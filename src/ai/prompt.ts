/**
 * Prompts for a local coding agent.
 *
 * The agent already sits in the workspace with its own read tools, so the plugin
 * never inlines source text: it only states the goal and the output contract.
 *
 * Prompts follow the UI locale: in `en` the whole prompt is English and the agent is
 * asked to write map text in English; in `zh-CN` it is Chinese.
 */

import { getLocale, type Locale } from '../../shared/i18n';

export interface PromptContext {
  rootName: string;
  topic: string;
  /** Files the user is looking at, as a hint for where to start. */
  priorityFiles: string[];
  /** Adjustments from the previous turn, fed back so the agent can correct itself. */
  previousIssues?: string[];
}

interface PromptText {
  hints: string;
  intro: (rootName: string) => string;
  topic: (topic: string) => string;
  explore: string[];
  finish: string;
  schema: { title: string; description: string; note: string; label: string; optional: string; edgeLabel: string; stepTitle: string };
  contractHead: string[];
  contractTail: string[];
  retryHead: string;
  retryTail: string;
  continue: string;
}

const TEXT: Record<Locale, PromptText> = {
  'zh-CN': {
    hints: '用户当前正在看这些文件，可以优先从它们入手：',
    intro: rootName => `你是代码侦探。工作区就是当前目录（${rootName}），请直接用你的读文件 / 搜索工具阅读真实源码。`,
    topic: topic => `要追踪的流程：${topic}`,
    explore: [
      '请按执行顺序梳理出完整链路：入口事件 → 处理函数 → 数据读写 → 界面刷新或返回。',
      '只写有源码依据的调用关系，不要推测；行号必须来自你实际读到的内容。',
    ],
    finish: '读够上下文后，把结论整理成下面要求的 JSON，作为最后一条消息输出。',
    schema: {
      title: '地图标题', description: '可选说明', note: '这段代码做了什么（一句话）',
      label: '短标签', optional: '可选', edgeLabel: '调用', stepTitle: '第一步',
    },
    contractHead: [
      '输出格式（硬性要求）：',
      '1. 在最后一条消息里只输出一个 JSON 对象，不要 Markdown 围栏，不要额外解释。',
      '2. schemaVersion 必须为 1，字段名严格如下，不要添加未知字段：',
    ],
    contractTail: [
      '3. map.id 匹配 ^[a-z0-9][a-z0-9-]*$；node / edge / step / source 的 id 匹配 ^[A-Za-z0-9_.:-]+$。',
      '4. 每个 source 必须给出相对工作区的 file（用 / 分隔）、startLine、endLine，且 endLine >= startLine。',
      '5. 不要写 anchorText：插件会按真实文件重新生成。',
      '6. 每个 source 都要写 note：用一句话（不超过 60 字）说明这几行在流程里做了什么，它会显示在代码行尾。',
      '7. 只写有源码依据的节点与连线，宁缺勿滥。',
    ],
    retryHead: '上一次的 JSON 没能通过校验。',
    retryTail: '请复用你已经读到的内容，输出修正后的完整 JSON 对象。仍然只输出 JSON。',
    continue: '继续：在上一轮基础上补齐或修正地图，最后只输出完整的 JSON 对象。',
  },
  en: {
    hints: 'The user is currently looking at these files; consider starting from them:',
    intro: rootName => `You are Code Detective. The workspace is the current directory (${rootName}); read the real source directly with your file-reading / search tools.`,
    topic: topic => `Flow to trace: ${topic}`,
    explore: [
      'Lay out the complete chain in execution order: entry event → handler → data reads/writes → UI refresh or return.',
      'Only include call relationships backed by the source; do not guess. Line numbers must come from what you actually read.',
    ],
    finish: 'Once you have enough context, turn your findings into the JSON described below and output it as your final message.',
    schema: {
      title: 'Map title', description: 'Optional description', note: 'What this code does (one sentence)',
      label: 'Short label', optional: 'Optional', edgeLabel: 'calls', stepTitle: 'Step one',
    },
    contractHead: [
      'Output format (hard requirements):',
      '1. In your final message output exactly one JSON object: no Markdown fences, no extra explanation.',
      '2. schemaVersion must be 1 and field names must be exactly as below; do not add unknown fields:',
    ],
    contractTail: [
      '3. map.id matches ^[a-z0-9][a-z0-9-]*$; node / edge / step / source ids match ^[A-Za-z0-9_.:-]+$.',
      '4. Every source must give a workspace-relative file (separated by /), startLine and endLine, with endLine >= startLine.',
      '5. Do not write anchorText: the plugin regenerates it from the real file.',
      '6. Every source needs a note: one sentence (at most 120 characters) on what these lines do in the flow; it is shown at the end of the code line.',
      '7. Only include nodes and edges backed by the source; fewer but accurate is better.',
      '8. Write all titles, labels, descriptions and notes in English.',
    ],
    retryHead: 'The previous JSON failed validation.',
    retryTail: 'Reuse what you have already read and output the complete corrected JSON object. Still output only JSON.',
    continue: 'Continue: complete or fix the map based on the previous turn, and finally output only the complete JSON object.',
  },
};

function text(): PromptText {
  return TEXT[getLocale()];
}

export function explorePrompt(context: PromptContext): string {
  const p = text();
  const hints = context.priorityFiles.length > 0
    ? ['', p.hints, ...context.priorityFiles.slice(0, 12).map(file => `- ${file}`)]
    : [];
  return [
    p.intro(context.rootName),
    '',
    p.topic(context.topic),
    '',
    ...p.explore,
    ...hints,
    '',
    p.finish,
  ].join('\n');
}

function schema(): string {
  const s = text().schema;
  return [
    '{',
    '  "schemaVersion": 1,',
    '  "id": "kebab-case-id",',
    `  "title": "${s.title}",`,
    `  "description": "${s.description}",`,
    '  "sources": { "<sourceId>": { "file": "src/a.ts", "startLine": 1, "endLine": 3,',
    `                               "note": "${s.note}" } },`,
    `  "nodes": [{ "id": "step-1", "label": "${s.label}", "description": "${s.optional}",`,
    '               "kind": "step|function|condition|event", "sourceIds": ["<sourceId>"] }],',
    `  "edges": [{ "id": "e1", "from": "step-1", "to": "step-2", "label": "${s.edgeLabel}",`,
    '              "kind": "call|flow|event|related", "sourceIds": ["<sourceId>"] }],',
    `  "walkthrough": [{ "id": "w1", "title": "${s.stepTitle}", "description": "${s.optional}",`,
    '                    "nodeIds": ["step-1"], "edgeIds": ["e1"] }]',
    '}',
  ].join('\n');
}

/** Output contract appended to the first prompt; follows the current locale. */
export function outputContract(): string {
  const p = text();
  return [...p.contractHead, '', schema(), '', ...p.contractTail].join('\n');
}

export function retryPrompt(issues: readonly string[]): string {
  const p = text();
  return [
    p.retryHead,
    '',
    ...issues.slice(-5).map(issue => `- ${issue}`),
    '',
    p.retryTail,
  ].join('\n');
}

export function continuePrompt(): string {
  return text().continue;
}
