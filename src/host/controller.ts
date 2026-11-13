import * as vscode from 'vscode';
import {
  DEFAULT_VIEW_STATE,
  SOURCE_STATE_LABELS,
  type BridgeMessage,
  type HostMessage,
  type InitializePayload,
  type MapSnapshot,
  type MapSummary,
  type RevealPayload,
  type Selection,
  type ThemeKind,
  type ViewState,
} from '../../shared/types';
import { sanitizeViewState, sourceIdsForSelection } from '../core/selection';
import { parseBridgeMessage, validateUiPatch, asRevealPayload, type UiPatch } from './bridge';
import { HostError, errorMessage } from '../core/errors';
import { HighlightController, sourceRange } from './highlights';
import { checkedSourceUri } from './paths';
import { MapRepository, type MapRecord } from './repository';
import { SessionStore } from './session';
import { SourceService, isUsableSource, type AcceptedMap } from './sources';
import { AiService } from './ai';
import { registerChatIntegration } from './chat';
import { webviewHtml, webviewRoot } from './webview';

const VIEW_TYPE = 'codeDetective.mapView';
const HELP_URL = 'https://github.com/x1phyr/code-detective#地图格式';

function isAccepted(record: MapRecord | undefined): record is AcceptedMap {
  return record !== undefined && record.map !== undefined && record.revision !== undefined;
}

function themeKind(): ThemeKind {
  const kind = vscode.window.activeColorTheme.kind;
  if (kind === vscode.ColorThemeKind.Light) return 'light';
  if (kind === vscode.ColorThemeKind.HighContrastLight) return 'high-contrast-light';
  if (kind === vscode.ColorThemeKind.HighContrast) return 'high-contrast';
  return 'dark';
}

export class DetectiveController implements vscode.Disposable {
  private readonly log: vscode.OutputChannel;
  private readonly repository: MapRepository;
  private readonly session: SessionStore;
  private readonly sources: SourceService;
  private readonly highlights: HighlightController;
  private readonly ai: AiService;
  private readonly disposables: vscode.Disposable[] = [];
  /** The sidebar webview, once VS Code has resolved it (the user opened the tab). */
  private panel?: vscode.WebviewView;
  private current?: AcceptedMap;
  private ui?: ViewState;
  private started = false;
  /** Resolves once the first map scan finishes, so a restored panel can find its map. */
  private markScanned!: () => void;
  private readonly scanned = new Promise<void>(resolve => { this.markScanned = resolve; });

  constructor(private readonly context: vscode.ExtensionContext) {
    this.log = vscode.window.createOutputChannel('代码侦探');
    this.repository = new MapRepository(this.log);
    this.session = new SessionStore(context.workspaceState);
    this.sources = new SourceService(this.log);
    this.highlights = new HighlightController(this.sources);
    this.ai = new AiService({
      log: this.log,
      root: () => this.activeRoot(),
      refresh: () => this.repository.refresh(),
      hasMap: key => this.repository.get(key) !== undefined,
      notify: (message, severity = 'info') => this.notify(message, severity),
      progress: (phase, message, chars) => this.post({
        protocolVersion: 1,
        type: 'ai.progress',
        payload: { phase, message, chars },
      }),
      result: payload => this.post({ protocolVersion: 1, type: 'ai.result', payload }),
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.disposables.push(
      this.log,
      this.repository,
      this.sources,
      this.highlights,
      this.ai,
    );
    this.disposables.push(
      this.repository.onDidChange(() => { void this.onMapsChanged(); }),
      this.sources.onDidChange(() => {
        // Positions just resolved (or moved after an edit): redraw editor decorations too.
        this.highlights.schedule();
        this.pushSnapshot();
      }),
      vscode.window.onDidChangeActiveColorTheme(() => this.post({ protocolVersion: 1, type: 'theme', payload: { kind: themeKind() } })),
      vscode.window.registerWebviewViewProvider(VIEW_TYPE, {
        resolveWebviewView: view => this.attachView(view),
      }, { webviewOptions: { retainContextWhenHidden: true } }),
      vscode.commands.registerCommand('codeDetective.openMap', (key?: unknown) =>
        this.openMap(typeof key === 'string' && key.trim() ? key.trim() : undefined)),
      vscode.commands.registerCommand('codeDetective.refreshMaps', () => this.refreshMaps()),
      vscode.commands.registerCommand('codeDetective.startWalkthrough', () => this.startWalkthrough()),
      vscode.commands.registerCommand('codeDetective.nextStep', () => this.step(1)),
      vscode.commands.registerCommand('codeDetective.previousStep', () => this.step(-1)),
      vscode.commands.registerCommand('codeDetective.stopWalkthrough', () => this.stopWalkthrough()),
      vscode.commands.registerCommand('codeDetective.clearHighlights', () => this.clearHighlights()),
      vscode.commands.registerCommand('codeDetective.toggleHighlights', () => this.toggleHighlights()),
      vscode.commands.registerCommand('codeDetective.copyAuthoringPrompt', () => this.copyAuthoringPrompt()),
      vscode.commands.registerCommand('codeDetective.generateMap', () => this.generateMapCommand()),
      vscode.commands.registerCommand('codeDetective.chooseAiProvider', () => this.chooseAiProviderCommand()),
      vscode.commands.registerCommand('codeDetective.cancelAi', () => this.ai.cancel()),
      vscode.commands.registerCommand('codeDetective.openHelp', () => this.openHelp()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.repository.installWatchers();
        void this.repository.refresh().catch(error => this.log.appendLine(`地图扫描失败：${errorMessage(error)}`));
      }),
    );
    this.disposables.push(...registerChatIntegration({
      root: () => this.activeRoot(),
      hasMap: key => this.repository.get(key) !== undefined,
      refresh: () => this.repository.refresh(),
      openMap: key => this.openMap(key),
      notify: (message, severity = 'info') => this.notify(message, severity),
    }));
    if ((vscode.workspace.workspaceFolders ?? []).length === 0) {
      this.log.appendLine('没有打开的工作区；添加文件夹后会自动扫描地图。');
    }
    this.repository.installWatchers();
    try {
      await this.repository.refresh();
    } finally {
      this.markScanned();
    }
  }

  async shutdown(): Promise<void> {
    for (const item of this.disposables.splice(0)) {
      try { item.dispose(); } catch { /* ignore */ }
    }
    this.panel = undefined;
    await this.session.flush().catch(() => undefined);
  }

  dispose(): void { void this.shutdown(); }

  private async attachView(view: vscode.WebviewView): Promise<void> {
    this.panel = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [webviewRoot(this.context.extensionUri)] };
    view.webview.html = webviewHtml(view.webview, this.context.extensionUri);
    const messages = view.webview.onDidReceiveMessage((message: unknown) => { void this.onMessage(message); });
    view.onDidDispose(() => {
      messages.dispose();
      if (this.panel === view) {
        this.panel = undefined;
        this.highlights.clear();
      }
    });
    if (this.current) {
      this.updateTitle();
      return;
    }
    // VS Code may resolve the view before the first scan completes.
    await this.scanned;
    const restored = this.lastAccepted();
    if (restored && !this.current) await this.select(restored, { reuse: true });
  }

  /** Last map the user opened, so a recreated panel is never blank. */
  private lastAccepted(): AcceptedMap | undefined {
    const key = this.session.current();
    if (!key) return undefined;
    const record = this.repository.get(key);
    return isAccepted(record) ? record : undefined;
  }

  /** Shows the sidebar view; VS Code resolves it (attachView) the first time. */
  private async ensurePanel(): Promise<void> {
    if (this.panel) {
      this.panel.show(true);
      return;
    }
    await vscode.commands.executeCommand(`${VIEW_TYPE}.focus`);
  }

  private updateTitle(): void {
    if (this.panel) this.panel.description = this.current?.map.title;
  }

  private async openMap(key?: string): Promise<void> {
    await this.ensurePanel();

    const records = [...this.summaries()];
    if (records.length === 0) {
      this.reveal();
      this.post({ protocolVersion: 1, type: 'initialize', payload: { maps: [] } });
      void vscode.window.showWarningMessage('没有找到地图。请在 .code-detective/maps/ 下创建地图 JSON。');
      return;
    }

    const chosen = key ?? await this.pickMap(records);
    if (!chosen) return;
    const record = this.repository.get(chosen);
    if (!record) {
      void vscode.window.showWarningMessage(`没有找到地图：${chosen}`);
      return;
    }
    if (!isAccepted(record)) {
      void vscode.window.showErrorMessage(`地图无法打开：${record.error ?? '内容无效'}`);
      this.pushSnapshot();
      return;
    }
    await this.select(record);
  }

  private summaries(): MapSummary[] { return this.repository.summaries(); }

  private async pickMap(records: MapSummary[]): Promise<string | undefined> {
    const items = records.map(record => ({
      label: record.error ? `$(error) ${record.title}` : record.title,
      description: `${record.rootName} · ${record.fileName}`,
      detail: record.error,
      key: record.key,
    }));
    const picked = await vscode.window.showQuickPick(items, { title: '选择要打开的地图', matchOnDescription: true });
    return picked?.key;
  }

  private async select(record: AcceptedMap, options: { reuse?: boolean } = {}): Promise<void> {
    const previous = this.current;
    if (previous && previous.key !== record.key) await this.persist();
    this.current = record;
    const stored = this.session.get(record.key);
    this.ui = sanitizeViewState(record.map, stored ?? DEFAULT_VIEW_STATE);
    if (options.reuse !== true) this.session.setCurrent(record.key);
    this.sources.reset(record);
    this.highlights.update(record, this.ui);
    this.updateTitle();
    this.pushSnapshot();
  }

  private async refreshMaps(): Promise<void> {
    await this.repository.refresh();
    if (this.current) {
      const refreshed = this.repository.get(this.current.key);
      if (isAccepted(refreshed)) {
        this.current = refreshed;
        this.sources.reset(refreshed);
        this.ui = sanitizeViewState(refreshed.map, this.ui);
        this.highlights.update(refreshed, this.ui);
        this.pushSnapshot();
      }
    } else {
      this.pushSnapshot();
    }
  }

  private async onMapsChanged(): Promise<void> {
    if (this.current) {
      const refreshed = this.repository.get(this.current.key);
      if (isAccepted(refreshed) && refreshed.revision !== this.current.revision) {
        this.current = refreshed;
        this.sources.reset(refreshed);
        this.ui = sanitizeViewState(refreshed.map, this.ui);
        this.highlights.update(refreshed, this.ui);
        this.notify('地图已更新，阅读位置已保留。');
      } else if (!isAccepted(refreshed) && refreshed?.error) {
        this.notify(`地图无效，已保留上次有效版本：${refreshed.error}`, 'error');
        return this.pushSnapshot();
      } else if (!refreshed) {
        // Deleted, its `id` changed, or its workspace folder was removed.
        const title = this.current.map.title;
        await this.persist();
        this.current = undefined;
        this.ui = undefined;
        this.sources.reset();
        this.highlights.clear();
        this.updateTitle();
        this.notify(`地图「${title}」已被删除或改名，请从列表重新选择。`, 'warning');
      }
    }
    this.pushSnapshot();
  }

  private snapshot(): MapSnapshot | undefined {
    if (!this.current || !this.ui) return undefined;
    return {
      key: this.current.key,
      revision: this.current.revision,
      map: this.current.map,
      statuses: this.sources.statuses(),
      ui: this.ui,
      error: undefined,
    };
  }

  private pushSnapshot(): void {
    if (!this.panel) return;
    this.post({ protocolVersion: 1, type: 'snapshot', payload: { snapshot: this.snapshot() } });
    this.post({ protocolVersion: 1, type: 'maps', payload: { maps: this.summaries() } });
  }

  private post(message: HostMessage): void {
    void this.panel?.webview.postMessage(message);
  }

  private notify(message: string, severity: 'info' | 'warning' | 'error' = 'info'): void {
    this.post({ protocolVersion: 1, type: 'notice', payload: { message, severity } });
  }

  private async persist(): Promise<void> {
    if (this.current && this.ui) {
      const snapshot = structuredClone(this.ui);
      this.session.save(this.current.key, snapshot);
    }
    await Promise.resolve();
  }

  private reveal(): void {
    this.panel?.show(true);
  }

  private async onMessage(raw: unknown): Promise<void> {
    let message: BridgeMessage<Record<string, unknown>>;
    try {
      message = parseBridgeMessage(raw);
    } catch (error) {
      this.notify(errorMessage(error), 'error');
      return;
    }
    try {
      await this.dispatch(message);
    } catch (error) {
      const text = errorMessage(error);
      this.log.appendLine(`消息 ${message.type} 处理失败：${text}`);
      this.notify(text, error instanceof HostError ? 'warning' : 'error');
    }
  }

  private async dispatch(message: BridgeMessage<Record<string, unknown>>): Promise<void> {
    switch (message.type) {
      case 'view.ready':
        this.post({ protocolVersion: 1, type: 'initialize', payload: this.initializePayload() });
        this.post({ protocolVersion: 1, type: 'theme', payload: { kind: themeKind() } });
        void this.pushAiStatus();
        return;
      case 'maps.refresh':
        await this.refreshMaps();
        return;
      case 'prompt.copy':
        await this.copyAuthoringPrompt();
        return;
      case 'help.open':
        await this.openHelp();
        return;
      case 'ai.status':
        await this.pushAiStatus();
        return;
      case 'ai.select':
        await this.ai.setAgent(String(message.payload.agent));
        await this.pushAiStatus();
        return;
      case 'ai.generate': {
        const files = Array.isArray(message.payload.files) ? message.payload.files as string[] : undefined;
        await this.ai.generate(
          String(message.payload.topic),
          message.payload.agent === undefined ? undefined : String(message.payload.agent),
          files,
        );
        await this.pushAiStatus();
        return;
      }
      case 'ai.cancel':
        this.ai.cancel();
        return;
      case 'map.open': {
        const record = this.repository.get(message.mapKey ?? '');
        if (!isAccepted(record)) throw new HostError('MAP_NOT_FOUND', '地图不存在或当前无效。');
        await this.select(record);
        return;
      }
      case 'source.reveal':
        await this.revealSource(asRevealPayload(message));
        return;
      case 'tour.goto':
        await this.gotoStep(String(message.payload.stepId));
        return;
      case 'tour.stop':
        this.ui = this.ui ? { ...this.ui, stepId: undefined, selection: this.ui.selection?.kind === 'step' ? undefined : this.ui.selection } : this.ui;
        await this.commitUi();
        return;
      case 'highlight.setEnabled':
        await this.setHighlightEnabled(message.payload.enabled === true);
        return;
      case 'ui.patch': {
        const patch = validateUiPatch(message.payload);
        await this.applyUiPatch(patch);
        return;
      }
      default:
        throw new HostError('INVALID_MESSAGE', `不支持的消息类型：${message.type}`);
    }
  }

  /**
   * Folder that AI generation and chat tools work in. The folder of the file
   * you're editing wins; the open map's folder is only the fallback, so in a
   * multi-root workspace a map from folder A doesn't pull work about B into A.
   */
  private activeRoot(): vscode.WorkspaceFolder | undefined {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length <= 1) return folders[0];
    const active = vscode.window.activeTextEditor?.document.uri;
    if (active) {
      const owner = vscode.workspace.getWorkspaceFolder(active);
      if (owner) return owner;
    }
    if (this.current && folders.some(folder => folder.uri.toString() === this.current!.root.uri.toString())) {
      return this.current.root;
    }
    return folders[0];
  }

  private async pushAiStatus(): Promise<void> {
    const { providers, config } = this.ai.status();
    this.post({
      protocolVersion: 1,
      type: 'ai.status',
      payload: {
        providers,
        agent: config.agent,
        command: config.command,
        allowedTools: config.allowedTools,
      },
    });
  }

  private initializePayload(): InitializePayload {
    return { maps: this.summaries(), current: this.snapshot() };
  }

  private async applyUiPatch(patch: UiPatch): Promise<void> {
    if (!this.current || !this.ui) return;
    const { selection, ...rest } = patch;
    const next: Partial<ViewState> = { ...this.ui, ...rest };
    if (selection === null) {
      // Clearing keeps an active walkthrough step; sanitizeViewState re-selects it.
      delete next.selection;
      delete next.sourceId;
    } else if (selection !== undefined) {
      next.selection = selection;
    }
    const merged = sanitizeViewState(this.current.map, next);
    this.ui = merged;
    this.session.save(this.current.key, merged);
    // Pan / zoom only: the webview already shows it, so don't echo a full snapshot.
    const keys = Object.keys(patch);
    if (keys.length === 1 && keys[0] === 'viewport') return;
    this.highlights.update(this.current, merged);
    this.pushSnapshot();
  }

  private async commitUi(): Promise<void> {
    if (!this.current || !this.ui) return;
    this.ui = sanitizeViewState(this.current.map, this.ui);
    this.highlights.update(this.current, this.ui);
    this.session.save(this.current.key, this.ui);
    this.pushSnapshot();
  }

  private async setHighlightEnabled(enabled: boolean): Promise<void> {
    if (!this.current || !this.ui) return;
    await this.applyUiPatch({ ...this.ui, highlightEnabled: enabled });
  }

  private async clearHighlights(): Promise<void> {
    this.highlights.clear();
    await this.setHighlightEnabled(false);
  }

  private async toggleHighlights(): Promise<void> {
    if (!this.current || !this.ui) {
      void vscode.window.showInformationMessage('请先打开一张地图。');
      return;
    }
    await this.setHighlightEnabled(!this.ui.highlightEnabled);
  }

  private walkthrough(): { steps: NonNullable<AcceptedMap['map']['walkthrough']>; index: number } | undefined {
    const steps = this.current?.map.walkthrough ?? [];
    if (!this.current || steps.length === 0) return undefined;
    const index = this.ui?.stepId ? steps.findIndex(step => step.id === this.ui?.stepId) : -1;
    return { steps, index };
  }

  private async startWalkthrough(): Promise<void> {
    const walkthrough = this.walkthrough();
    if (!walkthrough) {
      void vscode.window.showInformationMessage('当前地图没有导读步骤。');
      return;
    }
    if (!this.panel) await this.ensurePanel();
    await this.gotoStep(walkthrough.steps[0]!.id);
  }

  private async step(delta: number): Promise<void> {
    const walkthrough = this.walkthrough();
    if (!walkthrough) {
      void vscode.window.showInformationMessage('当前地图没有导读步骤。');
      return;
    }
    const target = walkthrough.index < 0
      ? (delta > 0 ? 0 : walkthrough.steps.length - 1)
      : Math.min(walkthrough.steps.length - 1, Math.max(0, walkthrough.index + delta));
    await this.gotoStep(walkthrough.steps[target]!.id);
  }

  private async gotoStep(stepId: string): Promise<void> {
    const map = this.current?.map;
    if (!map) throw new HostError('MAP_NOT_FOUND', '请先打开一张地图。');
    const step = map.walkthrough?.find(item => item.id === stepId);
    if (!step) throw new HostError('STEP_NOT_FOUND', '导读步骤不存在。');
    this.ui = sanitizeViewState(map, { ...this.ui, selection: { kind: 'step', id: step.id }, stepId: step.id });
    this.highlights.update(this.current, this.ui);
    this.session.save(this.current!.key, this.ui);
    this.pushSnapshot();
    const sourceId = sourceIdsForSelection(map, { kind: 'step', id: step.id })[0];
    if (sourceId) await this.revealSource({ targetKind: 'step', targetId: step.id, sourceId });
  }

  private async stopWalkthrough(): Promise<void> {
    this.ui = this.ui ? { ...this.ui, stepId: undefined, selection: this.ui.selection?.kind === 'step' ? undefined : this.ui.selection } : this.ui;
    await this.commitUi();
  }

  private async revealSource(payload: RevealPayload): Promise<void> {
    if (!this.current) throw new HostError('MAP_NOT_FOUND', '请先打开一张地图。');
    const map = this.current.map;
    const available = sourceIdsForSelection(map, { kind: payload.targetKind, id: payload.targetId });
    const sourceId = payload.sourceId && available.includes(payload.sourceId) ? payload.sourceId : undefined;
    const candidates = sourceId ? [sourceId] : available;
    if (candidates.length === 0) throw new HostError('SOURCE_NOT_FOUND', '这个对象没有关联源码。');

    if (candidates.length > 1) {
      const items = candidates.map(id => ({ label: this.sources.describe(id), id }));
      const picked = await vscode.window.showQuickPick(items, {
        title: '选择要跳转的源码位置',
        placeHolder: '这个对象有多个来源',
      });
      if (!picked) return;
      return this.openSource(picked.id, payload.focusEditor === true);
    }
    return this.openSource(candidates[0]!, payload.focusEditor === true);
  }

  private async openSource(sourceId: string, focusEditor: boolean): Promise<void> {
    const map = this.current?.map;
    const ref = map?.sources[sourceId];
    if (!map || !ref || !this.current) throw new HostError('SOURCE_NOT_FOUND', '来源不存在。');
    const { uri } = await checkedSourceUri(this.current.root.uri, ref.file);
    const status = this.sources.getStatus(sourceId) ?? { ...ref, state: 'pending' as const };
    const selection: Selection | undefined = this.ui?.selection;
    const nextUi = sanitizeViewState(map, { ...this.ui, sourceId });
    this.ui = nextUi;
    this.session.save(this.current.key, nextUi);
    this.highlights.update(this.current, nextUi);
    this.pushSnapshot();

    const document = await vscode.workspace.openTextDocument(uri);
    const column = focusEditor ? vscode.ViewColumn.One : vscode.ViewColumn.Beside;
    const editor = await vscode.window.showTextDocument(document, { viewColumn: column, preview: false, preserveFocus: !focusEditor });
    const range = sourceRange(document, status);
    if (range) {
      editor.selection = new vscode.Selection(range.start, range.start);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    if (!isUsableSource(status) && status.state !== 'pending') {
      this.notify(`${SOURCE_STATE_LABELS[status.state]}：${status.message ?? ref.file}`, 'warning');
    }
    if (selection) this.highlights.schedule();
  }


  private async generateMapCommand(): Promise<void> {
    await this.ensurePanel();
    this.reveal();
    const topic = await vscode.window.showInputBox({
      title: '用 AI 生成代码地图',
      prompt: '描述你想了解的功能或流程；当前打开的文件会一起交给 AI 分析。',
      placeHolder: '例如：从点击背包按钮到刷新物品列表的完整流程',
    });
    if (!topic || topic.trim().length === 0) return;
    await this.ai.generate(topic.trim());
    this.pushAiStatus();
  }

  private async chooseAiProviderCommand(): Promise<void> {
    if (await this.ai.chooseInteractive()) this.pushAiStatus();
  }

  private async copyAuthoringPrompt(): Promise<void> {
    const text = authoringPrompt();
    await vscode.env.clipboard.writeText(text);
    this.notify('已复制 AI 地图生成提示词。');
    void vscode.window.showInformationMessage('已复制 AI 地图生成提示词到剪贴板。');
  }

  private async openHelp(): Promise<void> {
    try {
      // vsce stores the readme lowercased; match case-insensitively for Linux / remote.
      const entries = await vscode.workspace.fs.readDirectory(this.context.extensionUri);
      const name = entries.find(([entry]) => entry.toLowerCase() === 'readme.md')?.[0];
      if (!name) throw new Error('README not found');
      const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(this.context.extensionUri, name));
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: false });
    } catch {
      void vscode.env.openExternal(vscode.Uri.parse(HELP_URL));
    }
  }
}

function authoringPrompt(): string {
  return [
    '请为下面的功能生成一张“代码侦探”地图，并把 JSON 保存到工作区根目录的 .code-detective/maps/<id>.json。',
    '',
    '要求：',
    '1. 严格使用 schemaVersion 1，字段名与 JSON Schema 一致（见 schemas/code-map-v1.schema.json）。',
    '2. id 使用小写字母、数字和连字符；节点与连线 id 使用 [A-Za-z0-9_.:-]。',
    '3. sources 中每个来源必须给出 workspace 相对路径、startLine、endLine；能提供时请附 anchorText（完整的整行文本）。',
    '4. 只写有源码依据的节点和连线，不要推测调用关系；不确定就不要写。',
    '5. 可选地提供 walkthrough 步骤，nodeIds / edgeIds 必须引用已存在的 id。',
    '',
    '我想了解的话题：<在这里填写>',
  ].join('\n');
}
