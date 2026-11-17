<script setup lang="ts">
import { computed } from 'vue';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Position } from '@vue-flow/core';
import type { EdgeData } from '../model';
import { roundedPath } from '../layout';
import { t } from '../../../shared/i18n';

const props = defineProps<{
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  data?: EdgeData;
  markerEnd?: string;
  selected?: boolean;
}>();

const emit = defineEmits<{
  inspect: [{ id: string; event: MouseEvent }];
}>();

/**
 * 优先用 ELK 的正交路由：跨层长连线会绕开中间节点，标签放在 ELK 预留的位置上。
 * 兜底布局没有路由时，退回 Vue Flow 的折线连接两端。
 */
const geometry = computed<{ path: string; x: number; y: number }>(() => {
  const route = props.data?.route;
  if (route && route.points.length >= 2) {
    const points = route.points;
    const middle = route.label ?? (() => {
      const a = points[Math.floor((points.length - 1) / 2)]!;
      const b = points[Math.floor((points.length - 1) / 2) + 1]!;
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    })();
    return { path: roundedPath(points), x: middle.x, y: middle.y };
  }
  const [path, x, y] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 6,
  });
  return { path, x, y };
});

const state = computed(() => ({
  active: props.data?.active,
  related: props.data?.related,
  dimmed: props.data?.dimmed,
  branch: props.data?.branch,
  delegated: (props.data?.bridgeHops ?? 0) > 0 || props.data?.kind === 'delegated',
  dispatch: props.data?.kind === 'dispatch',
  event: props.data?.kind === 'event',
}));

const labelTitle = computed(() => {
  if (!props.data?.label) return undefined;
  if ((props.data.bridgeHops ?? 0) > 0) {
    return `${props.data.label}\n${t('webview.edgeBridgeTooltip', { count: props.data.bridgeHops })}`;
  }
  return props.data.label;
});
</script>

<template>
  <BaseEdge
    :id="id"
    :path="geometry.path"
    :marker-end="data?.active || data?.related ? 'url(#cd-arrow-active)' : markerEnd"
    :interaction-width="14"
    :class="['cd-edge', state]"
  />
  <EdgeLabelRenderer v-if="data?.label">
    <button
      v-if="data.interactive"
      type="button"
      class="cd-edge-label interactive nodrag nopan"
      :class="[state, { bridge: data.bridgeHops > 0 }]"
      :title="labelTitle"
      :style="{ transform: `translate(-50%, -50%) translate(${geometry.x}px, ${geometry.y}px)` }"
      @click.stop="emit('inspect', { id, event: $event })"
    >
      <span
        v-if="data.bridgeHops > 0 || data.kind === 'delegated'"
        class="codicon codicon-call-outgoing"
        aria-hidden="true"
      ></span>
      <span
        v-else-if="data.merged > 1"
        class="codicon codicon-git-merge"
        aria-hidden="true"
      ></span>
      <span>{{ data.label }}</span>
    </button>
    <div
      v-else
      class="cd-edge-label"
      :class="state"
      :title="data.label"
      :style="{ transform: `translate(-50%, -50%) translate(${geometry.x}px, ${geometry.y}px)` }"
    >{{ data.label }}</div>
  </EdgeLabelRenderer>
</template>
