import type {
  AgentOption,
  AiStatusPayload,
  CodeMap,
  EditorContextPayload,
  HostMessage,
  InitializePayload,
  MapSnapshot,
  MapSummary,
  PeekTarget,
  QaExchange,
  SourceStatus,
  ViewState,
} from '../../shared/types';
import { DEFAULT_VIEW_STATE } from '../../shared/types';
import { t } from '../../shared/i18n';
import {
  activeFocusSelection,
  matchCursorToMap,
  sanitizeViewState,
  sourceIdsForSelection,
} from '../../src/core/selection';
import { mainline } from '../../src/core/tour';
import type { HostBridge } from './bridge';
import { PREVIEW_BUNDLES, initialPreviewKey } from './preview-data';
import { currentPreviewTheme, nextPreviewTheme, setPreviewTheme } from './preview-theme';

interface PreviewUiPatch {
  activeTab?: 'walkthrough' | 'map';
  activeStepId?: string;
  visitedStepIds?: string[];
  openAsideId?: string | null;
  peek?: PeekTarget | null;
  sourceId?: string | null;
  expandedGroupIds?: string[];
  expandedBranchIds?: string[];
  highlightEnabled?: boolean;
  viewport?: { x: number; y: number; zoom: number };
}

const revision = '0'.repeat(64);

const PREVIEW_AGENTS: AgentOption[] = [
  { id: 'copilot', label: 'GitHub Copilot', kind: 'cli', available: true, badge: 'CLI', detail: '/usr/local/bin/copilot' },
  { id: 'agy', label: 'Antigravity (agy)', kind: 'cli', available: true, badge: 'CLI', detail: '~/.local/bin/agy' },
  { id: 'codex', label: 'Codex CLI', kind: 'cli', available: true, badge: 'CLI', detail: '/opt/homebrew/bin/codex' },
  { id: 'claude', label: 'Claude Code', kind: 'cli', available: true, badge: 'CLI', detail: '~/.local/bin/claude' },
];

function statusesFor(map: CodeMap): Record<string, SourceStatus> {
  const output: Record<string, SourceStatus> = {};
  for (const [id, ref] of Object.entries(map.sources)) {
    output[id] = { file: ref.file, startLine: ref.startLine, endLine: ref.endLine, state: 'matched' };
  }
  return output;
}

export function createPreviewHost(): HostBridge {
  const bundles = new Map(PREVIEW_BUNDLES.map(item => [item.key, structuredClone(item)]));
  let activeKey = bundles.has(initialPreviewKey) ? initialPreviewKey : PREVIEW_BUNDLES[0]!.key;
  const uiByKey = new Map<string, ViewState>();
  const qaByKey = new Map<string, QaExchange[]>();
  let currentAgentId = 'copilot';
  const aiStatus: AiStatusPayload = { busy: false, traces: [] };
  let editorContext: EditorContextPayload = { matchedStepIds: [], matchedNodeIds: [] };
  const listeners: ((message: HostMessage) => void)[] = [];

  setPreviewTheme(currentPreviewTheme());

  const currentBundle = () => bundles.get(activeKey) ?? [...bundles.values()][0]!;

  const getUi = (key: string, map: CodeMap): ViewState => {
    const existing = uiByKey.get(key);
    if (existing) return existing;
    const initial = sanitizeViewState(map, DEFAULT_VIEW_STATE);
    const focus = activeFocusSelection(map, initial);
    const firstSource = focus ? sourceIdsForSelection(map, focus)[0] : undefined;
    const hydrated = sanitizeViewState(map, { ...initial, sourceId: firstSource });
    uiByKey.set(key, hydrated);
    return hydrated;
  };

  const summaries = (): MapSummary[] => [...bundles.values()].map(item => ({
    key: item.key,
    title: item.map.title,
    rootName: item.map.id,
    fileName: `.code-detective/maps/${item.map.id}.json`,
    revision,
    stepCount: mainline(item.map).length,
    nodeCount: item.map.nodes.length,
  }));

  const emit = (message: HostMessage): void => {
    for (const listener of listeners) listener(message);
  };

  const snapshot = (): MapSnapshot => {
    const bundle = currentBundle();
    const ui = getUi(bundle.key, bundle.map);
    return {
      key: bundle.key,
      revision,
      map: bundle.map,
      statuses: statusesFor(bundle.map),
      ui: structuredClone(ui),
    };
  };

  const initialize = (): InitializePayload => ({
    maps: summaries(),
    current: snapshot(),
    agents: PREVIEW_AGENTS,
    currentAgentId,
    aiStatus,
    editorContext,
    qa: qaByKey.get(activeKey) ?? [],
  });

  const applyUiPatch = (patch: PreviewUiPatch): void => {
    const bundle = currentBundle();
    const prev = getUi(bundle.key, bundle.map);
    const merged: ViewState = {
      ...prev,
      ...(patch.activeTab !== undefined ? { activeTab: patch.activeTab } : {}),
      ...(patch.activeStepId !== undefined ? { activeStepId: patch.activeStepId } : {}),
      ...(patch.visitedStepIds !== undefined ? { visitedStepIds: patch.visitedStepIds } : {}),
      ...(patch.openAsideId !== undefined ? { openAsideId: patch.openAsideId ?? undefined } : {}),
      ...(patch.peek !== undefined ? { peek: patch.peek ?? undefined } : {}),
      ...(patch.sourceId !== undefined ? { sourceId: patch.sourceId ?? undefined } : {}),
      ...(patch.expandedGroupIds !== undefined ? { expandedGroupIds: patch.expandedGroupIds } : {}),
      ...(patch.expandedBranchIds !== undefined ? { expandedBranchIds: patch.expandedBranchIds } : {}),
      ...(patch.highlightEnabled !== undefined ? { highlightEnabled: patch.highlightEnabled } : {}),
      ...(patch.viewport !== undefined ? { viewport: patch.viewport } : {}),
    };
    const next = sanitizeViewState(bundle.map, merged);
    if (!next.sourceId) {
      const focus = activeFocusSelection(bundle.map, next);
      const firstSource = focus ? sourceIdsForSelection(bundle.map, focus)[0] : undefined;
      if (firstSource) next.sourceId = firstSource;
    }
    uiByKey.set(bundle.key, next);
    emit({ protocolVersion: 1, type: 'snapshot', payload: { snapshot: snapshot() } });
  };

  const notice = (message: string, severity: 'info' | 'warning' | 'error' = 'info'): void => {
    emit({ protocolVersion: 1, type: 'notice', payload: { message, severity } });
  };

  const reveal = (targetKind: 'node' | 'edge' | 'step', targetId: string, sourceId?: string): void => {
    const bundle = currentBundle();
    const available = sourceIdsForSelection(bundle.map, { kind: targetKind, id: targetId });
    const chosen = sourceId && available.includes(sourceId) ? sourceId : available[0];
    if (!chosen) {
      notice(t('webview.noLinkedSource'), 'warning');
      return;
    }
    applyUiPatch({ sourceId: chosen });
  };

  const gotoStep = (stepId: string): void => {
    const bundle = currentBundle();
    const prev = getUi(bundle.key, bundle.map);
    const step = bundle.map.walkthrough.find(item => item.id === stepId);
    if (!step) return;
    const isAside = Boolean(step.aside);
    const prevVisited = prev.visitedStepIds ?? [];
    const visited = isAside || prevVisited.includes(stepId)
      ? prevVisited
      : [...prevVisited, stepId];
    const firstSource = sourceIdsForSelection(bundle.map, { kind: 'step', id: stepId })[0];
    if (isAside) {
      applyUiPatch({ openAsideId: stepId, peek: null, sourceId: firstSource ?? prev.sourceId });
    } else {
      applyUiPatch({
        activeStepId: stepId,
        visitedStepIds: visited,
        openAsideId: null,
        peek: null,
        sourceId: firstSource ?? prev.sourceId,
      });
    }
  };

  const stepDelta = (delta: -1 | 1): void => {
    const bundle = currentBundle();
    const prev = getUi(bundle.key, bundle.map);
    const ordered = mainline(bundle.map).map(item => item.id);
    if (ordered.length === 0) return;
    const index = prev.activeStepId ? ordered.indexOf(prev.activeStepId) : 0;
    const nextIndex = Math.max(0, Math.min(ordered.length - 1, (index >= 0 ? index : 0) + delta));
    gotoStep(ordered[nextIndex]!);
  };

  const emitQa = (): void => {
    const bundle = currentBundle();
    emit({
      protocolVersion: 1,
      type: 'qa.state',
      payload: { mapId: bundle.map.id, exchanges: structuredClone(qaByKey.get(activeKey) ?? []) },
    });
  };

  const simulateQa = (question: string, stepId?: string): void => {
    const bundle = currentBundle();
    const ui = getUi(bundle.key, bundle.map);
    const targetStepId = stepId ?? ui.activeStepId ?? bundle.map.walkthrough[0]!.id;
    const step = bundle.map.walkthrough.find(item => item.id === targetStepId);
    const firstSourceId = step ? sourceIdsForSelection(bundle.map, { kind: 'step', id: step.id })[0] : undefined;
    const ref = firstSourceId ? bundle.map.sources[firstSourceId] : undefined;
    const cite = ref ? `\`${ref.file}:${ref.startLine}\`` : '`src/login-controller.ts:15`';
    const exchange: QaExchange = {
      id: `qa-${Date.now()}`,
      stepId: targetStepId,
      question,
      selection: editorContext.selection
        ? {
            file: editorContext.selection.file,
            startLine: editorContext.selection.startLine,
            endLine: editorContext.selection.endLine,
          }
        : undefined,
      answer: ref
        ? `在「${step?.title ?? bundle.map.title}」这一步里，核心逻辑落在 ${cite}。\n\n你可以点击上面的源码坐标直接跳过去对照阅读；也可以把这条回答存成当前步骤的**笔记**或**新岔路**。`
        : `这个问题关联到 ${cite}，建议结合当前步骤主线对照阅读。`,
      status: 'done',
    };
    const list = [...(qaByKey.get(activeKey) ?? []), exchange];
    qaByKey.set(activeKey, list);
    emitQa();
  };

  const handle = (type: string, payload: Record<string, unknown>): void => {
    switch (type) {
      case 'view.ready':
        emit({ protocolVersion: 1, type: 'initialize', payload: initialize() });
        emit({ protocolVersion: 1, type: 'theme', payload: { kind: currentPreviewTheme() } });
        return;
      case 'preview.theme':
        setPreviewTheme(nextPreviewTheme());
        emit({ protocolVersion: 1, type: 'theme', payload: { kind: currentPreviewTheme() } });
        return;
      case 'preview.cursor': {
        const file = typeof payload.file === 'string' ? payload.file : undefined;
        const line = typeof payload.line === 'number' ? payload.line : undefined;
        const bundle = currentBundle();
        const matches = file !== undefined && line !== undefined
          ? matchCursorToMap(bundle.map, statusesFor(bundle.map), file, line)
          : { matchedStepIds: [], matchedNodeIds: [] };
        editorContext = {
          activeFile: file,
          cursorLine: line,
          matchedStepIds: matches.matchedStepIds,
          matchedNodeIds: matches.matchedNodeIds,
        };
        emit({ protocolVersion: 1, type: 'editor.context', payload: editorContext });
        return;
      }
      case 'maps.refresh':
        emit({ protocolVersion: 1, type: 'maps', payload: { maps: summaries() } });
        return;
      case 'map.open': {
        const nextKey = String(payload.key ?? '');
        if (bundles.has(nextKey)) {
          activeKey = nextKey;
          editorContext = { matchedStepIds: [], matchedNodeIds: [] };
          emit({ protocolVersion: 1, type: 'editor.context', payload: editorContext });
          emitQa();
        }
        emit({ protocolVersion: 1, type: 'snapshot', payload: { snapshot: snapshot() } });
        return;
      }
      case 'ui.patch':
        applyUiPatch(payload as PreviewUiPatch);
        return;
      case 'source.reveal':
        reveal(
          payload.targetKind as 'node' | 'edge' | 'step',
          String(payload.targetId),
          typeof payload.sourceId === 'string' ? payload.sourceId : undefined,
        );
        return;
      case 'source.openLocation': {
        const file = String(payload.file ?? '');
        const line = typeof payload.startLine === 'number' ? payload.startLine : 1;
        const bundle = currentBundle();
        const matchedSource = Object.entries(bundle.map.sources).find(
          ([, ref]) => ref.file === file && line >= ref.startLine && line <= ref.endLine,
        )?.[0] ?? Object.entries(bundle.map.sources).find(([, ref]) => ref.file === file)?.[0];
        if (matchedSource) applyUiPatch({ sourceId: matchedSource });
        notice(t('webview.previewNavigate', { file, line }));
        return;
      }
      case 'tour.goto':
        gotoStep(String(payload.stepId ?? ''));
        return;
      case 'tour.step':
        stepDelta(payload.delta === -1 ? -1 : 1);
        return;
      case 'highlight.setEnabled':
        applyUiPatch({ highlightEnabled: payload.enabled === true });
        return;
      case 'highlight.clear':
        applyUiPatch({ highlightEnabled: false });
        return;
      case 'ai.setAgent':
        currentAgentId = String(payload.agentId ?? currentAgentId);
        emit({ protocolVersion: 1, type: 'agents', payload: { agents: PREVIEW_AGENTS, currentAgentId } });
        return;
      case 'ai.refreshAgents':
        emit({ protocolVersion: 1, type: 'agents', payload: { agents: PREVIEW_AGENTS, currentAgentId } });
        notice(t('host.agentsRefreshed'));
        return;
      case 'ai.openSettings':
        notice(t('webview.previewUnavailable'));
        return;
      case 'ai.open':
        emit({
          protocolVersion: 1,
          type: 'ai.compose',
          payload: {
            open: true,
            overwriteKey: payload.regenerate === true ? activeKey : undefined,
          },
        });
        return;
      case 'ai.generate':
        notice(t('webview.previewNoAi'));
        return;
      case 'qa.ask':
        simulateQa(
          String(payload.question ?? ''),
          typeof payload.stepId === 'string' ? payload.stepId : undefined,
        );
        return;
      case 'qa.saveNote': {
        const exchange = (qaByKey.get(activeKey) ?? []).find(item => item.id === payload.exchangeId);
        const bundle = currentBundle();
        const step = bundle.map.walkthrough.find(item => item.id === exchange?.stepId);
        if (exchange && step) {
          const noteId = `note-${Date.now()}`;
          step.notes = [
            ...(step.notes ?? []),
            {
              id: noteId,
              question: exchange.question,
              answer: exchange.answer,
              createdAt: new Date().toISOString(),
            },
          ];
          exchange.savedNoteId = noteId;
          emitQa();
          emit({ protocolVersion: 1, type: 'snapshot', payload: { snapshot: snapshot() } });
        }
        return;
      }
      case 'qa.saveAside': {
        const exchange = (qaByKey.get(activeKey) ?? []).find(item => item.id === payload.exchangeId);
        const bundle = currentBundle();
        const anchorIndex = bundle.map.walkthrough.findIndex(item => item.id === exchange?.stepId);
        const anchor = anchorIndex >= 0 ? bundle.map.walkthrough[anchorIndex] : undefined;
        if (exchange && anchor) {
          const asideId = `aside-${Date.now()}`;
          bundle.map.walkthrough.splice(anchorIndex + 1, 0, {
            id: asideId,
            title: exchange.question.slice(0, 36),
            description: exchange.answer,
            aside: true,
            nodeIds: [...anchor.nodeIds],
            edgeIds: [...(anchor.edgeIds ?? [])],
          });
          anchor.branches = [...(anchor.branches ?? []), asideId];
          exchange.savedAsideId = asideId;
          emitQa();
          applyUiPatch({ openAsideId: asideId });
        }
        return;
      }
      case 'note.delete': {
        const bundle = currentBundle();
        const step = bundle.map.walkthrough.find(item => item.id === payload.stepId);
        if (step?.notes) {
          step.notes = step.notes.filter(item => item.id !== payload.noteId);
          emit({ protocolVersion: 1, type: 'snapshot', payload: { snapshot: snapshot() } });
        }
        return;
      }
      case 'map.popout':
      case 'map.delete':
      case 'prompt.copy':
      case 'help.open':
      case 'map.openFile':
        notice(t('webview.previewUnavailable'));
        return;
      default:
        return;
    }
  };

  return {
    preview: true,
    post<T>(type: string, payload: T): void {
      handle(type, (payload ?? {}) as Record<string, unknown>);
    },
    onMessage(listener: (message: HostMessage) => void): void {
      listeners.push(listener);
    },
    saveState(): void {
      // 浏览器预览没有 Webview 持久化状态。
    },
  };
}
