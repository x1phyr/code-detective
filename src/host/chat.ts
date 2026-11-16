import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import { describeAdjustments, fillAnchors, normalizeDraft } from '../core/mapDraft';
import { isCanonicalRelativePath } from '../core/paths';
import { parseMap } from '../core/validator';
import { errorMessage } from '../core/errors';
import { extractJson } from '../ai/json';
import { resolveExecutable } from '../ai/agent/env';
import { outputContract, retryPrompt } from '../ai/prompt';
import { MAP_DIR, writeMapFile, type WrittenMap } from './mapWriter';
import { checkedSourceUri } from './paths';
import { readWorkspaceText } from './workspaceText';
import { MAX_QUERY_LENGTH, unsafeRegex } from './regexGuard';
import { t } from '../../shared/i18n';

export const PARTICIPANT_ID = 'code-detective.detective';

export const TOOL_SEARCH = 'codeDetective_searchSources';
export const TOOL_READ = 'codeDetective_readSource';
export const TOOL_CREATE_MAP = 'codeDetective_createMap';

const MAX_SEARCH_FILES = 5_000;
const MAX_SEARCH_RESULTS = 40;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_READ_LINES = 400;
const MAX_DRAFT_FILES = 200;
const PREFETCH_BATCH = 8;

const SOURCE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,vue,py,go,rs,java,kt,cs,swift,rb,php,c,h,cpp,hpp,md,json}';
const EXCLUDE_GLOB = '**/{node_modules,.git,dist,out,build,coverage,vendor,target,.next,.nuxt,artifacts,library,temp,local,.code-detective}/**';

export interface ChatHostHooks {
  root(): vscode.WorkspaceFolder | undefined;
  hasMap(key: string): boolean;
  refresh(): Promise<void>;
  openMap(key?: string): Promise<void>;
  notify(message: string, severity?: 'info' | 'warning' | 'error'): void;
}

export interface CreateMapOutcome {
  written: WrittenMap;
  title: string;
  nodes: number;
  edges: number;
  steps: number;
  adjustments: string[];
}

/** Built lazily so descriptions follow the locale set at activation. */
function searchSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string', description: t('chat.schemaQuery') },
      regex: { type: 'boolean', description: t('chat.schemaRegex') },
      caseSensitive: { type: 'boolean', description: t('chat.schemaCaseSensitive') },
      glob: { type: 'string', description: t('chat.schemaGlob') },
      maxResults: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_RESULTS, description: t('chat.schemaMaxResults') },
    },
  } as const;
}

function readSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['file'],
    properties: {
      file: { type: 'string', description: t('chat.schemaFile') },
      startLine: { type: 'integer', minimum: 1, description: t('chat.schemaStartLine') },
      endLine: { type: 'integer', minimum: 1, description: t('chat.schemaEndLine') },
    },
  } as const;
}

/** Only this much of each line is matched, which bounds per-line regex work. */
const MAX_MATCH_LINE = 1_000;
const SEARCH_BUDGET_MS = 3_000;


function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}


export interface SourceMatch {
  file: string;
  line: number;
  text: string;
}

async function searchWithRipgrep(
  rgBin: string,
  root: vscode.WorkspaceFolder,
  input: { query: string; regex?: boolean; caseSensitive?: boolean; glob?: string },
  limit: number,
  token?: vscode.CancellationToken,
): Promise<SourceMatch[] | undefined> {
  if (root.uri.scheme !== 'file') return undefined;
  const args = [
    '--json',
    '--max-filesize',
    '256K',
    '--glob',
    `!${EXCLUDE_GLOB}`,
  ];
  if (!input.regex) args.push('--fixed-strings');
  args.push(input.caseSensitive ? '--case-sensitive' : '--ignore-case');
  if (input.glob && input.glob.trim()) args.push('--glob', input.glob.trim());
  args.push('--', input.query, '.');

  return new Promise<SourceMatch[] | undefined>(resolve => {
    let settled = false;
    let buf = '';
    const rawMatches: SourceMatch[] = [];
    const child = spawn(rgBin, args, {
      cwd: root.uri.fsPath,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const done = async (ok: boolean): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopCancel?.dispose();
      if (!ok) {
        resolve(undefined);
        return;
      }
      const verified: SourceMatch[] = [];
      for (const item of rawMatches) {
        if (verified.length >= limit) break;
        if (!isCanonicalRelativePath(item.file)) continue;
        try {
          await checkedSourceUri(root.uri, item.file);
          verified.push(item);
        } catch { /* skip symlink outside workspace */ }
      }
      resolve(verified);
    };

    const kill = (): void => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
    };

    const timer = setTimeout(() => {
      kill();
      void done(rawMatches.length > 0);
    }, SEARCH_BUDGET_MS);
    const stopCancel = token?.onCancellationRequested(() => {
      kill();
      void done(true);
    });

    const parseLine = (line: string): void => {
      if (!line.startsWith('{') || rawMatches.length >= limit * 2) return;
      try {
        const evt = JSON.parse(line) as {
          type?: string;
          data?: { path?: { text?: string }; lines?: { text?: string }; line_number?: number };
        };
        if (evt.type !== 'match' || !evt.data) return;
        const rawPath = evt.data.path?.text;
        const lineText = evt.data.lines?.text;
        const lineNum = evt.data.line_number;
        if (typeof rawPath !== 'string' || typeof lineText !== 'string' || typeof lineNum !== 'number') return;
        const rel = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
        rawMatches.push({
          file: rel,
          line: lineNum,
          text: lineText.replace(/\r?\n$/, '').slice(0, 240),
        });
        if (rawMatches.length >= limit) {
          kill();
        }
      } catch { /* ignore malformed line */ }
    };

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const part of parts) parseLine(part);
    });
    child.on('error', () => { void done(false); });
    child.on('close', code => {
      if (buf) parseLine(buf);
      // rg exits 0 on matches, 1 on no matches, 2 on error (or null when killed early after reaching limit).
      void done(code === 0 || code === 1 || rawMatches.length > 0);
    });
  });
}

export async function searchSources(
  root: vscode.WorkspaceFolder,
  input: { query: string; regex?: boolean; caseSensitive?: boolean; glob?: string; maxResults?: number },
  token?: vscode.CancellationToken,
): Promise<SourceMatch[]> {
  const limit = Math.min(Math.max(input.maxResults ?? 20, 1), MAX_SEARCH_RESULTS);
  if (typeof input.query !== 'string' || input.query.length === 0) throw new Error(t('chat.queryEmpty'));
  if (input.query.length > MAX_QUERY_LENGTH) throw new Error(t('chat.queryTooLong', { max: MAX_QUERY_LENGTH }));
  if (input.regex && unsafeRegex(input.query)) {
    throw new Error(t('chat.regexUnsafe'));
  }
  let pattern: RegExp;
  try {
    pattern = input.regex
      ? new RegExp(input.query, input.caseSensitive ? '' : 'i')
      : new RegExp(input.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), input.caseSensitive ? '' : 'i');
  } catch (error) {
    throw new Error(t('chat.regexInvalid', { error: errorMessage(error) }));
  }

  const rgBin = resolveExecutable('rg');
  if (rgBin) {
    const rgResult = await searchWithRipgrep(rgBin, root, input, limit, token);
    if (rgResult !== undefined) return rgResult;
  }

  const include = new vscode.RelativePattern(root, input.glob && input.glob.trim() ? input.glob.trim() : SOURCE_GLOB);
  const uris = await vscode.workspace.findFiles(include, EXCLUDE_GLOB, MAX_SEARCH_FILES, token);
  const matches: SourceMatch[] = [];
  const deadline = Date.now() + SEARCH_BUDGET_MS;
  for (const uri of uris) {
    if (matches.length >= limit || token?.isCancellationRequested || Date.now() > deadline) break;
    if (uri.scheme !== 'file') continue;
    const file = vscode.workspace.asRelativePath(uri, false).split('\\').join('/');
    if (!file || file.startsWith('..')) continue;
    let text: string;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > MAX_FILE_BYTES) continue;
      text = new TextDecoder('utf-8', { fatal: false }).decode(await vscode.workspace.fs.readFile(uri));
    } catch { continue; }
    if (text.includes('\u0000')) continue;
    const lines = splitLines(text);
    for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
      const line = lines[index]!;
      if (pattern.test(line.slice(0, MAX_MATCH_LINE))) matches.push({ file, line: index + 1, text: line.slice(0, 240) });
    }
  }
  return matches;
}

export interface SourceSlice {
  file: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
}

export async function readSource(
  root: vscode.WorkspaceFolder,
  input: { file: string; startLine?: number; endLine?: number },
): Promise<SourceSlice> {
  const text = await readWorkspaceText(root, input.file);
  const lines = splitLines(text);
  const total = lines.length;
  const from = Math.min(Math.max(input.startLine ?? 1, 1), Math.max(total, 1));
  const requestedEnd = input.endLine ?? from + 199;
  const to = Math.min(Math.max(requestedEnd, from), from + MAX_READ_LINES - 1, Math.max(total, 1));
  const numbered = lines.slice(from - 1, to).map((line, index) => `${from + index}\t${line}`).join('\n');
  return { file: input.file, startLine: from, endLine: to, totalLines: total, content: numbered };
}

/**
 * Turns a model-authored draft into a validated map: anchors are regenerated
 * from the real files, references to dropped sources are pruned, and the result
 * must still pass the same strict validator the webview relies on.
 */
export async function createMapFromDraft(
  root: vscode.WorkspaceFolder,
  hooks: Pick<ChatHostHooks, 'hasMap' | 'refresh'>,
  input: unknown,
  fallbackTitle?: string,
): Promise<CreateMapOutcome> {
  const draft = normalizeDraft(input, { root: root.uri.fsPath, fallbackTitle });
  const files = [...new Set(Object.values(draft.sources).map(ref => ref.file))].slice(0, MAX_DRAFT_FILES);
  // 超出上限的来源不会预热，fillAnchors 会把它们作为不可读来源裁剪并报告。
  const cache = new Map<string, string | undefined>();
  const load = async (file: string): Promise<void> => {
    try {
      cache.set(file, await readWorkspaceText(root, file));
    } catch {
      cache.set(file, undefined);
    }
  };
  for (let offset = 0; offset < files.length; offset += PREFETCH_BATCH) {
    await Promise.all(files.slice(offset, offset + PREFETCH_BATCH).map(load));
  }
  const filled = fillAnchors(draft, file => cache.get(file));
  const map = parseMap(JSON.stringify(filled.map));
  const written = await writeMapFile(map, { root, hasMap: key => hooks.hasMap(key) });
  await hooks.refresh();
  return {
    written,
    title: map.title,
    nodes: map.nodes.length,
    edges: map.edges.length,
    steps: map.walkthrough?.length ?? 0,
    adjustments: describeAdjustments(filled),
  };
}

function createMapResultText(outcome: CreateMapOutcome): string {
  const summary = [
    t('chat.mapSummary', { title: outcome.title, nodes: outcome.nodes, edges: outcome.edges, steps: outcome.steps }),
    t('chat.mapFile', { path: outcome.written.relativePath }),
    t('chat.mapKey', { key: outcome.written.key }),
  ];
  if (outcome.adjustments.length > 0) summary.push(...outcome.adjustments);
  return summary.join('\n');
}

function explorePrompt(topic: string, rootName: string): string {
  return [
    t('chat.exploreRole', { root: rootName }),
    t('chat.exploreTopic', { topic }),
    '',
    t('chat.exploreTrace'),
    t('chat.exploreTools', { search: TOOL_SEARCH, read: TOOL_READ }),
    t('chat.exploreEvidence'),
    t('chat.exploreRounds'),
  ].join('\n');
}

function planInstruction(): string {
  return t('chat.planIntro');
}

function textPart(value: string): vscode.LanguageModelTextPart {
  return new vscode.LanguageModelTextPart(value);
}

async function invokeToolByName(
  name: string,
  input: unknown,
  token: vscode.ChatParticipantToolToken | undefined,
  cancellation: vscode.CancellationToken,
): Promise<string> {
  const result = await vscode.lm.invokeTool(name, {
    input: input as object,
    toolInvocationToken: token,
  }, cancellation);
  const parts = result.content.filter(part => part instanceof vscode.LanguageModelTextPart) as vscode.LanguageModelTextPart[];
  return parts.map(part => part.value).join('\n');
}

interface ExploreResult {
  messages: vscode.LanguageModelChatMessage[];
  /** False when the model answered without ever reading a file. */
  readSources: boolean;
}

async function explore(
  model: vscode.LanguageModelChat,
  topic: string,
  root: vscode.WorkspaceFolder,
  token: vscode.CancellationToken,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
): Promise<ExploreResult> {
  const tools: vscode.LanguageModelChatTool[] = [
    { name: TOOL_SEARCH, description: t('chat.toolSearchDesc'), inputSchema: searchSchema() },
    { name: TOOL_READ, description: t('chat.toolReadDesc'), inputSchema: readSchema() },
  ];
  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(explorePrompt(topic, root.name)),
  ];
  let readSources = false;
  for (;;) {
    if (token.isCancellationRequested) return { messages, readSources };
    const response = await model.sendRequest(messages, { tools, justification: t('chat.justifyExplore') }, token);
    const calls: vscode.LanguageModelToolCallPart[] = [];
    let text = '';
    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelToolCallPart) calls.push(part);
      else if (part instanceof vscode.LanguageModelTextPart) text += part.value;
    }
    if (calls.length === 0) {
      if (text.trim()) messages.push(vscode.LanguageModelChatMessage.Assistant(text.trim()));
      break;
    }
    if (calls.some(call => call.name === TOOL_READ || call.name === TOOL_SEARCH)) readSources = true;
    const labels = calls.map(call => {
      const input = call.input as { query?: string; file?: string };
      return input.query ?? input.file ?? '';
    }).filter(Boolean);
    if (labels.length > 0) stream.progress(t('chat.progressReading', { labels: labels.slice(0, 3).join(t('chat.listSeparator')) }));
    messages.push(vscode.LanguageModelChatMessage.Assistant(calls));
    const results: vscode.LanguageModelToolResultPart[] = [];
    for (const call of calls) {
      let text2: string;
      try {
        text2 = await invokeToolByName(call.name, call.input, request.toolInvocationToken, token);
      } catch (error) {
        text2 = t('chat.toolFailed', { error: errorMessage(error) });
      }
      results.push(new vscode.LanguageModelToolResultPart(call.callId, [textPart(text2)]));
    }
    messages.push(vscode.LanguageModelChatMessage.User(results));
  }
  return { messages, readSources };
}

interface PlanOutcome {
  draft?: unknown;
  rawText?: string;
  error?: string;
}

async function plan(
  model: vscode.LanguageModelChat,
  messages: vscode.LanguageModelChatMessage[],
  instruction: string,
  token: vscode.CancellationToken,
  stream: vscode.ChatResponseStream,
): Promise<PlanOutcome> {
  stream.progress(t('chat.progressPlanning'));
  const request = [...messages, vscode.LanguageModelChatMessage.User(instruction)];
  const response = await model.sendRequest(request, {
    justification: t('chat.justifyPlan'),
  }, token);
  let text = '';
  for await (const part of response.stream) {
    if (part instanceof vscode.LanguageModelToolCallPart) {
      const input = part.input as Record<string, unknown> | undefined;
      if (input && typeof input === 'object' && Object.keys(input).length > 0) {
        return { draft: input, rawText: JSON.stringify(input) };
      }
    }
    if (part instanceof vscode.LanguageModelTextPart) text += part.value;
  }
  const json = extractJson(text);
  if (!json) return { rawText: text, error: t('chat.noStructuredDraft') };
  try {
    return { draft: JSON.parse(json), rawText: json };
  } catch {
    return { rawText: text, error: t('chat.draftNotJson') };
  }
}

function streamingResult(stream: vscode.ChatResponseStream, outcome: CreateMapOutcome): void {
  stream.markdown(`### ${outcome.title}\n\n`);
  stream.markdown(createMapResultText(outcome).split('\n').map(line => `${line}\n`).join('\n'));
  stream.button({ command: 'codeDetective.openMap', title: t('chat.openMapButton'), arguments: [outcome.written.key] });
  stream.markdown('\n');
  stream.markdown(t('chat.startTourHint'));
}

async function handleMapRequest(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  hooks: ChatHostHooks,
): Promise<vscode.ChatResult> {
  const root = hooks.root();
  if (!root) {
    stream.markdown(t('chat.noWorkspaceAnalyze'));
    return {};
  }
  const topic = request.prompt.trim() || t('chat.defaultTopic');
  try {
    const explored = await explore(request.model, topic, root, token, request, stream);
    if (token.isCancellationRequested) return { metadata: { phase: 'cancelled' } };
    if (!explored.readSources) {
      stream.markdown(t('chat.noSourcesRead'));
    }

    const planPrompt = `${planInstruction()}\n\n${outputContract()}`;
    let conversation = explored.messages;
    let outcome: CreateMapOutcome | undefined;
    let lastError: string | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const instruction = attempt === 0 ? planPrompt : retryPrompt([lastError ?? t('chat.unknownReason')]);
      const planned = await plan(request.model, conversation, instruction, token, stream);
      if (token.isCancellationRequested) return { metadata: { phase: 'cancelled' } };

      conversation = [
        ...conversation,
        vscode.LanguageModelChatMessage.User(instruction),
        vscode.LanguageModelChatMessage.Assistant(planned.rawText?.trim() || '{}'),
      ];

      if (!planned.draft) {
        lastError = planned.error ?? t('chat.unknownReason');
        continue;
      }
      try {
        outcome = await createMapFromDraft(root, hooks, planned.draft, topic);
        break;
      } catch (error) {
        if (token.isCancellationRequested || error instanceof vscode.CancellationError) {
          throw error;
        }
        lastError = errorMessage(error);
      }
    }

    if (!outcome) {
      stream.markdown(t('chat.planFailed', { error: lastError ?? t('chat.unknownReason') }));
      return {};
    }

    hooks.notify(t('chat.mapGenerated', { title: outcome.title, path: outcome.written.relativePath }));
    streamingResult(stream, outcome);
    await hooks.openMap(outcome.written.key);
    return { metadata: { mapKey: outcome.written.key } };
  } catch (error) {
    if (token.isCancellationRequested || error instanceof vscode.CancellationError) {
      stream.markdown(t('chat.cancelled'));
      return { metadata: { phase: 'cancelled' } };
    }
    const message = errorMessage(error);
    stream.markdown(t('chat.generateFailed', { error: message }));
    stream.markdown(t('chat.keptLastMap'));
    return { metadata: { error: message } };
  }
}

/** Registers the `@detective` participant plus the exploration / map-writing tools when supported by the host editor. */
export function registerChatIntegration(hooks: ChatHostHooks): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  if (typeof vscode.lm?.registerTool === 'function') {
    try {
      disposables.push(vscode.lm.registerTool<{ file: string; startLine?: number; endLine?: number }>(TOOL_READ, {
        prepareInvocation: options => ({
          invocationMessage: options.input.startLine
            ? t('chat.readInvocationFrom', { file: options.input.file, line: options.input.startLine })
            : t('chat.readInvocation', { file: options.input.file }),
        }),
        async invoke(options, token) {
          const root = hooks.root();
          if (!root) throw new Error(t('chat.noWorkspace'));
          if (token.isCancellationRequested) throw new vscode.CancellationError();
          const slice = await readSource(root, options.input);
          return new vscode.LanguageModelToolResult([textPart(`${t('chat.readResultHeader', { file: slice.file, start: slice.startLine, end: slice.endLine, total: slice.totalLines })}\n${slice.content}`)]);
        },
      }));

      disposables.push(vscode.lm.registerTool<{ query: string; regex?: boolean; caseSensitive?: boolean; glob?: string; maxResults?: number }>(TOOL_SEARCH, {
        prepareInvocation: options => ({
          invocationMessage: t('chat.searchInvocation', { query: options.input.query }),
        }),
        async invoke(options, token) {
          const root = hooks.root();
          if (!root) throw new Error(t('chat.noWorkspace'));
          const matches = await searchSources(root, options.input, token);
          const body = matches.length === 0
            ? t('chat.noMatches')
            : matches.map(match => `${match.file}:${match.line}\t${match.text}`).join('\n');
          return new vscode.LanguageModelToolResult([textPart(body)]);
        },
      }));

      disposables.push(vscode.lm.registerTool<Record<string, unknown>>(TOOL_CREATE_MAP, {
        prepareInvocation: options => {
          const title = typeof options.input.title === 'string' ? options.input.title : t('chat.defaultMapTitle');
          return {
            invocationMessage: t('chat.writeMapInvocation', { title }),
            confirmationMessages: {
              title: t('chat.writeMapConfirmTitle'),
              message: new vscode.MarkdownString(t('chat.writeMapConfirmMessage', { dir: MAP_DIR, title })),
            },
          };
        },
        async invoke(options) {
          const root = hooks.root();
          if (!root) throw new Error(t('chat.noWorkspace'));
          const outcome = await createMapFromDraft(root, hooks, options.input);
          hooks.notify(t('chat.mapGenerated', { title: outcome.title, path: outcome.written.relativePath }));
          return new vscode.LanguageModelToolResult([textPart(createMapResultText(outcome))]);
        },
      }));
    } catch {
      /* Language model tools are unsupported in some non-VS-Code forks (e.g. Cursor / Windsurf). */
    }
  }

  if (typeof vscode.chat?.createChatParticipant === 'function') {
    try {
      const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, async (request, _context, stream, token) => {
        switch (request.command) {
          case 'open': {
            // Only an explicit mapKey is forwarded; free text falls back to the picker.
            const raw = request.prompt.trim();
            const key = /^[\w.:@/-]+$/.test(raw) ? raw : undefined;
            await hooks.openMap(key);
            stream.markdown(key ? t('chat.openedMapKey', { key }) : t('chat.openedMap'));
            return {};
          }
          case 'next':
            await vscode.commands.executeCommand('codeDetective.nextStep');
            stream.markdown(t('chat.advancedStep'));
            return {};
          case 'help':
            stream.markdown(t('chat.help'));
            return {};
          case 'map':
          default:
            return handleMapRequest(request, stream, token, hooks);
        }
      });
      participant.iconPath = new vscode.ThemeIcon('search');
      participant.followupProvider = {
        provideFollowups(result) {
          const mapKey = result.metadata?.mapKey;
          if (typeof mapKey !== 'string') return [];
          return [
            { prompt: t('chat.followupNextPrompt'), label: t('chat.followupNextLabel'), command: 'next' },
            { prompt: t('chat.followupOpenPrompt'), label: t('chat.followupOpenLabel'), command: 'open' },
          ];
        },
      };
      disposables.push(participant);
    } catch {
      /* Chat participant API is unavailable outside VS Code Copilot Chat. */
    }
  }

  return disposables;
}
