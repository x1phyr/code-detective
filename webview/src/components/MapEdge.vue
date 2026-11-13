<script setup lang="ts">
import { computed } from 'vue';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Position } from '@vue-flow/core';
import type { EdgeData } from '../model';
import { roundedPath } from '../layout';

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
}));
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
    <div
      class="cd-edge-label"
      :class="state"
      :title="data.label"
      :style="{ transform: `translate(-50%, -50%) translate(${geometry.x}px, ${geometry.y}px)` }"
    >{{ data.label }}</div>
  </EdgeLabelRenderer>
</template>
