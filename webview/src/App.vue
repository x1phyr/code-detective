<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { VueFlow, useVueFlow, type Edge, type Node, type ViewportTransform } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import type {
  AiPhase,
  AiProviderStatus,
  AiResultPayload,
  AiStatusPayload,
  HostMessage,
  MapSnapshot,
  MapSummary,
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

const maps = ref<MapSummary[]>([]);
const snapshot = shallowRef<MapSnapshot>();
const theme = ref<ThemeKind>('dark');
const notice = ref<{ message: string; severity: string }>();
const layout = ref<Record<string, Positioned>>({});
const ready = ref(false);
const menuOpen = ref(false);
const activeSourceId = ref<string>();
const flow = useVueFlow('code-detective-map');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const aiOpen = ref(false);
const aiTopic = ref('');
const aiStatus = ref<AiStatusPayload>();
const aiProvider = ref('auto');
const aiPhase = ref<AiPhase>();
const aiMessage = ref('');
const aiChars = ref(0);
const aiResult = ref<AiResultPayload>();
const aiBusy = computed(() => aiPhase.value === 'preparing' || aiPhase.value === 'running'
  || aiPhase.value === 'validating' || aiPhase.value === 'retry');
const aiProgressLabel = computed(() => {
  switch (aiPhase.value) {
    case 'preparing': return '正在准备上下文…';
    case 'running': return aiChars.value > 0 ? `正在生成… ${aiChars.value} 字符` : '正在生成…';
    case 'validating': return '正在校验结果…';
    case 'retry': return '校验未通过，正在重试…';
    case 'done': return '已生成地图';
    case 'cancelled': return '已取消';
    case 'error': return '生成失败';
    default: return '空闲';
  }
});

const map = computed(() => snapshot.value?.map);
const ui = computed<ViewState>(() => snapshot.value?.ui ?? DEFAULT_VIEW_STATE);
const statuses = computed<Record<string, SourceStatus>>(() => snapshot.value?.statuses ?? {});
const selection = computed<Selection | undefined>(() => ui.value.selection);

const related = computed(() => (map.value ? relatedSelection(map.value, selection.value) : { nodes: new Set(), edges: new Set() }));

/** 节点位置只由 ELK 布局决定，用户不能拖动，因此不使用会话里保存的坐标。 */
const currentPositions = computed<Record<string, { x: number; y: number }>>(() => {
  const current = map.value;
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
  const current = map.value;
  if (!current) return [];
  const positions = currentPositions.value;
  return current.nodes.map(node => ({
    id: node.id,
    type: 'detective',
    position: positions[node.id] ?? { x: 0, y: 0 },
    data: {
      node,
      active: selection.value?.kind === 'node' && selection.value.id === node.id,
      related: related.value.nodes.has(node.id),
      inStep: stepIds.value.has(node.id),
    },
  }));
});

const edges = computed<Edge[]>(() => {
  const current = map.value;
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

function onNodeClick(event: { node: { id: string } }): void {
  select('node', event.node.id);
}

function onEdgeClick(event: { edge: { id: string } }): void {
  select('edge', event.edge.id);
}

function onPaneClick(): void {
  post('ui.patch', { selection: undefined });
}

function onViewportChange(viewport: ViewportTransform): void {
  post('ui.patch', { viewport: { x: Math.round(viewport.x), y: Math.round(viewport.y), zoom: Number(viewport.zoom.toFixed(3)) } });
}

function fitToView(): void {
  void flow.fitView({ padding: 0.2 });
}

function openSource(sourceId: string): void {
  activeSourceId.value = sourceId;
  const current = selection.value;
  if (!current) return;
  post('source.reveal', { targetKind: current.kind, targetId: current.id, sourceId });
}

function startTour(): void {
  const first = map.value?.walkthrough?.[0];
  if (first) post('tour.goto', { stepId: first.id });
  else showNotice('当前地图没有导读步骤。', 'warning');
}

function stepBy(delta: number): void {
  const steps = map.value?.walkthrough ?? [];
  if (steps.length === 0) return;
  const next = stepIndex.value < 0
    ? (delta > 0 ? 0 : steps.length - 1)
    : Math.min(steps.length - 1, Math.max(0, stepIndex.value + delta));
  post('tour.goto', { stepId: steps[next]!.id });
}

function stopTour(): void {
  post('tour.stop', {});
}

function toggleHighlights(): void {
  post('highlight.setEnabled', { enabled: !ui.value.highlightEnabled });
}

function openMap(key: string): void {
  post('map.open', {}, { mapKey: key });
  menuOpen.value = false;
}

function openAi(): void {
  aiOpen.value = !aiOpen.value;
  if (aiOpen.value) post('ai.status', {});
}

function onAiProviderChange(): void {
  post('ai.select', { provider: aiProvider.value });
}

function generateWithAi(): void {
  if (aiBusy.value) return;
  const topic = aiTopic.value.trim();
  if (!topic) {
    showNotice('请先描述你想了解的功能。', 'warning');
    return;
  }
  const files: string[] = [];
  const current = map.value;
  if (current) {
    const chosen = selection.value;
    const ids = chosen && chosen.kind === 'node'
      ? current.nodes.find(node => node.id === chosen.id)?.sourceIds ?? []
      : [];
    for (const id of ids) {
      const file = current.sources[id]?.file;
      if (file && !files.includes(file)) files.push(file);
    }
  }
  aiResult.value = undefined;
  aiChars.value = 0;
  post('ai.generate', { topic, provider: aiProvider.value, files });
}

function cancelAi(): void {
  post('ai.cancel', {});
}

function openGeneratedMap(): void {
  const key = aiResult.value?.mapKey;
  if (key) post('map.open', {}, { mapKey: key });
  aiResult.value = undefined;
  aiOpen.value = false;
}

function handle(message: HostMessage): void {
  switch (message.type) {
    case 'initialize':
      maps.value = message.payload.maps;
      if (message.payload.current) snapshot.value = message.payload.current;
      break;
    case 'maps':
      maps.value = message.payload.maps;
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
    case 'ai.status':
      aiStatus.value = message.payload;
      aiProvider.value = message.payload.provider;
      break;
    case 'ai.progress':
      aiPhase.value = message.payload.phase;
      aiMessage.value = message.payload.message ?? '';
      if (typeof message.payload.chars === 'number') aiChars.value = message.payload.chars;
      break;
    case 'ai.result':
      aiPhase.value = message.payload.phase;
      aiResult.value = message.payload;
      if (message.payload.ok && message.payload.title) showNotice(`已生成地图：${message.payload.title}`, 'info');
      else if (message.payload.phase === 'error') showNotice(message.payload.message ?? '生成失败', 'error');
      break;
  }
}

const providerList = computed<AiProviderStatus[]>(() => aiStatus.value?.providers ?? []);

async function prepareLayout(current: MapSnapshot): Promise<void> {
  layout.value = await computeLayout(current.map);
  ready.value = true;
}

/** 地图内容变化（同 key 被改写时 revision 会变）也要重算，否则新节点会堆在原点。 */
watch(() => [snapshot.value?.key, snapshot.value?.revision] as const, async () => {
  const current = snapshot.value;
  if (!current) return;
  ready.value = false;
  activeSourceId.value = current.ui.sourceId;
  await prepareLayout(current);
});

watch(() => ui.value.selection, current => {
  if (!current) return;
  if (current.kind === 'step') activeSourceId.value = sourceIdsForSelection(map.value!, current)[0];
});

onMounted(() => {
  props.host.onMessage(handle);
  post('view.ready', {});
});
</script>

<template>
  <div class="cd-root" :data-theme="theme">
    <header class="cd-toolbar">
      <div class="cd-brand">
        <span class="codicon codicon-map" aria-hidden="true"></span>
        <span class="cd-brand-title">{{ map?.title ?? '代码侦探' }}</span>
        <span v-if="map?.description" class="cd-brand-sub">{{ map.description }}</span>
      </div>
      <div class="cd-actions">
        <div class="cd-select">
          <button class="cd-button" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
            <span class="codicon codicon-list-selection" aria-hidden="true"></span>
            地图
            <span v-if="maps.length" class="cd-badge">{{ maps.length }}</span>
          </button>
          <ul v-if="menuOpen" class="cd-menu" role="menu">
            <li v-if="maps.length === 0" class="cd-menu-empty">没有发现地图</li>
            <li v-for="item in maps" :key="item.key" role="none">
              <button role="menuitem" :class="{ current: item.key === snapshot?.key }" @click="openMap(item.key)">
                <span class="codicon" :class="item.error ? 'codicon-error' : 'codicon-file-code'" aria-hidden="true"></span>
                <span class="cd-menu-text">
                  <strong>{{ item.title }}</strong>
                  <small>{{ item.rootName }} · {{ item.fileName }}</small>
                </span>
              </button>
            </li>
          </ul>
        </div>
        <button class="cd-button" title="重新扫描地图" @click="post('maps.refresh', {})">
          <span class="codicon codicon-refresh" aria-hidden="true"></span>
          重新扫描
        </button>
        <button class="cd-button" title="缩放到能看到整张地图" @click="fitToView">
          <span class="codicon codicon-screen-full" aria-hidden="true"></span>
          适应窗口
        </button>
        <button class="cd-button" :class="{ on: ui.highlightEnabled }" @click="toggleHighlights">
          <span class="codicon codicon-symbol-color" aria-hidden="true"></span>
          相关高亮
        </button>
        <button class="cd-button" :class="{ on: aiOpen }" @click="openAi">
          <span class="codicon codicon-sparkle" aria-hidden="true"></span>
          AI 生成
        </button>
        <button class="cd-button" @click="post('prompt.copy', {})">
          <span class="codicon codicon-copy" aria-hidden="true"></span>
          提示词
        </button>
        <button class="cd-button" @click="post('help.open', {})">
          <span class="codicon codicon-question" aria-hidden="true"></span>
          帮助
        </button>
      </div>
    </header>

    <div class="cd-body">
      <main class="cd-canvas">
        <VueFlow
          v-if="map && ready"
          id="code-detective-map"
          :nodes="nodes"
          :edges="edges"
          :default-viewport="ui.viewport ?? { x: 0, y: 0, zoom: 1 }"
          :min-zoom="0.25"
          :max-zoom="2.5"
          :nodes-draggable="false"
          :nodes-connectable="false"
          :edges-updatable="false"
          :elements-selectable="true"
          :pan-on-drag="true"
          :zoom-on-double-click="false"
          fit-view-on-init
          class="cd-flow"
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
            <button class="cd-button primary" @click="openAi">用 AI 生成地图</button>
            <button class="cd-button" @click="post('prompt.copy', {})">复制 AI 生成提示词</button>
            <button class="cd-button" @click="post('maps.refresh', {})">重新扫描</button>
          </div>
        </div>

        <div v-if="map" class="cd-tour" :class="{ active: stepIndex >= 0 }">
          <template v-if="stepIndex >= 0">
            <button class="cd-icon-button" title="上一步" @click="stepBy(-1)"><span class="codicon codicon-arrow-left"></span></button>
            <span class="cd-tour-text">{{ detail?.title }}</span>
            <span class="cd-tour-count">{{ stepIndex + 1 }}/{{ map.walkthrough?.length }}</span>
            <button class="cd-icon-button" title="下一步" @click="stepBy(1)"><span class="codicon codicon-arrow-right"></span></button>
            <button class="cd-icon-button" title="停止导读" @click="stopTour"><span class="codicon codicon-debug-stop"></span></button>
          </template>
          <template v-else-if="(map.walkthrough?.length ?? 0) > 0">
            <button class="cd-button primary" @click="startTour">
              <span class="codicon codicon-play"></span> 开始导读
            </button>
            <span class="cd-tour-count">{{ map.walkthrough?.length }} 步</span>
          </template>
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
                <button v-for="id in detail.nodeIds" :key="id" class="cd-link" @click="select('node', id)">
                  {{ map?.nodes.find(node => node.id === id)?.label ?? id }}
                </button>
              </dd>
            </template>
            <template v-if="detail.edgeIds.length">
              <dt>相关连线</dt>
              <dd>
                <button v-for="id in detail.edgeIds" :key="id" class="cd-link" @click="select('edge', id)">
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
                @click="select('node', node.id)"
              >
                <span class="cd-dot" :class="`kind-${node.kind ?? 'default'}`"></span>
                {{ node.label }}
              </button>
            </li>
          </ul>
          <template v-if="map.walkthrough?.length">
            <h3>导读</h3>
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

    <aside v-if="aiOpen" class="cd-ai" aria-label="AI 生成地图">
      <header class="cd-ai-head">
        <span class="codicon codicon-sparkle" aria-hidden="true"></span>
        <h2>用 AI 生成地图</h2>
        <button class="cd-icon-button" title="关闭" @click="aiOpen = false">
          <span class="codicon codicon-close"></span>
        </button>
      </header>

      <label class="cd-ai-field">
        <span>AI 服务</span>
        <select :value="aiProvider" :disabled="aiBusy" @change="onAiProviderChange">
          <option v-for="item in providerList" :key="item.id" :value="item.id">
            {{ item.label }}{{ item.available ? '' : '（不可用）' }}
          </option>
          <option v-if="providerList.length === 0" value="auto">自动选择</option>
        </select>
      </label>
      <p v-if="providerList.find(item => item.id === aiProvider)?.detail" class="cd-ai-hint">
        {{ providerList.find(item => item.id === aiProvider)?.detail }}
      </p>
      <p v-if="aiStatus?.remoteBaseUrl && !aiStatus?.allowRemote" class="cd-ai-hint warn">
        当前地址不是本机，请求会被阻止。请在设置中开启 codeDetective.ai.allowRemote。
      </p>

      <label class="cd-ai-field">
        <span>想了解什么</span>
        <textarea
          v-model="aiTopic"
          rows="4"
          :disabled="aiBusy"
          placeholder="例如：从点击背包按钮到刷新物品列表的完整流程"
        ></textarea>
      </label>

      <p class="cd-ai-hint">AI 会读取当前打开的文件和当前选中节点的源码，生成结果先通过 JSON 校验再写入 .code-detective/maps/。</p>

      <div class="cd-ai-actions">
        <button class="cd-button primary" :disabled="aiBusy" @click="generateWithAi">
          <span class="codicon codicon-sparkle" aria-hidden="true"></span>
          生成地图
        </button>
        <button v-if="aiBusy" class="cd-button" @click="cancelAi">取消</button>
        <button class="cd-button" @click="post('ai.status', {})" :disabled="aiBusy">
          <span class="codicon codicon-refresh" aria-hidden="true"></span>
        </button>
      </div>

      <div v-if="aiPhase" class="cd-ai-progress" :class="aiPhase">
        <span class="codicon" :class="aiBusy ? 'codicon-loading codicon-modifier-spin' : aiPhase === 'done' ? 'codicon-check' : aiPhase === 'error' ? 'codicon-error' : 'codicon-circle-slash'" aria-hidden="true"></span>
        <span>{{ aiProgressLabel }}</span>
      </div>
      <p v-if="aiMessage" class="cd-ai-hint">{{ aiMessage }}</p>
      <div v-if="aiResult?.ok && aiResult.mapKey" class="cd-ai-result">
        <span class="codicon codicon-check" aria-hidden="true"></span>
        <span>{{ aiResult.title }} · {{ aiResult.message }}</span>
        <button class="cd-button" @click="openGeneratedMap">打开地图</button>
      </div>
    </aside>

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
