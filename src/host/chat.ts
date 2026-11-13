import * as vscode from 'vscode';
import { DRAFT_MAP_SCHEMA, describeAdjustments, fillAnchors, normalizeDraft } from '../core/mapDraft';
import { parseMap } from '../core/validator';
import { errorMessage } from '../core/errors';
import { extractJson } from '../ai/json';
import { MAP_DIR, writeMapFile, type WrittenMap } from './mapWriter';
import { readWorkspaceText } from './workspaceText';
import { MAX_QUERY_LENGTH, unsafeRegex } from './regexGuard';

export const PARTICIPANT_ID = 'code-detective.detective';

export const TOOL_SEARCH = 'codeDetective_searchSources';
export const TOOL_READ = 'codeDetective_readSource';
export const TOOL_CREATE_MAP = 'codeDetective_createMap';

const MAX_SEARCH_FILES = 200;
const MAX_SEARCH_RESULTS = 40;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_READ_LINES = 400;
const MAX_DRAFT_FILES = 200;
const PREFETCH_BATCH = 8;
const MAX_EXPLORE_ROUNDS = 6;

const SOURCE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,vue,py,go,rs,java,kt,cs,swift,rb,php,c,h,cpp,hpp,md,json}';
const EXCLUDE_GLOB = '**/{node_modules,.git,dist,out,build,coverage,vendor,target,.next,.nuxt,artifacts}/**';

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

const SEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string', description: '要在工作区源码中查找的文本（默认按子串匹配）' },
    regex: { type: 'boolean', description: '是否把 query 当作正则表达式' },
    caseSensitive: { type: 'boolean', description: '是否区分大小写，默认不区分' },
    glob: { type: 'string', description: '可选的额外文件过滤，例如 src/**/*.ts' },
    maxResults: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_RESULTS, description: '最多返回多少条匹配，默认 20' },
  },
} as const;

const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file'],
  properties: {
    file: { type: 'string', description: '工作区相对路径，使用 / 分隔' },
    startLine: { type: 'integer', minimum: 1, description: '起始行，默认 1' },
    endLine: { type: 'integer', minimum: 1, description: '结束行（含），默认 startLine + 199' },
  },
} as const;

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

export async function searchSources(
  root: vscode.WorkspaceFolder,
  input: { query: string; regex?: boolean; caseSensitive?: boolean; glob?: string; maxResults?: number },
  token?: vscode.CancellationToken,
): Promise<SourceMatch[]> {
  const limit = Math.min(Math.max(input.maxResults ?? 20, 1), MAX_SEARCH_RESULTS);
  if (typeof input.query !== 'string' || input.query.length === 0) throw new Error('query 不能为空。');
  if (input.query.length > MAX_QUERY_LENGTH) throw new Error(`query 不能超过 ${MAX_QUERY_LENGTH} 个字符。`);
  if (input.regex && unsafeRegex(input.query)) {
    throw new Error('正则含有嵌套量词或反向引用，可能导致回溯爆炸；请改用更简单的表达式或普通文本搜索。');
  }
  let pattern: RegExp;
  try {
    pattern = input.regex
      ? new RegExp(input.query, input.caseSensitive ? '' : 'i')
      : new RegExp(input.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), input.caseSensitive ? '' : 'i');
  } catch (error) {
    throw new Error(`正则无效：${errorMessage(error)}`);
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
): Promise<CreateMapOutcome> {
  const draft = normalizeDraft(input);
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
    `已生成地图《${outcome.title}》：${outcome.nodes} 个节点、${outcome.edges} 条连线、${outcome.steps} 个导读步骤。`,
    `文件：${outcome.written.relativePath}`,
    `mapKey：${outcome.written.key}`,
  ];
  if (outcome.adjustments.length > 0) summary.push(...outcome.adjustments);
  return summary.join('\n');
}

function explorePrompt(topic: string, rootName: string): string {
  return [
    `你是代码侦探的探索助手。工作区根目录：${rootName}。`,
    `用户想了解的流程：${topic}`,
    '',
    '先用工具阅读真实源码，按调用顺序追踪出完整链路：入口事件 → 处理函数 → 数据读写 → 界面刷新。',
    `可用工具：${TOOL_SEARCH}（按关键字搜索）、${TOOL_READ}（读取文件指定行）。`,
    '只看有源码依据的调用关系，不要推测；行号必须来自你实际读到的内容。',
    '最多探索 6 轮，读够上下文后就停止调用工具，用两三句话总结这条链路。',
  ].join('\n');
}

const PLAN_INSTRUCTION = [
  '现在把刚才的探索结果整理成代码地图草稿，调用工具提交。',
  '',
  '要求：',
  '1. 每个 node / edge 都必须引用真实的 sourceIds；sources 只给 file、startLine、endLine，不要写 anchorText。',
  '2. 行号必须来自你实际读到的内容，endLine >= startLine。',
  '3. 按执行顺序给 walkthrough，每个步骤包含一个节点及其进出连线。',
  '4. 只写有源码依据的节点与连线，不要编造。',
].join('\n');

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
    { name: TOOL_SEARCH, description: '在工作区源码中按关键字或正则搜索，返回 file、line 与整行文本。', inputSchema: SEARCH_SCHEMA },
    { name: TOOL_READ, description: '读取工作区文件的指定行范围，输出带行号的文本。', inputSchema: READ_SCHEMA },
  ];
  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(explorePrompt(topic, root.name)),
  ];
  let readSources = false;
  for (let round = 0; round < MAX_EXPLORE_ROUNDS; round += 1) {
    if (token.isCancellationRequested) return { messages, readSources };
    const response = await model.sendRequest(messages, { tools, justification: '读取工作区源码以追踪调用链' }, token);
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
    if (labels.length > 0) stream.progress(`阅读源码：${labels.slice(0, 3).join('、')}`);
    messages.push(vscode.LanguageModelChatMessage.Assistant(calls));
    const results: vscode.LanguageModelToolResultPart[] = [];
    for (const call of calls) {
      let text2: string;
      try {
        text2 = await invokeToolByName(call.name, call.input, request.toolInvocationToken, token);
      } catch (error) {
        text2 = `工具执行失败：${errorMessage(error)}`;
      }
      results.push(new vscode.LanguageModelToolResultPart(call.callId, [textPart(text2)]));
    }
    messages.push(vscode.LanguageModelChatMessage.User(results));
  }
  return { messages, readSources };
}

interface PlanOutcome {
  draft?: unknown;
  error?: string;
}

async function plan(
  model: vscode.LanguageModelChat,
  messages: vscode.LanguageModelChatMessage[],
  token: vscode.CancellationToken,
  stream: vscode.ChatResponseStream,
): Promise<PlanOutcome> {
  stream.progress('整理结构化流程');
  const tools: vscode.LanguageModelChatTool[] = [
    {
      name: TOOL_CREATE_MAP,
      description: '校验并保存代码地图草稿；插件会按真实文件补全 anchorText 并打开地图。',
      inputSchema: DRAFT_MAP_SCHEMA,
    },
  ];
  const request = [...messages, vscode.LanguageModelChatMessage.User(PLAN_INSTRUCTION)];
  const response = await model.sendRequest(request, {
    tools,
    toolMode: vscode.LanguageModelChatToolMode.Required,
    justification: '整理代码地图草稿',
  }, token);
  let text = '';
  for await (const part of response.stream) {
    if (part instanceof vscode.LanguageModelToolCallPart) return { draft: part.input };
    if (part instanceof vscode.LanguageModelTextPart) text += part.value;
  }
  const json = extractJson(text);
  if (!json) return { error: '模型没有返回结构化的地图草稿。' };
  try {
    return { draft: JSON.parse(json) };
  } catch {
    return { error: '模型返回的草稿不是合法 JSON。' };
  }
}

function streamingResult(stream: vscode.ChatResponseStream, outcome: CreateMapOutcome): void {
  stream.markdown(`### ${outcome.title}\n\n`);
  stream.markdown(createMapResultText(outcome).split('\n').map(line => `${line}\n`).join('\n'));
  stream.button({ command: 'codeDetective.openMap', title: '打开代码地图', arguments: [outcome.written.key] });
  stream.markdown('\n');
  stream.markdown(`也可以直接执行 \`代码侦探: 开始导读\` 按顺序阅读。`);
}

async function handleMapRequest(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  hooks: ChatHostHooks,
): Promise<vscode.ChatResult> {
  const root = hooks.root();
  if (!root) {
    stream.markdown('请先打开一个工作区文件夹，再让我分析调用流程。');
    return {};
  }
  const topic = request.prompt.trim() || '当前打开文件的主要调用流程';
  try {
    const explored = await explore(request.model, topic, root, token, request, stream);
    if (token.isCancellationRequested) return { metadata: { phase: 'cancelled' } };
    if (!explored.readSources) {
      stream.markdown('> 本次没有读取任何源码，行号可能不准确，请打开地图后核对。\n\n');
    }
    const planned = await plan(request.model, explored.messages, token, stream);
    if (token.isCancellationRequested) return { metadata: { phase: 'cancelled' } };
    if (!planned.draft) {
      stream.markdown(`没能生成地图：${planned.error ?? '未知原因'}\n\n可以补充更具体的话题，或用 \`代码侦探: 用 AI 生成地图\` 指定 AI 服务。`);
      return {};
    }
    const outcome = await createMapFromDraft(root, hooks, planned.draft);
    hooks.notify(`已生成地图《${outcome.title}》：${outcome.written.relativePath}`);
    streamingResult(stream, outcome);
    await hooks.openMap(outcome.written.key);
    return { metadata: { mapKey: outcome.written.key } };
  } catch (error) {
    if (token.isCancellationRequested || error instanceof vscode.CancellationError) {
      stream.markdown('已取消。');
      return { metadata: { phase: 'cancelled' } };
    }
    const message = errorMessage(error);
    stream.markdown(`生成失败：${message}\n\n`);
    stream.markdown(`已保留上次有效地图。可执行 \`代码侦探: 用 AI 生成地图\` 改用本地模型服务重试。`);
    return { metadata: { error: message } };
  }
}

/** Registers the `@detective` participant plus the exploration / map-writing tools. */
export function registerChatIntegration(hooks: ChatHostHooks): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  disposables.push(vscode.lm.registerTool<{ file: string; startLine?: number; endLine?: number }>(TOOL_READ, {
    prepareInvocation: options => ({
      invocationMessage: `读取 ${options.input.file}${options.input.startLine ? ` 第 ${options.input.startLine} 行起` : ''}`,
    }),
    async invoke(options, token) {
      const root = hooks.root();
      if (!root) throw new Error('请先打开一个工作区文件夹。');
      if (token.isCancellationRequested) throw new vscode.CancellationError();
      const slice = await readSource(root, options.input);
      return new vscode.LanguageModelToolResult([textPart(`${slice.file}（第 ${slice.startLine}–${slice.endLine} 行，共 ${slice.totalLines} 行）\n${slice.content}`)]);
    },
  }));

  disposables.push(vscode.lm.registerTool<{ query: string; regex?: boolean; caseSensitive?: boolean; glob?: string; maxResults?: number }>(TOOL_SEARCH, {
    prepareInvocation: options => ({
      invocationMessage: `搜索 ${options.input.query}`,
    }),
    async invoke(options, token) {
      const root = hooks.root();
      if (!root) throw new Error('请先打开一个工作区文件夹。');
      const matches = await searchSources(root, options.input, token);
      const body = matches.length === 0
        ? '没有匹配。可以换关键字，或先用更宽泛的搜索定位文件。'
        : matches.map(match => `${match.file}:${match.line}\t${match.text}`).join('\n');
      return new vscode.LanguageModelToolResult([textPart(body)]);
    },
  }));

  disposables.push(vscode.lm.registerTool<Record<string, unknown>>(TOOL_CREATE_MAP, {
    prepareInvocation: options => {
      const title = typeof options.input.title === 'string' ? options.input.title : '代码地图';
      return {
        invocationMessage: `写入地图《${title}》`,
        confirmationMessages: {
          title: '写入代码地图',
          message: new vscode.MarkdownString(`将在 \`${MAP_DIR}/\` 下新建地图《${title}》，并按真实文件补全源码锚点。`),
        },
      };
    },
    async invoke(options) {
      const root = hooks.root();
      if (!root) throw new Error('请先打开一个工作区文件夹。');
      const outcome = await createMapFromDraft(root, hooks, options.input);
      hooks.notify(`已生成地图《${outcome.title}》：${outcome.written.relativePath}`);
      return new vscode.LanguageModelToolResult([textPart(createMapResultText(outcome))]);
    },
  }));

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, async (request, _context, stream, token) => {
    switch (request.command) {
      case 'open': {
        // Only an explicit mapKey is forwarded; free text falls back to the picker.
        const raw = request.prompt.trim();
        const key = /^[\w.:@/-]+$/.test(raw) ? raw : undefined;
        await hooks.openMap(key);
        stream.markdown(key ? `已打开地图 \`${key}\`。` : '已打开代码地图。');
        return {};
      }
      case 'next':
        await vscode.commands.executeCommand('codeDetective.nextStep');
        stream.markdown('已前进到导读的下一步。');
        return {};
      case 'help':
        stream.markdown([
          '**代码侦探**',
          '',
          '- `/map <话题>`：先读源码追踪调用链，再生成并打开代码地图。',
          '- `/open [mapKey]`：打开已有地图。',
          '- `/next`：导读下一步。',
          '',
          'Agent 模式下也可以直接使用 `#codeDetectiveCreateMap` 等工具。',
        ].join('\n'));
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
        { prompt: '下一步', label: '继续导读', command: 'next' },
        { prompt: '打开刚生成的地图', label: '打开地图', command: 'open' },
      ];
    },
  };
  disposables.push(participant);

  return disposables;
}
