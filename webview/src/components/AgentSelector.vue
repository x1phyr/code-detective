<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { AgentOption } from '../../../shared/types';
import { t } from '../../../shared/i18n';

const props = withDefaults(defineProps<{
  agents: AgentOption[];
  modelValue: string;
  compact?: boolean;
  direction?: 'up' | 'down';
  disabled?: boolean;
}>(), {
  compact: false,
  direction: 'down',
  disabled: false,
});

const emit = defineEmits<{
  'update:modelValue': [id: string];
  refresh: [];
  openSettings: [];
}>();

const open = ref(false);
const rootRef = ref<HTMLElement>();

const activeAgent = computed(() =>
  props.agents.find(item => item.id === props.modelValue) ?? props.agents[0],
);

const chevronClass = computed(() => {
  if (props.direction === 'up') {
    return open.value ? 'codicon-chevron-down' : 'codicon-chevron-up';
  }
  return open.value ? 'codicon-chevron-up' : 'codicon-chevron-down';
});

function toggle(): void {
  if (props.disabled) return;
  open.value = !open.value;
}

function selectAgent(id: string): void {
  open.value = false;
  if (id !== props.modelValue) {
    emit('update:modelValue', id);
  }
}

function onRefresh(): void {
  open.value = false;
  emit('refresh');
}

function onOpenSettings(): void {
  open.value = false;
  emit('openSettings');
}

function onPointerDown(event: PointerEvent): void {
  if (!open.value) return;
  const target = event.target as Node | null;
  if (target && rootRef.value?.contains(target)) return;
  open.value = false;
}

function onKeydown(event: KeyboardEvent): void {
  if (open.value && event.key === 'Escape') {
    event.stopPropagation();
    open.value = false;
  }
}

onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div ref="rootRef" class="cd-agent-selector" :class="{ compact, up: direction === 'up', open }">
    <button
      type="button"
      class="cd-agent-trigger"
      :aria-label="t('webview.agentMenuAria')"
      :aria-expanded="open"
      :disabled="disabled"
      :title="activeAgent?.detail || activeAgent?.label || modelValue"
      @click="toggle"
    >
      <span
        class="cd-dot"
        :class="activeAgent?.available === false ? 'warn' : 'ok'"
        aria-hidden="true"
      ></span>
      <span class="cd-agent-trigger-label">{{ activeAgent?.label || modelValue }}</span>
      <span class="codicon cd-agent-chevron" :class="chevronClass" aria-hidden="true"></span>
    </button>

    <div
      v-if="open"
      class="cd-agent-menu"
      :class="direction === 'up' ? 'dir-up' : 'dir-down'"
      role="menu"
    >
      <button
        v-for="agent in agents"
        :key="agent.id"
        type="button"
        role="menuitemradio"
        class="cd-agent-option"
        :class="{ active: agent.id === modelValue, unavailable: agent.available === false }"
        :aria-checked="agent.id === modelValue"
        :title="agent.detail || agent.label"
        @click="selectAgent(agent.id)"
      >
        <span
          class="cd-dot"
          :class="agent.available === false ? 'warn' : 'ok'"
          aria-hidden="true"
        ></span>
        <span class="cd-agent-option-label">{{ agent.label }}</span>
        <span v-if="agent.badge" class="cd-agent-option-badge" :class="{ warn: agent.available === false }">
          {{ agent.badge }}
        </span>
        <span
          class="codicon cd-agent-option-check"
          :class="agent.id === modelValue ? 'codicon-check' : ''"
          aria-hidden="true"
        ></span>
      </button>

      <div class="cd-agent-menu-sep" role="separator"></div>

      <button type="button" role="menuitem" class="cd-agent-menu-action" @click="onRefresh">
        <span class="codicon codicon-refresh" aria-hidden="true"></span>
        <span>{{ t('webview.agentRefresh') }}</span>
      </button>
      <button type="button" role="menuitem" class="cd-agent-menu-action" @click="onOpenSettings">
        <span class="codicon codicon-settings-gear" aria-hidden="true"></span>
        <span>{{ t('webview.agentSettings') }}</span>
      </button>
    </div>
  </div>
</template>
