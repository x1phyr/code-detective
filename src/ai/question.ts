/**
 * 导读中的提问：把“当前在看哪一步、哪段代码、贯穿例子是什么”一起交给本机 agent，
 * 让它像坐在旁边的人一样回答，而不是从零开始解释。
 *
 * agent 在工作区里有自己的只读工具；这里只给位置，不内联源码文本。
 */
import type { CodeMap, SourceRef, WalkthroughStep } from '../../shared/types';
import { getLocale } from '../../shared/i18n';

export interface QuestionContext {
  map: CodeMap;
  step: WalkthroughStep;
  source?: SourceRef;
  /** 主线上的位置，例如 3 / 7。 */
  index: number;
  total: number;
  /** 之前在这一步里的问答，用于追问。 */
  history: { question: string; answer: string }[];
  question: string;
}

const TEXT = {
  'zh-CN': {
    role: '你是坐在用户旁边、带他一步一步读代码的同事。用户正在看下面这一步，并就这一步提了一个问题。',
    map: (title: string) => `地图：${title}`,
    example: (value: string) => `贯穿例子：${value}`,
    step: (index: number, total: number, title: string) => `当前步骤（${index}/${total}）：${title}`,
    description: (value: string) => `这一步讲的是：${value}`,
    code: (file: string, start: number, end: number) => `正在看的代码：${file} 第 ${start}–${end} 行（请用你的读文件工具打开它和需要的上下文）`,
    history: '这一步里之前的问答：',
    question: (value: string) => `用户的问题：${value}`,
    rules: [
      '回答要求：',
      '- 先直接回答问题，再补充必要的上下文；一般 3–8 句话，别写成文档。',
      '- 引用代码时写成 `文件:行号`，只引用你实际读到的内容，不确定就说不确定。',
      '- 如果问题和贯穿例子有关，用这个例子来解释具体会发生什么。',
      '- 用户问到的内容如果在后面的步骤里会讲，可以简单回答并告诉他“后面第 N 步会细看”。',
      '- 输出 Markdown，不要输出 JSON。',
    ],
  },
  en: {
    role: 'You are a colleague sitting next to the user, walking them through the code step by step. The user is on the step below and asked a question about it.',
    map: (title: string) => `Map: ${title}`,
    example: (value: string) => `Running example: ${value}`,
    step: (index: number, total: number, title: string) => `Current step (${index}/${total}): ${title}`,
    description: (value: string) => `What this step covers: ${value}`,
    code: (file: string, start: number, end: number) => `Code being read: ${file} lines ${start}–${end} (open it and any context you need with your file tools)`,
    history: 'Earlier questions on this step:',
    question: (value: string) => `The user's question: ${value}`,
    rules: [
      'How to answer:',
      '- Answer the question directly first, then add only the context needed; usually 3–8 sentences, not a document.',
      '- Cite code as `file:line`, only cite what you actually read, and say so when unsure.',
      '- If the question relates to the running example, use it to explain what concretely happens.',
      '- If a later step covers the topic, answer briefly and say "step N looks at this in detail".',
      '- Reply in Markdown, not JSON. Write in English.',
    ],
  },
} as const;

export function questionPrompt(context: QuestionContext): string {
  const p = TEXT[getLocale()];
  const lines: string[] = [p.role, '', p.map(context.map.title)];
  if (context.map.tour?.example) lines.push(p.example(context.map.tour.example));
  lines.push(p.step(context.index, context.total, context.step.title));
  if (context.step.description) lines.push(p.description(context.step.description));
  if (context.source) lines.push(p.code(context.source.file, context.source.startLine, context.source.endLine));
  const outline = (context.map.walkthrough ?? []).filter(step => !step.aside).map((step, index) => `${index + 1}. ${step.title}`);
  if (outline.length) lines.push('', ...outline);
  if (context.history.length) {
    lines.push('', p.history);
    for (const item of context.history.slice(-4)) lines.push(`Q: ${item.question}`, `A: ${item.answer}`);
  }
  lines.push('', p.question(context.question), '', ...p.rules);
  return lines.join('\n');
}
