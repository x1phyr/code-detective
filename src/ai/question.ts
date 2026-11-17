/**
 * 带读中的随时提问：把“当前在看哪一步、哪段代码、选中的代码片段、贯穿例子是什么”一起交给 agent，
 * 让它像坐在身旁的资深同事一样即时答疑。
 */
import type { CodeMap, EditorSelectionSlice, SourceRef, WalkthroughStep } from '../../shared/types';
import { detectPromptLocale } from '../../shared/i18n';

export interface QuestionContext {
  map: CodeMap;
  step: WalkthroughStep;
  source?: SourceRef;
  /** 用户在编辑器中额外框选的代码片段。 */
  selection?: EditorSelectionSlice;
  /** 主线上的位置，例如 3 / 7。 */
  index: number;
  total: number;
  /** 之前在这一步里的问答，用于追问。 */
  history: { question: string; answer: string }[];
  question: string;
}

const TEXT = {
  'zh-CN': {
    role: '你是坐在用户旁边、手把手带他读代码的资深同事。用户正在阅读下面这一步，并就代码提了一个问题。',
    map: (title: string) => `带读讲义：${title}`,
    example: (value: string) => `贯穿例子：${value}`,
    step: (index: number, total: number, title: string) => `当前步骤（${index}/${total}）：${title}`,
    description: (value: string) => `这一步讲的是：${value}`,
    code: (file: string, start: number, end: number) => `当前步骤对应的代码：${file} 第 ${start}–${end} 行（请用读文件工具查看上下文）`,
    selection: (file: string, start: number, end: number, symbol?: string) =>
      `用户刚刚在编辑器里框选了这段代码（${file}:${start}-${end}${symbol ? ` · ${symbol}` : ''}）：`,
    history: '这一步之前的追问：',
    question: (value: string) => `用户的问题：${value}`,
    rules: [
      '回答要求：',
      '- 先开门见山回答问题，再补充必要上下文；控制在 3–8 句话，像同事口头点拨一样清晰好懂，别写成冗长文档。',
      '- 提到具体源码位置时，务必写成反引号包裹的 `路径/文件.ts:行号` 或 `路径/文件.ts:起始行-结束行`（UI 会自动渲染成可点击跳转按钮），且只引用你实际读到的真实行号。',
      '- 如果问题和贯穿例子有关，顺着这个例子演示具体数据怎么走。',
      '- 如果后面的主线步骤会展开细讲，先简要回答并提示“后面第 N 步会细看”。',
      '- 输出精炼的 Markdown，不要输出 JSON。请使用与「用户的问题」相同的语言作答（若问题仅包含代码标识符或文件路径，则使用当前讲义的语言；无法判断时跟随界面语言）。',
    ],
  },
  en: {
    role: 'You are a senior colleague sitting next to the user, walking them through the code step by step. The user is reading the step below and asked a question.',
    map: (title: string) => `Guide: ${title}`,
    example: (value: string) => `Running example: ${value}`,
    step: (index: number, total: number, title: string) => `Current step (${index}/${total}): ${title}`,
    description: (value: string) => `What this step covers: ${value}`,
    code: (file: string, start: number, end: number) => `Step code location: ${file} lines ${start}-${end} (open it and surrounding context with your file tools)`,
    selection: (file: string, start: number, end: number, symbol?: string) =>
      `Code currently selected by the user in the editor (${file}:${start}-${end}${symbol ? ` · ${symbol}` : ''}):`,
    history: 'Earlier follow-up questions on this step:',
    question: (value: string) => `User question: ${value}`,
    rules: [
      'How to answer:',
      '- Answer directly first, then add only essential context; keep it concise (3-8 sentences), like a helpful teammate.',
      '- Format every code reference in backticks as `path/file.ts:line` or `path/file.ts:start-end` (the UI turns these into clickable jump links), and cite only lines you actually read.',
      '- Connect your explanation to the running example whenever helpful.',
      '- If a later step covers the topic in depth, answer briefly and mention "step N covers this in detail".',
      '- Reply in concise Markdown, not JSON. Reply in the same language as the user\'s question (if the question contains only code identifiers or file paths, use the guide\'s language, falling back to the UI language).',
    ],
  },
} as const;

export function questionPrompt(context: QuestionContext): string {
  const p = TEXT[detectPromptLocale(context.question, detectPromptLocale(context.map.title))];
  const lines: string[] = [p.role, '', p.map(context.map.title)];
  if (context.map.tour?.example) lines.push(p.example(context.map.tour.example));
  lines.push(p.step(context.index, context.total, context.step.title));
  if (context.step.description) lines.push(p.description(context.step.description));
  if (context.source) lines.push(p.code(context.source.file, context.source.startLine, context.source.endLine));
  if (context.selection) {
    lines.push(
      '',
      p.selection(context.selection.file, context.selection.startLine, context.selection.endLine, context.selection.symbol),
      '```',
      context.selection.preview,
      '```',
    );
  }
  const outline = (context.map.walkthrough ?? []).filter(step => !step.aside).map((step, index) => `${index + 1}. ${step.title}`);
  if (outline.length) lines.push('', ...outline);
  if (context.history.length) {
    lines.push('', p.history);
    for (const item of context.history.slice(-4)) lines.push(`Q: ${item.question}`, `A: ${item.answer}`);
  }
  lines.push('', p.question(context.question), '', ...p.rules);
  return lines.join('\n');
}
