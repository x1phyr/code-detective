import type { CodeMap } from '../../shared/types';
import { extractJson } from './json';
import { explorePrompt, OUTPUT_CONTRACT, retryPrompt, type PromptContext } from './prompt';
import { parseMap } from '../core/validator';
import { describeAdjustments, fillAnchors, normalizeDraft } from '../core/mapDraft';
import { AiError, type AgentSession } from './types';

export interface MapRequest {
  topic: string;
  rootName: string;
  /** Files the user is looking at, used only as a starting hint. */
  priorityFiles: string[];
  cwd: string;
  timeoutMs: number;
  cancel: import('./types').AgentCancel;
  onPhase?(phase: 'running' | 'validating' | 'retry', detail?: string): void;
  onProgress?(chars: number): void;
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
  };

  request.onPhase?.('running', 'agent 正在阅读源码');
  let reply = await session.send({
    ...base,
    prompt: `${explorePrompt(contextOf(request))}\n\n${OUTPUT_CONTRACT}`,
  });
  let attempts = 1;
  let lastIssues: string[] = [];

  for (;;) {
    request.onPhase?.('validating');
    try {
      const { map, adjustments } = await buildMap(reply.text, request.readFile);
      return { text: reply.text, map, adjustments, attempts, sessionId: reply.sessionId };
    } catch (error) {
      lastIssues = [(error as Error).message];
      if (attempts > retries) {
        throw new AiError('AI_INVALID_MAP',
          `agent 给出的地图未通过校验：${lastIssues[0] ?? '未知原因'}`);
      }
      attempts += 1;
      request.onPhase?.('retry', lastIssues[0]);
      reply = await session.send({ ...base, prompt: retryPrompt(lastIssues) });
    }
  }
}

/** Extracts and validates the JSON object from the agent's final message. */
const MAX_ANCHOR_FILES = 60;

async function buildMap(
  text: string,
  readFile: MapRequest['readFile'],
): Promise<{ map: CodeMap; adjustments: string[] }> {
  if (!readFile) return { map: mapFromReply(text), adjustments: [] };
  const json = extractJson(text);
  if (!json) throw new AiError('AI_NO_JSON', '没有在 agent 的回复中找到合法的 JSON 对象。');
  const draft = normalizeDraft(JSON.parse(json));
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
  if (!json) throw new AiError('AI_NO_JSON', '没有在 agent 的回复中找到合法的 JSON 对象。');
  return parseMap(json);
}
