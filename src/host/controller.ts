import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  DEFAULT_VIEW_STATE,
  sourceStateLabel,
  type BridgeMessage,
  type ComposeDraftPayload,
  type HostMessage,
  type InitializePayload,
  type MapSnapshot,
  type MapSummary,
  type RevealPayload,
  type ThemeKind,
  type ViewState,
} from '../../shared/types';
import { activeFocusSelection, sanitizeViewState, sourceIdsForSelection } from '../core/selection';
import { parseBridgeMessage, validateUiPatch, asRevealPayload, type UiPatch } from './bridge';
import { HostError, errorMessage } from '../core/errors';
import { assertRelativeSourcePath } from '../core/paths';
import { focusRevealRange, HighlightController } from './highlights';
import { EditorContextTracker, guessEnclosingSymbol } from './editorContext';
import { checkedSourceUri } from './paths';
import { MapRepository, type MapRecord } from './repository';
import { deleteMapFile } from './mapWriter';
import { SessionStore } from './session';
import { SourceService, isUsableSource, type AcceptedMap } from './sources';
import { AiService } from './ai';
import { MentorQaService } from './mentorQa';
import { registerChatIntegration } from './chat';
import { webviewHtml, webviewRoot } from './webview';
import { asideOrigin, mainline, stepSource } from '../core/tour';
import { t } from '../../shared/i18n';

const VIEW_TYPE = 'codeDetective.mapView';
const MAP_PANEL_TYPE = 'codeDetective.mapPanel';
const HELP_URL = 'https://github.com/x1phyr/code-detective#讲义-json-格式schema-v1';

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
  private readonly editorTracker: EditorContextTracker;
  private readonly ai: AiService;
  private readonly qa: MentorQaService;
  private readonly disposables: vscode.Disposable[] = [];
  /** Sidebar Mentor Panel webview. */
  private panel?: vscode.WebviewView;
  /** Optional pop-out Editor Tab dedicated to the full-width Call Graph. */
  private mapEditorPanel?: vscode.WebviewPanel;
  /** Queued compose draft if `generateFromCursor` was triggered before sidebar webview mounted. */
  private pendingCompose?: ComposeDraftPayload;
  private current?: AcceptedMap;
  private ui?: ViewState;
  private started = false;
  private markScanned!: () => void;
  private readonly scanned = new Promise<void>(resolve => { this.markScanned = resolve; });

  constructor(private readonly context: vscode.ExtensionContext) {
    this.log = vscode.window.createOutputChannel(t('host.outputChannel'));
    this.repository = new MapRepository(this.log);
    this.session = new SessionStore(context.workspaceState);
    this.sources = new SourceService(this.log);
    this.highlights = new HighlightController(this.sources);
    this.editorTracker = new EditorContextTracker({
      statuses: () => this.sources.statuses(),
      onUpdate: ctx => {
        this.post({ protocolVersion: 1, type: 'editor.context', payload: ctx });
      },
    });
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
    this.qa = new MentorQaService({
      currentAgentId: () => this.ai.catalog().currentAgentId,
      openSession: root => this.ai.openSession(root),
      refresh: () => this.repository.refresh(),
      log: line => this.log.appendLine(line),
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
      this.editorTracker,
      this.ai,
      this.qa,
    );
    this.disposables.push(
      this.repository.onDidChange(() => { void this.onMapsChanged(); }),
      this.sources.onDidChange(() => {
        this.highlights.schedule();
        this.editorTracker.refreshNow();
        this.pushSnapshot();
      }),
      this.ai.onDidChangeStatus(status => {
        this.post({ protocolVersion: 1, type: 'ai.status', payload: status });
      }),
      this.qa.onDidChange(mapKey => {
        if (this.current?.key === mapKey) {
          this.post({
            protocolVersion: 1,
            type: 'qa.state',
            payload: { mapId: this.current.map.id, exchanges: this.qa.exchanges(mapKey) },
          });
        }
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('codeDetective.ai')) {
          this.postAgents();
        }
      }),
      vscode.window.onDidChangeActiveColorTheme(() => this.post({ protocolVersion: 1, type: 'theme', payload: { kind: themeKind() } })),
      vscode.window.registerWebviewViewProvider(VIEW_TYPE, {
        resolveWebviewView: view => this.attachView(view),
      }, { webviewOptions: { retainContextWhenHidden: true } }),
      vscode.commands.registerCommand('codeDetective.openMap', (key?: unknown) =>
        this.openMap(typeof key === 'string' && key.trim() ? key.trim() : undefined)),
      vscode.commands.registerCommand('codeDetective.openMapPanel', () => this.openMapPanel()),
      vscode.commands.registerCommand('codeDetective.refreshMaps', () => this.refreshMaps()),
      vscode.commands.registerCommand('codeDetective.startWalkthrough', () => this.startWalkthrough()),
      vscode.commands.registerCommand('codeDetective.nextStep', () => this.step(1)),
      vscode.commands.registerCommand('codeDetective.previousStep', () => this.step(-1)),
      vscode.commands.registerCommand('codeDetective.clearHighlights', () => this.clearHighlights()),
      vscode.commands.registerCommand('codeDetective.toggleHighlights', () => this.toggleHighlights()),
      vscode.commands.registerCommand('codeDetective.highlightsOn', () => this.toggleHighlights()),
      vscode.commands.registerCommand('codeDetective.highlightsOff', () => this.toggleHighlights()),
      vscode.commands.registerCommand('codeDetective.fitView', () => this.post({ protocolVersion: 1, type: 'view.fit', payload: {} })),
      vscode.commands.registerCommand('codeDetective.copyAuthoringPrompt', () => this.copyAuthoringPrompt()),
      vscode.commands.registerCommand('codeDetective.generateMap', () => this.generateMapCommand()),
      vscode.commands.registerCommand('codeDetective.generateFromCursor', () => this.generateFromCursorCommand()),
      vscode.commands.registerCommand('codeDetective.chooseAiProvider', () => this.chooseAiProviderCommand()),
      vscode.commands.registerCommand('codeDetective.cancelAi', () => {
        this.ai.cancel();
        this.qa.cancel();
      }),
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
    void this.ai.refreshAvailability().then(() => this.postAgents());
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
    this.mapEditorPanel?.dispose();
    this.mapEditorPanel = undefined;
    this.panel = undefined;
    await this.session.flush().catch(() => undefined);
  }

  dispose(): void { void this.shutdown(); }

  private async attachView(view: vscode.WebviewView): Promise<void> {
    this.panel = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [webviewRoot(this.context.extensionUri)] };
    view.webview.html = webviewHtml(view.webview, this.context.extensionUri);
    const messages = view.webview.onDidReceiveMessage((message: unknown) => { void this.onMessage(message, view.webview, false); });
    const visibility = view.onDidChangeVisibility(() => this.syncHighlightVisibility());
    this.syncHighlightVisibility();
    view.onDidDispose(() => {
      messages.dispose();
      visibility.dispose();
      if (this.panel === view) {
        this.panel = undefined;
        if (!this.mapEditorPanel) this.highlights.clear();
        else this.syncHighlightVisibility();
      }
    });
    if (this.current) {
      this.updateTitle();
      return;
    }
    await this.scanned;
    const restored = this.lastAccepted() ?? this.firstAccepted();
    if (restored && !this.current) await this.select(restored, { reuse: true });
  }

  private async openMapPanel(): Promise<void> {
    if (this.mapEditorPanel) {
      this.mapEditorPanel.reveal(vscode.ViewColumn.Beside, false);
      return;
    }
    const title = this.current ? t('host.mapPanelTitle', { title: this.current.map.title }) : t('host.mapPanelDefaultTitle');
    const panel = vscode.window.createWebviewPanel(
      MAP_PANEL_TYPE,
      title,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [webviewRoot(this.context.extensionUri)] },
    );
    panel.webview.html = webviewHtml(panel.webview, this.context.extensionUri);
    this.mapEditorPanel = panel;
    const messages = panel.webview.onDidReceiveMessage((message: unknown) => { void this.onMessage(message, panel.webview, true); });
    const viewState = panel.onDidChangeViewState(() => this.syncHighlightVisibility());
    this.syncHighlightVisibility();
    panel.onDidDispose(() => {
      messages.dispose();
      viewState.dispose();
      if (this.mapEditorPanel === panel) {
        this.mapEditorPanel = undefined;
        if (!this.panel) this.highlights.clear();
        else this.syncHighlightVisibility();
      }
    });
  }

  /** 侧栏被切到别的视图（资源管理器、搜索等）时收起代码着色，回来再恢复。 */
  private syncHighlightVisibility(): void {
    this.highlights.setVisible(this.panel?.visible === true || this.mapEditorPanel?.visible === true);
  }

  private lastAccepted(): AcceptedMap | undefined {
    const key = this.session.current();
    if (!key) return undefined;
    const record = this.repository.get(key);
    return isAccepted(record) ? record : undefined;
  }

  private firstAccepted(): AcceptedMap | undefined {
    for (const summary of this.summaries()) {
      const record = this.repository.get(summary.key);
      if (isAccepted(record)) return record;
    }
    return undefined;
  }

  private async ensurePanel(): Promise<void> {
    if (this.panel) {
      this.panel.show(true);
      return;
    }
    await vscode.commands.executeCommand(`${VIEW_TYPE}.focus`);
  }

  private updateTitle(): void {
    if (this.panel) this.panel.description = this.current?.map.title;
    if (this.mapEditorPanel) {
      this.mapEditorPanel.title = this.current
        ? t('host.mapPanelTitle', { title: this.current.map.title })
        : t('host.mapPanelDefaultTitle');
    }
    const hasTour = Boolean(this.current && mainline(this.current.map).length);
    void vscode.commands.executeCommand('setContext', 'codeDetective.hasMap', this.current !== undefined);
    void vscode.commands.executeCommand('setContext', 'codeDetective.highlightEnabled', this.ui?.highlightEnabled === true);
    void vscode.commands.executeCommand('setContext', 'codeDetective.hasTour', hasTour);
    void vscode.commands.executeCommand('setContext', 'codeDetective.touring', Boolean(hasTour && this.ui?.activeStepId));
  }

  private async openMap(key?: string): Promise<void> {
    await this.ensurePanel();
    const records = [...this.summaries()];
    if (records.length === 0) {
      this.reveal();
      this.post({ protocolVersion: 1, type: 'ai.compose', payload: { open: true } });
      void vscode.window.showInformationMessage(t('host.noMaps'));
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
    const stored = this.session.get(record.key);
    this.ui = sanitizeViewState(record.map, stored ?? DEFAULT_VIEW_STATE);
    // Automatically mark initial activeStepId as visited
    if (this.ui.activeStepId) {
      const visited = new Set(this.ui.visitedStepIds ?? []);
      visited.add(this.ui.activeStepId);
      this.ui = { ...this.ui, visitedStepIds: [...visited] };
    }
    if (options.reuse !== true) this.session.setCurrent(record.key);
    this.sources.reset(record);
    this.editorTracker.setMap(record);
    this.highlights.update(record, this.ui);
    this.updateTitle();
    this.pushSnapshot();
    this.post({
      protocolVersion: 1,
      type: 'qa.state',
      payload: { mapId: record.map.id, exchanges: this.qa.exchanges(record.key) },
    });
  }

  private async refreshMaps(): Promise<void> {
    await this.repository.refresh();
    if (this.current) {
      const refreshed = this.repository.get(this.current.key);
      if (isAccepted(refreshed)) {
        this.current = refreshed;
        this.sources.reset(refreshed);
        this.editorTracker.setMap(refreshed);
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
        this.editorTracker.setMap(refreshed);
        this.ui = sanitizeViewState(refreshed.map, this.ui);
        this.highlights.update(refreshed, this.ui);
        this.updateTitle();
      } else if (!isAccepted(refreshed) && refreshed?.error) {
        this.notify(t('host.mapInvalidKept', { error: refreshed.error ?? '' }), 'error');
        return this.pushSnapshot();
      } else if (!refreshed) {
        const title = this.current.map.title;
        const oldKey = this.current.key;
        await this.persist();
        this.qa.resetSession(oldKey);
        this.current = undefined;
        this.ui = undefined;
        this.sources.reset();
        this.editorTracker.setMap(undefined);
        this.highlights.clear();
        const fallback = this.firstAccepted();
        if (fallback) {
          await this.select(fallback);
        } else {
          this.updateTitle();
          this.notify(t('host.mapRemoved', { title }), 'warning');
        }
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
    if (!this.panel && !this.mapEditorPanel) return;
    this.post({ protocolVersion: 1, type: 'snapshot', payload: { snapshot: this.snapshot() } });
    this.post({ protocolVersion: 1, type: 'maps', payload: { maps: this.summaries() } });
  }

  private postAgents(): void {
    const { agents, currentAgentId } = this.ai.catalog();
    this.post({ protocolVersion: 1, type: 'agents', payload: { agents, currentAgentId } });
  }

  private post(message: HostMessage): void {
    void this.panel?.webview.postMessage(message);
    void this.mapEditorPanel?.webview.postMessage(message);
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

  private async onMessage(raw: unknown, sender: vscode.Webview, standaloneMap: boolean): Promise<void> {
    let message: BridgeMessage<Record<string, unknown>>;
    try {
      message = parseBridgeMessage(raw);
    } catch (error) {
      this.notify(errorMessage(error), 'error');
      return;
    }
    try {
      await this.dispatch(message, sender, standaloneMap);
    } catch (error) {
      const text = errorMessage(error);
      this.log.appendLine(t('host.messageFailed', { type: message.type, error: text }));
      this.notify(text, error instanceof HostError ? 'warning' : 'error');
    }
  }

  private async dispatch(
    message: BridgeMessage<Record<string, unknown>>,
    sender: vscode.Webview,
    standaloneMap: boolean,
  ): Promise<void> {
    switch (message.type) {
      case 'view.ready': {
        void sender.postMessage({
          protocolVersion: 1,
          type: 'initialize',
          payload: this.initializePayload(standaloneMap),
        } satisfies HostMessage);
        void sender.postMessage({
          protocolVersion: 1,
          type: 'theme',
          payload: { kind: themeKind() },
        } satisfies HostMessage);
        if (!standaloneMap && this.pendingCompose) {
          const draft = this.pendingCompose;
          this.pendingCompose = undefined;
          void sender.postMessage({ protocolVersion: 1, type: 'ai.compose', payload: draft } satisfies HostMessage);
        }
        return;
      }
      case 'maps.refresh':
        await this.refreshMaps();
        return;
      case 'map.popout':
        await this.openMapPanel();
        return;
      case 'ai.open':
        this.post({ protocolVersion: 1, type: 'ai.compose', payload: { open: true } });
        return;
      case 'ai.setAgent':
        await this.ai.setAgent(String(message.payload.agentId), true);
        this.postAgents();
        return;
      case 'ai.generate': {
        const p = message.payload;
        const overwriteKey = typeof p.overwriteKey === 'string' ? p.overwriteKey : undefined;
        const overwrite = overwriteKey ? this.repository.get(overwriteKey) : undefined;
        const anchorFile = typeof p.anchorFile === 'string' ? p.anchorFile : undefined;
        await this.ai.generate({
          topic: String(p.topic).trim(),
          agentId: typeof p.agentId === 'string' ? p.agentId : undefined,
          anchor: anchorFile
            ? {
                file: anchorFile,
                symbol: typeof p.anchorSymbol === 'string' ? p.anchorSymbol : undefined,
                startLine: typeof p.startLine === 'number' ? p.startLine : undefined,
                endLine: typeof p.endLine === 'number' ? p.endLine : undefined,
              }
            : undefined,
          overwrite,
        });
        return;
      }
      case 'ai.cancel':
        this.ai.cancel();
        return;
      case 'ai.refreshAgents':
        await this.ai.refreshAvailability();
        this.postAgents();
        this.notify(t('host.agentsRefreshed'));
        return;
      case 'ai.openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'codeDetective.ai');
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
      case 'map.delete': {
        await this.deleteMap(message.mapKey ?? '');
        return;
      }
      case 'source.reveal':
        await this.revealSource(asRevealPayload(message));
        return;
      case 'source.openLocation': {
        const file = String(message.payload.file);
        const startLine = Number(message.payload.startLine);
        const endLine = typeof message.payload.endLine === 'number' ? message.payload.endLine : startLine;
        await this.openWorkspaceLocation(file, startLine, endLine);
        return;
      }
      case 'tour.goto':
        await this.gotoStep(String(message.payload.stepId), true);
        return;
      case 'tour.step':
        await this.step(message.payload.delta === -1 ? -1 : 1);
        return;
      case 'highlight.setEnabled':
        await this.setHighlightEnabled(message.payload.enabled === true);
        return;
      case 'ui.patch': {
        const patch = validateUiPatch(message.payload);
        await this.applyUiPatch(patch);
        return;
      }
      case 'qa.ask': {
        if (!this.current) throw new HostError('MAP_NOT_FOUND', t('host.openMapFirst'));
        const includeSelection = message.payload.includeSelection !== false;
        const selection = includeSelection ? this.editorTracker.state.selection : undefined;
        await this.qa.ask({
          record: this.current,
          stepId: String(message.payload.stepId),
          question: String(message.payload.question),
          selection,
        });
        return;
      }
      case 'qa.cancel':
        this.qa.cancel();
        this.notify(t('host.qaCancelled'));
        return;
      case 'qa.saveNote': {
        if (!this.current) throw new HostError('MAP_NOT_FOUND', t('host.openMapFirst'));
        await this.qa.saveAsNote(this.current, String(message.payload.exchangeId));
        this.notify(t('host.noteSaved'));
        return;
      }
      case 'qa.saveAside': {
        if (!this.current) throw new HostError('MAP_NOT_FOUND', t('host.openMapFirst'));
        const title = typeof message.payload.title === 'string' ? message.payload.title : undefined;
        const aside = await this.qa.saveAsAside(this.current, String(message.payload.exchangeId), title);
        // Refresh current map reference and expand the newly saved aside inline!
        const refreshed = this.repository.get(this.current.key);
        if (isAccepted(refreshed)) {
          this.current = refreshed;
          this.ui = sanitizeViewState(refreshed.map, { ...this.ui, openAsideId: aside.id });
          this.session.save(refreshed.key, this.ui);
          this.highlights.update(refreshed, this.ui);
          this.pushSnapshot();
        }
        this.notify(t('host.asideSaved', { title: aside.title }));
        return;
      }
      case 'note.delete': {
        if (!this.current) throw new HostError('MAP_NOT_FOUND', t('host.openMapFirst'));
        await this.qa.deleteNote(this.current, String(message.payload.stepId), String(message.payload.noteId));
        this.notify(t('host.noteDeleted'));
        return;
      }
      default:
        throw new HostError('INVALID_MESSAGE', t('host.unsupportedMessage', { type: message.type }));
    }
  }

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

  private initializePayload(standaloneMap = false): InitializePayload {
    const { agents, currentAgentId } = this.ai.catalog();
    return {
      maps: this.summaries(),
      current: this.snapshot(),
      agents,
      currentAgentId,
      aiStatus: this.ai.status(),
      editorContext: this.editorTracker.state,
      qa: this.qa.exchanges(this.current?.key),
      standaloneMap: standaloneMap || undefined,
    };
  }

  private async applyUiPatch(patch: UiPatch): Promise<void> {
    if (!this.current || !this.ui) return;
    const { openAsideId, peek, sourceId, ...rest } = patch;
    const next: Partial<ViewState> = { ...this.ui, ...rest };

    if (openAsideId === null) delete next.openAsideId;
    else if (openAsideId !== undefined) next.openAsideId = openAsideId;

    if (peek === null) delete next.peek;
    else if (peek !== undefined) next.peek = peek;

    if (sourceId === null) delete next.sourceId;
    else if (sourceId !== undefined) next.sourceId = sourceId;

    const merged = sanitizeViewState(this.current.map, next);
    this.ui = merged;
    this.session.save(this.current.key, merged);
    const keys = Object.keys(patch);
    if (keys.length === 1 && keys[0] === 'viewport') return;
    this.highlights.update(this.current, merged);
    this.updateTitle();
    this.pushSnapshot();
  }

  private async setHighlightEnabled(enabled: boolean): Promise<void> {
    if (!this.current || !this.ui) return;
    await this.applyUiPatch({ highlightEnabled: enabled });
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

  private async startWalkthrough(): Promise<void> {
    const steps = this.current ? mainline(this.current.map) : [];
    if (!this.current || steps.length === 0) {
      void vscode.window.showInformationMessage(t('host.noWalkthrough'));
      return;
    }
    await this.ensurePanel();
    await this.gotoStep(steps[0]!.id, true);
  }

  private async step(delta: 1 | -1): Promise<void> {
    const map = this.current?.map;
    const main = map ? mainline(map) : [];
    if (!map || main.length === 0) {
      void vscode.window.showInformationMessage(t('host.noWalkthrough'));
      return;
    }
    // If an inline aside is currently open and user presses Previous, close the aside back to main step
    if (this.ui?.openAsideId && delta === -1) {
      const activeMain = this.ui.activeStepId ?? main[0]!.id;
      await this.gotoStep(activeMain, true);
      return;
    }
    const currentId = this.ui?.activeStepId;
    const idx = currentId ? main.findIndex(item => item.id === currentId) : -1;
    const targetIdx = idx < 0
      ? 0
      : Math.min(Math.max(idx + delta, 0), main.length - 1);
    const target = main[targetIdx];
    if (target) await this.gotoStep(target.id, true);
  }

  private async gotoStep(stepId: string, revealEditor: boolean): Promise<void> {
    const current = this.current;
    if (!current) throw new HostError('MAP_NOT_FOUND', t('host.openMapFirst'));
    const map = current.map;
    const step = map.walkthrough.find(item => item.id === stepId);
    if (!step) throw new HostError('STEP_NOT_FOUND', t('host.stepNotFound'));

    const sourceId = stepSource(map, step);
    const visited = new Set(this.ui?.visitedStepIds ?? []);
    visited.add(step.id);

    let activeStepId = step.id;
    let openAsideId: string | undefined;
    if (step.aside) {
      const origin = asideOrigin(map, step.id);
      activeStepId = origin?.id ?? this.ui?.activeStepId ?? mainline(map)[0]?.id ?? step.id;
      visited.add(activeStepId);
      openAsideId = step.id;
    }

    this.ui = sanitizeViewState(map, {
      ...this.ui,
      activeTab: 'walkthrough',
      activeStepId,
      openAsideId,
      visitedStepIds: [...visited],
      peek: undefined,
      sourceId,
    });
    this.highlights.update(current, this.ui);
    this.session.save(current.key, this.ui);
    this.updateTitle();
    this.pushSnapshot();

    if (revealEditor && sourceId) {
      await this.openSource(sourceId, false);
    }
  }

  private async deleteMap(key: string): Promise<void> {
    const record = this.repository.get(key);
    if (!record) throw new HostError('MAP_NOT_FOUND', t('host.mapNotFound'));
    const title = record.map?.title ?? path.posix.basename(record.relativePath);
    const choice = await vscode.window.showWarningMessage(
      t('host.confirmDeleteMap', { title, file: record.relativePath }),
      { modal: true },
      t('host.deleteAction'),
    );
    if (choice !== t('host.deleteAction')) return;
    await deleteMapFile(record.uri);
    this.qa.resetSession(key);
    await this.repository.refresh();
    void vscode.window.showInformationMessage(t('host.mapDeleted', { title }));
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
    const range = focusRevealRange(document, status, map, sourceId, activeFocusSelection(map, nextUi));
    if (range) {
      editor.selection = new vscode.Selection(range.start, range.start);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    if (!isUsableSource(status) && status.state !== 'pending') {
      this.notify(t('host.sourceStateWarning', { state: sourceStateLabel(status.state), detail: status.message ?? ref.file }), 'warning');
    }
    this.highlights.schedule();
    return editor;
  }

  private async openWorkspaceLocation(file: string, startLine: number, endLine: number): Promise<void> {
    const root = this.current?.root ?? this.activeRoot();
    if (!root) throw new HostError('MAP_NOT_FOUND', t('host.openWorkspaceFirst'));
    assertRelativeSourcePath(file);
    const { uri } = await checkedSourceUri(root.uri, file);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: targetColumn(document.uri),
      preview: false,
      preserveFocus: false,
    });
    const maxLine = Math.max(document.lineCount, 1);
    const startZero = Math.min(Math.max(startLine, 1), maxLine) - 1;
    const endZero = Math.min(Math.max(endLine, startLine), maxLine) - 1;
    const range = new vscode.Range(startZero, 0, endZero, document.lineAt(endZero).text.length);
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private async generateMapCommand(): Promise<void> {
    await this.ensurePanel();
    this.reveal();
    if (this.panel) {
      this.post({ protocolVersion: 1, type: 'ai.compose', payload: { open: true } });
      return;
    }
    const topic = await vscode.window.showInputBox({
      title: t('host.generateTitle'),
      prompt: t('host.generatePrompt'),
      placeHolder: t('host.generatePlaceholder'),
    });
    if (!topic || topic.trim().length === 0) return;
    await this.ai.generate({ topic: topic.trim() });
  }

  private async generateFromCursorCommand(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const root = this.activeRoot();
    let draft: ComposeDraftPayload = { open: true };
    if (editor && root && editor.document.uri.scheme === 'file') {
      const rel = path.relative(root.uri.fsPath, editor.document.uri.fsPath).split(path.sep).join('/');
      if (rel && !rel.startsWith('..')) {
        const startLine = editor.selection.start.line + 1;
        const endLine = editor.selection.isEmpty
          ? startLine
          : Math.max(startLine, editor.selection.end.line + 1);
        const symbol = guessEnclosingSymbol(editor.document, editor.selection.active.line);
        const targetLabel = symbol ? `${symbol} (${rel}:${startLine})` : `${rel}:${startLine}`;
        draft = {
          open: true,
          topic: t('host.fromCursorTopic', { target: targetLabel }),
          anchorFile: rel,
          anchorSymbol: symbol,
          startLine,
          endLine,
        };
      }
    }
    this.pendingCompose = draft;
    await this.ensurePanel();
    this.reveal();
    if (this.panel) {
      this.pendingCompose = undefined;
      this.post({ protocolVersion: 1, type: 'ai.compose', payload: draft });
    }
  }

  private async chooseAiProviderCommand(): Promise<void> {
    const changed = await this.ai.chooseInteractive();
    if (changed) this.postAgents();
  }

  private async copyAuthoringPrompt(): Promise<void> {
    const text = t('host.authoringPrompt');
    await vscode.env.clipboard.writeText(text);
    this.notify(t('host.promptCopied'));
    void vscode.window.showInformationMessage(t('host.promptCopiedToClipboard'));
  }

  private async openHelp(): Promise<void> {
    try {
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

function targetColumn(uri: vscode.Uri): vscode.ViewColumn {
  const visible = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString());
  return visible?.viewColumn ?? vscode.window.tabGroups.activeTabGroup.viewColumn ?? vscode.ViewColumn.Active;
}
