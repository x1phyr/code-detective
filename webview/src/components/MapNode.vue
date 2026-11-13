<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';
import type { NodeData } from '../model';
import { nodeKindLabel } from '../model';

defineProps<{ data: NodeData; selected: boolean }>();
</script>

<template>
  <div
    class="cd-node"
    :class="[
      `kind-${data.node.kind ?? 'default'}`,
      { active: data.active, related: data.related, dimmed: data.dimmed },
    ]"
  >
    <Handle type="target" :position="Position.Top" />
    <div class="cd-node-kind">{{ nodeKindLabel(data.node.kind) }}</div>
    <div class="cd-node-label">{{ data.node.label }}</div>
    <div v-if="data.node.description" class="cd-node-desc">{{ data.node.description }}</div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>
