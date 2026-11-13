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
  schema: { title: string; description: string; note: string; label: string; optional: string; edgeLabel: string; stepTitle: string; branch: string; stepWhat: string; why: string; watch: string; skip: string; stepExample: string; example: string; recap: string; exercise: string };
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
      label: '短标签', optional: '可选', edgeLabel: '调用', stepTitle: '第一步', branch: '可选：分支条件',
      stepWhat: '这一步在看什么（1–3 句）', why: '为什么这样写', watch: '值得注意的坑', skip: '可以先跳过的部分', stepExample: '例子走到这里时发生了什么',
      example: '一个贯穿全程的具体例子', recap: '看完后的总结（3–5 句）', exercise: '一个动手验证理解的小练习',
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
      '8. 分层：顶层放 3–8 个功能块（整体阶段），每个功能块的内部步骤用 parent 指向该功能块；一层最多约 12 个节点，超过就再拆一层。简单流程可以不分层。',
      '9. 主干与支线：正常执行路径的边不写 branch；异常、提前返回、缓存命中、重试等分支的边写 branch（例如 "未命中缓存"、"校验失败"）。分叉点用 kind: "condition"，提前 return / 抛错 / 结束用 kind: "exit"。',
      '10. walkthrough 是带人读代码的导读，像坐在旁边讲解一样写：主线 5–10 步沿正常路径走，每一步只指向一段代码（sourceId，通常 3–20 行）；description 说这段在做什么，why 说为什么这样写，watch 写容易踩的坑，skip 写这一步可以先略过的细节（都可选，没有就不写）。',
      '11. 在 tour.example 里定一个具体例子（真实的输入 / 用户 / 数据），每一步的 example 写这个例子走到这里时发生了什么；tour.recap 写看完后的总结，tour.exercise 给一个可以动手验证理解的小练习（例如改一行代码、加一条日志后会看到什么）。',
      '12. 异常、重试等支线不要塞进主线：写成 aside: true 的步骤，并在出发的那一步用 branches 列出它们；用户看完岔路会回到出发的那一步。',
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
      label: 'Short label', optional: 'Optional', edgeLabel: 'calls', stepTitle: 'Step one', branch: 'Optional: branch condition',
      stepWhat: 'What this step looks at (1-3 sentences)', why: 'Why it is written this way', watch: 'A pitfall worth noticing', skip: 'What can be skipped for now', stepExample: 'What happens to the example here',
      example: 'One concrete example that runs through the tour', recap: 'Summary after the tour (3-5 sentences)', exercise: 'A small hands-on exercise to check understanding',
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
      '8. Layers: put 3–8 feature blocks (overall phases) at the top level; inner steps of a block set parent to that block. Keep each layer to about 12 nodes, split further if needed. Simple flows may stay flat.',
      '9. Main path vs branches: edges on the normal execution path have no branch; edges for errors, early returns, cache hits, retries etc. set branch (e.g. "cache miss", "validation failed"). Use kind "condition" at decision points and kind "exit" for early return / throw / end.',
      '10. walkthrough is a guided reading, written as if sitting next to the reader: a main line of 5-10 steps follows the normal path, each step points to exactly one piece of code (sourceId, usually 3-20 lines); description says what that code does, why explains why it is written this way, watch names a pitfall, skip names details that can be skipped for now (all optional; omit when there is nothing to say).',
      '11. Put one concrete example in tour.example (a real input / user / piece of data); each step\'s example says what happens to that example at this point. tour.recap is the summary after the tour, tour.exercise is a small hands-on exercise to check understanding (e.g. what you would see after changing a line or adding a log).',
      '12. Keep error / retry paths off the main line: write them as steps with aside: true and list them in branches of the step they start from; after an aside the reader returns to that step.',
      '13. Write all titles, labels, descriptions, notes, branch labels and tour text in English.',
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
    '               "kind": "step|function|condition|event|exit", "parent": "<blockNodeId>", "sourceIds": ["<sourceId>"] }],',
    `  "edges": [{ "id": "e1", "from": "step-1", "to": "step-2", "label": "${s.edgeLabel}",`,
    `              "kind": "call|flow|event|related", "branch": "${s.branch}", "sourceIds": ["<sourceId>"] }],`,
    `  "walkthrough": [{ "id": "w1", "title": "${s.stepTitle}", "description": "${s.stepWhat}",`,
    '                    "nodeIds": ["step-1"], "edgeIds": ["e1"], "sourceId": "<sourceId>",',
    `                    "why": "${s.why}", "watch": "${s.watch}", "skip": "${s.skip}", "example": "${s.stepExample}",`,
    '                    "branches": ["w-aside"] },',
    '                  { "id": "w-aside", "title": "…", "aside": true, "nodeIds": ["…"], "edgeIds": [], "sourceId": "<sourceId>" }],',
    `  "tour": { "example": "${s.example}", "recap": "${s.recap}", "exercise": "${s.exercise}" }`,
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
