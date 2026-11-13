import * as vscode from 'vscode';
import { readWorkspaceText } from './workspaceText';
import * as path from 'node:path';
import type { AiPhase, CodeMap } from '../../shared/types';
import { readAiConfig, type AiConfig } from '../ai/config';
import { agentCatalog, createSession } from '../ai/index';
import { generateMap } from '../ai/mapGenerator';
import { AiError, type AgentCancel } from '../ai/types';
import { errorMessage } from '../core/errors';
import { assertRelativeSourcePath } from '../core/paths';
import { checkedSourceUri } from './paths';
import { writeMapFile, type WrittenMap } from './mapWriter';
import { t } from '../../shared/i18n';

export interface AiHostHooks {
  log: vscode.OutputChannel;
  root(): vscode.WorkspaceFolder | undefined;
  refresh(): Promise<void>;
  /** True when a map with this id already exists in the given root. */
  hasMap(id: string): boolean;
  /** 生成成功后打开地图。 */
  open(mapKey: string): Promise<void>;
}

const PROGRESS_INTERVAL_MS = 250;

/** Last session of the current task, so a retry continues the same conversation. */
interface Task {
  topic: string;
  sessionId?: string;
  cancel: vscode.CancellationTokenSource;
  dispose(): void;
}

export class AiService implements vscode.Disposable {
  private running?: Task;
  /** Set synchronously before the first await, so two quick requests can't both start. */
  private starting = false;
  private lastProgress = 0;
  private lastPhase = '';

  private report(phase: AiPhase, message?: string, chars?: number): void {
    const now = Date.now();
    const phaseChanged = phase !== this.lastPhase;
    if (!phaseChanged && now - this.lastProgress < PROGRESS_INTERVAL_MS) return;
    this.lastProgress = now;
    this.lastPhase = phase;
    const text = chars && chars > 0 ? `${message ?? ''} · ${chars}` : message;
    this.progress?.report({ message: text });
  }
  private progress?: vscode.Progress<{ message?: string }>;

  constructor(private readonly hooks: AiHostHooks) {}

  get busy(): boolean { return this.starting || this.running !== undefined; }

  async setAgent(agent: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('codeDetective.ai');
    const section = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await config.update('agent', agent, section);
    void vscode.window.showInformationMessage(t('host.agentSwitched', { agent }));
  }

  /** Quick pick over the built-in agents plus any configured custom ones. */
  async chooseInteractive(): Promise<boolean> {
    const config = readAiConfig();
    const known = agentCatalog(config);
    const picked = await vscode.window.showQuickPick(
      known.map(item => ({
        label: item.label,
        description: item.id === config.agent ? t('host.agentCurrent') : undefined,
        detail: item.id === config.agent ? `${config.command || item.id}` : undefined,
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

  async generate(topic: string, agentId?: string, files?: string[]): Promise<void> {
    const root = this.hooks.root();
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
      if (agentId) await this.setAgent(agentId);
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
      topic,
      cancel: source,
      dispose: () => { subscription.dispose(); listeners.clear(); },
    };
    this.running = task;
    this.starting = false;
    const started = Date.now();
    this.lastPhase = '';
    this.lastProgress = 0;

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: t('host.aiProgressTitle', { topic }),
      cancellable: true,
    }, async (progress, token) => {
      this.progress = progress;
      const stop = token.onCancellationRequested(() => source.cancel());
      try {
        await this.run(task, root, topic, files, source, cancel, started);
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
    task: Task, root: vscode.WorkspaceFolder, topic: string, files: string[] | undefined,
    source: vscode.CancellationTokenSource, cancel: AgentCancel, started: number,
  ): Promise<void> {
    try {
      const config = readAiConfig();
      this.report('preparing', t('host.aiStarting', { agent: config.agent }));
      const session = createSession(config);
      const result = await generateMap(session, {
        topic,
        rootName: root.name,
        priorityFiles: await this.priorityFiles(root, files),
        cwd: root.uri.fsPath,
        timeoutMs: config.timeoutMs,
        cancel,
        onPhase: (phase, detail) => {
          this.report(phase, phase === 'validating' ? t('host.aiValidating')
            : phase === 'retry' ? t('host.aiRetrying', { agent: session.label }) : t('host.aiReading', { agent: session.label }),
          detail === undefined ? undefined : detail.length);
        },
        onProgress: chars => this.report('running', t('host.aiReading', { agent: session.label }), chars),
        readFile: file => readWorkspaceText(root, file),
      }, { retries: 1 });
      task.sessionId = result.sessionId;

      if (source.token.isCancellationRequested) {
        void vscode.window.showInformationMessage(t('host.aiCancelled'));
        return;
      }
      this.lastPhase = '';
      this.report('validating', t('host.aiWriting'));
      const written = await this.writeMap(root, result.map);
      await this.hooks.refresh();
      this.lastPhase = '';
      this.report('done', t('host.aiGenerated', { file: path.posix.basename(written.relativePath) }));
      if (result.adjustments.length > 0) {
        this.hooks.log.appendLine(t('host.aiAdjustedLog', { title: result.map.title, adjustments: result.adjustments.join('\n') }));
      }
      const summary = t('host.aiSummary', { agent: session.label, seconds: Math.round((Date.now() - started) / 1000), attempts: result.attempts })
        + (result.adjustments.length > 0 ? t('host.aiSummaryAdjusted', { count: result.adjustments.length }) : '');
      void this.hooks.open(written.key);
      void vscode.window.showInformationMessage(t('host.aiGeneratedMap', { title: result.map.title, summary }));
    } catch (error) {
      const cancelled = source.token.isCancellationRequested
        || (error instanceof AiError && error.code === 'AI_CANCELLED');
      const message = cancelled ? t('host.aiCancelled') : errorMessage(error);
      if (!cancelled) this.hooks.log.appendLine(t('host.aiFailedLog', { message }));
      this.lastPhase = '';
      if (cancelled) void vscode.window.showInformationMessage(message);
      else {
        void vscode.window.showErrorMessage(t('host.aiFailedLog', { message }), t('host.viewLog'))
          .then(choice => { if (choice) this.hooks.log.show(true); });
      }
    }
  }

  /** Files the user is looking at; only a hint, the agent reads what it needs. */
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

  private async writeMap(
    root: vscode.WorkspaceFolder,
    map: { id: string; title: string },
  ): Promise<WrittenMap> {
    return writeMapFile(map as CodeMap, {
      root,
      hasMap: key => this.hooks.hasMap(key),
    });
  }

  dispose(): void {
    this.cancel();
  }
}
