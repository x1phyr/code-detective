/**
 * Prompts for a local coding agent.
 *
 * The agent already sits in the workspace with its own read tools, so the plugin
 * never inlines source text: it only states the goal and the output contract.
 */

export interface PromptContext {
  rootName: string;
  topic: string;
  /** Files the user is looking at, as a hint for where to start. */
  priorityFiles: string[];
  /** Adjustments from the previous turn, fed back so the agent can correct itself. */
  previousIssues?: string[];
}

export function explorePrompt(context: PromptContext): string {
  const hints = context.priorityFiles.length > 0
    ? ['', '用户当前正在看这些文件，可以优先从它们入手：', ...context.priorityFiles.slice(0, 12).map(file => `- ${file}`)]
    : [];
  return [
    `你是代码侦探。工作区就是当前目录（${context.rootName}），请直接用你的读文件 / 搜索工具阅读真实源码。`,
    '',
    `要追踪的流程：${context.topic}`,
    '',
    '请按执行顺序梳理出完整链路：入口事件 → 处理函数 → 数据读写 → 界面刷新或返回。',
    '只写有源码依据的调用关系，不要推测；行号必须来自你实际读到的内容。',
    ...hints,
    '',
    '读够上下文后，把结论整理成下面要求的 JSON，作为最后一条消息输出。',
  ].join('\n');
}

const SCHEMA = [
  '{',
  '  "schemaVersion": 1,',
  '  "id": "kebab-case-id",',
  '  "title": "地图标题",',
  '  "description": "可选说明",',
  '  "sources": { "<sourceId>": { "file": "src/a.ts", "startLine": 1, "endLine": 3 } },',
  '  "nodes": [{ "id": "step-1", "label": "短标签", "description": "可选",',
  '               "kind": "step|function|condition|event", "sourceIds": ["<sourceId>"] }],',
  '  "edges": [{ "id": "e1", "from": "step-1", "to": "step-2", "label": "调用",',
  '              "kind": "call|flow|event|related", "sourceIds": ["<sourceId>"] }],',
  '  "walkthrough": [{ "id": "w1", "title": "第一步", "description": "可选",',
  '                    "nodeIds": ["step-1"], "edgeIds": ["e1"] }]',
  '}',
].join('\n');

export const OUTPUT_CONTRACT = [
  '输出格式（硬性要求）：',
  '1. 在最后一条消息里只输出一个 JSON 对象，不要 Markdown 围栏，不要额外解释。',
  '2. schemaVersion 必须为 1，字段名严格如下，不要添加未知字段：',
  '',
  SCHEMA,
  '',
  '3. map.id 匹配 ^[a-z0-9][a-z0-9-]*$；node / edge / step / source 的 id 匹配 ^[A-Za-z0-9_.:-]+$。',
  '4. 每个 source 必须给出相对工作区的 file（用 / 分隔）、startLine、endLine，且 endLine >= startLine。',
  '5. 不要写 anchorText：插件会按真实文件重新生成。',
  '6. 只写有源码依据的节点与连线，宁缺勿滥。',
].join('\n');

export function retryPrompt(issues: readonly string[]): string {
  return [
    '上一次的 JSON 没能通过校验。',
    '',
    ...issues.slice(-5).map(issue => `- ${issue}`),
    '',
    '请复用你已经读到的内容，输出修正后的完整 JSON 对象。仍然只输出 JSON。',
  ].join('\n');
}

export function continuePrompt(): string {
  return '继续：在上一轮基础上补齐或修正地图，最后只输出完整的 JSON 对象。';
}
