import type { CodeMap } from '../../shared/types';
import type { AgentActivity } from './agent/types';
import { extractJson } from './json';
import { explorePrompt, outputContract, retryPrompt, type PromptAnchor, type PromptContext } from './prompt';
import { parseMap } from '../core/validator';
import { describeAdjustments, fillAnchors, normalizeDraft } from '../core/mapDraft';
import { AiError, type AgentSession } from './types';
import { t } from '../../shared/i18n';

export interface MapRequest {
  topic: string;
  rootName: string;
  anchor?: PromptAnchor;
  /** Files the user is looking at, used only as a starting hint. */
  priorityFiles: string[];
  cwd: string;
  timeoutMs: number;
  cancel: import('./types').AgentCancel;
  onPhase?(phase: 'running' | 'validating' | 'retry', detail?: string): void;
  onProgress?(chars: number): void;
  onActivity?(activity: AgentActivity): void;
  /**
   * Reads a workspace file for anchor filling (undefined when unreadable).
   * When set, the reply goes through the same tolerant pipeline as chat:
   * bad items are dropped and reported, anchors come from the real file.
   */
  readFile?(file: string): Promise<string | undefined>;
}

export interface MapResult {
  text: string;
  map: CodeMap;
  /** What the tolerant pipeline dropped or clamped; empty without `readFile`. */
  adjustments: string[];
  /** Turns used, including the retry turn. */
  attempts: number;
  sessionId?: string;
}

function contextOf(request: MapRequest): PromptContext {
  return {
    rootName: request.rootName,
    topic: request.topic,
    anchor: request.anchor,
    priorityFiles: request.priorityFiles,
  };
}

/**
 * Drives one agent conversation to a validated map.
 *
 * The agent explores the workspace itself (that is its first turn), then the
 * same session is reused for corrections — so a retry never re-reads the code
 * and the conversation stays within one session.
 */
export async function generateMap(
  session: AgentSession,
  request: MapRequest,
  options: { retries?: number } = {},
): Promise<MapResult> {
  const retries = options.retries ?? 1;
  const base = {
    cwd: request.cwd,
    timeoutMs: request.timeoutMs,
    cancel: request.cancel,
    onChunk: (chunk: string) => request.onProgress?.(chunk.length),
    onActivity: request.onActivity,
  };

  request.onPhase?.('running', t('ai.agentReading'));
  let reply = await session.send({
    ...base,
    prompt: `${explorePrompt(contextOf(request))}\n\n${outputContract()}`,
  });
  let attempts = 1;
  let lastIssues: string[] = [];

  for (;;) {
    request.onPhase?.('validating');
    try {
      const { map, adjustments } = await buildMap(reply.text, request.readFile, request.cwd, request.topic);
      return { text: reply.text, map, adjustments, attempts, sessionId: reply.sessionId };
    } catch (error) {
      lastIssues = [(error as Error).message];
      if (attempts > retries) {
        throw new AiError('AI_INVALID_MAP',
          t('ai.invalidMap', { issue: lastIssues[0] ?? t('ai.unknownReason') }));
      }
      attempts += 1;
      request.onPhase?.('retry', lastIssues[0]);
      const hasSession = Boolean(reply.sessionId ?? session.sessionId);
      const nextPrompt = hasSession
        ? retryPrompt(lastIssues)
        : `${explorePrompt(contextOf(request))}\n\n${outputContract()}\n\n${retryPrompt(lastIssues)}`;
      reply = await session.send({ ...base, prompt: nextPrompt });
    }
  }
}

/** Extracts and validates the JSON object from the agent's final message. */
const MAX_ANCHOR_FILES = 60;

async function buildMap(
  text: string,
  readFile: MapRequest['readFile'],
  root: string,
  fallbackTitle?: string,
): Promise<{ map: CodeMap; adjustments: string[] }> {
  if (!readFile) return { map: mapFromReply(text), adjustments: [] };
  const json = extractJson(text);
  if (!json) throw new AiError('AI_NO_JSON', t('ai.noJsonInReply'));
  const draft = normalizeDraft(JSON.parse(json), { root, fallbackTitle });
  const files = [...new Set(Object.values(draft.sources).map(ref => ref.file))].slice(0, MAX_ANCHOR_FILES);
  const cache = new Map<string, string | undefined>();
  await Promise.all(files.map(async file => {
    cache.set(file, await readFile(file).catch(() => undefined));
  }));
  const filled = fillAnchors(draft, file => cache.get(file));
  const map = parseMap(JSON.stringify(filled.map));
  return { map, adjustments: describeAdjustments(filled) };
}

export function mapFromReply(text: string): CodeMap {
  const json = extractJson(text);
  if (!json) throw new AiError('AI_NO_JSON', t('ai.noJsonInReply'));
  return parseMap(json);
}
