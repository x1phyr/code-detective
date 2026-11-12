import * as vscode from 'vscode';
import * as path from 'node:path';
import type { AiPhase, AiProviderStatus, AiResultPayload, CodeMap } from '../../shared/types';
import { readAiConfig, readApiKey, storeApiKey, normalizeBaseUrl, type AiConfig } from '../ai/config';
import { LOCAL_PROBES, resolveProvider } from '../ai/index';
import { OpenAiCompatibleProvider } from '../ai/openaiCompatible';
import { generateMap } from '../ai/mapGenerator';
import { AiError, type AiCancel } from '../ai/types';
import { errorMessage } from '../core/errors';
import { assertRelativeSourcePath } from '../core/paths';
import { checkedSourceUri } from './paths';
import { writeMapFile, type WrittenMap } from './mapWriter';

export interface AiHostHooks {
  secrets: vscode.SecretStorage;
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

export class AiService implements vscode.Disposable {
  private running?: { topic: string; dispose(): void; source: vscode.CancellationTokenSource };
  private lastProgress = 0;
  private lastPhase = '';

  /** Streaming tokens arrive per chunk; throttle so the webview is not flooded. */
  private report(phase: AiPhase, message?: string, chars?: number): void {
    const now = Date.now();
    const phaseChanged = phase !== this.lastPhase;
    if (!phaseChanged && now - this.lastProgress < PROGRESS_INTERVAL_MS) return;
    this.lastProgress = now;
    this.lastPhase = phase;
    this.hooks.progress(phase, message, chars);
  }

  constructor(private readonly hooks: AiHostHooks) {}

  get busy(): boolean { return this.running !== undefined; }

  async status(): Promise<{ providers: AiProviderStatus[]; config: AiConfig }> {
    const config = readAiConfig();
    const apiKey = await readApiKey(this.hooks.secrets);
    let localDetail = `${config.baseUrl}${config.model ? ` · ${config.model}` : ' · 未选择模型'}`;
    let localAvailable = false;
    for (const probe of LOCAL_PROBES) {
      const models = await new OpenAiCompatibleProvider({
        baseUrl: probe.baseUrl, model: '', apiKey, timeoutMs: 1_200,
      }).listModels().catch(() => []);
      if (models.length > 0) {
        localAvailable = true;
        if (probe.baseUrl === config.baseUrl.replace(/\/+$/, '') || !config.model) {
          localDetail = `${probe.label} · ${models.slice(0, 3).join(', ')}${models.length > 3 ? ' …' : ''}`;
        }
        break;
      }
    }
    if (!localAvailable) localDetail += '（未探测到本地服务）';
    let lmDetail = '使用已安装的 Copilot Chat 等模型';
    let lmAvailable = false;
    try {
      const models = await vscode.lm.selectChatModels(config.vscodeLmVendor ? { vendor: config.vscodeLmVendor } : {});
      lmAvailable = models.length > 0;
      lmDetail = models.length > 0 ? models.slice(0, 3).map(model => model.name).join(', ') : '没有可用模型';
    } catch {
      lmDetail = '不可用';
    }
    const providers: AiProviderStatus[] = [
      { id: 'auto', label: '自动选择', available: true, detail: '优先本地模型服务，其次 CLI，最后 VS Code 模型', current: config.provider === 'auto' },
      {
        id: 'openai-compatible',
        label: '本地模型服务（OpenAI 兼容）',
        available: localAvailable || config.model.length > 0,
        detail: localDetail,
        current: config.provider === 'openai-compatible',
      },
      {
        id: 'cli',
        label: '本地 CLI Agent',
        available: config.cliCommand.trim().length > 0,
        detail: config.cliCommand ? `${config.cliCommand} ${config.cliArgs.join(' ')}`.trim() : '未配置',
        current: config.provider === 'cli',
      },
      {
        id: 'vscode-lm',
        label: 'VS Code 语言模型',
        available: lmAvailable,
        detail: lmDetail,
        current: config.provider === 'vscode-lm',
      },
    ];
    return { providers, config };
  }

  async setProvider(provider: string, baseUrl?: string, model?: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('codeDetective.ai');
    // 工作区设置需要打开文件夹；单文件模式下退回用户设置。
    const section = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await config.update('provider', provider, section);
    if (baseUrl !== undefined) await config.update('baseUrl', baseUrl, section);
    if (model !== undefined) await config.update('model', model, section);
    this.hooks.notify(`AI 服务已切换为 ${provider}。`);
  }

  /** Lets the user pick a provider and, for local servers, an actual model. */
  async chooseInteractive(): Promise<boolean> {
    const config = readAiConfig();
    const items: (vscode.QuickPickItem & { action: string; baseUrl?: string; model?: string })[] = [];
    for (const probe of LOCAL_PROBES) {
      const models = await new OpenAiCompatibleProvider({
        baseUrl: probe.baseUrl, model: '', apiKey: await readApiKey(this.hooks.secrets), timeoutMs: 1_200,
      }).listModels().catch(() => []);
      if (models.length === 0) continue;
      for (const model of models.slice(0, 12)) {
        items.push({
          label: `$(server) ${probe.label}`,
          description: model,
          detail: probe.baseUrl,
          action: 'openai-compatible',
          baseUrl: probe.baseUrl,
          model,
        });
      }
    }
    if (config.cliCommand) {
      items.push({
        label: '$(terminal) 本地 CLI Agent',
        description: `${config.cliCommand} ${config.cliArgs.join(' ')}`.trim(),
        detail: '复用已登录的本地 agent，无需 API Key',
        action: 'cli',
      });
    }
    items.push({ label: '$(sparkle) VS Code 语言模型', description: 'Copilot Chat 等已安装模型', action: 'vscode-lm' });
    items.push({ label: '$(gear) 自定义 OpenAI 兼容地址…', description: config.baseUrl, action: 'custom' });

    const picked = await vscode.window.showQuickPick(items, {
      title: '选择 AI 服务',
      placeHolder: items.length > 0 ? '本地探测到的模型优先显示' : '没有探测到本地模型，请手动配置',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) return false;
    if (picked.action === 'custom') {
      const url = await vscode.window.showInputBox({
        title: 'OpenAI 兼容服务地址',
        value: config.baseUrl,
        prompt: '例如 http://127.0.0.1:11434/v1（Ollama）或 http://127.0.0.1:1234/v1（LM Studio）',
        validateInput: value => {
          try { new URL(value); return undefined; } catch { return '请输入合法的 URL。'; }
        },
      });
      if (!url) return false;
      const model = await vscode.window.showInputBox({ title: '模型名称', value: config.model, prompt: '例如 qwen2.5-coder:14b' });
      if (model === undefined) return false;
      await this.setProvider('openai-compatible', url, model);
      return true;
    }
    await this.setProvider(picked.action, picked.baseUrl, picked.model);
    return true;
  }

  /** Optional API key entry, stored in SecretStorage rather than settings.json. */
  async promptForApiKey(): Promise<void> {
    const value = await vscode.window.showInputBox({
      title: 'AI 服务 API Key（可留空）',
      password: true,
      prompt: '仅保存在 VS Code SecretStorage 中；本地模型通常不需要。',
    });
    if (value === undefined) return;
    await storeApiKey(this.hooks.secrets, value.trim());
    this.hooks.notify(value.trim() ? '已保存 API Key。' : '已清除 API Key。');
  }

  cancel(): void {
    this.running?.source.cancel();
  }

  async generate(topic: string, providerId?: string, files?: string[]): Promise<void> {
    const root = this.hooks.root();
    if (!root) {
      this.hooks.notify('请先打开一个工作区文件夹。', 'warning');
      return;
    }
    if (this.running) {
      this.hooks.notify('已有 AI 任务在运行，请先取消。', 'warning');
      return;
    }
    const source = new vscode.CancellationTokenSource();
    const listeners = new Set<() => void>();
    const subscription = source.token.onCancellationRequested(() => { for (const listener of listeners) listener(); });
    const cancel: AiCancel = {
      get isCancellationRequested() { return source.token.isCancellationRequested; },
      onCancellationRequested(listener: () => void) {
        const inner = source.token.onCancellationRequested(listener);
        listeners.add(listener);
        return inner;
      },
    };
    this.running = { topic, source, dispose: () => { subscription.dispose(); listeners.clear(); } };
    const started = Date.now();
    try {
      const config = readAiConfig();
      if (providerId && providerId !== config.provider) {
        // 直接落盘，避免 setProvider 额外弹出切换提示。
        const target = vscode.workspace.workspaceFolders?.length
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
        await vscode.workspace.getConfiguration('codeDetective.ai').update('provider', providerId, target);
      }
      const effective = readAiConfig();
      if (effective.provider === 'openai-compatible') {
        // 明确选择该通道时提前校验地址；`auto` 交给回退链逐项尝试。
        normalizeBaseUrl(effective.baseUrl, effective);
      }
      this.lastPhase = '';
      this.lastProgress = 0;
      this.report('preparing', '正在准备上下文');
      const resolved = await resolveProvider(readAiConfig(), {
        secrets: this.hooks.secrets,
        log: this.hooks.log,
        cwd: root.uri.fsPath,
      });
      this.report('running', `使用 ${resolved.provider.label}`);
      const result = await generateMap(resolved.provider, {
        topic,
        root,
        priorityFiles: await this.priorityFiles(root, files),
        cancel,
        onProgress: (phase, text) => {
          this.report(phase, phase === 'validating' ? '正在校验生成结果'
            : phase === 'retry' ? '校验失败，正在重试' : `使用 ${resolved.provider.label}`, text.length);
        },
      }, { retries: 1 });
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
        provider: resolved.provider.label,
        message: `${resolved.provider.label} · ${Math.round((Date.now() - started) / 1000)} 秒 · ${result.attempts} 次尝试`,
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
      this.running?.dispose();
      this.running = undefined;
      source.dispose();
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
    for (const document of vscode.workspace.textDocuments) if (!document.isUntitled) add(document.uri);
    return output;
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
