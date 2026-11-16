import * as vscode from 'vscode';
import * as path from 'node:path';
import type { AgentOption, AiPhase, AiStatusPayload, AiTraceItem } from '../../shared/types';
import { readAiConfig, type AiConfig } from '../ai/config';
import { AGENTS, createSession, resolveExecutable } from '../ai/index';
import { generateMap } from '../ai/mapGenerator';
import type { PromptAnchor } from '../ai/prompt';
import { AiError, type AgentCancel, type AgentSession } from '../ai/types';
import { errorMessage } from '../core/errors';
import { assertRelativeSourcePath } from '../core/paths';
import { checkedSourceUri } from './paths';
import { writeMapFile } from './mapWriter';
import type { MapRecord } from './repository';
import { CopilotSession, probeCopilotLm } from './copilotEngine';
import { readWorkspaceText } from './workspaceText';
import { t } from '../../shared/i18n';

export interface AiHostHooks {
  log: vscode.OutputChannel;
  root(): vscode.WorkspaceFolder | undefined;
  refresh(): Promise<void>;
  /** True when a map with this id already exists in the given root. */
  hasMap(id: string): boolean;
  /** Opens a newly written or updated map. */
  open(mapKey: string): Promise<void>;
}

export interface GenerateOptions {
  topic: string;
  agentId?: string;
  anchor?: PromptAnchor;
  files?: string[];
  overwrite?: MapRecord;
}

const PROGRESS_INTERVAL_MS = 250;
const MAX_TRACES = 40;

interface Task {
  topic: string;
  sessionId?: string;
  cancel: vscode.CancellationTokenSource;
  dispose(): void;
}

export class AiService implements vscode.Disposable {
  private running?: Task;
  private starting = false;
  private lastProgress = 0;
  private lastPhase = '';
  private progress?: vscode.Progress<{ message?: string }>;
  private traceCounter = 0;
  private copilotLmReady = false;
  private availabilityProbed = false;
  private currentStatus: AiStatusPayload = { busy: false, traces: [] };
  private readonly statusChanged = new vscode.EventEmitter<AiStatusPayload>();
  readonly onDidChangeStatus = this.statusChanged.event;

  constructor(private readonly hooks: AiHostHooks) {}

  get busy(): boolean { return this.starting || this.running !== undefined; }

  status(): AiStatusPayload {
    return this.currentStatus;
  }

  /** Re-probes host capabilities (e.g. VS Code LM availability) for catalog status. */
  async refreshAvailability(): Promise<void> {
    this.copilotLmReady = await probeCopilotLm();
    this.availabilityProbed = true;
  }

  /**
   * Lists all available AI engines in priority order (`copilot` -> `agy` -> `codex` -> `claude` -> custom)
   * with live availability metadata, and computes the effective active engine.
   */
  catalog(): { agents: AgentOption[]; currentAgentId: string } {
    const config = readAiConfig();
    const agents: AgentOption[] = AGENTS.map(item => {
      const hasOverride = item.id === config.agent && Boolean(config.command);
      const cmd = hasOverride ? config.command : item.id;
      const cliPath = resolveExecutable(cmd);

      if (item.id === 'copilot') {
        if (cliPath) {
          return {
            id: item.id,
            label: item.label,
            kind: 'cli',
            available: true,
            badge: 'CLI',
            detail: cliPath,
          };
        }
        if (this.copilotLmReady && !hasOverride) {
          return {
            id: item.id,
            label: item.label,
            kind: 'copilot',
            available: true,
            badge: 'VS Code LM',
            detail: 'vscode.lm',
          };
        }
        return {
          id: item.id,
          label: item.label,
          kind: 'cli',
          available: false,
          badge: t('host.agentBadgeMissing'),
          detail: cmd,
        };
      }

      return {
        id: item.id,
        label: item.label,
        kind: 'cli',
        available: Boolean(cliPath),
        badge: cliPath ? 'CLI' : t('host.agentBadgeMissing'),
        detail: cliPath ?? cmd,
      };
    });

    for (const item of config.customAgents) {
      const cliPath = resolveExecutable(item.command);
      agents.push({
        id: item.id,
        label: item.label || item.id,
        kind: 'custom',
        available: Boolean(cliPath),
        badge: cliPath ? 'Custom' : t('host.agentBadgeMissing'),
        detail: cliPath ?? item.command,
      });
    }

    const autoPicked = agents.find(item => item.available && item.kind !== 'copilot')
      ?? agents.find(item => item.available)
      ?? agents[0]!;
    const currentAgentId = config.agentExplicit && agents.some(item => item.id === config.agent)
      ? config.agent
      : autoPicked.id;

    return { agents, currentAgentId };
  }

  /** Creates a read-only workspace session using the currently active engine (CLI or VS Code LM fallback). */
  openSession(root: vscode.WorkspaceFolder): AgentSession {
    const config = readAiConfig();
    const { currentAgentId } = this.catalog();
    const effectiveConfig: AiConfig = {
      ...config,
      agent: currentAgentId,
      command: currentAgentId === config.agent ? config.command : '',
    };

    if (currentAgentId === 'copilot') {
      const hasOverride = Boolean(effectiveConfig.command);
      const cliPath = resolveExecutable(effectiveConfig.command || 'copilot');
      if (!cliPath && !hasOverride && typeof vscode.lm?.selectChatModels === 'function') {
        return new CopilotSession(root);
      }
    }
    return createSession(effectiveConfig);
  }

  async setAgent(agent: string, quiet = false): Promise<void> {
    const config = vscode.workspace.getConfiguration('codeDetective.ai');
    const section = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await config.update('agent', agent, section);
    if (!quiet) {
      const label = this.catalog().agents.find(item => item.id === agent)?.label ?? agent;
      void vscode.window.showInformationMessage(t('host.agentSwitched', { agent: label }));
    }
  }

  async chooseInteractive(): Promise<boolean> {
    await this.refreshAvailability();
    const { agents, currentAgentId } = this.catalog();
    const picked = await vscode.window.showQuickPick(
      agents.map(item => ({
        label: item.label,
        description: item.id === currentAgentId ? t('host.agentCurrent') : item.badge,
        detail: item.detail ?? item.id,
        id: item.id,
      })),
      { title: t('host.agentPickTitle'), placeHolder: t('host.agentPickPlaceholder') },
    );
    if (!picked) return false;
    await this.setAgent(picked.id);
    return true;
  }

  cancel(): void {
    this.running?.cancel.cancel();
  }

  private pushTrace(kind: AiTraceItem['kind'], text: string, detail?: string): void {
    const clean = text.trim();
    if (!clean) return;
    const prev = this.currentStatus.traces.at(-1);
    if (prev && prev.kind === kind && prev.text === clean && prev.detail === detail) return;
    const nextTrace: AiTraceItem = {
      id: `tr-${++this.traceCounter}`,
      kind,
      text: clean,
      detail,
      timestamp: Date.now(),
    };
    const traces = [...this.currentStatus.traces, nextTrace].slice(-MAX_TRACES);
    this.currentStatus = { ...this.currentStatus, traces };
    this.statusChanged.fire(this.currentStatus);
  }

  private updateStatus(patch: Partial<AiStatusPayload>): void {
    this.currentStatus = { ...this.currentStatus, ...patch };
    this.statusChanged.fire(this.currentStatus);
  }

  private report(phase: AiPhase, message?: string, chars?: number): void {
    const now = Date.now();
    const phaseChanged = phase !== this.lastPhase;
    if (!phaseChanged && now - this.lastProgress < PROGRESS_INTERVAL_MS) return;
    this.lastProgress = now;
    this.lastPhase = phase;
    const text = chars && chars > 0 ? `${message ?? ''} · ${chars}` : message;
    this.progress?.report({ message: text });
    this.updateStatus({ phase });
    if (phaseChanged && message) {
      this.pushTrace(phase === 'retry' ? 'retry' : 'status', message);
    }
  }

  async generate(options: GenerateOptions | string, legacyAgentId?: string, legacyFiles?: string[]): Promise<void> {
    const req: GenerateOptions = typeof options === 'string'
      ? { topic: options, agentId: legacyAgentId, files: legacyFiles }
      : options;

    const root = req.overwrite?.root ?? this.hooks.root();
    if (!root) {
      void vscode.window.showWarningMessage(t('host.openWorkspaceFirst'));
      return;
    }
    if (this.busy) {
      void vscode.window.showWarningMessage(t('host.aiTaskRunning'));
      return;
    }
    this.starting = true;
    try {
      if (!this.availabilityProbed) {
        await this.refreshAvailability();
      }
      if (req.agentId && req.agentId !== this.catalog().currentAgentId) {
        await this.setAgent(req.agentId, true);
      }
    } catch (error) {
      this.starting = false;
      throw error;
    }

    const source = new vscode.CancellationTokenSource();
    const listeners = new Set<() => void>();
    const subscription = source.token.onCancellationRequested(() => { for (const listener of listeners) listener(); });
    const cancel: AgentCancel = {
      get isCancellationRequested() { return source.token.isCancellationRequested; },
      onCancellationRequested(listener: () => void) {
        const inner = source.token.onCancellationRequested(listener);
        listeners.add(listener);
        return inner;
      },
    };
    const task: Task = {
      topic: req.topic,
      cancel: source,
      dispose: () => { subscription.dispose(); listeners.clear(); },
    };
    this.running = task;
    this.starting = false;
    const started = Date.now();
    this.lastPhase = '';
    this.lastProgress = 0;

    const { agents, currentAgentId } = this.catalog();
    const agentLabel = agents.find(a => a.id === currentAgentId)?.label ?? currentAgentId;
    this.currentStatus = {
      busy: true,
      topic: req.topic,
      agentId: currentAgentId,
      agentLabel,
      phase: 'preparing',
      traces: [],
      error: undefined,
    };
    this.statusChanged.fire(this.currentStatus);

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: t('host.aiProgressTitle', { topic: req.topic }),
      cancellable: true,
    }, async (progress, token) => {
      this.progress = progress;
      const stop = token.onCancellationRequested(() => source.cancel());
      try {
        await this.run(task, root, req, source, cancel, started);
      } finally {
        stop.dispose();
        this.progress = undefined;
        task.dispose();
        if (this.running === task) this.running = undefined;
        source.dispose();
      }
    });
  }

  private async run(
    task: Task,
    root: vscode.WorkspaceFolder,
    req: GenerateOptions,
    source: vscode.CancellationTokenSource,
    cancel: AgentCancel,
    started: number,
  ): Promise<void> {
    try {
      const config = readAiConfig();
      const session = this.openSession(root);
      this.updateStatus({ agentId: session.id, agentLabel: session.label });
      this.report('preparing', t('host.aiStarting', { agent: session.label }));

      const explicitFiles = [
        ...(req.anchor?.file ? [req.anchor.file] : []),
        ...(req.files ?? []),
      ];

      const result = await generateMap(session, {
        topic: req.topic,
        rootName: root.name,
        anchor: req.anchor,
        priorityFiles: await this.priorityFiles(root, explicitFiles),
        cwd: root.uri.fsPath,
        timeoutMs: config.timeoutMs,
        cancel,
        onPhase: (phase, detail) => {
          this.report(
            phase,
            phase === 'validating'
              ? t('host.aiValidating')
              : phase === 'retry'
                ? t('host.aiRetrying', { agent: session.label })
                : t('host.aiReading', { agent: session.label }),
            detail === undefined ? undefined : detail.length,
          );
        },
        onProgress: chars => this.report('running', t('host.aiReading', { agent: session.label }), chars),
        onActivity: activity => {
          this.pushTrace(activity.kind, activity.text, activity.detail);
          this.progress?.report({ message: `${activity.text}${activity.detail ? ` (${activity.detail})` : ''}` });
        },
        readFile: file => readWorkspaceText(root, file),
      }, { retries: 1 });
      task.sessionId = result.sessionId;

      if (source.token.isCancellationRequested) {
        this.updateStatus({ busy: false, phase: 'cancelled' });
        void vscode.window.showInformationMessage(t('host.aiCancelled'));
        return;
      }
      this.lastPhase = '';
      this.report('validating', t('host.aiWriting'));
      const written = await writeMapFile(result.map, {
        root,
        hasMap: key => this.hooks.hasMap(key),
        overwrite: req.overwrite,
      });
      await this.hooks.refresh();
      this.lastPhase = '';
      this.report('done', t('host.aiGenerated', { file: path.posix.basename(written.relativePath) }));
      this.updateStatus({ busy: false, phase: 'done' });
      if (result.adjustments.length > 0) {
        this.hooks.log.appendLine(t('host.aiAdjustedLog', { title: result.map.title, adjustments: result.adjustments.join('\n') }));
      }
      const summary = t('host.aiSummary', { agent: session.label, seconds: Math.round((Date.now() - started) / 1000), attempts: result.attempts })
        + (result.adjustments.length > 0 ? t('host.aiSummaryAdjusted', { count: result.adjustments.length }) : '');
      await this.hooks.open(written.key);
      void vscode.window.showInformationMessage(t('host.aiGeneratedMap', { title: result.map.title, summary }));
    } catch (error) {
      const cancelled = source.token.isCancellationRequested
        || (error instanceof AiError && error.code === 'AI_CANCELLED');
      const message = cancelled ? t('host.aiCancelled') : errorMessage(error);
      if (!cancelled) this.hooks.log.appendLine(t('host.aiFailedLog', { message }));
      this.lastPhase = '';
      this.updateStatus({
        busy: false,
        phase: cancelled ? 'cancelled' : 'error',
        error: cancelled ? undefined : message,
      });
      if (cancelled) void vscode.window.showInformationMessage(message);
      else {
        void vscode.window.showErrorMessage(t('host.aiFailedLog', { message }), t('host.viewLog'))
          .then(choice => { if (choice) this.hooks.log.show(true); });
      }
    }
  }

  private async priorityFiles(root: vscode.WorkspaceFolder, explicit?: string[]): Promise<string[]> {
    const seen = new Set<string>();
    const output: string[] = [];
    const add = (uri: vscode.Uri): void => {
      if (uri.scheme !== 'file') return;
      const relative = path.relative(root.uri.fsPath, uri.fsPath).split(path.sep).join('/');
      if (!relative || relative.startsWith('..') || seen.has(relative)) return;
      try {
        assertRelativeSourcePath(relative);
      } catch { return; }
      seen.add(relative);
      output.push(relative);
    };
    for (const file of explicit ?? []) {
      try {
        assertRelativeSourcePath(file);
        const checked = await checkedSourceUri(root.uri, file);
        add(checked.uri);
      } catch { /* skip files outside the workspace */ }
    }
    for (const editor of vscode.window.visibleTextEditors) add(editor.document.uri);
    return output.slice(0, 20);
  }

  dispose(): void {
    this.cancel();
    this.statusChanged.dispose();
  }
}
