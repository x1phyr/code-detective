import * as vscode from 'vscode';
import {
  DEFAULT_VIEW_STATE,
  sourceStateLabel,
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
import { TourGuide } from './tour';
import { mainline, moveTo, stepBy, stepSource, type TourPosition } from '../core/tour';
import { t } from '../../shared/i18n';

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
  private readonly guide: TourGuide;
  /** 导读位置（含岔路的返回栈）；`ui.stepId` 只记当前步骤，返回栈只在本次会话里。 */
  private tour?: TourPosition;
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
    this.log = vscode.window.createOutputChannel(t('host.outputChannel'));
    this.repository = new MapRepository(this.log);
    this.session = new SessionStore(context.workspaceState);
    this.sources = new SourceService(this.log);
    this.highlights = new HighlightController(this.sources);
    this.guide = new TourGuide({ root: () => this.activeRoot(), log: line => this.log.appendLine(line) });
    this.ai = new AiService({
      log: this.log,
      root: () => this.activeRoot(),
      refresh: () => this.repository.refresh(),
      hasMap: key => this.repository.get(key) !== undefined,
      open: async key => {
        const record = this.repository.get(key);
        if (isAccepted(record)) {
          await this.ensurePanel();
          await this.select(record);
        }
      },
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
      this.guide,
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
      vscode.commands.registerCommand('codeDetective.tourBranch', (stepId?: unknown) =>
        typeof stepId === 'string' ? this.gotoStep(stepId) : undefined),
      vscode.commands.registerCommand('codeDetective.tourReply', (reply?: vscode.CommentReply) =>
        reply && typeof reply.text === 'string' ? this.guide.ask(reply) : undefined),
      vscode.commands.registerCommand('codeDetective.clearHighlights', () => this.clearHighlights()),
      vscode.commands.registerCommand('codeDetective.toggleHighlights', () => this.toggleHighlights()),
      // 标题栏按 `codeDetective.highlightEnabled` 上下文在两个图标间切换，两个命令执行同一动作。
      vscode.commands.registerCommand('codeDetective.highlightsOn', () => this.toggleHighlights()),
      vscode.commands.registerCommand('codeDetective.highlightsOff', () => this.toggleHighlights()),
      vscode.commands.registerCommand('codeDetective.fitView', () => this.post({ protocolVersion: 1, type: 'view.fit', payload: {} })),
      vscode.commands.registerCommand('codeDetective.copyAuthoringPrompt', () => this.copyAuthoringPrompt()),
      vscode.commands.registerCommand('codeDetective.generateMap', () => this.generateMapCommand()),
      vscode.commands.registerCommand('codeDetective.chooseAiProvider', () => this.chooseAiProviderCommand()),
      vscode.commands.registerCommand('codeDetective.cancelAi', () => this.ai.cancel()),
      vscode.commands.registerCommand('codeDetective.openHelp', () => this.openHelp()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.repository.installWatchers();
        void this.repository.refresh().catch(error => this.log.appendLine(t('host.mapScanFailed', { error: errorMessage(error) })));
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
      this.log.appendLine(t('host.noWorkspace'));
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
    void vscode.commands.executeCommand('setContext', 'codeDetective.hasMap', this.current !== undefined);
    void vscode.commands.executeCommand('setContext', 'codeDetective.highlightEnabled', this.ui?.highlightEnabled === true);
    void vscode.commands.executeCommand('setContext', 'codeDetective.hasTour', Boolean(this.current && mainline(this.current.map).length));
    void vscode.commands.executeCommand('setContext', 'codeDetective.touring', this.guide.active);
  }

  private async openMap(key?: string): Promise<void> {
    await this.ensurePanel();

    const records = [...this.summaries()];
    if (records.length === 0) {
      this.reveal();
      this.post({ protocolVersion: 1, type: 'initialize', payload: { maps: [] } });
      void vscode.window.showWarningMessage(t('host.noMaps'));
      return;
    }

    const chosen = key ?? await this.pickMap(records);
    if (!chosen) return;
    const record = this.repository.get(chosen);
    if (!record) {
      void vscode.window.showWarningMessage(t('host.mapNotFoundNamed', { name: chosen }));
      return;
    }
    if (!isAccepted(record)) {
      void vscode.window.showErrorMessage(t('host.mapCannotOpen', { reason: record.error ?? t('host.invalidContent') }));
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
    const picked = await vscode.window.showQuickPick(items, { title: t('host.pickMapTitle'), matchOnDescription: true });
    return picked?.key;
  }

  private async select(record: AcceptedMap, options: { reuse?: boolean } = {}): Promise<void> {
    const previous = this.current;
    if (previous && previous.key !== record.key) await this.persist();
    this.current = record;
    if (previous?.key !== record.key) {
      this.tour = undefined;
      this.guide.reset();
    }
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
        // 地图改了：当前步骤还在就原地刷新讲解，不在了就结束导读。
        if (this.guide.active) {
          if (this.ui.stepId) void this.showStep(this.tourPosition()!).catch(() => undefined);
          else {
            this.tour = undefined;
            this.guide.close();
          }
        }
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
        this.notify(t('host.mapUpdated'));
      } else if (!isAccepted(refreshed) && refreshed?.error) {
        this.notify(t('host.mapInvalidKept', { error: refreshed.error ?? '' }), 'error');
        return this.pushSnapshot();
      } else if (!refreshed) {
        // Deleted, its `id` changed, or its workspace folder was removed.
        const title = this.current.map.title;
        await this.persist();
        this.current = undefined;
        this.ui = undefined;
        this.sources.reset();
        this.highlights.clear();
        this.tour = undefined;
        this.guide.reset();
        this.updateTitle();
        this.notify(t('host.mapRemoved', { title }), 'warning');
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
      this.log.appendLine(t('host.messageFailed', { type: message.type, error: text }));
      this.notify(text, error instanceof HostError ? 'warning' : 'error');
    }
  }

  private async dispatch(message: BridgeMessage<Record<string, unknown>>): Promise<void> {
    switch (message.type) {
      case 'view.ready':
        this.post({ protocolVersion: 1, type: 'initialize', payload: this.initializePayload() });
        this.post({ protocolVersion: 1, type: 'theme', payload: { kind: themeKind() } });
        return;
      case 'maps.refresh':
        await this.refreshMaps();
        return;
      case 'ai.open':
        await this.generateMapCommand();
        return;
      case 'prompt.copy':
        await this.copyAuthoringPrompt();
        return;
      case 'help.open':
        await this.openHelp();
        return;
      case 'map.open': {
        const record = this.repository.get(message.mapKey ?? '');
        if (!isAccepted(record)) throw new HostError('MAP_NOT_FOUND', t('host.mapNotFound'));
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
        await this.stopWalkthrough();
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
        throw new HostError('INVALID_MESSAGE', t('host.unsupportedMessage', { type: message.type }));
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

  private initializePayload(): InitializePayload {
    return { maps: this.summaries(), current: this.snapshot() };
  }

  private async applyUiPatch(patch: UiPatch): Promise<void> {
    if (!this.current || !this.ui) return;
    const { selection, ...rest } = patch;
    const next: Partial<ViewState> = { ...this.ui, ...rest };
    if (selection === null) {
      // 点空白就是彻底清空，包括导读步骤（侧边栏里没有单独的“停止导读”按钮）。
      delete next.selection;
      delete next.sourceId;
      delete next.stepId;
    } else if (selection !== undefined) {
      next.selection = selection;
    }
    const merged = sanitizeViewState(this.current.map, next);
    this.ui = merged;
    if (!merged.stepId && this.guide.active) {
      // 点空白清空了选择：导读也一起结束，编辑器里的讲解面板收起。
      this.tour = undefined;
      this.guide.close();
      this.updateTitle();
    }
    this.session.save(this.current.key, merged);
    // Pan / zoom only: the webview already shows it, so don't echo a full snapshot.
    const keys = Object.keys(patch);
    if (keys.length === 1 && keys[0] === 'viewport') return;
    this.highlights.update(this.current, merged);
    this.updateTitle();
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
      void vscode.window.showInformationMessage(t('host.openMapFirst'));
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
      void vscode.window.showInformationMessage(t('host.noWalkthrough'));
      return;
    }
    if (!this.panel) await this.ensurePanel();
    await this.gotoStep(walkthrough.steps[0]!.id);
  }

  private async step(delta: 1 | -1): Promise<void> {
    const map = this.current?.map;
    if (!map || mainline(map).length === 0) {
      void vscode.window.showInformationMessage(t('host.noWalkthrough'));
      return;
    }
    const position = this.tourPosition();
    const next = stepBy(map, position, delta);
    if (!next || (position && next.stepId === position.stepId && this.guide.active)) return;
    await this.showStep(next);
  }

  /** 当前导读位置：优先用本次会话里的（带岔路栈），否则从保存的 stepId 恢复。 */
  private tourPosition(): TourPosition | undefined {
    const stepId = this.ui?.stepId;
    if (!stepId) return undefined;
    if (this.tour?.stepId === stepId) return this.tour;
    return { stepId, returnTo: [] };
  }

  private async gotoStep(stepId: string): Promise<void> {
    const map = this.current?.map;
    if (!map) throw new HostError('MAP_NOT_FOUND', t('host.openMapFirst'));
    if (!map.walkthrough?.some(item => item.id === stepId)) throw new HostError('STEP_NOT_FOUND', t('host.stepNotFound'));
    const next = moveTo(map, this.tourPosition(), stepId);
    if (next) await this.showStep(next);
  }

  /** 移到导读的某一步：地图高亮、打开那一段代码，并在代码下方展开讲解面板。 */
  private async showStep(position: TourPosition): Promise<void> {
    const current = this.current;
    if (!current) return;
    const map = current.map;
    const step = map.walkthrough?.find(item => item.id === position.stepId);
    if (!step) throw new HostError('STEP_NOT_FOUND', t('host.stepNotFound'));
    this.tour = position;
    const sourceId = stepSource(map, step);
    this.ui = sanitizeViewState(map, { ...this.ui, selection: { kind: 'step', id: step.id }, stepId: step.id, sourceId });
    this.highlights.update(current, this.ui);
    this.session.save(current.key, this.ui);
    this.pushSnapshot();
    if (!sourceId) {
      this.guide.close();
      this.updateTitle();
      this.notify(t('host.noLinkedSource'), 'warning');
      return;
    }
    const editor = await this.openSource(sourceId, true);
    if (editor && this.current === current && this.tour === position) {
      this.guide.show(map, position, editor.document, this.sources.getStatus(sourceId));
    }
    this.updateTitle();
  }

  private async stopWalkthrough(): Promise<void> {
    this.tour = undefined;
    this.guide.close();
    this.ui = this.ui ? { ...this.ui, stepId: undefined, selection: this.ui.selection?.kind === 'step' ? undefined : this.ui.selection } : this.ui;
    await this.commitUi();
    this.updateTitle();
  }

  private async revealSource(payload: RevealPayload): Promise<void> {
    if (!this.current) throw new HostError('MAP_NOT_FOUND', t('host.openMapFirst'));
    const map = this.current.map;
    const available = sourceIdsForSelection(map, { kind: payload.targetKind, id: payload.targetId });
    const sourceId = payload.sourceId && available.includes(payload.sourceId) ? payload.sourceId : undefined;
    const candidates = sourceId ? [sourceId] : available;
    if (candidates.length === 0) throw new HostError('SOURCE_NOT_FOUND', t('host.noLinkedSource'));

    if (candidates.length > 1) {
      const items = candidates.map(id => ({ label: this.sources.describe(id), id }));
      const picked = await vscode.window.showQuickPick(items, {
        title: t('host.pickSourceTitle'),
        placeHolder: t('host.pickSourcePlaceholder'),
      });
      if (!picked) return;
      await this.openSource(picked.id, payload.focusEditor === true);
      return;
    }
    await this.openSource(candidates[0]!, payload.focusEditor === true);
  }

  private async openSource(sourceId: string, focusEditor: boolean): Promise<vscode.TextEditor | undefined> {
    const map = this.current?.map;
    const ref = map?.sources[sourceId];
    if (!map || !ref || !this.current) throw new HostError('SOURCE_NOT_FOUND', t('host.sourceNotFound'));
    const { uri } = await checkedSourceUri(this.current.root.uri, ref.file);
    const status = this.sources.getStatus(sourceId) ?? { ...ref, state: 'pending' as const };
    const selection: Selection | undefined = this.ui?.selection;
    const nextUi = sanitizeViewState(map, { ...this.ui, sourceId });
    this.ui = nextUi;
    this.session.save(this.current.key, nextUi);
    this.highlights.update(this.current, nextUi);
    this.pushSnapshot();

    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: targetColumn(document.uri),
      preview: false,
      preserveFocus: !focusEditor,
    });
    const range = sourceRange(document, status);
    if (range) {
      editor.selection = new vscode.Selection(range.start, range.start);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    if (!isUsableSource(status) && status.state !== 'pending') {
      this.notify(t('host.sourceStateWarning', { state: sourceStateLabel(status.state), detail: status.message ?? ref.file }), 'warning');
    }
    if (selection) this.highlights.schedule();
    return editor;
  }


  private async generateMapCommand(): Promise<void> {
    await this.ensurePanel();
    this.reveal();
    const topic = await vscode.window.showInputBox({
      title: t('host.generateTitle'),
      prompt: t('host.generatePrompt'),
      placeHolder: t('host.generatePlaceholder'),
    });
    if (!topic || topic.trim().length === 0) return;
    await this.ai.generate(topic.trim());
  }

  private async chooseAiProviderCommand(): Promise<void> {
    await this.ai.chooseInteractive();
  }

  private async copyAuthoringPrompt(): Promise<void> {
    const text = authoringPrompt();
    await vscode.env.clipboard.writeText(text);
    this.notify(t('host.promptCopied'));
    void vscode.window.showInformationMessage(t('host.promptCopiedToClipboard'));
  }

  private async openHelp(): Promise<void> {
    try {
      // vsce stores the readme lowercased; match case-insensitively for Linux / remote.
      const entries = await vscode.workspace.fs.readDirectory(this.context.extensionUri);
      const name = entries.find(([entry]) => entry.toLowerCase() === 'readme.md')?.[0];
      if (!name) throw new Error('README not found');
      const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(this.context.extensionUri, name));
      await vscode.window.showTextDocument(document, { viewColumn: targetColumn(document.uri), preview: false });
    } catch {
      void vscode.env.openExternal(vscode.Uri.parse(HELP_URL));
    }
  }
}

function authoringPrompt(): string {
  return t('host.authoringPrompt');
}

/**
 * 源码总是在当前聚焦的编辑器组里以新页签打开，绝不新建分栏；
 * 若该文件已在某个可见分栏里，就复用那个分栏，避免同一文件开两份。
 */
function targetColumn(uri: vscode.Uri): vscode.ViewColumn {
  const visible = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString());
  return visible?.viewColumn ?? vscode.window.tabGroups.activeTabGroup.viewColumn ?? vscode.ViewColumn.Active;
}
