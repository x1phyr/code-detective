<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type {
  AgentOption,
  AiStatusPayload,
  ComposeDraftPayload,
  EditorContextPayload,
} from '../../../shared/types';
import { t } from '../../../shared/i18n';
import AgentSelector from './AgentSelector.vue';

const props = defineProps<{
  hasExistingMap: boolean;
  regenerateTitle?: string;
  draft: ComposeDraftPayload;
  agents: AgentOption[];
  currentAgentId: string;
  aiStatus: AiStatusPayload;
  editorContext: EditorContextPayload;
}>();

const emit = defineEmits<{
  submit: [payload: {
    topic: string;
    agentId: string;
    anchorFile?: string;
    anchorSymbol?: string;
    startLine?: number;
    endLine?: number;
    overwriteKey?: string;
  }];
  changeAgent: [agentId: string];
  refreshAgents: [];
  openSettings: [];
  cancelAi: [];
  close: [];
  copyPrompt: [];
}>();

const topic = ref(props.draft.topic ?? '');
const selectedAgent = ref(props.currentAgentId);
const anchorFile = ref(props.draft.anchorFile);
const anchorSymbol = ref(props.draft.anchorSymbol);
const startLine = ref(props.draft.startLine);
const endLine = ref(props.draft.endLine);
const traceListRef = ref<HTMLElement>();
const textareaRef = ref<HTMLTextAreaElement>();

const elapsedSeconds = ref(0);
let elapsedTimer: ReturnType<typeof setInterval> | undefined;

function startElapsedTimer(): void {
  stopElapsedTimer();
  elapsedSeconds.value = 0;
  elapsedTimer = setInterval(() => {
    elapsedSeconds.value += 1;
  }, 1000);
}

function stopElapsedTimer(): void {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = undefined;
  }
}

watch(() => props.aiStatus.busy, busy => {
  if (busy) startElapsedTimer();
  else stopElapsedTimer();
}, { immediate: true });

onBeforeUnmount(stopElapsedTimer);

const formattedElapsed = computed(() => {
  const s = elapsedSeconds.value;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
});

const activePhaseStep = computed(() => {
  const phase = props.aiStatus.phase;
  if (phase === 'validating' || phase === 'retry' || phase === 'done') return 3;
  if (phase === 'running' || props.aiStatus.traces.length > 0) return 2;
  return 1;
});

function resizeTextarea(): void {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

watch(() => props.currentAgentId, id => {
  if (id) selectedAgent.value = id;
});

watch(() => props.draft, async d => {
  if (d.topic !== undefined) topic.value = d.topic;
  anchorFile.value = d.anchorFile;
  anchorSymbol.value = d.anchorSymbol;
  startLine.value = d.startLine;
  endLine.value = d.endLine;
  await nextTick();
  resizeTextarea();
}, { deep: true });

watch(topic, async () => {
  await nextTick();
  resizeTextarea();
});

watch(() => props.aiStatus.traces.length, async () => {
  await nextTick();
  if (traceListRef.value) {
    traceListRef.value.scrollTop = traceListRef.value.scrollHeight;
  }
});

const currentAgentOption = computed(() =>
  props.agents.find(item => item.id === selectedAgent.value) ?? props.agents[0],
);

const readyFallbackAgent = computed(() =>
  props.agents.find(item => item.available === true && item.id !== selectedAgent.value),
);

const anchorLabel = computed(() => {
  if (!anchorFile.value) return '';
  const short = anchorFile.value.split('/').pop() ?? anchorFile.value;
  const lines = startLine.value
    ? (endLine.value && endLine.value > startLine.value ? `:${startLine.value}-${endLine.value}` : `:${startLine.value}`)
    : '';
  return anchorSymbol.value ? `${anchorSymbol.value} (${short}${lines})` : `${short}${lines}`;
});

const cursorSuggestion = computed(() => {
  if (anchorFile.value) return undefined;
  const ctx = props.editorContext;
  if (ctx.selection) {
    const short = ctx.selection.file.split('/').pop() ?? ctx.selection.file;
    const label = ctx.selection.symbol
      ? `${ctx.selection.symbol} (${short}:${ctx.selection.startLine}-${ctx.selection.endLine})`
      : `${short}:${ctx.selection.startLine}-${ctx.selection.endLine}`;
    return {
      file: ctx.selection.file,
      symbol: ctx.selection.symbol,
      startLine: ctx.selection.startLine,
      endLine: ctx.selection.endLine,
      label,
    };
  }
  if (ctx.activeFile) {
    const short = ctx.activeFile.split('/').pop() ?? ctx.activeFile;
    const linePart = ctx.cursorLine ? `:${ctx.cursorLine}` : '';
    const label = ctx.activeSymbol ? `${ctx.activeSymbol} (${short}${linePart})` : `${short}${linePart}`;
    return {
      file: ctx.activeFile,
      symbol: ctx.activeSymbol,
      startLine: ctx.cursorLine,
      endLine: ctx.cursorLine,
      label,
    };
  }
  return undefined;
});

const starterChips = computed(() => [
  { label: t('webview.starterArchLabel'), prompt: t('webview.starterArchPrompt') },
  { label: t('webview.starterFlowLabel'), prompt: t('webview.starterFlowPrompt') },
  { label: t('webview.starterEdgeLabel'), prompt: t('webview.starterEdgePrompt') },
]);

function attachCursor(): void {
  const sug = cursorSuggestion.value;
  if (!sug) return;
  anchorFile.value = sug.file;
  anchorSymbol.value = sug.symbol;
  startLine.value = sug.startLine;
  endLine.value = sug.endLine;
  if (!topic.value.trim()) {
    topic.value = `${sug.label}`;
  }
}

function clearAnchor(): void {
  anchorFile.value = undefined;
  anchorSymbol.value = undefined;
  startLine.value = undefined;
  endLine.value = undefined;
}

function onAgentSelected(id: string): void {
  selectedAgent.value = id;
  emit('changeAgent', id);
}

async function applyStarter(prompt: string): Promise<void> {
  topic.value = prompt;
  await nextTick();
  resizeTextarea();
  textareaRef.value?.focus();
}

function onSubmit(): void {
  const trimmed = topic.value.trim();
  if (!trimmed || props.aiStatus.busy) return;
  emit('submit', {
    topic: trimmed,
    agentId: selectedAgent.value,
    anchorFile: anchorFile.value,
    anchorSymbol: anchorSymbol.value,
    startLine: startLine.value,
    endLine: endLine.value,
    overwriteKey: props.draft.overwriteKey,
  });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    onSubmit();
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    onSubmit();
  }
}

function traceIcon(kind: string): string {
  switch (kind) {
    case 'search': return 'codicon-search';
    case 'read': return 'codicon-book';
    case 'think': return 'codicon-sparkle';
    case 'retry': return 'codicon-sync';
    default: return 'codicon-pulse';
  }
}
</script>

<template>
  <div class="cd-composer">
    <!-- Busy / Live Exploration Footprints Card -->
    <div v-if="aiStatus.busy" class="cd-trace-card">
      <div class="cd-trace-header">
        <span class="cd-trace-badge-icon" aria-hidden="true">
          <span class="codicon codicon-loading codicon-modifier-spin"></span>
        </span>
        <div class="cd-trace-titles">
          <h3>{{ t('webview.traceRunningTitle', { agent: aiStatus.agentLabel || currentAgentOption?.label || selectedAgent }) }}</h3>
          <span class="cd-trace-elapsed">{{ formattedElapsed }}</span>
        </div>
        <button type="button" class="cd-mini-btn" @click="emit('cancelAi')">
          <span class="codicon codicon-debug-stop" aria-hidden="true"></span>
          {{ t('webview.composerCancel') }}
        </button>
      </div>

      <!-- 3-Stage Phase Stepper -->
      <div class="cd-phase-steps" role="status">
        <div class="cd-phase-step" :class="{ active: activePhaseStep === 1, done: activePhaseStep > 1 }">
          <span class="cd-phase-num">1</span>
          <span>{{ t('webview.phaseStart') }}</span>
        </div>
        <span class="cd-phase-sep" aria-hidden="true"></span>
        <div class="cd-phase-step" :class="{ active: activePhaseStep === 2, done: activePhaseStep > 2 }">
          <span class="cd-phase-num">2</span>
          <span>{{ t('webview.phaseExplore') }}</span>
        </div>
        <span class="cd-phase-sep" aria-hidden="true"></span>
        <div class="cd-phase-step" :class="{ active: activePhaseStep === 3 }">
          <span class="cd-phase-num">3</span>
          <span>{{ t('webview.phaseValidate') }}</span>
        </div>
      </div>

      <p v-if="aiStatus.topic" class="cd-trace-topic-card">{{ aiStatus.topic }}</p>

      <ol ref="traceListRef" class="cd-trace-list">
        <li v-if="aiStatus.traces.length === 0" class="cd-trace-item muted">
          <span class="codicon codicon-pulse" aria-hidden="true"></span>
          <span>{{ t('webview.traceWaiting') }}</span>
        </li>
        <li v-for="item in aiStatus.traces" :key="item.id" class="cd-trace-item" :class="item.kind">
          <span class="codicon" :class="traceIcon(item.kind)" aria-hidden="true"></span>
          <span class="cd-trace-text">{{ item.text }}</span>
          <small v-if="item.detail" class="cd-trace-detail">{{ item.detail }}</small>
        </li>
      </ol>
    </div>

    <!-- Idle / Unified Authoring Composer -->
    <form v-else class="cd-composer-form" @submit.prevent="onSubmit">
      <div class="cd-composer-top">
        <span class="cd-composer-badge" aria-hidden="true">
          <span class="codicon codicon-sparkle"></span>
        </span>
        <div class="cd-composer-headings">
          <h3>
            {{ regenerateTitle ? t('webview.composerRegenerateTitle', { title: regenerateTitle }) : t('webview.composerTitle') }}
          </h3>
          <p class="cd-composer-sub">{{ t('webview.composerSubtitle') }}</p>
        </div>
        <button
          v-if="hasExistingMap"
          type="button"
          class="cd-icon-button"
          :title="t('webview.composerBack')"
          @click="emit('close')"
        >
          <span class="codicon codicon-close" aria-hidden="true"></span>
        </button>
      </div>

      <!-- Actionable Error Banner -->
      <div v-if="aiStatus.error" class="cd-composer-error-card" role="alert">
        <div class="cd-composer-error-main">
          <span class="codicon codicon-error" aria-hidden="true"></span>
          <span>{{ aiStatus.error }}</span>
        </div>
        <div class="cd-composer-error-actions">
          <button
            v-if="readyFallbackAgent"
            type="button"
            class="cd-mini-btn primary"
            @click="onAgentSelected(readyFallbackAgent.id)"
          >
            {{ t('webview.agentSwitchReady', { agent: readyFallbackAgent.label }) }}
          </button>
          <button type="button" class="cd-mini-btn" @click="emit('openSettings')">
            <span class="codicon codicon-settings-gear" aria-hidden="true"></span>
            {{ t('webview.composerOpenSettings') }}
          </button>
          <button type="button" class="cd-mini-btn" @click="emit('copyPrompt')">
            <span class="codicon codicon-copy" aria-hidden="true"></span>
            {{ t('webview.copyPrompt') }}
          </button>
        </div>
      </div>

      <!-- Unified IDE Composer Box -->
      <div class="cd-composer-box">
        <!-- Inline Context / Anchor Strip -->
        <div v-if="anchorFile || cursorSuggestion" class="cd-composer-context">
          <div v-if="anchorFile" class="cd-anchor-chip active">
            <span class="codicon codicon-pinned" aria-hidden="true"></span>
            <span class="cd-anchor-text">{{ t('webview.composerAnchorChip', { label: anchorLabel }) }}</span>
            <button type="button" class="cd-anchor-clear" :title="t('webview.composerClearAnchor')" @click="clearAnchor">
              <span class="codicon codicon-close" aria-hidden="true"></span>
            </button>
          </div>
          <button
            v-else-if="cursorSuggestion"
            type="button"
            class="cd-anchor-chip suggest"
            @click="attachCursor"
          >
            <span class="cd-cursor-dot" aria-hidden="true"></span>
            <span class="cd-anchor-text">{{ t('webview.composerUseCursor', { label: cursorSuggestion.label }) }}</span>
          </button>
        </div>

        <textarea
          ref="textareaRef"
          v-model="topic"
          class="cd-composer-textarea"
          rows="3"
          :placeholder="t('webview.composerPlaceholder')"
          @input="resizeTextarea"
          @keydown="onKeydown"
        ></textarea>

        <div class="cd-composer-bar">
          <AgentSelector
            :agents="agents"
            :model-value="selectedAgent"
            direction="down"
            @update:model-value="onAgentSelected"
            @refresh="emit('refreshAgents')"
            @open-settings="emit('openSettings')"
          />

          <div class="cd-composer-bar-right">
            <button
              type="button"
              class="cd-icon-button"
              :title="t('webview.copyPrompt')"
              @click="emit('copyPrompt')"
            >
              <span class="codicon codicon-copy" aria-hidden="true"></span>
            </button>
            <button type="submit" class="cd-send-pill" :disabled="!topic.trim()">
              <span class="codicon codicon-sparkle" aria-hidden="true"></span>
              <span>{{ t('webview.composerStart') }}</span>
            </button>
          </div>
        </div>
      </div>

      <p class="cd-composer-footnote">{{ t('webview.composerShortcutHint') }}</p>

      <!-- Missing Agent Gentle Hint -->
      <div v-if="currentAgentOption?.available === false" class="cd-agent-warning">
        <span class="codicon codicon-warning" aria-hidden="true"></span>
        <span class="cd-agent-warning-text">
          {{ t('webview.agentMissingHint', { agent: currentAgentOption.label }) }}
        </span>
        <button
          v-if="readyFallbackAgent"
          type="button"
          class="cd-mini-btn primary"
          @click="onAgentSelected(readyFallbackAgent.id)"
        >
          {{ t('webview.agentSwitchReady', { agent: readyFallbackAgent.label }) }}
        </button>
        <button v-else type="button" class="cd-mini-btn" @click="emit('openSettings')">
          {{ t('webview.composerOpenSettings') }}
        </button>
      </div>

      <!-- Quick Starter Chips -->
      <div v-if="!regenerateTitle && !topic.trim()" class="cd-starter-chips">
        <button
          v-for="chip in starterChips"
          :key="chip.label"
          type="button"
          class="cd-starter-chip"
          @click="applyStarter(chip.prompt)"
        >
          <span class="codicon codicon-lightbulb" aria-hidden="true"></span>
          <span>{{ chip.label }}</span>
        </button>
      </div>
    </form>
  </div>
</template>
