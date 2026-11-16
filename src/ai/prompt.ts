/**
 * Prompts for a coding agent.
 *
 * The agent already sits in the workspace with its own read tools, so the plugin
 * never inlines source text: it only states the goal and the output contract.
 *
 * Prompts follow the UI locale: in `en` the whole prompt is English and the agent is
 * asked to write map text in English; in `zh-CN` it is Chinese.
 */

import { getLocale, type Locale } from '../../shared/i18n';

export interface PromptAnchor {
  file: string;
  symbol?: string;
  startLine?: number;
  endLine?: number;
}

export interface PromptContext {
  rootName: string;
  topic: string;
  /** Explicit starting anchor when the user launches from cursor / selection. */
  anchor?: PromptAnchor;
  /** Files the user is looking at, as a hint for where to start. */
  priorityFiles: string[];
  /** Adjustments from the previous turn, fed back so the agent can correct itself. */
  previousIssues?: string[];
}

interface PromptText {
  hints: string;
  anchorLine: (anchor: PromptAnchor) => string;
  intro: (rootName: string) => string;
  topic: (topic: string) => string;
  explore: string[];
  finish: string;
  schema: {
    title: string;
    description: string;
    note: string;
    label: string;
    optional: string;
    edgeLabel: string;
    stepTitle: string;
    branch: string;
    stepWhat: string;
    why: string;
    watch: string;
    skip: string;
    stepExample: string;
    example: string;
    recap: string;
    exercise: string;
  };
  contractHead: string[];
  contractTail: string[];
  retryHead: string;
  retryTail: string;
  continue: string;
}

const TEXT: Record<Locale, PromptText> = {
  'zh-CN': {
    hints: '用户当前正在看这些文件，可作为探索参考：',
    anchorLine: anchor => {
      const range = anchor.startLine
        ? (anchor.endLine && anchor.endLine > anchor.startLine ? `:${anchor.startLine}-${anchor.endLine}` : `:${anchor.startLine}`)
        : '';
      const symbol = anchor.symbol ? `（符号：${anchor.symbol}）` : '';
      return `起点锚点：${anchor.file}${range}${symbol}`;
    },
    intro: rootName => `你是代码侦探。工作区就是当前目录（${rootName}），请自由发挥你的搜索、读文件、子智能体等探索能力阅读真实源码。`,
    topic: topic => `要带读的主题：${topic}`,
    explore: [
      '请深入定位并阅读真实的业务实现代码（不要只停留在类型、接口或枚举声明上），按最有利于读者理解代码实际运行机制的方式自由组织带读步骤与脉络图。',
      '所有文件路径和行号必须来自你实际读到的真实文件内容，不要猜测或凭记忆估算。',
    ],
    finish: '探索完成后，在最后一条消息里按下面的输出格式直接输出完整的 JSON 对象。',
    schema: {
      title: '带读讲义标题', description: '简要说明这条流程做什么', note: '这段代码的作用简注（可选）',
      label: '节点短标签', optional: '职责简述（可选）', edgeLabel: '关系说明（可选）', stepTitle: '步骤标题', branch: '可选：分支条件说明',
      stepWhat: '清晰讲解这一步在做什么', why: '可选：设计原因或背景考量', watch: '可选：容易踩坑或需留意的地方', skip: '可选：初读可先略过的细节', stepExample: '可选：结合具体例子说明这一步的变化',
      example: '可选：贯穿全程的具体例子', recap: '可选：全局回顾总结', exercise: '可选：验证理解的小练习',
    },
    contractHead: [
      '输出格式（仅约束 JSON 结构）：',
      '1. 最后一条消息只输出一个合法 JSON 对象，不要加 Markdown 代码块围栏，不要在 JSON 外写额外文字。',
      '2. schemaVersion 固定为 1；必填顶层字段为 schemaVersion、id、title、sources、nodes（至少 1 个）、edges、walkthrough（至少 1 个非 aside 主线步骤），不要添加未定义字段：',
    ],
    contractTail: [
      '3. id 规范：顶层 id 匹配 ^[a-z0-9][a-z0-9-]*$（最长 64 字符）；sources / nodes / edges / walkthrough 内各项 id 匹配 ^[A-Za-z0-9_.:-]+$，同组内唯一，且所有引用的 id（sourceId、sourceIds、nodeIds、edgeIds、from、to、parent、branches）都必须指向真实存在的目标。',
      '4. sources：file 写相对工作区根目录的路径（用 / 分隔，不写绝对路径，不以 ./ 开头，不含 ..）；startLine 与 endLine 为从真实文件读到的 1 起始整数且 endLine >= startLine；不要写 anchorText（插件会自动从真实文件提取补全）。',
      '5. 层级与分支字段约定：node.parent 可选，指向顶层分组节点 id（最多允许 1 层 parent 分组，不可嵌套多层或成环）；edge.branch 可选，用于标注条件/异常分支；旁支步骤可设 aside: true 并在主线步骤的 branches 数组中引用其 id。',
    ],
    retryHead: '上一次输出的 JSON 没能通过格式校验：',
    retryTail: '请复用已读到的上下文修正格式问题，只输出修正后的完整 JSON 对象。',
    continue: '继续完成并只输出完整的 JSON 对象。',
  },
  en: {
    hints: 'Files currently open in the user editor (optional starting hints):',
    anchorLine: anchor => {
      const range = anchor.startLine
        ? (anchor.endLine && anchor.endLine > anchor.startLine ? `:${anchor.startLine}-${anchor.endLine}` : `:${anchor.startLine}`)
        : '';
      const symbol = anchor.symbol ? ` (symbol: ${anchor.symbol})` : '';
      return `Starting anchor: ${anchor.file}${range}${symbol}`;
    },
    intro: rootName => `You are Code Detective. The workspace is the current directory (${rootName}); freely use your search, file-reading, subagent, and analysis tools to explore the real source code.`,
    topic: topic => `Topic to explain: ${topic}`,
    explore: [
      'Locate and read the actual runtime implementation in the codebase (do not stop at static interfaces, types, or enum declarations), and organize the walkthrough steps and graph in whatever way best explains how the code works.',
      'Every file path and line number must come from real files you actually read — never guess.',
    ],
    finish: 'When finished, output the complete JSON object in your final message matching the schema below.',
    schema: {
      title: 'Guide title', description: 'Brief summary of what this flow does', note: 'Concise inline note on this code slice (optional)',
      label: 'Short node label', optional: 'Brief responsibility (optional)', edgeLabel: 'Relationship label (optional)', stepTitle: 'Step title', branch: 'Optional: branch condition',
      stepWhat: 'Clear explanation of what happens in this step', why: 'Optional: design rationale', watch: 'Optional: subtle pitfall or gotcha', skip: 'Optional: details safe to skip at first', stepExample: 'Optional: what happens to the example here',
      example: 'Optional: concrete scenario running through the guide', recap: 'Optional: overall summary', exercise: 'Optional: small verification exercise',
    },
    contractHead: [
      'Output format (JSON schema contract only):',
      '1. Output a single valid JSON object in your final message: no Markdown fences, no extra prose outside the JSON.',
      '2. schemaVersion must be 1; required top-level fields are schemaVersion, id, title, sources, nodes (min 1), edges, and walkthrough (min 1 non-aside step), with no unknown fields:',
    ],
    contractTail: [
      '3. IDs & references: map.id matches ^[a-z0-9][a-z0-9-]*$ (max 64 chars); source / node / edge / step ids match ^[A-Za-z0-9_.:-]+$, unique within each collection, and every referenced id (sourceId, sourceIds, nodeIds, edgeIds, from, to, parent, branches) must exist.',
      '4. sources: file must be a workspace-relative /-separated path (no absolute paths, no leading ./, no ..); startLine and endLine are 1-based integers from files you read with endLine >= startLine; omit anchorText (the extension fills it from the real file).',
      '5. Grouping & branches: optional node.parent references a top-level stage node id (at most 1 level of parent nesting, no cycles); optional edge.branch labels conditional/error branches; optional detour steps set aside: true and are referenced in another step\'s branches array.',
      '6. Write all titles, labels, descriptions, notes, branch labels and tour text in English.',
    ],
    retryHead: 'The previous JSON failed schema validation:',
    retryTail: 'Reuse what you have already read, fix the schema issues, and output only the complete JSON object.',
    continue: 'Continue and output only the complete JSON object.',
  },
};

function text(): PromptText {
  return TEXT[getLocale()];
}

export function explorePrompt(context: PromptContext): string {
  const p = text();
  const anchorBlock = context.anchor ? ['', p.anchorLine(context.anchor)] : [];
  const hints = context.priorityFiles.length > 0
    ? ['', p.hints, ...context.priorityFiles.slice(0, 12).map(file => `- ${file}`)]
    : [];
  return [
    p.intro(context.rootName),
    '',
    p.topic(context.topic),
    ...anchorBlock,
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
    `  "nodes": [{ "id": "fn-1", "label": "${s.label}", "description": "${s.optional}",`,
    '               "kind": "step|function|condition|event|exit", "parent": "<optionalStageNodeId>", "sourceIds": ["<sourceId>"] }],',
    `  "edges": [{ "id": "e1", "from": "fn-1", "to": "fn-2", "label": "${s.edgeLabel}",`,
    `              "kind": "call|flow|event|related", "branch": "${s.branch}", "sourceIds": ["<sourceId>"] }],`,
    `  "walkthrough": [{ "id": "w1", "title": "${s.stepTitle}", "description": "${s.stepWhat}",`,
    '                    "nodeIds": ["fn-1"], "edgeIds": ["e1"], "sourceId": "<sourceId>",',
    `                    "why": "${s.why}", "watch": "${s.watch}", "skip": "${s.skip}", "example": "${s.stepExample}",`,
    '                    "branches": ["w-aside"] },',
    '                  { "id": "w-aside", "title": "...", "aside": true, "nodeIds": ["..."], "edgeIds": [], "sourceId": "<sourceId>" }],',
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
