<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
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
import { DEFAULT_VIEW_STATE, SOURCE_STATE_LABELS } from '../../shared/types';
import { sourceIdsForSelection } from '../../src/core/selection';
import type { HostBridge } from './host';
import MapNode from './components/MapNode.vue';
import MapEdge from './components/MapEdge.vue';
import { computeLayout, type Positioned } from './layout';
import {
  NODE_KIND_LABELS,
  edgeKindLabel,
  relatedSelection,
  statusTone,
} from './model';

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
const layout = ref<Record<string, Positioned>>({});
/** 与 `layout` 对应的地图；画布只渲染已布局好的版本，避免新节点在布局完成前堆在原点。 */
const layoutMap = shallowRef<CodeMap>();
const ready = ref(false);
const activeSourceId = ref<string>();
const flow = useVueFlow('code-detective-map');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

const map = computed(() => snapshot.value?.map);
const ui = computed<ViewState>(() => snapshot.value?.ui ?? DEFAULT_VIEW_STATE);
const statuses = computed<Record<string, SourceStatus>>(() => snapshot.value?.statuses ?? {});
const selection = computed<Selection | undefined>(() => ui.value.selection);

const related = computed(() => (map.value ? relatedSelection(map.value, selection.value) : { nodes: new Set(), edges: new Set() }));

/** 节点位置只由 ELK 布局决定，用户不能拖动，因此不使用会话里保存的坐标。 */
const currentPositions = computed<Record<string, { x: number; y: number }>>(() => {
  const current = layoutMap.value;
  if (!current) return {};
  const output: Record<string, { x: number; y: number }> = {};
  for (const node of current.nodes) {
    const position = layout.value[node.id];
    output[node.id] = position ? { x: Math.round(position.x), y: Math.round(position.y) } : { x: 0, y: 0 };
  }
  return output;
});

const stepIds = computed(() => {
  const current = selection.value;
  if (current?.kind === 'step' && map.value) {
    return new Set(map.value.walkthrough?.find(step => step.id === current.id)?.nodeIds ?? []);
  }
  return new Set<string>();
});

const nodes = computed<Node[]>(() => {
  const current = layoutMap.value;
  if (!current) return [];
  const positions = currentPositions.value;
  return current.nodes.map(node => ({
    id: node.id,
    type: 'detective',
    position: positions[node.id] ?? { x: 0, y: 0 },
    data: {
      node,
      active: selection.value?.kind === 'node' && selection.value.id === node.id,
      related: related.value.nodes.has(node.id) || stepIds.value.has(node.id),
      dimmed: Boolean(selection.value) && !related.value.nodes.has(node.id) && !stepIds.value.has(node.id),
    },
  }));
});

const edges = computed<Edge[]>(() => {
  const current = layoutMap.value;
  if (!current) return [];
  return current.edges.map(edge => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: 'detective',
    markerEnd: 'url(#cd-arrow)',
    data: {
      edge,
      active: selection.value?.kind === 'edge' && selection.value.id === edge.id,
      related: related.value.edges.has(edge.id),
      dimmed: Boolean(selection.value) && !related.value.edges.has(edge.id),
    },
  }));
});

const detail = computed(() => {
  const current = map.value;
  const active = selection.value;
  if (!current || !active) return undefined;
  if (active.kind === 'node') {
    const node = current.nodes.find(item => item.id === active.id);
    if (node) {
      return {
        kind: '节点' as const,
        title: node.label,
        subtitle: NODE_KIND_LABELS[node.kind ?? 'default'],
        description: node.description,
        sourceIds: node.sourceIds,
        nodeIds: [node.id] as string[],
        edgeIds: [] as string[],
      };
    }
  }
  if (active.kind === 'edge') {
    const edge = current.edges.find(item => item.id === active.id);
    if (edge) {
      return {
        kind: '连线' as const,
        title: edge.label ?? `${edge.from} → ${edge.to}`,
        subtitle: edgeKindLabel(edge),
        description: edge.description,
        sourceIds: edge.sourceIds,
        nodeIds: [edge.from, edge.to],
        edgeIds: [],
      };
    }
  }
  const step = current.walkthrough?.find(item => item.id === active.id);
  if (step) {
    return {
      kind: '导读' as const,
      title: step.title,
      subtitle: `步骤 ${stepIndex.value + 1} / ${current.walkthrough?.length ?? 0}`,
      description: step.description,
      sourceIds: sourceIdsForSelection(current, active),
      nodeIds: step.nodeIds,
      edgeIds: step.edgeIds,
    };
  }
  return undefined;
});

const stepIndex = computed(() => {
  const current = map.value;
  const active = selection.value;
  if (!current || active?.kind !== 'step') return -1;
  return current.walkthrough?.findIndex(step => step.id === active.id) ?? -1;
});

const activeSource = computed<SourceStatus | undefined>(() => {
  const id = activeSourceId.value;
  return id ? statuses.value[id] : undefined;
});

function labelFor(status: SourceStatus | undefined): string {
  if (!status) return '未检查';
  return SOURCE_STATE_LABELS[status.state as SourceState];
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

/** 点图上的对象 = 选中它 + 在当前编辑器组里打开第一处源码（高亮 + 行尾注释）。 */
function selectAndReveal(kind: 'node' | 'edge', id: string): void {
  select(kind, id);
  const current = map.value;
  const sourceId = current ? sourceIdsForSelection(current, { kind, id })[0] : undefined;
  activeSourceId.value = sourceId;
  if (sourceId) post('source.reveal', { targetKind: kind, targetId: id, sourceId });
}

function onNodeClick(event: { node: { id: string } }): void {
  selectAndReveal('node', event.node.id);
}

function onEdgeClick(event: { edge: { id: string } }): void {
  selectAndReveal('edge', event.edge.id);
}

function onPaneClick(): void {
  // JSON 会丢掉 undefined 键，必须用 null 明确表示“清除选择”。
  post('ui.patch', { selection: null });
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
  pendingViewport = { x: Math.round(viewport.x), y: Math.round(viewport.y), zoom: Number(viewport.zoom.toFixed(3)) };
  if (viewportTimer) clearTimeout(viewportTimer);
  viewportTimer = setTimeout(flushViewportPatch, VIEWPORT_DEBOUNCE_MS);
}

async function applyViewport(change: () => Promise<unknown>): Promise<void> {
  applyingViewport = true;
  try {
    await change();
  } finally {
    applyingViewport = false;
  }
}

function fitToView(): void {
  void applyViewport(() => flow.fitView({ padding: 0.2 }));
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
  void applyViewport(() => (saved ? flow.setViewport(saved) : flow.fitView({ padding: 0.2 })));
}

function openSource(sourceId: string): void {
  activeSourceId.value = sourceId;
  const current = selection.value;
  if (!current) return;
  post('source.reveal', { targetKind: current.kind, targetId: current.id, sourceId });
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

async function prepareLayout(current: MapSnapshot): Promise<void> {
  const generation = ++layoutGeneration;
  const positions = await computeLayout(current.map);
  if (generation !== layoutGeneration) return;
  layout.value = positions;
  layoutMap.value = current.map;
  ready.value = true;
}

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
    initialView = { key, viewport: current.ui.viewport };
    mountViewport = current.ui.viewport ?? { x: 0, y: 0, zoom: 1 };
    props.host.saveState({ mapKey: key });
  }
  activeSourceId.value = current.ui.sourceId;
  await prepareLayout(current);
});

watch(() => ui.value.selection, current => {
  if (!current) return;
  if (current.kind === 'step') activeSourceId.value = sourceIdsForSelection(map.value!, current)[0];
});

onMounted(() => {
  props.host.onMessage(handle);
  window.addEventListener('pagehide', flushViewportPatch);
  post('view.ready', {});
});
</script>

<template>
  <div class="cd-root" :data-theme="theme">

    <div class="cd-body">
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
            <MapNode :data="nodeProps.data" :selected="false" />
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
          <h2>正在准备地图…</h2>
          <p>正在计算布局并检查源码位置。</p>
        </div>

        <div v-else class="cd-empty">
          <span class="codicon codicon-map" aria-hidden="true"></span>
          <h2>还没有打开地图</h2>
          <p>在 <code>.code-detective/maps/</code> 下创建地图 JSON，或选择一张已有地图。</p>
          <div class="cd-empty-actions">
            <button class="cd-button primary" @click="post('ai.open', {})">用 AI 生成地图</button>
            <button class="cd-button" @click="post('prompt.copy', {})">复制 AI 生成提示词</button>
            <button class="cd-button" @click="post('maps.refresh', {})">重新扫描</button>
          </div>
        </div>

      </main>

      <aside class="cd-side" aria-label="对象目录与详情">
        <section v-if="detail" class="cd-detail">
          <div class="cd-detail-head">
            <span class="cd-chip">{{ detail.kind }}</span>
            <h2>{{ detail.title }}</h2>
            <p v-if="detail.subtitle" class="cd-detail-sub">{{ detail.subtitle }}</p>
          </div>
          <p v-if="detail.description" class="cd-detail-desc">{{ detail.description }}</p>
          <div class="cd-detail-group">
            <h3>源码位置 <span class="cd-count">{{ detail.sourceIds.length }}</span></h3>
            <ul class="cd-sources">
              <li v-for="id in detail.sourceIds" :key="id" :class="{ chosen: activeSourceId === id }">
                <button class="cd-source" @click="openSource(id)">
                  <span class="cd-dot" :class="statusTone(statuses[id]?.state)"></span>
                  <span class="cd-source-text">
                    <strong>{{ statuses[id]?.file ?? map?.sources[id]?.file ?? id }}</strong>
                    <small v-if="statuses[id]">
                      第 {{ statuses[id]!.startLine }}–{{ statuses[id]!.endLine }} 行 · {{ labelFor(statuses[id]) }}
                    </small>
                  </span>
                  <span class="codicon codicon-go-to-file" aria-hidden="true"></span>
                </button>
              </li>
              <li v-if="detail.sourceIds.length === 0" class="cd-muted">这个对象没有关联源码。</li>
            </ul>
          </div>
          <dl v-if="detail.nodeIds.length || detail.edgeIds.length" class="cd-rel">
            <template v-if="detail.nodeIds.length">
              <dt>相关节点</dt>
              <dd>
                <button v-for="id in detail.nodeIds" :key="id" class="cd-link" @click="selectAndReveal('node', id)">
                  {{ map?.nodes.find(node => node.id === id)?.label ?? id }}
                </button>
              </dd>
            </template>
            <template v-if="detail.edgeIds.length">
              <dt>相关连线</dt>
              <dd>
                <button v-for="id in detail.edgeIds" :key="id" class="cd-link" @click="selectAndReveal('edge', id)">
                  {{ id }}
                </button>
              </dd>
            </template>
          </dl>
        </section>

        <section v-if="map" class="cd-outline">
          <h3>对象目录</h3>
          <ul class="cd-tree">
            <li v-for="node in map.nodes" :key="node.id">
              <button
                :class="{ current: selection?.kind === 'node' && selection.id === node.id }"
                @click="selectAndReveal('node', node.id)"
              >
                {{ node.label }}
              </button>
            </li>
          </ul>
          <template v-if="map.walkthrough?.length">
            <h3 title="地图作者建议的阅读顺序；点一步会高亮相关节点并打开代码">阅读顺序</h3>
            <ul class="cd-tree">
              <li v-for="(step, index) in map.walkthrough" :key="step.id">
                <button
                  :class="{ current: selection?.kind === 'step' && selection.id === step.id }"
                  @click="post('tour.goto', { stepId: step.id })"
                >
                  <span class="cd-index">{{ index + 1 }}</span>
                  {{ step.title }}
                </button>
              </li>
            </ul>
          </template>
        </section>
      </aside>
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
        <marker id="cd-arrow" viewBox="0 0 12 12" markerWidth="10" markerHeight="10" refX="10" refY="6" orient="auto-start-reverse">
          <path d="M 0 0 L 12 6 L 0 12 z" fill="currentColor" />
        </marker>
      </defs>
    </svg>
  </div>
</template>
