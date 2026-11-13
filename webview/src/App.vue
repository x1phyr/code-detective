<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { VueFlow, useVueFlow, type Edge, type Node, type ViewportTransform } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import type {
  CodeMap,
  HostMessage,
  MapSnapshot,
  Selection,
  SourceState,
  SourceStatus,
  ThemeKind,
  ViewState,
} from '../../shared/types';
import { DEFAULT_VIEW_STATE, sourceStateLabel } from '../../shared/types';
import { sourceIdsForSelection } from '../../src/core/selection';
import { asideOrigin, mainline } from '../../src/core/tour';
import { ancestry, childCounts, collapseBranches, levelOf, representativeAt, type LevelEdge } from '../../src/core/hierarchy';
import { t } from '../../shared/i18n';
import type { HostBridge } from './host';
import MapNode from './components/MapNode.vue';
import MapEdge from './components/MapEdge.vue';
import { computeLayout, type LayoutResult } from './layout';
import { edgeLabelSize, nodeShape, nodeSize } from './measure';
import { edgeText, relatedSelection, statusTone } from './model';

const props = defineProps<{ host: HostBridge }>();

const snapshot = shallowRef<MapSnapshot>();
/** 在宿主的 `theme` 消息到达前，先按 VS Code 注入的 body class 选主题，避免亮色主题下闪一下暗色。 */
function initialTheme(): ThemeKind {
  const classes = document.body.classList;
  if (classes.contains('vscode-high-contrast-light')) return 'high-contrast-light';
  if (classes.contains('vscode-high-contrast')) return 'high-contrast';
  if (classes.contains('vscode-light')) return 'light';
  if (classes.contains('vscode-dark')) return 'dark';
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

const theme = ref<ThemeKind>(initialTheme());
const notice = ref<{ message: string; severity: string }>();
const layout = shallowRef<LayoutResult>({ nodes: {}, edges: {} });
/** 与 `layout` 对应的地图；画布只渲染已布局好的版本，避免新节点在布局完成前堆在原点。 */
const layoutMap = shallowRef<CodeMap>();
/** 当前所在的功能块（顶层为 undefined）。只在 webview 本地，不写回宿主。 */
const level = ref<string>();
/** 已展开支线的节点。 */
const expanded = ref<Set<string>>(new Set());
/** 多源码节点的选择菜单。 */
const sourceMenu = ref<{ kind: 'node' | 'edge'; id: string; x: number; y: number }>();
/** 布局对应的“层 + 展开状态”，变化时重新布局。 */
let layoutKey = '';
const ready = ref(false);
const activeSourceId = ref<string>();
const flow = useVueFlow('code-detective-map');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

const map = computed(() => snapshot.value?.map);
const ui = computed<ViewState>(() => snapshot.value?.ui ?? DEFAULT_VIEW_STATE);
const statuses = computed<Record<string, SourceStatus>>(() => snapshot.value?.statuses ?? {});
const selection = computed<Selection | undefined>(() => ui.value.selection);

const currentLevel = computed(() => (layoutMap.value ? levelOf(layoutMap.value, level.value) : undefined));
const collapsed = computed(() => (currentLevel.value
  ? collapseBranches(currentLevel.value, expanded.value)
  : { visible: new Set<string>(), hidden: new Map<string, number>() }));
const blocks = computed(() => (map.value ? childCounts(map.value) : new Map<string, number>()));
const breadcrumb = computed(() => (map.value ? ancestry(map.value, level.value) : []));

/**
 * 选中对象投影到当前层：深层节点被选中时，高亮它在这一层的祖先功能块；
 * 连线高亮所有包含了被选中原始连线的合并连线。
 */
const related = computed(() => {
  const current = map.value;
  const base = current ? relatedSelection(current, selection.value) : { nodes: new Set<string>(), edges: new Set<string>() };
  if (!current) return base;
  const nodes = new Set<string>();
  for (const id of base.nodes) {
    const rep = representativeAt(current, id, level.value);
    if (rep) nodes.add(rep);
  }
  const edges = new Set<string>();
  for (const edge of currentLevel.value?.edges ?? []) {
    if (edge.edgeIds.some(id => base.edges.has(id))) edges.add(edge.id);
  }
  return { nodes, edges };
});

const activeNodeId = computed(() => {
  const current = map.value;
  const chosen = selection.value;
  if (!current || chosen?.kind !== 'node') return undefined;
  return representativeAt(current, chosen.id, level.value);
});

/** 节点的附加信息（子节点数、折叠数、源码数……），布局和渲染共用，保证尺寸一致。 */
function nodeExtras(node: CodeMap['nodes'][number], hidden: Map<string, number>) {
  return {
    children: blocks.value.get(node.id) ?? 0,
    hidden: hidden.get(node.id) ?? 0,
    expanded: expanded.value.has(node.id),
    sources: node.sourceIds.length,
    warn: node.sourceIds.some(id => {
      const state = statuses.value[id]?.state;
      return state !== undefined && state !== 'pending' && state !== 'matched';
    }),
  };
}

const nodes = computed<Node[]>(() => {
  const current = currentLevel.value;
  if (!current) return [];
  const boxes = layout.value.nodes;
  const { visible, hidden } = collapsed.value;
  return current.nodes.filter(node => visible.has(node.id)).map(node => {
    const box = boxes[node.id];
    const extras = nodeExtras(node, hidden);
    return {
      id: node.id,
      type: 'detective',
      position: { x: Math.round(box?.x ?? 0), y: Math.round(box?.y ?? 0) },
      data: {
        node,
        ...extras,
        height: box?.height ?? nodeSize(node, nodeShape(node, extras)).height,
        active: activeNodeId.value === node.id,
        related: related.value.nodes.has(node.id),
        dimmed: Boolean(selection.value) && !related.value.nodes.has(node.id),
      },
    };
  });
});

const edges = computed<Edge[]>(() => {
  const current = currentLevel.value;
  if (!current) return [];
  const { visible } = collapsed.value;
  const chosen = selection.value;
  return current.edges.filter(edge => visible.has(edge.from) && visible.has(edge.to)).map((edge: LevelEdge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: 'detective',
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

/** 步骤条只列主线；岔路步骤在编辑器里的讲解面板中进入。 */
const mainSteps = computed(() => (map.value ? mainline(map.value) : []));

/** 当前高亮的主线步骤：在岔路里时，高亮出发的那一步。 */
const stepIndex = computed(() => {
  const current = map.value;
  const active = selection.value;
  if (!current || active?.kind !== 'step') return -1;
  const step = current.walkthrough?.find(item => item.id === active.id);
  const anchor = step?.aside ? asideOrigin(current, step.id) : step;
  return mainSteps.value.findIndex(item => item.id === anchor?.id);
});

// 侧栏很窄时步骤条会横向滚动：切换步骤后把当前步骤滚进可见区域。
const stepsBar = ref<HTMLElement>();
watch(stepIndex, async index => {
  if (index < 0) return;
  await nextTick();
  stepsBar.value?.querySelectorAll('.cd-step')[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});

const activeSource = computed<SourceStatus | undefined>(() => {
  const id = activeSourceId.value;
  return id ? statuses.value[id] : undefined;
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
  noticeTimer = setTimeout(() => { notice.value = undefined; }, 5200);
}

function select(kind: Selection['kind'], id: string): void {
  post('ui.patch', { selection: { kind, id } });
}

function reveal(kind: 'node' | 'edge' | 'step', id: string, sourceId: string): void {
  activeSourceId.value = sourceId;
  post('source.reveal', { targetKind: kind, targetId: id, sourceId });
}

/**
 * 点图上的对象 = 选中它 + 打开源码（高亮 + 行尾注释）。
 * 只有一处源码时直接打开；有多处时在点击位置弹出菜单让用户挑。
 */
function selectAndReveal(kind: 'node' | 'edge', id: string, at?: { x: number; y: number }): void {
  select(kind, id);
  sourceMenu.value = undefined;
  const current = map.value;
  const ids = current ? sourceIdsForSelection(current, { kind, id }) : [];
  if (ids.length === 1) reveal(kind, id, ids[0]!);
  else if (ids.length > 1 && at) sourceMenu.value = { kind, id, ...at };
  else if (ids.length > 1) reveal(kind, id, ids[0]!);
}

function pointer(event: MouseEvent | TouchEvent): { x: number; y: number } {
  const point = 'touches' in event ? event.touches[0] ?? event.changedTouches[0] : event;
  const box = document.querySelector('.cd-canvas')?.getBoundingClientRect();
  canvasSize.value = { width: box?.width ?? 0, height: box?.height ?? 0 };
  return { x: (point?.clientX ?? 0) - (box?.left ?? 0), y: (point?.clientY ?? 0) - (box?.top ?? 0) };
}

function onNodeClick(event: { node: { id: string }; event: MouseEvent | TouchEvent }): void {
  selectAndReveal('node', event.node.id, pointer(event.event));
}

function onEdgeClick(event: { edge: { id: string }; event: MouseEvent | TouchEvent }): void {
  // 合并后的跨层连线以第一条原始连线为代表。
  const edge = currentLevel.value?.edges.find(item => item.id === event.edge.id);
  selectAndReveal('edge', edge?.edgeIds[0] ?? event.edge.id, pointer(event.event));
}

function onPaneClick(): void {
  sourceMenu.value = undefined;
  // JSON 会丢掉 undefined 键，必须用 null 明确表示“清除选择”。
  post('ui.patch', { selection: null });
}

/** 进入功能块 / 回到某一层。 */
function enter(id: string | undefined): void {
  sourceMenu.value = undefined;
  flushViewportPatch();
  level.value = id;
  expanded.value = new Set();
}

function toggleBranches(id: string): void {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

function onNodeAction(action: { type: 'enter' | 'branches'; id: string }): void {
  if (action.type === 'enter') enter(action.id);
  else toggleBranches(action.id);
}

/** 让一组节点进入当前层并可见：必要时切换层、展开支线。返回它们在当前层的代表 id。 */
function bringIntoView(nodeIds: readonly string[]): string[] {
  const current = map.value;
  if (!current || nodeIds.length === 0) return [];
  // 切到这些节点最深的公共父功能块，让它们本身（而不是所在的功能块）出现在画布上。
  const chains = nodeIds
    .map(id => ancestry(current, id).slice(0, -1).map(node => node.id))
    .filter((chain, index) => current.nodes.some(node => node.id === nodeIds[index]));
  let target: string | undefined;
  if (chains.length) {
    for (let depth = 0; ; depth++) {
      const id = chains[0]![depth];
      if (!id || chains.some(chain => chain[depth] !== id)) break;
      target = id;
    }
  }
  if (target !== level.value) {
    level.value = target;
    expanded.value = new Set();
  }
  const reps = [...new Set(nodeIds.map(id => representativeAt(current, id, level.value)).filter((id): id is string => Boolean(id)))];
  // 目标被折叠在支线里：逐层展开带“+N”的节点，直到目标都露出来。
  for (let guard = 0; guard < 20 && reps.some(id => !collapsed.value.visible.has(id)); guard++) {
    const more = [...collapsed.value.hidden.keys()].filter(id => !expanded.value.has(id));
    if (more.length === 0) break;
    expanded.value = new Set([...expanded.value, ...more]);
  }
  return reps;
}

function gotoStep(stepId: string): void {
  sourceMenu.value = undefined;
  post('tour.goto', { stepId });
}

const VIEWPORT_DEBOUNCE_MS = 300;
let viewportTimer: ReturnType<typeof setTimeout> | undefined;
let pendingViewport: { x: number; y: number; zoom: number } | undefined;
/** 程序化改视口（fitView / 恢复视口）期间为 true，此时不回传视口。 */
let applyingViewport = false;

function cancelViewportPatch(): void {
  if (viewportTimer) clearTimeout(viewportTimer);
  viewportTimer = undefined;
  pendingViewport = undefined;
}

function flushViewportPatch(): void {
  const viewport = pendingViewport;
  cancelViewportPatch();
  // 宿主只保存纯视口补丁、不回 snapshot，所以这里发完即可，不等回声。
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

/**
 * 适配整层：侧栏通常又窄又高，按宽度适配、水平居中、顶部对齐。
 * 内容太高时不再继续缩小（最小 0.6），而是让用户上下拖动，避免字小到看不清。
 */
function fitContent(duration = 0): Promise<unknown> {
  const boxes = Object.values(layout.value.nodes);
  const pane = document.querySelector('.cd-canvas')?.getBoundingClientRect();
  if (!boxes.length || !pane?.width) return flow.fitView({ padding: 0.1, maxZoom: 1 });
  const pad = 16;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width + 4);
    maxY = Math.max(maxY, box.y + box.height + 4);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const fitWidth = (pane.width - pad * 2) / width;
  const fitHeight = (pane.height - pad * 2) / height;
  const zoom = Math.min(1, fitWidth, Math.max(fitHeight, Math.min(0.6, fitWidth)));
  const x = (pane.width - width * zoom) / 2 - minX * zoom;
  // 顶部对齐：侧栏里从上往下读，不在上方留一大块空白。
  const y = pad - minY * zoom;
  return flow.setViewport({ x, y, zoom }, { duration });
}

/** 视口还是程序适配出来的（用户没手动拖动/缩放过）：面板尺寸变化时自动重新适配。 */
let autoFit = true;
let resizeObserver: ResizeObserver | undefined;
let resizeTimer: ReturnType<typeof setTimeout> | undefined;

function watchCanvasSize(element: Element | null): void {
  resizeObserver?.disconnect();
  if (!element || typeof ResizeObserver === 'undefined') return;
  resizeObserver = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (autoFit && ready.value) void applyViewport(() => fitContent());
    }, 80);
  });
  resizeObserver.observe(element);
}

function fitToView(): void {
  void applyViewport(() => fitContent(200));
}

/** 切到新地图后待执行的首次视口：有保存的视口就恢复，否则适配整张图。只执行一次。 */
let initialView: { key: string; viewport?: { x: number; y: number; zoom: number } } | undefined;
/** 画布挂载时的初始视口，只在换地图时更新，避免首帧先画在原点再跳。 */
let mountViewport = { x: 0, y: 0, zoom: 1 };

function onNodesInitialized(): void {
  const pending = initialView;
  if (!pending || pending.key !== snapshot.value?.key) return;
  initialView = undefined;
  const saved = pending.viewport;
  void applyViewport(() => (saved ? flow.setViewport(saved) : fitContent()), !saved);
}

function openSource(sourceId: string): void {
  const menu = sourceMenu.value;
  sourceMenu.value = undefined;
  if (menu) reveal(menu.kind, menu.id, sourceId);
}

/** 菜单出现在点击处，但不超出画布：靠右时向左展开，靠下时向上展开。 */
const canvasSize = ref({ width: 0, height: 0 });
const menuStyle = computed(() => {
  const menu = sourceMenu.value;
  if (!menu) return {};
  const { width, height } = canvasSize.value;
  const menuWidth = Math.min(280, width - 16);
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

/** 选中变化时（例如阅读顺序切到下一步），把画布移到相关节点上。 */
async function focusNodes(ids: string[]): Promise<void> {
  if (ids.length === 0 || !ready.value) return;
  await nextTick();
  void applyViewport(() => flow.fitView({ nodes: ids, padding: 0.25, maxZoom: 1, duration: 240 }), false);
}

function handle(message: HostMessage): void {
  switch (message.type) {
    case 'initialize':
      if (message.payload.current) snapshot.value = message.payload.current;
      break;
    case 'maps':
      break;
    case 'view.fit':
      fitToView();
      break;
    case 'snapshot':
      snapshot.value = message.payload.snapshot;
      break;
    case 'notice':
      showNotice(message.payload.message, message.payload.severity ?? 'info');
      break;
    case 'theme':
      theme.value = message.payload.kind;
      break;
  }
}


/** 每次请求布局递增；较慢的旧布局返回时代号对不上就丢弃，不把旧坐标套到新节点上。 */
let layoutGeneration = 0;

async function prepareLayout(current: CodeMap): Promise<void> {
  const generation = ++layoutGeneration;
  const view = levelOf(current, level.value);
  const { visible, hidden } = collapseBranches(view, expanded.value);
  const positions = await computeLayout({
    nodes: view.nodes.filter(node => visible.has(node.id)).map(node => ({
      id: node.id,
      ...nodeSize(node, nodeShape(node, nodeExtras(node, hidden))),
    })),
    edges: view.edges.filter(edge => visible.has(edge.from) && visible.has(edge.to)).map(edge => ({
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
  layoutKey = `${level.value ?? ''}|${[...expanded.value].sort().join(',')}`;
  ready.value = true;
}

/** 换层或展开/收起支线后重新布局，并把视口适配到新的一层。 */
watch([level, expanded], async () => {
  const current = map.value;
  if (!current) return;
  const key = `${level.value ?? ''}|${[...expanded.value].sort().join(',')}`;
  if (key === layoutKey) return;
  const levelChanged = key.split('|')[0] !== layoutKey.split('|')[0];
  await prepareLayout(current);
  await nextTick();
  // 换层：重新适配；展开/收起支线：如果用户没手动调整过视口，也重新适配，避免新出现的支线跑出画布。
  if (levelChanged || autoFit) void applyViewport(() => fitContent(levelChanged ? 0 : 200));
});

/**
 * 换地图（key 变化）时卸载画布并在布局完成后恢复/适配视口；
 * 同一地图只换 revision 时保持画布挂载和当前视口，只重算布局（否则新节点会堆在原点）。
 */
watch(() => [snapshot.value?.key, snapshot.value?.revision] as const, async ([key], previous) => {
  const current = snapshot.value;
  if (!current || !key) return;
  if (key !== previous?.[0]) {
    cancelViewportPatch();
    ready.value = false;
    layoutMap.value = undefined;
    level.value = undefined;
    expanded.value = new Set();
    sourceMenu.value = undefined;
    initialView = { key, viewport: current.ui.viewport };
    mountViewport = current.ui.viewport ?? { x: 0, y: 0, zoom: 1 };
    props.host.saveState({ mapKey: key });
  }
  activeSourceId.value = current.ui.sourceId;
  // 地图内容变化后，之前所在的功能块可能已被删除。
  if (level.value && !current.map.nodes.some(node => node.id === level.value)) level.value = undefined;
  await prepareLayout(current.map);
});

watch(() => ui.value.selection, (current, previous) => {
  if (!current || !map.value) return;
  if (current.kind === 'step') activeSourceId.value = sourceIdsForSelection(map.value, current)[0];
  if (previous && previous.kind === current.kind && previous.id === current.id) return;
  // 阅读顺序或外部命令切换了选中：确保目标在画布上可见并移过去。画布上的点击不需要移动。
  if (current.kind === 'step') {
    const step = map.value.walkthrough?.find(item => item.id === current.id);
    const reps = bringIntoView(step?.nodeIds ?? []);
    void focusNodes(reps);
  } else if (current.kind === 'node' && !collapsed.value.visible.has(current.id)) {
    void focusNodes(bringIntoView([current.id]));
  }
});

onMounted(() => {
  props.host.onMessage(handle);
  window.addEventListener('pagehide', flushViewportPatch);
  post('view.ready', {});
  watchCanvasSize(document.querySelector('.cd-canvas'));
});

onBeforeUnmount(() => resizeObserver?.disconnect());
</script>

<template>
  <div class="cd-root" :data-theme="theme">

    <div class="cd-body">
      <nav v-if="map && (breadcrumb.length || mainSteps.length)" class="cd-bar">
        <ol v-if="breadcrumb.length" class="cd-crumbs" :aria-label="t('webview.breadcrumbLabel')">
          <li>
            <button class="cd-crumb" @click="enter(undefined)">
              <span class="codicon codicon-home" aria-hidden="true"></span>{{ t('webview.overview') }}
            </button>
          </li>
          <li v-for="(block, index) in breadcrumb" :key="block.id">
            <span class="codicon codicon-chevron-right" aria-hidden="true"></span>
            <button class="cd-crumb" :disabled="index === breadcrumb.length - 1" @click="enter(block.id)">{{ block.label }}</button>
          </li>
        </ol>
        <button
          v-if="mainSteps.length && stepIndex < 0"
          class="cd-tour-start"
          :title="t('webview.startTourHint')"
          @click="gotoStep(mainSteps[0]!.id)"
        >
          <span class="codicon codicon-play" aria-hidden="true"></span>{{ t('webview.startTour') }}
        </button>
        <ol v-if="mainSteps.length" ref="stepsBar" class="cd-steps" :aria-label="t('webview.readingOrder')">
          <li v-for="(step, index) in mainSteps" :key="step.id">
            <button
              class="cd-step"
              :class="{ current: stepIndex === index }"
              :title="step.description || step.title"
              @click="gotoStep(step.id)"
            >
              <span class="cd-index">{{ index + 1 }}</span>
              <span class="cd-step-title">{{ step.title }}</span>
              <span v-if="step.branches?.length" class="codicon codicon-git-branch cd-step-branch" aria-hidden="true"></span>
            </button>
          </li>
        </ol>
      </nav>
      <main class="cd-canvas">
        <VueFlow
          v-if="map && layoutMap && ready"
          id="code-detective-map"
          :nodes="nodes"
          :edges="edges"
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

        <div v-else-if="map" class="cd-empty">
          <span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></span>
          <h2>{{ t('webview.preparingTitle') }}</h2>
          <p>{{ t('webview.preparingBody') }}</p>
        </div>

        <div v-else class="cd-empty">
          <span class="codicon codicon-map" aria-hidden="true"></span>
          <h2>{{ t('webview.emptyTitle') }}</h2>
          <p>{{ t('webview.emptyBodyBefore') }}<code>.code-detective/maps/</code>{{ t('webview.emptyBodyAfter') }}</p>
          <div class="cd-empty-actions">
            <button class="cd-button primary" @click="post('ai.open', {})">{{ t('webview.generateWithAi') }}</button>
            <button class="cd-button" @click="post('prompt.copy', {})">{{ t('webview.copyPrompt') }}</button>
            <button class="cd-button" @click="post('maps.refresh', {})">{{ t('webview.rescan') }}</button>
          </div>
        </div>
        <ul
          v-if="sourceMenu && menuSources.length"
          class="cd-popup"
          role="menu"
          :style="menuStyle"
        >
          <li class="cd-popup-title" role="presentation">{{ t('webview.chooseSource') }}</li>
          <li v-for="id in menuSources" :key="id" role="none">
            <button role="menuitem" class="cd-source" :class="{ chosen: activeSourceId === id }" @click="openSource(id)">
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
      </main>

    </div>


    <footer v-if="activeSource" class="cd-statusbar">
      <span class="cd-dot" :class="statusTone(activeSource.state)"></span>
      {{ activeSource.file }}:{{ activeSource.startLine }}–{{ activeSource.endLine }}
      <span class="cd-muted">{{ labelFor(activeSource) }}</span>
      <span v-if="activeSource.message" class="cd-muted">· {{ activeSource.message }}</span>
    </footer>

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
