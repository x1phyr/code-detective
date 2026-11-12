import * as vscode from 'vscode';
import * as path from 'node:path';
import type { AiPhase, AiAgentStatus, AiResultPayload, CodeMap } from '../../shared/types';
import { readAiConfig, type AiConfig } from '../ai/config';
import { agentCatalog, createSession } from '../ai/index';
import { generateMap } from '../ai/mapGenerator';
import { AiError, type AgentCancel } from '../ai/types';
import { errorMessage } from '../core/errors';
import { assertRelativeSourcePath } from '../core/paths';
import { checkedSourceUri } from './paths';
import { writeMapFile, type WrittenMap } from './mapWriter';

export interface AiHostHooks {
  log: vscode.OutputChannel;
  root(): vscode.WorkspaceFolder | undefined;
  refresh(): Promise<void>;
  /** True when a map with this id already exists in the given root. */
  hasMap(id: string): boolean;
  notify(message: string, severity?: 'info' | 'warning' | 'error'): void;
  progress(phase: AiPhase, message?: string, chars?: number): void;
  result(payload: AiResultPayload): void;
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
    this.hooks.progress(phase, message, chars);
  }

  constructor(private readonly hooks: AiHostHooks) {}

  get busy(): boolean { return this.starting || this.running !== undefined; }

  /** Which agent CLIs are configured, for the webview picker. */
  status(): { providers: AiAgentStatus[]; config: AiConfig } {
    const config = readAiConfig();
    const providers = agentCatalog(config).map(item => ({
      id: item.id,
      label: item.label,
      available: true,
      detail: item.id === config.agent
        ? `${config.command || item.id} · 工作区 ${config.allowedTools}`
        : `切换到 ${config.command || item.id}`,
      current: item.id === config.agent,
    }));
    return { providers, config };
  }

  async setAgent(agent: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('codeDetective.ai');
    const section = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await config.update('agent', agent, section);
    this.hooks.notify(`已切换到 ${agent}。`);
  }

  /** Quick pick over the built-in agents plus any configured custom ones. */
  async chooseInteractive(): Promise<boolean> {
    const config = readAiConfig();
    const known = agentCatalog(config);
    const picked = await vscode.window.showQuickPick(
      known.map(item => ({
        label: item.label,
        description: item.id === config.agent ? '当前' : undefined,
        detail: item.id === config.agent ? `${config.command || item.id}` : undefined,
        id: item.id,
      })),
      { title: '选择运行地图生成的 agent CLI', placeHolder: 'agent 会在当前工作区里自己阅读源码' },
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
      this.hooks.notify('请先打开一个工作区文件夹。', 'warning');
      return;
    }
    if (this.busy) {
      this.hooks.notify('已有 AI 任务在运行，请先取消。', 'warning');
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

    try {
      const config = readAiConfig();
      this.report('preparing', `正在启动 ${config.agent}`);
      const session = createSession(config);
      const result = await generateMap(session, {
        topic,
        rootName: root.name,
        priorityFiles: await this.priorityFiles(root, files),
        cwd: root.uri.fsPath,
        timeoutMs: config.timeoutMs,
        cancel,
        onPhase: (phase, detail) => {
          this.report(phase, phase === 'validating' ? '正在校验地图'
            : phase === 'retry' ? `校验失败，正在让 ${session.label} 修正` : `${session.label} 正在阅读源码`,
          detail === undefined ? undefined : detail.length);
        },
        onProgress: chars => this.report('running', `${session.label} 正在阅读源码`, chars),
      }, { retries: 1 });
      task.sessionId = result.sessionId;

      if (source.token.isCancellationRequested) {
        this.hooks.result({ ok: false, phase: 'cancelled', message: '已取消。' });
        return;
      }
      this.lastPhase = '';
      this.report('validating', '正在写入地图');
      const written = await this.writeMap(root, result.map);
      await this.hooks.refresh();
      this.lastPhase = '';
      this.report('done', `已生成 ${path.posix.basename(written.relativePath)}`);
      this.hooks.result({
        ok: true,
        phase: 'done',
        mapKey: written.key,
        title: result.map.title,
        fileName: written.relativePath,
        provider: session.label,
        message: `${session.label} · ${Math.round((Date.now() - started) / 1000)} 秒 · ${result.attempts} 轮`,
      });
    } catch (error) {
      const cancelled = source.token.isCancellationRequested
        || (error instanceof AiError && error.code === 'AI_CANCELLED');
      const message = cancelled ? '已取消 AI 生成。' : errorMessage(error);
      if (!cancelled) this.hooks.log.appendLine(`AI 生成失败：${message}`);
      this.lastPhase = '';
      this.report(cancelled ? 'cancelled' : 'error', message);
      this.hooks.result({ ok: false, phase: cancelled ? 'cancelled' : 'error', message });
    } finally {
      task.dispose();
      if (this.running === task) this.running = undefined;
      source.dispose();
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
