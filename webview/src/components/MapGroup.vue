<script setup lang="ts">
import type { GroupNodeData } from '../model';
import { t } from '../../../shared/i18n';

const props = defineProps<{ data: GroupNodeData }>();
const emit = defineEmits<{ collapse: [id: string] }>();
</script>

<template>
  <div
    class="cd-group"
    :class="{ active: data.active, dimmed: data.dimmed }"
    :style="{ width: `${data.width}px`, height: `${data.height}px` }"
  >
    <header class="cd-group-header">
      <span class="codicon codicon-symbol-namespace cd-group-icon" aria-hidden="true"></span>
      <span class="cd-group-title" :title="data.node.description || data.node.label">{{ data.node.label }}</span>
      <span v-if="data.stepBadge" class="cd-step-chip">{{ data.stepBadge }}</span>
      <button
        type="button"
        class="cd-group-collapse nodrag nopan"
        :title="t('webview.collapseGroup')"
        @click.stop="emit('collapse', props.data.node.id)"
      >
        <span class="codicon codicon-fold-up" aria-hidden="true"></span>{{ t('webview.collapseGroup') }}
      </button>
    </header>
  </div>
</template>
