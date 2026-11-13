<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';
import type { NodeData } from '../model';
import { nodeKindLabel } from '../model';
import { t } from '../../../shared/i18n';

const props = defineProps<{ data: NodeData; selected: boolean }>();
const emit = defineEmits<{ action: [{ type: 'enter' | 'branches'; id: string }] }>();

function fire(type: 'enter' | 'branches'): void {
  emit('action', { type, id: props.data.node.id });
}
</script>

<template>
  <div
    class="cd-node"
    :class="[
      `kind-${data.node.kind ?? 'default'}`,
      { active: data.active, related: data.related, dimmed: data.dimmed, block: data.children > 0, warn: data.warn },
    ]"
  >
    <Handle type="target" :position="Position.Top" />
    <div class="cd-node-kind">
      <span v-if="data.node.kind === 'condition'" class="codicon codicon-git-compare" aria-hidden="true"></span>
      <span v-else-if="data.node.kind === 'exit'" class="codicon codicon-debug-step-out" aria-hidden="true"></span>
      {{ nodeKindLabel(data.node.kind) }}
      <span
        v-if="data.sources > 1"
        class="cd-node-tag"
        :title="t('webview.multipleSources', { count: data.sources })"
      ><span class="codicon codicon-file-code" aria-hidden="true"></span>{{ data.sources }}</span>
      <span v-if="data.warn" class="cd-node-tag warn" :title="t('webview.sourceDrift')">
        <span class="codicon codicon-warning" aria-hidden="true"></span>
      </span>
    </div>
    <div class="cd-node-label">{{ data.node.label }}</div>
    <div v-if="data.node.description" class="cd-node-desc">{{ data.node.description }}</div>
    <div v-if="data.children > 0 || data.hidden > 0 || data.expanded" class="cd-node-actions">
      <button
        v-if="data.children > 0"
        class="cd-node-action nodrag nopan"
        :title="t('webview.enterBlock', { count: data.children })"
        @click.stop="fire('enter')"
      >
        <span class="codicon codicon-layers" aria-hidden="true"></span>{{ data.children }}
      </button>
      <button
        v-if="data.hidden > 0 || data.expanded"
        class="cd-node-action nodrag nopan"
        :title="data.expanded ? t('webview.hideBranches') : t('webview.showBranches', { count: data.hidden })"
        @click.stop="fire('branches')"
      >
        <span class="codicon" :class="data.expanded ? 'codicon-fold' : 'codicon-git-branch'" aria-hidden="true"></span>
        <template v-if="!data.expanded">+{{ data.hidden }}</template>
      </button>
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>
