import * as vscode from 'vscode';
import type {
  CodeMap,
  EditorSelectionSlice,
  QaExchange,
  SourceRef,
  StepNote,
  WalkthroughStep,
} from '../../shared/types';
import { mainline, stepSource } from '../core/tour';
import { questionPrompt } from '../ai/question';
import { readAiConfig } from '../ai/config';
import type { AgentCancel, AgentSession } from '../ai/types';
import { HostError, errorMessage } from '../core/errors';
import { saveMapAtUri } from './mapWriter';
import type { AcceptedMap } from './sources';
import { t } from '../../shared/i18n';

export interface MentorQaHooks {
  currentAgentId(): string;
  openSession(root: vscode.WorkspaceFolder): AgentSession;
  refresh(): Promise<void>;
  log(line: string): void;
}

function uniqueId(prefix: string, taken: Set<string>): string {
  for (let i = 1; i < 10_000; i += 1) {
    const candidate = `${prefix}-${Date.now().toString(36)}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${prefix}-${Date.now().toString(36)}`;
}

/**
 * Sidebar Mentor Q&A service:
 * - Streams step-contextual Q&A answers with live exploration status
 * - Persists valuable Q&A exchanges directly into map JSON as step `notes` or `aside` steps
 */
export class MentorQaService implements vscode.Disposable {
  private readonly exchangesByMap = new Map<string, QaExchange[]>();
  private readonly sessions = new Map<string, AgentSession>();
  private pending?: { exchangeId: string; mapKey: string; cts: vscode.CancellationTokenSource };
  private seq = 0;

  private readonly changed = new vscode.EventEmitter<string>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly hooks: MentorQaHooks) {}

  exchanges(mapKey?: string): QaExchange[] {
    if (!mapKey) return [];
    return this.exchangesByMap.get(mapKey) ?? [];
  }

  resetSession(mapKey?: string): void {
    if (!mapKey) {
      this.cancel();
      this.sessions.clear();
      return;
    }
    this.sessions.delete(mapKey);
  }

  cancel(): void {
    if (!this.pending) return;
    this.pending.cts.cancel();
  }

  async ask(params: {
    record: AcceptedMap;
    stepId: string;
    question: string;
    selection?: EditorSelectionSlice;
  }): Promise<void> {
    const { record, stepId, selection } = params;
    const question = params.question.trim();
    if (!question) throw new HostError('INVALID_MESSAGE', t('host.bridgeBadQuestion'));

    const map = record.map;
    const step = map.walkthrough.find(item => item.id === stepId);
    if (!step) throw new HostError('STEP_NOT_FOUND', t('host.stepNotFound'));

    this.cancel();

    const list = this.exchangesByMap.get(record.key) ?? [];
    const exchange: QaExchange = {
      id: `qa-${++this.seq}`,
      stepId,
      question,
      selection: selection
        ? { file: selection.file, startLine: selection.startLine, endLine: selection.endLine }
        : undefined,
      answer: '',
      status: 'streaming',
    };
    list.push(exchange);
    this.exchangesByMap.set(record.key, list);
    this.changed.fire(record.key);

    const cts = new vscode.CancellationTokenSource();
    this.pending = { exchangeId: exchange.id, mapKey: record.key, cts };
    const cancel: AgentCancel = {
      get isCancellationRequested() { return cts.token.isCancellationRequested; },
      onCancellationRequested: listener => cts.token.onCancellationRequested(listener),
    };

    try {
      const config = readAiConfig();
      const activeAgentId = this.hooks.currentAgentId();
      let session = this.sessions.get(record.key);
      if (!session || session.id !== activeAgentId) {
        session = this.hooks.openSession(record.root);
        this.sessions.set(record.key, session);
      }

      const main = mainline(map);
      const mainIndex = main.findIndex(item => item.id === step.id);
      const index = mainIndex >= 0 ? mainIndex + 1 : 1;
      const sourceId = stepSource(map, step);
      const source: SourceRef | undefined = sourceId ? map.sources[sourceId] : undefined;
      const priorStepHistory = list
        .filter(item => item.stepId === stepId && item.id !== exchange.id && item.status === 'done')
        .map(item => ({ question: item.question, answer: item.answer }));

      const reply = await session.send({
        prompt: questionPrompt({
          map,
          step,
          source,
          selection,
          index,
          total: Math.max(main.length, 1),
          history: priorStepHistory,
          question,
        }),
        cwd: record.root.uri.fsPath,
        timeoutMs: config.timeoutMs,
        cancel,
        onActivity: activity => {
          exchange.activity = activity.detail ? `${activity.text} (${activity.detail})` : activity.text;
          this.changed.fire(record.key);
        },
        onDelta: delta => {
          exchange.answer += delta;
          this.changed.fire(record.key);
        },
      });

      exchange.answer = (reply.text.trim() || exchange.answer.trim()) || t('host.qaEmptyAnswer');
      exchange.activity = undefined;
      exchange.status = 'done';
      this.changed.fire(record.key);
    } catch (error) {
      if (cts.token.isCancellationRequested) {
        const idx = list.indexOf(exchange);
        if (idx >= 0 && !exchange.answer.trim()) {
          list.splice(idx, 1);
        } else {
          exchange.status = 'done';
          exchange.activity = undefined;
        }
      } else {
        const msg = errorMessage(error);
        exchange.answer = t('host.qaFailed', { message: msg });
        exchange.activity = undefined;
        exchange.status = 'error';
        this.hooks.log(t('host.qaFailed', { message: msg }));
      }
      this.changed.fire(record.key);
    } finally {
      if (this.pending?.cts === cts) this.pending = undefined;
      cts.dispose();
    }
  }

  async saveAsNote(record: AcceptedMap, exchangeId: string): Promise<StepNote> {
    const list = this.exchangesByMap.get(record.key) ?? [];
    const exchange = list.find(item => item.id === exchangeId);
    if (!exchange || !exchange.answer.trim()) {
      throw new HostError('INVALID_MESSAGE', t('host.bridgeBadQuestion'));
    }
    const nextMap: CodeMap = structuredClone(record.map);
    const step = nextMap.walkthrough.find(item => item.id === exchange.stepId);
    if (!step) throw new HostError('STEP_NOT_FOUND', t('host.stepNotFound'));

    const existingIds = new Set((step.notes ?? []).map(n => n.id));
    const note: StepNote = {
      id: uniqueId('note', existingIds),
      question: exchange.question.slice(0, 300),
      answer: exchange.answer.slice(0, 4000),
      createdAt: new Date().toISOString(),
    };
    step.notes = [...(step.notes ?? []), note];
    await saveMapAtUri(record.uri, nextMap);
    exchange.savedNoteId = note.id;
    await this.hooks.refresh();
    this.changed.fire(record.key);
    return note;
  }

  async deleteNote(record: AcceptedMap, stepId: string, noteId: string): Promise<void> {
    const nextMap: CodeMap = structuredClone(record.map);
    const step = nextMap.walkthrough.find(item => item.id === stepId);
    if (!step || !step.notes) return;
    const filtered = step.notes.filter(item => item.id !== noteId);
    if (filtered.length === step.notes.length) return;
    if (filtered.length > 0) step.notes = filtered;
    else delete step.notes;
    await saveMapAtUri(record.uri, nextMap);
    for (const ex of this.exchangesByMap.get(record.key) ?? []) {
      if (ex.savedNoteId === noteId) ex.savedNoteId = undefined;
    }
    await this.hooks.refresh();
    this.changed.fire(record.key);
  }

  async saveAsAside(record: AcceptedMap, exchangeId: string, customTitle?: string): Promise<WalkthroughStep> {
    const list = this.exchangesByMap.get(record.key) ?? [];
    const exchange = list.find(item => item.id === exchangeId);
    if (!exchange || !exchange.answer.trim()) {
      throw new HostError('INVALID_MESSAGE', t('host.bridgeBadQuestion'));
    }
    const nextMap: CodeMap = structuredClone(record.map);
    const originStep = nextMap.walkthrough.find(item => item.id === exchange.stepId);
    if (!originStep) throw new HostError('STEP_NOT_FOUND', t('host.stepNotFound'));

    // Attach to a main-line step so aside branches stay clean 1-hop detours
    const hostStep = originStep.aside
      ? (nextMap.walkthrough.find(s => !s.aside && s.branches?.includes(originStep.id)) ?? nextMap.walkthrough.find(s => !s.aside)!)
      : originStep;

    let sourceId = stepSource(nextMap, originStep);
    if (exchange.selection) {
      const sourceIds = new Set(Object.keys(nextMap.sources));
      const selSourceId = uniqueId('src-qa', sourceIds);
      nextMap.sources[selSourceId] = {
        file: exchange.selection.file,
        startLine: exchange.selection.startLine,
        endLine: exchange.selection.endLine,
        note: (customTitle?.trim() || exchange.question).slice(0, 120),
      };
      sourceId = selSourceId;
    }

    const stepIds = new Set(nextMap.walkthrough.map(s => s.id));
    const asideId = uniqueId('aside', stepIds);
    const rawTitle = (customTitle?.trim() || exchange.question.trim()).replace(/[?？!！。]+$/, '');
    const title = rawTitle.slice(0, 80) || 'Aside';

    const asideStep: WalkthroughStep = {
      id: asideId,
      title,
      description: exchange.answer.slice(0, 2000),
      nodeIds: [...originStep.nodeIds],
      edgeIds: [...originStep.edgeIds],
      ...(sourceId ? { sourceId } : {}),
      aside: true,
    };

    nextMap.walkthrough.push(asideStep);
    hostStep.branches = [...new Set([...(hostStep.branches ?? []), asideId])];

    await saveMapAtUri(record.uri, nextMap);
    exchange.savedAsideId = asideId;
    await this.hooks.refresh();
    this.changed.fire(record.key);
    return asideStep;
  }

  dispose(): void {
    this.cancel();
    this.changed.dispose();
  }
}
