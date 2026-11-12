export const MAX_TOTAL_CHARS = 120_000;

export interface PromptFile {
  path: string;
  content: string;
}

export interface PromptContext {
  rootName: string;
  topic: string;
  files: PromptFile[];
}

export function systemPrompt(): string {
  return [
    '你是一名代码侦探。你的唯一任务是输出一张描述源码位置与阅读顺序的 JSON 代码地图。',
    '',
    '硬性要求：',
    '1. 只输出 JSON 对象本身，不要 Markdown 围栏、不要解释、不要前后缀文字。',
    '2. schemaVersion 必须为 1；字段名严格遵循给定的 JSON Schema，不要添加未知字段。',
    '3. map.id 使用 ^[a-z0-9][a-z0-9-]*$；node / edge / step / source 的 id 使用 ^[A-Za-z0-9_.:-]+$。',
    '4. 每个 source 必须给出相对工作区的 file（用 / 分隔）、startLine 与 endLine，且 endLine >= startLine。',
    '5. 提供 anchorText 时，必须逐字复制 startLine..endLine 的全部完整行，行数恰好等于 endLine - startLine + 1。',
    '6. 只写有源码依据的节点与连线；不要推测调用关系。无法确认的内容宁可不写。',
    '7. 行号必须来自你实际看到的文件内容，不要虚构，也不要用 1 作为占位。',
    '',
    '输出必须可直接通过 JSON Schema 校验。',
  ].join('\n');
}

export function schemaSummary(): string {
  return [
    '{',
    '  "schemaVersion": 1,',
    '  "id": "kebab-case-id",',
    '  "title": "地图标题",',
    '  "description": "可选说明",',
    '  "sources": { "<sourceId>": { "file": "src/a.ts", "startLine": 1, "endLine": 3, "anchorText": "第1行\\n第2行\\n第3行" } },',
    '  "nodes": [{ "id": "step-1", "label": "短标签", "description": "可选", "kind": "step|function|condition|event", "sourceIds": ["<sourceId>"] }],',
    '  "edges": [{ "id": "e1", "from": "step-1", "to": "step-2", "label": "调用", "kind": "call|flow|event|related", "sourceIds": ["<sourceId>"] }],',
    '  "walkthrough": [{ "id": "w1", "title": "第一步", "description": "可选", "nodeIds": ["step-1"], "edgeIds": ["e1"] }]',
    '}',
  ].join('\n');
}

export function withLineNumbers(text: string): string {
  return text.split('\n').map((line, index) => `${index + 1}\t${line}`).join('\n');
}

export function buildUserPrompt(context: PromptContext): string {
  let budget = MAX_TOTAL_CHARS;
  const sections: string[] = [];
  for (const file of context.files) {
    if (budget <= 0) break;
    const content = withLineNumbers(file.content).slice(0, Math.max(0, budget));
    if (content.length === 0) break;
    budget -= content.length;
    sections.push(`--- FILE: ${file.path} ---\n${content}`);
  }
  return [
    `工作区根目录：${context.rootName}`,
    `用户想了解的话题：${context.topic}`,
    '',
    '必须满足的 JSON 结构（字段含义以描述为准）：',
    schemaSummary(),
    '',
    '下面是你可以引用的源码；行号就是文件开头的数字，anchorText 必须逐字复制这些行（不含行号前缀）。',
    '',
    sections.join('\n\n'),
  ].join('\n');
}

export function failureHint(message: string): string {
  return [
    '上一次输出没有通过校验。',
    `错误：${message}`,
    '请修正后重新输出完整 JSON 对象，只输出 JSON。',
    '特别注意：anchorText 的行数必须等于 endLine - startLine + 1，且必须逐字匹配文件内容。',
  ].join('\n');
}
