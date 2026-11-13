<script setup lang="ts">
import { computed } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import type { NodeData } from '../model';
import { nodeKindLabel } from '../model';
import { t } from '../../../shared/i18n';

const props = defineProps<{ data: NodeData; selected: boolean }>();
const emit = defineEmits<{ action: [{ type: 'enter' | 'branches'; id: string }] }>();

function fire(type: 'enter' | 'branches'): void {
  emit('action', { type, id: props.data.node.id });
}

/** 只有事件 / 条件 / 出口有图标；普通步骤和函数不额外占位。 */
const icon = computed(() => ({
  event: 'codicon-zap',
  condition: 'codicon-question',
  exit: 'codicon-debug-step-out',
} as Record<string, string>)[props.data.node.kind ?? '']);

const footer = computed(() => {
  const d = props.data;
  return d.children > 0 || d.hidden > 0 || d.expanded || d.sources > 1 || d.warn;
});

/** 悬停提示给出完整内容：标签和说明在节点上最多显示两行。 */
const tooltip = computed(() => {
  const node = props.data.node;
  return [`${nodeKindLabel(node.kind)} · ${node.label}`, node.description].filter(Boolean).join('\n');
});
</script>

<template>
  <div
    class="cd-node"
    :class="[
      `kind-${data.node.kind ?? 'default'}`,
      { active: data.active, related: data.related, dimmed: data.dimmed, block: data.children > 0, warn: data.warn },
    ]"
    :style="{ height: `${data.height}px` }"
    :title="tooltip"
  >
    <Handle type="target" :position="Position.Top" />
    <div class="cd-node-label">
      <span v-if="icon" class="cd-node-icon codicon" :class="icon" aria-hidden="true"></span>
      <span class="cd-node-text">{{ data.node.label }}</span>
    </div>
    <div v-if="data.node.description" class="cd-node-desc">{{ data.node.description }}</div>
    <div v-if="footer" class="cd-node-footer">
      <button
        v-if="data.children > 0"
        class="cd-node-action nodrag nopan"
        :title="t('webview.enterBlock', { count: data.children })"
        @click.stop="fire('enter')"
      >
        <span class="codicon codicon-chevron-down" aria-hidden="true"></span>{{ t('webview.enterBlockShort', { count: data.children }) }}
      </button>
      <button
        v-if="data.hidden > 0 || data.expanded"
        class="cd-node-action nodrag nopan"
        :title="data.expanded ? t('webview.hideBranches') : t('webview.showBranches', { count: data.hidden })"
        @click.stop="fire('branches')"
      >
        <span class="codicon" :class="data.expanded ? 'codicon-fold-up' : 'codicon-git-branch'" aria-hidden="true"></span>
        {{ data.expanded ? t('webview.hideBranchesShort') : t('webview.showBranchesShort', { count: data.hidden }) }}
      </button>
      <span class="cd-node-meta">
        <span v-if="data.warn" class="cd-node-tag warn" :title="t('webview.sourceDrift')">
          <span class="codicon codicon-warning" aria-hidden="true"></span>
        </span>
        <span v-if="data.sources > 1" class="cd-node-tag" :title="t('webview.multipleSources', { count: data.sources })">
          <span class="codicon codicon-files" aria-hidden="true"></span>{{ data.sources }}
        </span>
      </span>
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>
