import type { Message } from '../index';

/** chat 区域的文案。key 统一以 `chat.` 开头。 */
export const chat = {
  // 工具参数 schema 描述（提供给模型）
  'chat.schemaQuery': { 'zh-CN': '要在工作区源码中查找的文本（默认按子串匹配）', en: 'Text to find in workspace sources (substring match by default)' },
  'chat.schemaRegex': { 'zh-CN': '是否把 query 当作正则表达式', en: 'Whether to treat query as a regular expression' },
  'chat.schemaCaseSensitive': { 'zh-CN': '是否区分大小写，默认不区分', en: 'Whether matching is case-sensitive; defaults to case-insensitive' },
  'chat.schemaGlob': { 'zh-CN': '可选的额外文件过滤，例如 src/**/*.ts', en: 'Optional extra file filter, e.g. src/**/*.ts' },
  'chat.schemaMaxResults': { 'zh-CN': '最多返回多少条匹配，默认 20', en: 'Maximum number of matches to return; defaults to 20' },
  'chat.schemaFile': { 'zh-CN': '工作区相对路径，使用 / 分隔', en: 'Workspace-relative path, separated by /' },
  'chat.schemaStartLine': { 'zh-CN': '起始行，默认 1', en: 'Start line; defaults to 1' },
  'chat.schemaEndLine': { 'zh-CN': '结束行（含），默认 startLine + 199', en: 'End line (inclusive); defaults to startLine + 199' },

  // searchSources 错误
  'chat.queryEmpty': { 'zh-CN': 'query 不能为空。', en: 'query must not be empty.' },
  'chat.queryTooLong': { 'zh-CN': 'query 不能超过 {max} 个字符。', en: 'query must not exceed {max} characters.' },
  'chat.regexUnsafe': {
    'zh-CN': '正则含有嵌套量词或反向引用，可能导致回溯爆炸；请改用更简单的表达式或普通文本搜索。',
    en: 'The regex contains nested quantifiers or backreferences and may cause catastrophic backtracking; use a simpler expression or a plain-text search.',
  },
  'chat.regexInvalid': { 'zh-CN': '正则无效：{error}', en: 'Invalid regex: {error}' },

  // 地图生成结果
  'chat.mapSummary': {
    'zh-CN': '已生成带读讲义《{title}》：{steps} 个带读步骤、{nodes} 个脉络节点、{edges} 条连线。',
    en: 'Generated guide "{title}": {steps} walkthrough steps, {nodes} nodes, {edges} edges.',
  },
  'chat.mapFile': { 'zh-CN': '文件：{path}', en: 'File: {path}' },
  'chat.mapKey': { 'zh-CN': 'mapKey：{key}', en: 'mapKey: {key}' },
  'chat.mapGenerated': { 'zh-CN': '已生成带读讲义《{title}》：{path}', en: 'Generated guide "{title}": {path}' },

  // 探索 / 整理提示词（发给模型）
  'chat.exploreRole': { 'zh-CN': '你是代码侦探。工作区根目录：{root}。', en: 'You are Code Detective. Workspace root: {root}.' },
  'chat.exploreTopic': { 'zh-CN': '用户想读懂的主题：{topic}', en: 'Topic the user wants to understand: {topic}' },
  'chat.exploreTrace': {
    'zh-CN': '请自由使用工具深入阅读真实的业务实现代码（不要只停留在接口、类型或枚举声明上），理清代码的实际运行机制。',
    en: 'Freely use the tools to locate and read the real runtime implementation (do not stop at interface, type, or enum declarations) and understand how the code actually works.',
  },
  'chat.exploreTools': {
    'zh-CN': '可用工具：{search}（全文关键字/正则搜索）、{read}（读取文件行范围）。',
    en: 'Available tools: {search} (full-workspace keyword/regex search), {read} (read lines of a file).',
  },
  'chat.exploreEvidence': {
    'zh-CN': '所有文件路径和行号必须来自你实际读到的真实源码，不要猜测。',
    en: 'All file paths and line numbers must come from real source files you actually read; never guess.',
  },
  'chat.exploreRounds': {
    'zh-CN': '读够上下文后停止调用工具，使用与用户主题相同的语言简要总结你梳理出的核心机制。',
    en: 'Once you have enough context, stop calling tools and briefly summarize what you found in the same language as the user\'s topic.',
  },
  'chat.planIntro': {
    'zh-CN': '现在把刚才的探索结果整理成带读讲义与脉络图 JSON（所有文案语言与用户发起的主题保持一致），按下面的输出格式直接输出一个合法 JSON 对象。',
    en: 'Now turn your exploration results into a guided walkthrough and call-graph JSON object matching the schema below, keeping all text in the same language as the user\'s topic.',
  },

  // 工具描述 / justification
  'chat.toolSearchDesc': {
    'zh-CN': '在工作区源码中按关键字或正则搜索，返回 file、line 与整行文本。',
    en: 'Search workspace sources by keyword or regex, returning file, line and the full line text.',
  },
  'chat.toolReadDesc': { 'zh-CN': '读取工作区文件的指定行范围，输出带行号的文本。', en: 'Read a line range of a workspace file, returning line-numbered text.' },
  'chat.toolCreateMapDesc': {
    'zh-CN': '校验并保存带读讲义与代码脉络图草稿；插件会按真实文件补全 anchorText 并自动打开讲义。',
    en: 'Validate and save a code guide and call-graph draft; the extension fills in anchorText from the real files and opens the guide.',
  },
  'chat.justifyExplore': { 'zh-CN': '读取工作区源码以追踪调用链', en: 'Read workspace sources to trace the call chain' },
  'chat.justifyPlan': { 'zh-CN': '整理带读讲义与代码脉络图', en: 'Build the guided walkthrough and call graph' },

  // 进度 / 流式输出
  'chat.progressReading': { 'zh-CN': '阅读源码：{labels}', en: 'Reading source: {labels}' },
  'chat.listSeparator': { 'zh-CN': '、', en: ', ' },
  'chat.toolFailed': { 'zh-CN': '工具执行失败：{error}', en: 'Tool failed: {error}' },
  'chat.progressPlanning': { 'zh-CN': '整理带读讲义与调用脉络', en: 'Structuring walkthrough and call graph' },
  'chat.noStructuredDraft': { 'zh-CN': '模型没有返回结构化的讲义草稿。', en: 'The model did not return a structured guide draft.' },
  'chat.draftNotJson': { 'zh-CN': '模型返回的草稿不是合法 JSON。', en: 'The draft returned by the model is not valid JSON.' },
  'chat.openMapButton': { 'zh-CN': '打开带读讲义', en: 'Open Code Guide' },
  'chat.startTourHint': {
    'zh-CN': '已在侧边栏打开带读讲义，可逐步跟读并随时提问。',
    en: 'Opened the guide in the sidebar; step through it and ask questions anytime.',
  },
  'chat.noWorkspaceAnalyze': { 'zh-CN': '请先打开一个工作区文件夹，再让我分析调用流程。', en: 'Open a workspace folder first, then ask me to analyze a call flow.' },
  'chat.defaultTopic': { 'zh-CN': '当前打开文件的主要调用流程', en: 'The main call flow of the currently open file' },
  'chat.noSourcesRead': {
    'zh-CN': '> 本次没有读取任何源码，行号可能不准确，请打开讲义后核对。\n\n',
    en: '> No source was read this time, so line numbers may be inaccurate; please verify after opening the guide.\n\n',
  },
  'chat.unknownReason': { 'zh-CN': '未知原因', en: 'unknown reason' },
  'chat.planFailed': {
    'zh-CN': '没能生成带读讲义：{error}\n\n可以补充更具体的话题，或在侧边栏切换 AI 引擎重试。',
    en: 'Could not generate a guide: {error}\n\nTry a more specific topic, or switch the AI engine in the sidebar.',
  },
  'chat.cancelled': { 'zh-CN': '已取消。', en: 'Cancelled.' },
  'chat.generateFailed': { 'zh-CN': '生成失败：{error}\n\n', en: 'Generation failed: {error}\n\n' },
  'chat.keptLastMap': {
    'zh-CN': '已保留上次有效讲义。可在代码侦探侧边栏切换其他 AI 引擎重试。',
    en: 'The last valid guide was kept. Switch to another AI engine in the Code Detective sidebar to retry.',
  },

  // 工具调用
  'chat.readInvocation': { 'zh-CN': '读取 {file}', en: 'Reading {file}' },
  'chat.readInvocationFrom': { 'zh-CN': '读取 {file} 第 {line} 行起', en: 'Reading {file} from line {line}' },
  'chat.noWorkspace': { 'zh-CN': '请先打开一个工作区文件夹。', en: 'Open a workspace folder first.' },
  'chat.readResultHeader': {
    'zh-CN': '{file}（第 {start}–{end} 行，共 {total} 行）',
    en: '{file} (lines {start}-{end} of {total})',
  },
  'chat.searchInvocation': { 'zh-CN': '搜索 {query}', en: 'Searching {query}' },
  'chat.noMatches': {
    'zh-CN': '没有匹配。可以换关键字，或先用更宽泛的搜索定位文件。',
    en: 'No matches. Try different keywords, or run a broader search first to locate the file.',
  },
  'chat.defaultMapTitle': { 'zh-CN': '带读讲义', en: 'Code Guide' },
  'chat.writeMapInvocation': { 'zh-CN': '保存讲义《{title}》', en: 'Saving guide "{title}"' },
  'chat.writeMapConfirmTitle': { 'zh-CN': '保存带读讲义', en: 'Save Code Guide' },
  'chat.writeMapConfirmMessage': {
    'zh-CN': '将在 `{dir}/` 下新建讲义《{title}》，并按真实文件补全源码锚点。',
    en: 'A new guide "{title}" will be created under `{dir}/`, with source anchors filled in from the real files.',
  },

  // 参与者命令
  'chat.openedMapKey': { 'zh-CN': '已打开讲义 `{key}`。', en: 'Opened guide `{key}`.' },
  'chat.openedMap': { 'zh-CN': '已打开带读讲义。', en: 'Opened the code guide.' },
  'chat.advancedStep': { 'zh-CN': '已前进到下一步。', en: 'Moved to the next walkthrough step.' },
  'chat.help': {
    'zh-CN': '**代码侦探**\n\n- `/map <话题>`：先读源码追踪调用链，再生成带读讲义与脉络图。\n- `/open [mapKey]`：打开已有讲义。\n- `/next`：带读下一步。\n\nAgent 模式下也可以直接使用 `#codeDetectiveCreateMap` 等工具。',
    en: '**Code Detective**\n\n- `/map <topic>`: read source to trace the call chain, then generate and open a guided walkthrough.\n- `/open [mapKey]`: open an existing guide.\n- `/next`: next walkthrough step.\n\nIn Agent mode you can also use tools such as `#codeDetectiveCreateMap` directly.',
  },
  'chat.followupNextPrompt': { 'zh-CN': '下一步', en: 'Next step' },
  'chat.followupNextLabel': { 'zh-CN': '继续带读', en: 'Next step' },
  'chat.followupOpenPrompt': { 'zh-CN': '打开刚生成的讲义', en: 'Open the guide just generated' },
  'chat.followupOpenLabel': { 'zh-CN': '打开讲义', en: 'Open guide' },
} satisfies Record<`chat.${string}`, Message>;
