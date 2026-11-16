<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { VueFlow, useVueFlow, type Edge, type Node, type ViewportTransform } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import type {
  AgentOption,
  AiStatusPayload,
  CodeMap,
  ComposeDraftPayload,
  EditorContextPayload,
  HostMessage,
  MapSnapshot,
  MapSummary,
  QaExchange,
  SourceState,
  SourceStatus,
  ThemeKind,
  ViewState,
  ViewTab,
} from '../../shared/types';
import { DEFAULT_VIEW_STATE, sourceStateLabel } from '../../shared/types';
import { activeFocusSelection, sourceIdsForSelection } from '../../src/core/selection';
import { mainline, stepSource, stepsForNode } from '../../src/core/tour';
import { projectCompoundGraph, visibleRepresentative, type LevelEdge } from '../../src/core/hierarchy';
import { t } from '../../shared/i18n';
import type { HostBridge } from './host';
import MapNode from './components/MapNode.vue';
import MapGroup from './components/MapGroup.vue';
import MapEdge from './components/MapEdge.vue';
import WalkthroughView from './components/WalkthroughView.vue';
import ComposerPanel from './components/ComposerPanel.vue';
import QaDrawer from './components/QaDrawer.vue';
import { computeLayout, type LayoutResult } from './layout';
import { edgeLabelSize, nodeShape, nodeSize } from './measure';
import { edgeText, formatStepBadge, relatedSelection, statusTone } from './model';

const props = defineProps<{ host: HostBridge }>();

function initialTheme(): ThemeKind {
  const classes = document.body.classList;
  if (classes.contains('vscode-high-contrast-light')) return 'high-contrast-light';
  if (classes.contains('vscode-high-contrast')) return 'high-contrast';
  if (classes.contains('vscode-light')) return 'light';
  if (classes.contains('vscode-dark')) return 'dark';
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

const theme = ref<ThemeKind>(initialTheme());
const maps = ref<MapSummary[]>([]);
const snapshot = shallowRef<MapSnapshot>();
const agents = ref<AgentOption[]>([
  { id: 'copilot', label: 'GitHub Copilot', kind: 'cli', available: true, badge: 'CLI' },
  { id: 'agy', label: 'Antigravity (agy)', kind: 'cli', available: true, badge: 'CLI' },
  { id: 'codex', label: 'Codex CLI', kind: 'cli', available: true, badge: 'CLI' },
  { id: 'claude', label: 'Claude Code', kind: 'cli', available: true, badge: 'CLI' },
]);
const currentAgentId = ref('copilot');
const aiStatus = ref<AiStatusPayload>({ busy: false, traces: [] });
const editorContext = ref<EditorContextPayload>({ matchedStepIds: [], matchedNodeIds: [] });
const qaExchanges = ref<QaExchange[]>([]);
const composeDraft = ref<ComposeDraftPayload>({ open: false });
const standaloneMap = ref(false);

const notice = ref<{ message: string; severity: string }>();
const layout = shallowRef<LayoutResult>({ nodes: {}, groups: {}, edges: {} });
const layoutMap = shallowRef<CodeMap>();
const sourceMenu = ref<{ kind: 'node' | 'edge'; id: string; x: number; y: number }>();
const ready = ref(false);
const canvasEl = ref<HTMLElement | null>(null);
const flow = useVueFlow('code-detective-map');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let layoutKey = '';

const map = computed(() => snapshot.value?.map);
const ui = computed<ViewState>(() => snapshot.value?.ui ?? DEFAULT_VIEW_STATE);
const statuses = computed<Record<string, SourceStatus>>(() => snapshot.value?.statuses ?? {});

const showComposer = computed(() =>
  !standaloneMap.value && (aiStatus.value.busy || composeDraft.value.open || (!map.value && maps.value.length === 0)),
);

const effectiveTab = computed<ViewTab>(() => (standaloneMap.value ? 'map' : ui.value.activeTab));

const regenerateTitle = computed(() => {
  const key = composeDraft.value.overwriteKey;
  if (!key) return undefined;
  return maps.value.find(m => m.key === key)?.title ?? map.value?.title;
});

const expandedGroups = computed(() => new Set(ui.value.expandedGroupIds ?? []));
const expandedBranches = computed(() => new Set(ui.value.expandedBranchIds ?? []));

const projection = computed(() =>
  layoutMap.value
    ? projectCompoundGraph(layoutMap.value, expandedGroups.value, expandedBranches.value)
    : undefined,
);

const focusSel = computed(() => (map.value ? activeFocusSelection(map.value, ui.value) : undefined));

const related = computed(() => {
  const current = map.value;
  const proj = projection.value;
  const base = current ? relatedSelection(current, focusSel.value) : { nodes: new Set<string>(), edges: new Set<string>() };
  if (!current || !proj) return base;
  const nodes = new Set<string>();
  for (const id of base.nodes) {
    const rep = visibleRepresentative(current, id, expandedGroups.value);
    if (rep) nodes.add(rep);
  }
  const edges = new Set<string>();
  for (const edge of proj.edges) {
    if (edge.edgeIds.some(id => base.edges.has(id))) edges.add(edge.id);
  }
  return { nodes, edges };
});

const stepNodeRepIds = computed(() => {
  const current = map.value;
  if (!current) return new Set<string>();
  const stepId = ui.value.openAsideId ?? ui.value.activeStepId;
  const step = stepId ? current.walkthrough.find(s => s.id === stepId) : undefined;
  const out = new Set<string>();
  for (const nid of step?.nodeIds ?? []) {
    const rep = visibleRepresentative(current, nid, expandedGroups.value);
    if (rep) out.add(rep);
  }
  return out;
});

const peekedNodeRepId = computed(() => {
  const current = map.value;
  if (!current || ui.value.peek?.kind !== 'node') return undefined;
  return visibleRepresentative(current, ui.value.peek.id, expandedGroups.value);
});

const cursorNodeRepSet = computed(() => {
  const current = map.value;
  if (!current) return new Set<string>();
  const set = new Set<string>();
  for (const nid of editorContext.value.matchedNodeIds ?? []) {
    const rep = visibleRepresentative(current, nid, expandedGroups.value);
    if (rep) set.add(rep);
  }
  return set;
});

function badgeForNode(current: CodeMap, nodeId: string, includeChildren: boolean): string | undefined {
  const steps = stepsForNode(current, nodeId, includeChildren);
  return formatStepBadge(steps.numbers);
}

function nodeExtras(current: CodeMap, node: CodeMap['nodes'][number], proj: NonNullable<typeof projection.value>) {
  const children = proj.groupChildCounts.get(node.id) ?? 0;
  return {
    children,
    hidden: proj.hiddenBranches.get(node.id) ?? 0,
    expanded: expandedBranches.value.has(node.id),
    sources: node.sourceIds.length,
    warn: node.sourceIds.some(id => {
      const state = statuses.value[id]?.state;
      return state !== undefined && state !== 'pending' && state !== 'matched';
    }),
    stepBadge: badgeForNode(current, node.id, children > 0),
  };
}

const flowNodes = computed<Node[]>(() => {
  const current = layoutMap.value;
  const proj = projection.value;
  if (!current || !proj) return [];

  const groupElements: Node[] = proj.groups.map(group => {
    const box = layout.value.groups[group.node.id];
    const hasActiveChild = group.childIds.some(cid => stepNodeRepIds.value.has(cid) || peekedNodeRepId.value === cid);
    return {
      id: `group:${group.node.id}`,
      type: 'group',
      position: { x: Math.round(box?.x ?? 0), y: Math.round(box?.y ?? 0) },
      selectable: false,
      draggable: false,
      zIndex: -1,
      data: {
        node: group.node,
        width: Math.round(box?.width ?? 260),
        height: Math.round(box?.height ?? 140),
        stepBadge: badgeForNode(current, group.node.id, true),
        active: hasActiveChild,
        dimmed: Boolean(focusSel.value) && !hasActiveChild && !related.value.nodes.has(group.node.id),
      },
    };
  });

  const cardElements: Node[] = proj.nodes.map(node => {
    const box = layout.value.nodes[node.id];
    const extras = nodeExtras(current, node, proj);
    const isStepActive = stepNodeRepIds.value.has(node.id);
    const isPeeked = peekedNodeRepId.value === node.id;
    return {
      id: node.id,
      type: 'detective',
      position: { x: Math.round(box?.x ?? 0), y: Math.round(box?.y ?? 0) },
      zIndex: 2,
      data: {
        node,
        ...extras,
        height: box?.height ?? nodeSize(node, nodeShape(node, extras)).height,
        active: isStepActive,
        peeked: isPeeked,
        cursorHere: cursorNodeRepSet.value.has(node.id),
        related: related.value.nodes.has(node.id),
        dimmed: Boolean(focusSel.value) && !related.value.nodes.has(node.id) && !isStepActive && !isPeeked,
      },
    };
  });

  return [...groupElements, ...cardElements];
});

const flowEdges = computed<Edge[]>(() => {
  const proj = projection.value;
  if (!proj) return [];
  const chosen = focusSel.value;
  return proj.edges.map((edge: LevelEdge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: 'detective',
    zIndex: 1,
    markerEnd: 'url(#cd-arrow)',
    data: {
      edge: edge.edge,
      merged: edge.edgeIds.length,
      branch: edge.branch,
      label: edgeText(edge),
      route: layout.value.edges[edge.id],
      active: chosen?.kind === 'edge' && edge.edgeIds.includes(chosen.id),
      related: related.value.edges.has(edge.id),
      dimmed: Boolean(chosen) && !related.value.edges.has(edge.id),
    },
  }));
});

/** Info for the non-destructive Peek Banner on the call graph. */
const peekInfo = computed(() => {
  const current = map.value;
  const pk = ui.value.peek;
  if (!current || !pk) return undefined;
  if (pk.kind === 'node') {
    const node = current.nodes.find(n => n.id === pk.id);
    if (!node) return undefined;
    const steps = stepsForNode(current, node.id, true);
    return {
      label: node.label,
      firstStep: steps.firstStepId
        ? { stepId: steps.firstStepId, index: steps.numbers[0] ?? 1 }
        : undefined,
    };
  }
  const edge = current.edges.find(e => e.id === pk.id);
  if (!edge) return undefined;
  const main = mainline(current);
  const idx = main.findIndex(s => s.edgeIds.includes(edge.id));
  return {
    label: edge.branch ?? edge.label ?? `${edge.from} -> ${edge.to}`,
    firstStep: idx >= 0 ? { stepId: main[idx]!.id, index: idx + 1 } : undefined,
  };
});

function labelFor(status: SourceStatus | undefined): string {
  if (!status) return t('webview.sourceUnchecked');
  return sourceStateLabel(status.state as SourceState);
}

function post<T>(type: string, payload: T, extra?: { mapKey?: string; mapRevision?: string }): void {
  props.host.post(type, payload, extra);
}

function showNotice(message: string, severity = 'info'): void {
  notice.value = { message, severity };
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = undefined; }, 5000);
}

function switchTab(tab: ViewTab): void {
  composeDraft.value = { open: false };
  sourceMenu.value = undefined;
  if (tab === 'walkthrough') {
    post('ui.patch', { activeTab: 'walkthrough', peek: null });
  } else {
    post('ui.patch', { activeTab: 'map' });
  }
}

function onSelectMap(event: Event): void {
  const key = (event.target as HTMLSelectElement).value;
  if (!key) return;
  composeDraft.value = { open: false };
  post('map.open', {}, { mapKey: key });
}

function openNewComposer(): void {
  composeDraft.value = { open: true };
}

function openRegenerateComposer(): void {
  if (!snapshot.value || !map.value) return;
  composeDraft.value = {
    open: true,
    topic: map.value.title,
    overwriteKey: snapshot.value.key,
  };
}

function deleteCurrentMap(): void {
  if (!snapshot.value) return;
  post('map.delete', {}, { mapKey: snapshot.value.key });
}

function onChangeAgent(agentId: string): void {
  currentAgentId.value = agentId;
  post('ai.setAgent', { agentId });
}

function onComposerSubmit(payload: {
  topic: string;
  agentId: string;
  anchorFile?: string;
  anchorSymbol?: string;
  startLine?: number;
  endLine?: number;
  overwriteKey?: string;
}): void {
  post('ai.generate', payload);
}

function gotoStep(stepId: string): void {
  sourceMenu.value = undefined;
  composeDraft.value = { open: false };
  post('tour.goto', { stepId });
}

function stepDelta(delta: 1 | -1): void {
  post('tour.step', { delta });
}

function toggleAside(asideId: string | null): void {
  post('ui.patch', { openAsideId: asideId });
}

function revealStepSource(payload: { stepId: string; sourceId: string }): void {
  post('source.reveal', {
    targetKind: 'step',
    targetId: payload.stepId,
    sourceId: payload.sourceId,
    focusEditor: false,
  });
}

function revealCurrentStep(): void {
  const current = map.value;
  if (!current) return;
  const stepId = ui.value.openAsideId ?? ui.value.activeStepId ?? mainline(current)[0]?.id;
  if (!stepId) return;
  const step = current.walkthrough.find(s => s.id === stepId);
  const srcId = step ? stepSource(current, step) : undefined;
  if (srcId) {
    post('source.reveal', { targetKind: 'step', targetId: stepId, sourceId: srcId, focusEditor: false });
  }
}

function openLocation(loc: { file: string; startLine: number; endLine: number }): void {
  post('source.openLocation', loc);
}

// Call Graph interactions (non-destructive Peek)
const canvasSize = ref({ width: 0, height: 0 });

function pointer(event: MouseEvent | TouchEvent): { x: number; y: number } {
  const point = 'touches' in event ? event.touches[0] ?? event.changedTouches[0] : event;
  const box = canvasEl.value?.getBoundingClientRect();
  canvasSize.value = { width: box?.width ?? 0, height: box?.height ?? 0 };
  return { x: (point?.clientX ?? 0) - (box?.left ?? 0), y: (point?.clientY ?? 0) - (box?.top ?? 0) };
}

function peekAndReveal(kind: 'node' | 'edge', id: string, at?: { x: number; y: number }): void {
  post('ui.patch', { peek: { kind, id } });
  sourceMenu.value = undefined;
  const current = map.value;
  const ids = current ? sourceIdsForSelection(current, { kind, id }) : [];
  if (ids.length === 1) {
    post('source.reveal', { targetKind: kind, targetId: id, sourceId: ids[0]! });
  } else if (ids.length > 1 && at) {
    sourceMenu.value = { kind, id, ...at };
  } else if (ids.length > 1) {
    post('source.reveal', { targetKind: kind, targetId: id, sourceId: ids[0]! });
  }
}

function onNodeClick(event: { node: { id: string; type?: string }; event: MouseEvent | TouchEvent }): void {
  if (event.node.type === 'group' || event.node.id.startsWith('group:')) return;
  peekAndReveal('node', event.node.id, pointer(event.event));
}

function onEdgeClick(event: { edge: { id: string }; event: MouseEvent | TouchEvent }): void {
  const edge = projection.value?.edges.find(item => item.id === event.edge.id);
  peekAndReveal('edge', edge?.edgeIds[0] ?? event.edge.id, pointer(event.event));
}

function onPaneClick(): void {
  sourceMenu.value = undefined;
  if (ui.value.peek) {
    post('ui.patch', { peek: null });
  }
}

function clearPeek(): void {
  sourceMenu.value = undefined;
  post('ui.patch', { peek: null });
}

function toggleGroup(id: string): void {
  const next = new Set(expandedGroups.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  post('ui.patch', { expandedGroupIds: [...next] });
}

function toggleBranches(id: string): void {
  const next = new Set(expandedBranches.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  post('ui.patch', { expandedBranchIds: [...next] });
}

function onNodeAction(action: { type: 'expandGroup' | 'branches'; id: string }): void {
  if (action.type === 'expandGroup') toggleGroup(action.id);
  else toggleBranches(action.id);
}

// Viewport management
const VIEWPORT_DEBOUNCE_MS = 300;
let viewportTimer: ReturnType<typeof setTimeout> | undefined;
let pendingViewport: { x: number; y: number; zoom: number } | undefined;
let applyingViewport = false;
let autoFit = true;
let resizeObserver: ResizeObserver | undefined;
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
let initialView: { key: string; viewport?: { x: number; y: number; zoom: number } } | undefined;
let mountViewport = { x: 0, y: 0, zoom: 1 };

function cancelViewportPatch(): void {
  if (viewportTimer) clearTimeout(viewportTimer);
  viewportTimer = undefined;
  pendingViewport = undefined;
}

function flushViewportPatch(): void {
  const viewport = pendingViewport;
  cancelViewportPatch();
  if (viewport) post('ui.patch', { viewport });
}

function onViewportChange(viewport: ViewportTransform): void {
  if (applyingViewport) return;
  autoFit = false;
  pendingViewport = { x: Math.round(viewport.x), y: Math.round(viewport.y), zoom: Number(viewport.zoom.toFixed(3)) };
  if (viewportTimer) clearTimeout(viewportTimer);
  viewportTimer = setTimeout(flushViewportPatch, VIEWPORT_DEBOUNCE_MS);
}

async function applyViewport(change: () => Promise<unknown>, auto = true): Promise<void> {
  applyingViewport = true;
  autoFit = auto;
  try {
    await change();
  } finally {
    applyingViewport = false;
  }
}

function fitContent(duration = 0): Promise<unknown> {
  const allBoxes = [
    ...Object.values(layout.value.nodes),
    ...Object.values(layout.value.groups),
  ];
  const pane = canvasEl.value?.getBoundingClientRect();
  if (!allBoxes.length || !pane?.width) return flow.fitView({ padding: 0.1, maxZoom: 1 });
  const pad = 20;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const box of allBoxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width + 4);
    maxY = Math.max(maxY, box.y + box.height + 4);
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const fitWidth = (pane.width - pad * 2) / width;
  const fitHeight = (pane.height - pad * 2) / height;
  const zoom = Math.min(1, fitWidth, Math.max(fitHeight, Math.min(0.62, fitWidth)));
  const x = (pane.width - width * zoom) / 2 - minX * zoom;
  const y = pad - minY * zoom;
  return flow.setViewport({ x, y, zoom }, { duration });
}

function fitToView(): void {
  void applyViewport(() => fitContent(200));
}

function onNodesInitialized(): void {
  const pending = initialView;
  if (!pending || pending.key !== snapshot.value?.key) {
    if (autoFit) void applyViewport(() => fitContent(0));
    return;
  }
  initialView = undefined;
  const saved = pending.viewport;
  void applyViewport(() => (saved ? flow.setViewport(saved) : fitContent()), !saved);
}

watch(canvasEl, element => {
  resizeObserver?.disconnect();
  if (!element || typeof ResizeObserver === 'undefined') return;
  resizeObserver = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (autoFit && ready.value && effectiveTab.value === 'map') {
        void applyViewport(() => fitContent());
      }
    }, 80);
  });
  resizeObserver.observe(element);
});

const menuStyle = computed(() => {
  const menu = sourceMenu.value;
  if (!menu) return {};
  const { width, height } = canvasSize.value;
  const menuWidth = Math.min(280, Math.max(180, width - 16));
  const left = Math.max(8, Math.min(menu.x, width - menuWidth - 8));
  const below = menu.y + 8 < height * 0.6;
  return below
    ? { left: `${left}px`, top: `${menu.y + 8}px` }
    : { left: `${left}px`, bottom: `${Math.max(8, height - menu.y + 8)}px` };
});

function sourceLocation(id: string): string {
  const ref = map.value?.sources[id];
  const file = statuses.value[id]?.file ?? ref?.file ?? id;
  const line = statuses.value[id]?.startLine ?? ref?.startLine;
  return line ? `${file.split('/').pop()}:${line}` : file;
}

const menuSources = computed(() => {
  const menu = sourceMenu.value;
  const current = map.value;
  if (!menu || !current) return [];
  return sourceIdsForSelection(current, { kind: menu.kind, id: menu.id });
});

function openSourceFromMenu(sourceId: string): void {
  const menu = sourceMenu.value;
  sourceMenu.value = undefined;
  if (menu) {
    post('source.reveal', { targetKind: menu.kind, targetId: menu.id, sourceId });
  }
}

let layoutGeneration = 0;

async function prepareLayout(current: CodeMap): Promise<void> {
  const generation = ++layoutGeneration;
  const proj = projectCompoundGraph(current, expandedGroups.value, expandedBranches.value);
  const positions = await computeLayout({
    nodes: proj.nodes.map(node => ({
      id: node.id,
      ...nodeSize(node, nodeShape(node, nodeExtras(current, node, proj))),
    })),
    groups: proj.groups.map(g => ({
      id: g.node.id,
      childIds: g.childIds,
    })),
    edges: proj.edges.map(edge => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      branch: edge.branch,
      label: edgeLabelSize(edgeText(edge)),
    })),
  });
  if (generation !== layoutGeneration) return;
  layout.value = positions;
  layoutMap.value = current;
  layoutKey = `${[...expandedGroups.value].sort().join(',')}|${[...expandedBranches.value].sort().join(',')}`;
  ready.value = true;
}

watch(
  () => [
    snapshot.value?.key,
    snapshot.value?.revision,
    [...expandedGroups.value].sort().join(','),
    [...expandedBranches.value].sort().join(','),
  ] as const,
  async ([key, rev, grpKey, brKey], prev) => {
    const current = snapshot.value;
    if (!current || !key) return;
    const mapChanged = key !== prev?.[0];
    if (mapChanged) {
      cancelViewportPatch();
      ready.value = false;
      layoutMap.value = undefined;
      sourceMenu.value = undefined;
      initialView = { key, viewport: current.ui.viewport };
      mountViewport = current.ui.viewport ?? { x: 0, y: 0, zoom: 1 };
      props.host.saveState({ mapKey: key });
    }
    const nextLayoutKey = `${grpKey}|${brKey}`;
    if (mapChanged || rev !== prev?.[1] || nextLayoutKey !== layoutKey) {
      await prepareLayout(current.map);
      if (!mapChanged && nextLayoutKey !== prev?.[2] + '|' + prev?.[3] && effectiveTab.value === 'map') {
        await nextTick();
        if (autoFit) void applyViewport(() => fitContent(180));
      }
    }
  },
);

watch(effectiveTab, async tab => {
  if (tab === 'map' && map.value) {
    if (!ready.value) await prepareLayout(map.value);
    await nextTick();
    if (autoFit) void applyViewport(() => fitContent(0));
  }
});

function handle(message: HostMessage): void {
  switch (message.type) {
    case 'initialize':
      maps.value = message.payload.maps;
      snapshot.value = message.payload.current;
      agents.value = message.payload.agents;
      currentAgentId.value = message.payload.currentAgentId;
      aiStatus.value = message.payload.aiStatus;
      editorContext.value = message.payload.editorContext;
      qaExchanges.value = message.payload.qa;
      standaloneMap.value = Boolean(message.payload.standaloneMap);
      break;
    case 'maps':
      maps.value = message.payload.maps;
      break;
    case 'snapshot': {
      const prevKey = snapshot.value?.key;
      snapshot.value = message.payload.snapshot;
      if (message.payload.snapshot && message.payload.snapshot.key !== prevKey && !aiStatus.value.busy) {
        composeDraft.value = { open: false };
      }
      break;
    }
    case 'agents':
      agents.value = message.payload.agents;
      currentAgentId.value = message.payload.currentAgentId;
      break;
    case 'ai.status': {
      const wasBusy = aiStatus.value.busy;
      aiStatus.value = message.payload;
      if (wasBusy && !message.payload.busy && message.payload.phase === 'done') {
        composeDraft.value = { open: false };
      }
      break;
    }
    case 'ai.compose':
      composeDraft.value = message.payload;
      break;
    case 'editor.context':
      editorContext.value = message.payload;
      break;
    case 'qa.state':
      qaExchanges.value = message.payload.exchanges;
      break;
    case 'view.fit':
      fitToView();
      break;
    case 'notice':
      showNotice(message.payload.message, message.payload.severity ?? 'info');
      break;
    case 'theme':
      theme.value = message.payload.kind;
      break;
  }
}

onMounted(() => {
  props.host.onMessage(handle);
  window.addEventListener('pagehide', flushViewportPatch);
  post('view.ready', {});
});

onBeforeUnmount(() => resizeObserver?.disconnect());
</script>

<template>
  <div class="cd-root" :data-theme="theme">
    <!--Zone 1: Top Bookshelf & Mode Header-->
    <header v-if="!standaloneMap" class="cd-topbar">
      <div class="cd-bookshelf">
        <select
          class="cd-book-select"
          :aria-label="t('webview.bookPickerAria')"
          :value="snapshot?.key ?? ''"
          :disabled="maps.length === 0"
          @change="onSelectMap"
        >
          <option v-if="maps.length === 0" value="">{{ t('webview.noMapsOption') }}</option>
          <option v-for="item in maps" :key="item.key" :value="item.key">
            {{ item.title }}{{ item.stepCount ? ` · ${t('webview.stepCountBadge', { count: item.stepCount })}` : '' }}
          </option>
        </select>
        <button type="button" class="cd-icon-button" :title="t('webview.newGuide')" @click="openNewComposer">
          <span class="codicon codicon-add" aria-hidden="true"></span>
        </button>
        <button
          v-if="snapshot"
          type="button"
          class="cd-icon-button"
          :title="t('webview.regenerateGuide')"
          @click="openRegenerateComposer"
        >
          <span class="codicon codicon-refresh" aria-hidden="true"></span>
        </button>
        <button
          v-if="snapshot"
          type="button"
          class="cd-icon-button"
          :title="t('webview.deleteGuide')"
          @click="deleteCurrentMap"
        >
          <span class="codicon codicon-trash" aria-hidden="true"></span>
        </button>
      </div>

      <!--Mode Segmented Switch (Walkthrough vs Call Graph)-->
      <div v-if="map && !showComposer" class="cd-mode-row">
        <div class="cd-segmented" role="tablist">
          <button
            type="button"
            role="tab"
            class="cd-seg-btn"
            :class="{ active: effectiveTab === 'walkthrough' }"
            :aria-selected="effectiveTab === 'walkthrough'"
            @click="switchTab('walkthrough')"
          >
            <span class="codicon codicon-book" aria-hidden="true"></span>{{ t('webview.tabWalkthrough') }}
          </button>
          <button
            type="button"
            role="tab"
            class="cd-seg-btn"
            :class="{ active: effectiveTab === 'map' }"
            :aria-selected="effectiveTab === 'map'"
            @click="switchTab('map')"
          >
            <span class="codicon codicon-type-hierarchy" aria-hidden="true"></span>{{ t('webview.tabMap') }}
          </button>
        </div>

        <div class="cd-mode-tools">
          <button
            v-if="effectiveTab === 'map'"
            type="button"
            class="cd-icon-button"
            :title="t('webview.fitViewButton')"
            @click="fitToView"
          >
            <span class="codicon codicon-screen-full" aria-hidden="true"></span>
          </button>
          <button
            type="button"
            class="cd-icon-button"
            :title="t('webview.popoutMap')"
            @click="post('map.popout', {})"
          >
            <span class="codicon codicon-link-external" aria-hidden="true"></span>
          </button>
        </div>
      </div>
    </header>

    <!--Standalone Map Tab Header-->
    <header v-else-if="map" class="cd-standalone-bar">
      <div class="cd-standalone-title">
        <span class="codicon codicon-type-hierarchy" aria-hidden="true"></span>
        <strong>{{ map.title }}</strong>
      </div>
      <div class="cd-mode-tools">
        <button type="button" class="cd-button" @click="fitToView">
          <span class="codicon codicon-screen-full" aria-hidden="true"></span>{{ t('webview.fitViewButton') }}
        </button>
      </div>
    </header>

    <!--Zone 2: Main Content Area-->
    <main class="cd-main">
      <!--Authoring Composer / Live Exploration Footprints-->
      <ComposerPanel
        v-if="showComposer"
        :has-existing-map="Boolean(map)"
        :regenerate-title="regenerateTitle"
        :draft="composeDraft"
        :agents="agents"
        :current-agent-id="currentAgentId"
        :ai-status="aiStatus"
        :editor-context="editorContext"
        @submit="onComposerSubmit"
        @change-agent="onChangeAgent"
        @refresh-agents="post('ai.refreshAgents', {})"
        @open-settings="post('ai.openSettings', {})"
        @cancel-ai="post('ai.cancel', {})"
        @close="composeDraft = { open: false }"
        @copy-prompt="post('prompt.copy', {})"
      />

      <!--Primary Protagonist: Narrative Guided Walkthrough-->
      <WalkthroughView
        v-else-if="map && effectiveTab === 'walkthrough'"
        :map="map"
        :ui="ui"
        :statuses="statuses"
        :editor-context="editorContext"
        @goto-step="gotoStep"
        @toggle-aside="toggleAside"
        @reveal-step-source="revealStepSource"
        @open-location="openLocation"
        @delete-note="p => post('note.delete', p)"
      />

      <!--Auxiliary Global Overview: Coarse-Grained Compound Call Graph-->
      <div v-else-if="map && effectiveTab === 'map'" ref="canvasEl" class="cd-canvas">
        <!--Non-destructive Peek Banner-->
        <div v-if="peekInfo" class="cd-peek-banner">
          <span class="cd-peek-title">{{ t('webview.peekBannerTitle', { label: peekInfo.label }) }}</span>
          <button
            v-if="peekInfo.firstStep"
            type="button"
            class="cd-mini-btn primary"
            @click="gotoStep(peekInfo.firstStep.stepId)"
          >
            {{ t('webview.peekJumpToStep', { index: peekInfo.firstStep.index }) }}
          </button>
          <button type="button" class="cd-icon-button" :title="t('webview.peekClear')" @click="clearPeek">
            <span class="codicon codicon-close" aria-hidden="true"></span>
          </button>
        </div>

        <VueFlow
          v-if="layoutMap && ready"
          id="code-detective-map"
          :nodes="flowNodes"
          :edges="flowEdges"
          :default-viewport="mountViewport"
          :min-zoom="0.25"
          :max-zoom="2.5"
          :nodes-draggable="false"
          :nodes-connectable="false"
          :edges-updatable="false"
          :elements-selectable="true"
          :pan-on-drag="true"
          :zoom-on-double-click="false"
          class="cd-flow"
          @nodes-initialized="onNodesInitialized"
          @node-click="onNodeClick"
          @edge-click="onEdgeClick"
          @pane-click="onPaneClick"
          @viewport-change-end="onViewportChange"
        >
          <template #node-group="groupProps">
            <MapGroup :data="groupProps.data" @collapse="toggleGroup" />
          </template>
          <template #node-detective="nodeProps">
            <MapNode :data="nodeProps.data" :selected="false" @action="onNodeAction" />
          </template>
          <template #edge-detective="edgeProps">
            <MapEdge
              :id="edgeProps.id"
              :source-x="edgeProps.sourceX"
              :source-y="edgeProps.sourceY"
              :target-x="edgeProps.targetX"
              :target-y="edgeProps.targetY"
              :source-position="edgeProps.sourcePosition"
              :target-position="edgeProps.targetPosition"
              :marker-end="edgeProps.markerEnd"
              :data="edgeProps.data"
            />
          </template>
          <Background :gap="24" :size="1.2" color="var(--cd-canvas-dot)" />
        </VueFlow>

        <div v-else class="cd-empty">
          <span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></span>
          <h2>{{ t('webview.preparingTitle') }}</h2>
          <p>{{ t('webview.preparingBody') }}</p>
        </div>

        <!--Multi-source disambiguation popup-->
        <ul
          v-if="sourceMenu && menuSources.length"
          class="cd-popup"
          role="menu"
          :style="menuStyle"
        >
          <li class="cd-popup-title" role="presentation">{{ t('webview.chooseSource') }}</li>
          <li v-for="id in menuSources" :key="id" role="none">
            <button role="menuitem" class="cd-source" :class="{ chosen: ui.sourceId === id }" @click="openSourceFromMenu(id)">
              <span class="cd-dot" :class="statusTone(statuses[id]?.state)"></span>
              <span class="cd-source-text">
                <strong>{{ map?.sources[id]?.note || sourceLocation(id) }}</strong>
                <small v-if="map?.sources[id]?.note" :title="`${statuses[id]?.file ?? map?.sources[id]?.file}:${statuses[id]?.startLine ?? map?.sources[id]?.startLine} · ${labelFor(statuses[id])}`">
                  <bdi>{{ statuses[id]?.file ?? map?.sources[id]?.file }}:{{ statuses[id]?.startLine ?? map?.sources[id]?.startLine }}</bdi>
                </small>
              </span>
            </button>
          </li>
        </ul>
      </div>

      <!--Fallback Empty State when maps exist on disk but none accepted-->
      <div v-else class="cd-empty">
        <span class="codicon codicon-book" aria-hidden="true"></span>
        <h2>{{ t('webview.emptyTitle') }}</h2>
        <p>{{ t('webview.emptyBodyBefore') }}<code>.code-detective/maps/</code>{{ t('webview.emptyBodyAfter') }}</p>
        <div class="cd-empty-actions">
          <button type="button" class="cd-button primary" @click="openNewComposer">{{ t('webview.generateWithAi') }}</button>
          <button type="button" class="cd-button" @click="post('maps.refresh', {})">{{ t('webview.rescan') }}</button>
        </div>
      </div>
    </main>

    <!--Zone 3: Sticky Step Navigator & Mentor Q&A Dock-->
    <QaDrawer
      v-if="map && !showComposer && !standaloneMap"
      :map="map"
      :ui="ui"
      :editor-context="editorContext"
      :exchanges="qaExchanges"
      :agents="agents"
      :current-agent-id="currentAgentId"
      @step-delta="stepDelta"
      @goto-step="gotoStep"
      @reveal-current-step="revealCurrentStep"
      @ask="p => post('qa.ask', p)"
      @cancel-qa="post('qa.cancel', {})"
      @save-note="id => post('qa.saveNote', { exchangeId: id })"
      @save-aside="id => post('qa.saveAside', { exchangeId: id })"
      @open-location="openLocation"
      @change-agent="onChangeAgent"
      @refresh-agents="post('ai.refreshAgents', {})"
      @open-settings="post('ai.openSettings', {})"
    />

    <!--Toast Notice-->
    <div v-if="notice" class="cd-notice" :class="notice.severity" role="status">
      {{ notice.message }}
    </div>

    <svg class="cd-defs" aria-hidden="true">
      <defs>
        <marker id="cd-arrow" viewBox="0 0 10 10" markerWidth="8" markerHeight="8" refX="9" refY="5" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="var(--cd-edge)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </marker>
        <marker id="cd-arrow-active" viewBox="0 0 10 10" markerWidth="9" markerHeight="9" refX="9" refY="5" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="var(--cd-focus)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
        </marker>
      </defs>
    </svg>
  </div>
</template>
