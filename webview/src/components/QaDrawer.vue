<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type {
  AgentOption,
  CodeMap,
  EditorContextPayload,
  QaExchange,
  ViewState,
  WalkthroughStep,
} from '../../../shared/types';
import { mainline, stepSource } from '../../../src/core/tour';
import { extractCitationClick, renderMentorMarkdown } from '../markdown';
import { t } from '../../../shared/i18n';
import AgentSelector from './AgentSelector.vue';

const props = defineProps<{
  map: CodeMap;
  ui: ViewState;
  editorContext: EditorContextPayload;
  exchanges: QaExchange[];
  agents: AgentOption[];
  currentAgentId: string;
}>();

const emit = defineEmits<{
  stepDelta: [delta: 1 | -1];
  gotoStep: [stepId: string];
  revealCurrentStep: [];
  ask: [payload: { stepId: string; question: string; includeSelection: boolean }];
  cancelQa: [];
  saveNote: [exchangeId: string];
  saveAside: [exchangeId: string];
  openLocation: [payload: { file: string; startLine: number; endLine: number }];
  changeAgent: [agentId: string];
  refreshAgents: [];
  openSettings: [];
}>();

const question = ref('');
const includeSelection = ref(true);
const drawerOpen = ref(false);
const historyRef = ref<HTMLElement>();
const inputRef = ref<HTMLTextAreaElement>();

const mainSteps = computed<WalkthroughStep[]>(() => mainline(props.map));
const activeMainId = computed(() => props.ui.activeStepId ?? mainSteps.value[0]?.id);
const activeMainIndex = computed(() => mainSteps.value.findIndex(s => s.id === activeMainId.value));
/** Context step for asking Q&A: if an aside is expanded inline, ask against that aside; otherwise active main step. */
const contextStepId = computed(() => props.ui.openAsideId ?? activeMainId.value ?? mainSteps.value[0]?.id ?? '');

const stepExchanges = computed(() =>
  props.exchanges.filter(item => item.stepId === contextStepId.value || item.stepId === activeMainId.value),
);
const isStreaming = computed(() => props.exchanges.some(item => item.status === 'streaming'));

const canPrev = computed(() => Boolean(props.ui.openAsideId) || activeMainIndex.value > 0);
const canNext = computed(() => activeMainIndex.value >= 0 && activeMainIndex.value < mainSteps.value.length - 1);

/** Gentle cursor reverse-sync: when editor cursor sits inside a DIFFERENT step from the active one. */
const otherCursorStep = computed<{ id: string; index: number; title: string } | undefined>(() => {
  const matched = props.editorContext.matchedStepIds ?? [];
  if (matched.length === 0) return undefined;
  if (matched.includes(activeMainId.value ?? '') || matched.includes(props.ui.openAsideId ?? '')) {
    return undefined;
  }
  for (const id of matched) {
    const mainIdx = mainSteps.value.findIndex(s => s.id === id);
    if (mainIdx >= 0) {
      return { id, index: mainIdx + 1, title: mainSteps.value[mainIdx]!.title };
    }
  }
  return undefined;
});

const activeStepHasSource = computed(() => {
  const step = props.map.walkthrough.find(s => s.id === contextStepId.value);
  return Boolean(step && stepSource(props.map, step));
});

const selectionChip = computed(() => {
  const sel = props.editorContext.selection;
  if (!sel) return undefined;
  return {
    shortFile: sel.file.split('/').pop() ?? sel.file,
    start: sel.startLine,
    end: sel.endLine,
  };
});

function resizeInput(): void {
  const el = inputRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 92)}px`;
}

// Auto-reset includeSelection to true whenever a fresh selection arrives
watch(() => props.editorContext.selection, sel => {
  if (sel) includeSelection.value = true;
});

watch(question, async () => {
  await nextTick();
  resizeInput();
});

watch(() => stepExchanges.value.map(e => `${e.id}:${e.answer.length}:${e.status}`).join('|'), async () => {
  if (stepExchanges.value.some(e => e.status === 'streaming')) {
    drawerOpen.value = true;
  }
  await nextTick();
  if (historyRef.value) {
    historyRef.value.scrollTop = historyRef.value.scrollHeight;
  }
});

async function submitQuestion(): Promise<void> {
  const trimmed = question.value.trim();
  if (!trimmed || !contextStepId.value || isStreaming.value) return;
  drawerOpen.value = true;
  emit('ask', {
    stepId: contextStepId.value,
    question: trimmed,
    includeSelection: Boolean(props.editorContext.selection && includeSelection.value),
  });
  question.value = '';
  await nextTick();
  if (inputRef.value) {
    inputRef.value.style.height = '';
  }
}

function onInputKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void submitQuestion();
  }
}

function onMarkdownClick(event: MouseEvent): void {
  const loc = extractCitationClick(event);
  if (loc) emit('openLocation', loc);
}
</script>

<template>
  <footer class="cd-dock">
    <!-- Gentle Reverse Cursor Tracking Banner -->
    <div v-if="otherCursorStep" class="cd-cursor-banner">
      <span class="cd-cursor-banner-text">
        <span class="cd-cursor-dot"></span>
        {{ t('webview.cursorAtOtherStep', { index: otherCursorStep.index, title: otherCursorStep.title }) }}
      </span>
      <span class="cd-cursor-banner-actions">
        <button type="button" class="cd-mini-btn primary" @click="emit('gotoStep', otherCursorStep.id)">
          {{ t('webview.switchToCursorStep') }}
        </button>
        <button v-if="activeStepHasSource" type="button" class="cd-mini-btn" @click="emit('revealCurrentStep')">
          {{ t('webview.backToStepCode') }}
        </button>
      </span>
    </div>

    <!-- Expandable Q&A History Drawer -->
    <div v-if="drawerOpen && stepExchanges.length > 0" class="cd-qa-drawer">
      <div class="cd-qa-drawer-head">
        <span class="cd-qa-drawer-title">
          <span class="codicon codicon-comment-discussion" aria-hidden="true"></span>
          {{ t('webview.qaHistoryToggle', { count: stepExchanges.length }) }}
        </span>
        <button
          type="button"
          class="cd-icon-button"
          :title="t('webview.asideClose')"
          @click="drawerOpen = false"
        >
          <span class="codicon codicon-chevron-down" aria-hidden="true"></span>
        </button>
      </div>

      <div ref="historyRef" class="cd-qa-history" @click="onMarkdownClick">
        <div v-for="ex in stepExchanges" :key="ex.id" class="cd-qa-card">
          <div class="cd-qa-q">
            <span class="codicon codicon-comment-discussion" aria-hidden="true"></span>
            <span>{{ ex.question }}</span>
            <button
              v-if="ex.selection"
              type="button"
              class="cd-cite"
              @click.stop="emit('openLocation', ex.selection)"
            >
              {{ ex.selection.file.split('/').pop() }}:{{ ex.selection.startLine }}–{{ ex.selection.endLine }}
            </button>
          </div>

          <div v-if="ex.answer" class="cd-qa-a" v-html="renderMentorMarkdown(ex.answer)"></div>
          <div v-if="ex.status === 'streaming'" class="cd-qa-streaming">
            <span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></span>
            <span>{{ ex.activity || t('webview.qaThinking') }}</span>
          </div>

          <div v-if="ex.status === 'done'" class="cd-qa-actions">
            <button
              type="button"
              class="cd-mini-btn"
              :disabled="Boolean(ex.savedNoteId)"
              @click="emit('saveNote', ex.id)"
            >
              <span class="codicon" :class="ex.savedNoteId ? 'codicon-check' : 'codicon-bookmark'" aria-hidden="true"></span>
              {{ ex.savedNoteId ? t('webview.qaSavedNote') : t('webview.qaSaveNote') }}
            </button>
            <button
              type="button"
              class="cd-mini-btn"
              :disabled="Boolean(ex.savedAsideId)"
              @click="emit('saveAside', ex.id)"
            >
              <span class="codicon" :class="ex.savedAsideId ? 'codicon-check' : 'codicon-git-branch'" aria-hidden="true"></span>
              {{ ex.savedAsideId ? t('webview.qaSavedAside') : t('webview.qaSaveAside') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Unified Compact Q&A Composer Box -->
    <form class="cd-qa-box" @submit.prevent="submitQuestion">
      <div v-if="selectionChip" class="cd-qa-box-context">
        <button
          type="button"
          class="cd-sel-toggle"
          :class="{ active: includeSelection }"
          @click="includeSelection = !includeSelection"
        >
          <span class="codicon codicon-selection" aria-hidden="true"></span>
          {{
            includeSelection
              ? t('webview.qaSelectionAttached', { file: selectionChip.shortFile, start: selectionChip.start, end: selectionChip.end })
              : t('webview.qaSelectionAttach', { file: selectionChip.shortFile, start: selectionChip.start, end: selectionChip.end })
          }}
        </button>
      </div>

      <textarea
        ref="inputRef"
        v-model="question"
        rows="1"
        class="cd-qa-textarea"
        :placeholder="t('webview.qaPlaceholder')"
        @input="resizeInput"
        @keydown="onInputKeydown"
      ></textarea>

      <div class="cd-qa-box-bar">
        <div class="cd-qa-box-left">
          <AgentSelector
            compact
            direction="up"
            :agents="agents"
            :model-value="currentAgentId"
            :disabled="isStreaming"
            @update:model-value="id => emit('changeAgent', id)"
            @refresh="emit('refreshAgents')"
            @open-settings="emit('openSettings')"
          />
          <button
            v-if="stepExchanges.length > 0"
            type="button"
            class="cd-qa-toggle-btn"
            :class="{ open: drawerOpen }"
            @click="drawerOpen = !drawerOpen"
          >
            <span class="codicon codicon-comment-discussion" aria-hidden="true"></span>
            <span>{{ t('webview.qaHistoryToggle', { count: stepExchanges.length }) }}</span>
            <span class="codicon" :class="drawerOpen ? 'codicon-chevron-down' : 'codicon-chevron-up'" aria-hidden="true"></span>
          </button>
        </div>

        <div class="cd-qa-box-right">
          <button
            v-if="isStreaming"
            type="button"
            class="cd-mini-btn"
            @click="emit('cancelQa')"
          >
            <span class="codicon codicon-debug-stop" aria-hidden="true"></span>
            {{ t('webview.qaCancel') }}
          </button>
          <button
            v-else
            type="submit"
            class="cd-qa-send-btn"
            :title="`${t('webview.qaSend')} (${t('webview.qaShortcutHint')})`"
            :aria-label="t('webview.qaSend')"
            :disabled="!question.trim()"
          >
            <span class="codicon codicon-arrow-up" aria-hidden="true"></span>
          </button>
        </div>
      </div>
    </form>

    <!-- Step Navigation Bar -->
    <div v-if="mainSteps.length > 0" class="cd-step-nav">
      <button
        type="button"
        class="cd-nav-btn"
        :disabled="!canPrev"
        @click="emit('stepDelta', -1)"
      >
        <span class="codicon codicon-arrow-left" aria-hidden="true"></span>{{ t('webview.prevStep') }}
      </button>
      <button
        type="button"
        class="cd-nav-progress"
        :title="t('webview.jumpToCode')"
        @click="emit('revealCurrentStep')"
      >
        {{ t('webview.stepProgress', { index: Math.max(1, activeMainIndex + 1), total: mainSteps.length }) }}
      </button>
      <button
        type="button"
        class="cd-nav-btn primary"
        :disabled="!canNext"
        @click="emit('stepDelta', 1)"
      >
        {{ t('webview.nextStep') }}<span class="codicon codicon-arrow-right" aria-hidden="true"></span>
      </button>
    </div>
  </footer>
</template>
