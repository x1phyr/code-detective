<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type {
  CodeMap,
  EditorContextPayload,
  SourceStatus,
  ViewState,
  WalkthroughStep,
} from '../../../shared/types';
import { mainline, stepSource } from '../../../src/core/tour';
import { extractCitationClick, renderMentorMarkdown } from '../markdown';
import { formatSourceRange, sourceSymbol, statusTone } from '../model';
import { t } from '../../../shared/i18n';

const props = defineProps<{
  map: CodeMap;
  ui: ViewState;
  statuses: Record<string, SourceStatus>;
  editorContext: EditorContextPayload;
}>();

const emit = defineEmits<{
  gotoStep: [stepId: string];
  toggleAside: [asideId: string | null];
  revealStepSource: [payload: { stepId: string; sourceId: string }];
  openLocation: [payload: { file: string; startLine: number; endLine: number }];
  deleteNote: [payload: { stepId: string; noteId: string }];
}>();

const introCollapsed = ref(false);
const containerRef = ref<HTMLElement>();

const steps = computed<WalkthroughStep[]>(() => mainline(props.map));
const visitedSet = computed(() => new Set(props.ui.visitedStepIds ?? []));
const cursorStepSet = computed(() => new Set(props.editorContext.matchedStepIds ?? []));

const activeId = computed(() => props.ui.activeStepId ?? steps.value[0]?.id);
const activeIndex = computed(() => steps.value.findIndex(s => s.id === activeId.value));
const isLastStep = computed(() => steps.value.length > 0 && activeIndex.value === steps.value.length - 1);

function stepSourceInfo(step: WalkthroughStep): {
  id: string;
  file: string;
  shortFile: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  note?: string;
  tone: 'ok' | 'warn' | 'error' | 'idle';
} | undefined {
  const id = stepSource(props.map, step);
  if (!id) return undefined;
  const ref = props.map.sources[id];
  if (!ref) return undefined;
  const status = props.statuses[id];
  const file = status?.file ?? ref.file;
  const startLine = status?.startLine ?? ref.startLine;
  const endLine = status?.endLine ?? ref.endLine;
  return {
    id,
    file,
    shortFile: file.split('/').pop() ?? file,
    startLine,
    endLine,
    symbol: sourceSymbol(ref),
    note: ref.note,
    tone: statusTone(status?.state),
  };
}

type StepSourceDisplay = NonNullable<ReturnType<typeof stepSourceInfo>>;

function formatSourceLoc(info: StepSourceDisplay, short = false): string {
  return formatSourceRange(short ? info.shortFile : info.file, info.startLine, info.endLine, short);
}

function sourceBarTitle(info: StepSourceDisplay): string {
  const loc = formatSourceLoc(info);
  const head = info.symbol ? `${info.symbol} · ${loc}` : loc;
  return info.note ? `${head} · ${info.note}\n${t('webview.jumpToCode')}` : `${head}\n${t('webview.jumpToCode')}`;
}

function asidesFor(step: WalkthroughStep): WalkthroughStep[] {
  if (!step.branches?.length) return [];
  const byId = new Map(props.map.walkthrough.map(s => [s.id, s]));
  return step.branches
    .map(id => byId.get(id))
    .filter((s): s is WalkthroughStep => Boolean(s && s.aside));
}

function openAsideFor(step: WalkthroughStep): WalkthroughStep | undefined {
  if (!props.ui.openAsideId) return undefined;
  return asidesFor(step).find(a => a.id === props.ui.openAsideId);
}

function onAsidePillClick(asideId: string): void {
  if (props.ui.openAsideId === asideId) {
    emit('toggleAside', null);
  } else {
    emit('gotoStep', asideId);
  }
}

function onMarkdownClick(event: MouseEvent): void {
  const loc = extractCitationClick(event);
  if (loc) emit('openLocation', loc);
}

watch(activeId, async id => {
  if (!id) return;
  await nextTick();
  const el = containerRef.value?.querySelector<HTMLElement>(`[data-step-id="${id}"]`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
</script>

<template>
  <div ref="containerRef" class="cd-walkthrough" @click="onMarkdownClick">
    <!--Map description subtitle if present-->
    <p v-if="map.description" class="cd-guide-desc">{{ map.description }}</p>

    <!--Collapsible Running Example Card-->
    <section v-if="map.tour?.example" class="cd-example-banner" :class="{ collapsed: introCollapsed }">
      <button type="button" class="cd-example-toggle" @click="introCollapsed = !introCollapsed">
        <span class="codicon codicon-beaker cd-callout-icon" aria-hidden="true"></span>
        <strong>{{ t('webview.tourExampleTitle') }}</strong>
        <span class="codicon cd-chevron" :class="introCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'" aria-hidden="true"></span>
      </button>
      <div v-if="!introCollapsed" class="cd-example-body" v-html="renderMentorMarkdown(map.tour.example)"></div>
    </section>

    <!--Accordion Vertical Step Timeline-->
    <ol class="cd-timeline" :aria-label="t('webview.readingOrder')">
      <li
        v-for="(step, idx) in steps"
        :key="step.id"
        :data-step-id="step.id"
        class="cd-tl-item"
        :class="{
          expanded: step.id === activeId,
          visited: visitedSet.has(step.id) && step.id !== activeId,
          'cursor-match': cursorStepSet.has(step.id),
        }"
      >
        <div class="cd-tl-rail" aria-hidden="true">
          <span class="cd-tl-badge">
            <span v-if="visitedSet.has(step.id) && step.id !== activeId" class="codicon codicon-check"></span>
            <template v-else>{{ idx + 1 }}</template>
          </span>
          <span v-if="idx < steps.length - 1" class="cd-tl-line"></span>
        </div>

        <div class="cd-tl-content">
          <!--Header row (always visible)-->
          <button
            type="button"
            class="cd-tl-header"
            @click="emit('gotoStep', step.id)"
          >
            <span class="cd-tl-title">{{ step.title }}</span>
            <span class="cd-tl-badges">
              <span v-if="cursorStepSet.has(step.id)" class="cd-pill cursor">
                <span class="cd-cursor-dot" aria-hidden="true"></span>{{ t('webview.cursorHere') }}
              </span>
              <span v-if="step.branches?.length" class="cd-pill subtle" :title="t('webview.stepAsidesTitle')">
                <span class="codicon codicon-git-branch" aria-hidden="true"></span>{{ step.branches.length }}
              </span>
              <span v-if="step.notes?.length" class="cd-pill subtle" :title="t('webview.stepNotesTitle')">
                <span class="codicon codicon-bookmark" aria-hidden="true"></span>{{ step.notes.length }}
              </span>
              <span
                v-if="stepSourceInfo(step)"
                class="cd-tl-loc"
                :title="formatSourceLoc(stepSourceInfo(step)!)"
              >
                {{ formatSourceLoc(stepSourceInfo(step)!, true) }}
              </span>
            </span>
          </button>

          <!--Expanded Active Card-->
          <div v-if="step.id === activeId" class="cd-tl-body">
            <!--Clickable Source Anchor Bar-->
            <button
              v-if="stepSourceInfo(step)"
              type="button"
              class="cd-source-bar"
              :title="sourceBarTitle(stepSourceInfo(step)!)"
              @click="emit('revealStepSource', { stepId: step.id, sourceId: stepSourceInfo(step)!.id })"
            >
              <span class="cd-dot" :class="stepSourceInfo(step)!.tone"></span>
              <code v-if="stepSourceInfo(step)!.symbol" class="cd-source-sym" :title="stepSourceInfo(step)!.symbol">{{ stepSourceInfo(step)!.symbol }}</code>
              <span class="cd-source-path" :title="formatSourceLoc(stepSourceInfo(step)!)">
                <bdi>{{ formatSourceLoc(stepSourceInfo(step)!) }}</bdi>
              </span>
              <span v-if="stepSourceInfo(step)!.note" class="cd-source-note" :title="stepSourceInfo(step)!.note">{{ stepSourceInfo(step)!.note }}</span>
              <span class="codicon codicon-go-to-file cd-source-jump" aria-hidden="true"></span>
            </button>

            <!--Main Mentor Explanation-->
            <div v-if="step.description" class="cd-mentor-prose" v-html="renderMentorMarkdown(step.description)"></div>

            <!--Mentor Callouts: Example, Why, Watch, Skip-->
            <div v-if="step.example" class="cd-callout example">
              <div class="cd-callout-head">
                <span class="codicon codicon-beaker" aria-hidden="true"></span>{{ t('webview.stepExampleTitle') }}
              </div>
              <div class="cd-callout-text" v-html="renderMentorMarkdown(step.example)"></div>
            </div>

            <div v-if="step.why" class="cd-callout why">
              <div class="cd-callout-head">
                <span class="codicon codicon-lightbulb" aria-hidden="true"></span>{{ t('webview.stepWhyTitle') }}
              </div>
              <div class="cd-callout-text" v-html="renderMentorMarkdown(step.why)"></div>
            </div>

            <div v-if="step.watch" class="cd-callout watch">
              <div class="cd-callout-head">
                <span class="codicon codicon-warning" aria-hidden="true"></span>{{ t('webview.stepWatchTitle') }}
              </div>
              <div class="cd-callout-text" v-html="renderMentorMarkdown(step.watch)"></div>
            </div>

            <div v-if="step.skip" class="cd-callout skip">
              <div class="cd-callout-head">
                <span class="codicon codicon-eye-closed" aria-hidden="true"></span>{{ t('webview.stepSkipTitle') }}
              </div>
              <div class="cd-callout-text" v-html="renderMentorMarkdown(step.skip)"></div>
            </div>

            <!--Inline Expandable Aside Detours-->
            <div v-if="asidesFor(step).length" class="cd-asides-section">
              <div class="cd-section-label">
                <span class="codicon codicon-git-branch" aria-hidden="true"></span>{{ t('webview.stepAsidesTitle') }}
              </div>
              <div class="cd-aside-pills">
                <button
                  v-for="aside in asidesFor(step)"
                  :key="aside.id"
                  type="button"
                  class="cd-aside-pill"
                  :class="{ open: ui.openAsideId === aside.id, 'cursor-match': cursorStepSet.has(aside.id) }"
                  @click="onAsidePillClick(aside.id)"
                >
                  <span class="codicon" :class="ui.openAsideId === aside.id ? 'codicon-chevron-down' : 'codicon-chevron-right'" aria-hidden="true"></span>
                  <span>{{ aside.title }}</span>
                  <span v-if="cursorStepSet.has(aside.id)" class="cd-cursor-dot" :title="t('webview.cursorHere')"></span>
                </button>
              </div>

              <!--Open Aside Sub-card-->
              <div v-if="openAsideFor(step)" class="cd-aside-card">
                <div class="cd-aside-card-head">
                  <span class="cd-pill aside">{{ t('webview.asideBadge') }}</span>
                  <strong>{{ openAsideFor(step)!.title }}</strong>
                  <button type="button" class="cd-icon-button" :title="t('webview.asideClose')" @click="emit('toggleAside', null)">
                    <span class="codicon codicon-close" aria-hidden="true"></span>
                  </button>
                </div>
                <button
                  v-if="stepSourceInfo(openAsideFor(step)!)"
                  type="button"
                  class="cd-source-bar compact"
                  :title="sourceBarTitle(stepSourceInfo(openAsideFor(step)!)!)"
                  @click="emit('revealStepSource', { stepId: openAsideFor(step)!.id, sourceId: stepSourceInfo(openAsideFor(step)!)!.id })"
                >
                  <span class="cd-dot" :class="stepSourceInfo(openAsideFor(step)!)!.tone"></span>
                  <code v-if="stepSourceInfo(openAsideFor(step)!)!.symbol" class="cd-source-sym" :title="stepSourceInfo(openAsideFor(step)!)!.symbol">{{ stepSourceInfo(openAsideFor(step)!)!.symbol }}</code>
                  <span class="cd-source-path" :title="formatSourceLoc(stepSourceInfo(openAsideFor(step)!)!)">
                    <bdi>{{ formatSourceLoc(stepSourceInfo(openAsideFor(step)!)!) }}</bdi>
                  </span>
                  <span v-if="stepSourceInfo(openAsideFor(step)!)!.note" class="cd-source-note" :title="stepSourceInfo(openAsideFor(step)!)!.note">{{ stepSourceInfo(openAsideFor(step)!)!.note }}</span>
                  <span class="codicon codicon-go-to-file cd-source-jump" aria-hidden="true"></span>
                </button>
                <div v-if="openAsideFor(step)!.description" class="cd-mentor-prose" v-html="renderMentorMarkdown(openAsideFor(step)!.description)"></div>
                <div v-if="openAsideFor(step)!.why" class="cd-callout why">
                  <div class="cd-callout-head"><span class="codicon codicon-lightbulb" aria-hidden="true"></span>{{ t('webview.stepWhyTitle') }}</div>
                  <div class="cd-callout-text" v-html="renderMentorMarkdown(openAsideFor(step)!.why)"></div>
                </div>
                <div v-if="openAsideFor(step)!.watch" class="cd-callout watch">
                  <div class="cd-callout-head"><span class="codicon codicon-warning" aria-hidden="true"></span>{{ t('webview.stepWatchTitle') }}</div>
                  <div class="cd-callout-text" v-html="renderMentorMarkdown(openAsideFor(step)!.watch)"></div>
                </div>
              </div>
            </div>

            <!--Saved Personal Step Notes-->
            <div v-if="step.notes?.length" class="cd-notes-section">
              <div class="cd-section-label">
                <span class="codicon codicon-bookmark" aria-hidden="true"></span>{{ t('webview.stepNotesTitle') }}
              </div>
              <div v-for="note in step.notes" :key="note.id" class="cd-note-card">
                <div class="cd-note-head">
                  <span v-if="note.question" class="cd-note-q">Q: {{ note.question }}</span>
                  <button
                    type="button"
                    class="cd-icon-button cd-note-del"
                    :title="t('webview.deleteNote')"
                    @click="emit('deleteNote', { stepId: step.id, noteId: note.id })"
                  >
                    <span class="codicon codicon-trash" aria-hidden="true"></span>
                  </button>
                </div>
                <div class="cd-note-a" v-html="renderMentorMarkdown(note.answer)"></div>
              </div>
            </div>
          </div>
        </div>
      </li>
    </ol>

    <!--Bottom Recap & Hands-on Exercise Card-->
    <section v-if="map.tour?.recap || map.tour?.exercise" class="cd-recap-card" :class="{ emphasized: isLastStep }">
      <div v-if="map.tour?.recap" class="cd-recap-block">
        <div class="cd-recap-head">
          <span class="codicon codicon-checklist" aria-hidden="true"></span>
          <strong>{{ t('webview.tourRecapTitle') }}</strong>
        </div>
        <div class="cd-mentor-prose" v-html="renderMentorMarkdown(map.tour.recap)"></div>
      </div>
      <div v-if="map.tour?.exercise" class="cd-recap-block exercise">
        <div class="cd-recap-head">
          <span class="codicon codicon-tools" aria-hidden="true"></span>
          <strong>{{ t('webview.tourExerciseTitle') }}</strong>
        </div>
        <div class="cd-mentor-prose" v-html="renderMentorMarkdown(map.tour.exercise)"></div>
      </div>
    </section>
  </div>
</template>
