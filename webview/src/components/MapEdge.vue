<script setup lang="ts">
import { computed } from 'vue';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Position } from '@vue-flow/core';
import type { EdgeData } from '../model';

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

const path = computed(() => getSmoothStepPath({
  sourceX: props.sourceX,
  sourceY: props.sourceY,
  targetX: props.targetX,
  targetY: props.targetY,
  sourcePosition: props.sourcePosition,
  targetPosition: props.targetPosition,
  borderRadius: 12,
}));

const label = computed(() => props.data?.edge.label);
</script>

<template>
  <BaseEdge
    :id="id"
    :path="path[0]"
    :marker-end="markerEnd"
    :class="['cd-edge', { active: data?.active, related: data?.related, dimmed: data?.dimmed }]"
  />
  <EdgeLabelRenderer v-if="label">
    <div
      class="cd-edge-label"
      :class="{ active: data?.active, dimmed: data?.dimmed }"
      :style="{ transform: `translate(-50%, -50%) translate(${path[1]}px, ${path[2]}px)` }"
    >{{ label }}</div>
  </EdgeLabelRenderer>
</template>
