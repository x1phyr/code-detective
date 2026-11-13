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
    'zh-CN': '已生成地图《{title}》：{nodes} 个节点、{edges} 条连线、{steps} 个导读步骤。',
    en: 'Generated map "{title}": {nodes} nodes, {edges} edges, {steps} walkthrough steps.',
  },
  'chat.mapFile': { 'zh-CN': '文件：{path}', en: 'File: {path}' },
  'chat.mapKey': { 'zh-CN': 'mapKey：{key}', en: 'mapKey: {key}' },
  'chat.mapGenerated': { 'zh-CN': '已生成地图《{title}》：{path}', en: 'Generated map "{title}": {path}' },

  // 探索 / 整理提示词（发给模型）
  'chat.exploreRole': { 'zh-CN': '你是代码侦探的探索助手。工作区根目录：{root}。', en: 'You are the exploration assistant of Code Detective. Workspace root: {root}.' },
  'chat.exploreTopic': { 'zh-CN': '用户想了解的流程：{topic}', en: 'The flow the user wants to understand: {topic}' },
  'chat.exploreTrace': {
    'zh-CN': '先用工具阅读真实源码，按调用顺序追踪出完整链路：入口事件 → 处理函数 → 数据读写 → 界面刷新。',
    en: 'First use the tools to read the real source and trace the full chain in call order: entry event → handler → data read/write → UI refresh.',
  },
  'chat.exploreTools': {
    'zh-CN': '可用工具：{search}（按关键字搜索）、{read}（读取文件指定行）。',
    en: 'Available tools: {search} (keyword search), {read} (read specific lines of a file).',
  },
  'chat.exploreEvidence': {
    'zh-CN': '只看有源码依据的调用关系，不要推测；行号必须来自你实际读到的内容。',
    en: 'Only report call relationships backed by source; do not guess. Line numbers must come from what you actually read.',
  },
  'chat.exploreRounds': {
    'zh-CN': '最多探索 6 轮，读够上下文后就停止调用工具，用两三句话总结这条链路。',
    en: 'Explore for at most 6 rounds; once you have enough context, stop calling tools and summarize the chain in two or three sentences.',
  },
  'chat.planIntro': { 'zh-CN': '现在把刚才的探索结果整理成代码地图草稿，调用工具提交。', en: 'Now turn the exploration results into a code map draft and submit it by calling the tool.' },
  'chat.planRequirements': { 'zh-CN': '要求：', en: 'Requirements:' },
  'chat.planRule1': {
    'zh-CN': '1. 每个 node / edge 都必须引用真实的 sourceIds；sources 只给 file、startLine、endLine，不要写 anchorText。',
    en: '1. Every node / edge must reference real sourceIds; sources only provide file, startLine and endLine, without anchorText.',
  },
  'chat.planRule2': { 'zh-CN': '2. 行号必须来自你实际读到的内容，endLine >= startLine。', en: '2. Line numbers must come from what you actually read, with endLine >= startLine.' },
  'chat.planRule3': {
    'zh-CN': '3. 按执行顺序给 walkthrough，每个步骤包含一个节点及其进出连线。',
    en: '3. Order the walkthrough by execution; each step contains one node and its incoming and outgoing edges.',
  },
  'chat.planRule4': { 'zh-CN': '4. 只写有源码依据的节点与连线，不要编造。', en: '4. Only include nodes and edges backed by source; do not invent anything.' },
  'chat.planRule6': {
    'zh-CN': '6. walkthrough 写成带人读代码的导读：主线 5–10 步，每步用 sourceId 只指向一段代码，可写 why / watch / skip / example；支线步骤写 aside: true，并在出发步骤的 branches 里列出；tour 里写贯穿例子 example、总结 recap、练习 exercise。',
    en: '6. Write walkthrough as a guided reading: a main line of 5-10 steps, each pointing to one piece of code via sourceId, optionally with why / watch / skip / example; aside steps set aside: true and are listed in branches of the step they start from; tour holds the running example, recap and exercise.',
  },
  'chat.planRule5': {
    'zh-CN': '5. 流程复杂时分层：顶层 3–8 个功能块，内部步骤用 parent 指向所属功能块；正常路径的边不写 branch，异常 / 提前返回 / 重试等分支的边写 branch（分支条件），分叉点 kind 用 condition，提前结束用 exit。',
    en: '5. For complex flows use layers: 3–8 feature blocks at the top, inner steps set parent to their block. Main-path edges have no branch; edges for errors / early returns / retries set branch (the condition). Use kind condition at decision points and exit for early termination.',
  },

  // 工具描述 / justification
  'chat.toolSearchDesc': {
    'zh-CN': '在工作区源码中按关键字或正则搜索，返回 file、line 与整行文本。',
    en: 'Search workspace sources by keyword or regex, returning file, line and the full line text.',
  },
  'chat.toolReadDesc': { 'zh-CN': '读取工作区文件的指定行范围，输出带行号的文本。', en: 'Read a line range of a workspace file, returning line-numbered text.' },
  'chat.toolCreateMapDesc': {
    'zh-CN': '校验并保存代码地图草稿；插件会按真实文件补全 anchorText 并打开地图。',
    en: 'Validate and save a code map draft; the extension fills in anchorText from the real files and opens the map.',
  },
  'chat.justifyExplore': { 'zh-CN': '读取工作区源码以追踪调用链', en: 'Read workspace sources to trace the call chain' },
  'chat.justifyPlan': { 'zh-CN': '整理代码地图草稿', en: 'Build the code map draft' },

  // 进度 / 流式输出
  'chat.progressReading': { 'zh-CN': '阅读源码：{labels}', en: 'Reading source: {labels}' },
  'chat.listSeparator': { 'zh-CN': '、', en: ', ' },
  'chat.toolFailed': { 'zh-CN': '工具执行失败：{error}', en: 'Tool failed: {error}' },
  'chat.progressPlanning': { 'zh-CN': '整理结构化流程', en: 'Structuring the flow' },
  'chat.noStructuredDraft': { 'zh-CN': '模型没有返回结构化的地图草稿。', en: 'The model did not return a structured map draft.' },
  'chat.draftNotJson': { 'zh-CN': '模型返回的草稿不是合法 JSON。', en: 'The draft returned by the model is not valid JSON.' },
  'chat.openMapButton': { 'zh-CN': '打开代码地图', en: 'Open Code Map' },
  'chat.startTourHint': {
    'zh-CN': '也可以直接执行 `代码侦探: 开始导读` 按顺序阅读。',
    en: 'You can also run `Code Detective: Start Walkthrough` to read it step by step.',
  },
  'chat.noWorkspaceAnalyze': { 'zh-CN': '请先打开一个工作区文件夹，再让我分析调用流程。', en: 'Open a workspace folder first, then ask me to analyze a call flow.' },
  'chat.defaultTopic': { 'zh-CN': '当前打开文件的主要调用流程', en: 'The main call flow of the currently open file' },
  'chat.noSourcesRead': {
    'zh-CN': '> 本次没有读取任何源码，行号可能不准确，请打开地图后核对。\n\n',
    en: '> No source was read this time, so line numbers may be inaccurate; please verify after opening the map.\n\n',
  },
  'chat.unknownReason': { 'zh-CN': '未知原因', en: 'unknown reason' },
  'chat.planFailed': {
    'zh-CN': '没能生成地图：{error}\n\n可以补充更具体的话题，或用 `代码侦探: 用 AI 生成地图` 指定 AI 服务。',
    en: 'Could not generate a map: {error}\n\nTry a more specific topic, or use `Code Detective: Generate Map with AI` to pick an AI provider.',
  },
  'chat.cancelled': { 'zh-CN': '已取消。', en: 'Cancelled.' },
  'chat.generateFailed': { 'zh-CN': '生成失败：{error}\n\n', en: 'Generation failed: {error}\n\n' },
  'chat.keptLastMap': {
    'zh-CN': '已保留上次有效地图。可执行 `代码侦探: 用 AI 生成地图` 改用本地模型服务重试。',
    en: 'The last valid map was kept. Run `Code Detective: Generate Map with AI` to retry with a local model service.',
  },

  // 工具调用
  'chat.readInvocation': { 'zh-CN': '读取 {file}', en: 'Reading {file}' },
  'chat.readInvocationFrom': { 'zh-CN': '读取 {file} 第 {line} 行起', en: 'Reading {file} from line {line}' },
  'chat.noWorkspace': { 'zh-CN': '请先打开一个工作区文件夹。', en: 'Open a workspace folder first.' },
  'chat.readResultHeader': {
    'zh-CN': '{file}（第 {start}–{end} 行，共 {total} 行）',
    en: '{file} (lines {start}–{end} of {total})',
  },
  'chat.searchInvocation': { 'zh-CN': '搜索 {query}', en: 'Searching {query}' },
  'chat.noMatches': {
    'zh-CN': '没有匹配。可以换关键字，或先用更宽泛的搜索定位文件。',
    en: 'No matches. Try different keywords, or run a broader search first to locate the file.',
  },
  'chat.defaultMapTitle': { 'zh-CN': '代码地图', en: 'Code Map' },
  'chat.writeMapInvocation': { 'zh-CN': '写入地图《{title}》', en: 'Writing map "{title}"' },
  'chat.writeMapConfirmTitle': { 'zh-CN': '写入代码地图', en: 'Write Code Map' },
  'chat.writeMapConfirmMessage': {
    'zh-CN': '将在 `{dir}/` 下新建地图《{title}》，并按真实文件补全源码锚点。',
    en: 'A new map "{title}" will be created under `{dir}/`, with source anchors filled in from the real files.',
  },

  // 参与者命令
  'chat.openedMapKey': { 'zh-CN': '已打开地图 `{key}`。', en: 'Opened map `{key}`.' },
  'chat.openedMap': { 'zh-CN': '已打开代码地图。', en: 'Opened the code map.' },
  'chat.advancedStep': { 'zh-CN': '已前进到导读的下一步。', en: 'Moved to the next walkthrough step.' },
  'chat.help': {
    'zh-CN': '**代码侦探**\n\n- `/map <话题>`：先读源码追踪调用链，再生成并打开代码地图。\n- `/open [mapKey]`：打开已有地图。\n- `/next`：导读下一步。\n\nAgent 模式下也可以直接使用 `#codeDetectiveCreateMap` 等工具。',
    en: '**Code Detective**\n\n- `/map <topic>`: read source to trace the call chain, then generate and open a code map.\n- `/open [mapKey]`: open an existing map.\n- `/next`: next walkthrough step.\n\nIn Agent mode you can also use tools such as `#codeDetectiveCreateMap` directly.',
  },
  'chat.followupNextPrompt': { 'zh-CN': '下一步', en: 'Next step' },
  'chat.followupNextLabel': { 'zh-CN': '继续导读', en: 'Continue walkthrough' },
  'chat.followupOpenPrompt': { 'zh-CN': '打开刚生成的地图', en: 'Open the map just generated' },
  'chat.followupOpenLabel': { 'zh-CN': '打开地图', en: 'Open map' },
} satisfies Record<`chat.${string}`, Message>;
