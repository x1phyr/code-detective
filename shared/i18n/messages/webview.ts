import type { Message } from '../index';

/** webview 区域的文案。key 统一以 `webview.` 开头。 */
export const webview = {
  // 节点 / 连线类型
  'webview.nodeKindStep': { 'zh-CN': '步骤', en: 'Step' },
  'webview.nodeKindFunction': { 'zh-CN': '函数', en: 'Function' },
  'webview.nodeKindCondition': { 'zh-CN': '条件', en: 'Condition' },
  'webview.nodeKindEvent': { 'zh-CN': '事件', en: 'Event' },
  'webview.nodeKindDefault': { 'zh-CN': '节点', en: 'Node' },
  'webview.edgeKindCall': { 'zh-CN': '调用', en: 'Call' },
  'webview.edgeKindFlow': { 'zh-CN': '流程', en: 'Flow' },
  'webview.edgeKindEvent': { 'zh-CN': '事件', en: 'Event' },
  'webview.edgeKindRelated': { 'zh-CN': '相关', en: 'Related' },

  // 详情面板
  'webview.detailKindNode': { 'zh-CN': '节点', en: 'Node' },
  'webview.detailKindEdge': { 'zh-CN': '连线', en: 'Edge' },
  'webview.detailKindStep': { 'zh-CN': '导读', en: 'Tour' },
  'webview.stepProgress': { 'zh-CN': '步骤 {index} / {total}', en: 'Step {index} / {total}' },
  'webview.sourceUnchecked': { 'zh-CN': '未检查', en: 'Not checked' },
  'webview.sourceLocations': { 'zh-CN': '源码位置', en: 'Source locations' },
  'webview.sourceLineRange': { 'zh-CN': '第 {start}–{end} 行', en: 'Lines {start}–{end}' },
  'webview.noLinkedSource': { 'zh-CN': '这个对象没有关联源码。', en: 'This item has no linked source.' },
  'webview.relatedNodes': { 'zh-CN': '相关节点', en: 'Related nodes' },
  'webview.relatedEdges': { 'zh-CN': '相关连线', en: 'Related edges' },
  'webview.outline': { 'zh-CN': '对象目录', en: 'Outline' },
  'webview.sideLabel': { 'zh-CN': '对象目录与详情', en: 'Outline and details' },
  'webview.readingOrder': { 'zh-CN': '阅读顺序', en: 'Reading order' },
  'webview.readingOrderHint': {
    'zh-CN': '地图作者建议的阅读顺序；点一步会高亮相关节点并打开代码',
    en: 'Reading order suggested by the map author; click a step to highlight its nodes and open the code',
  },

  // 空状态
  'webview.preparingTitle': { 'zh-CN': '正在准备地图…', en: 'Preparing map…' },
  'webview.preparingBody': { 'zh-CN': '正在计算布局并检查源码位置。', en: 'Computing layout and checking source locations.' },
  'webview.emptyTitle': { 'zh-CN': '还没有打开地图', en: 'No map open yet' },
  'webview.emptyBodyBefore': { 'zh-CN': '在 ', en: 'Create a map JSON under ' },
  'webview.emptyBodyAfter': { 'zh-CN': ' 下创建地图 JSON，或选择一张已有地图。', en: ', or pick an existing map.' },
  'webview.generateWithAi': { 'zh-CN': '用 AI 生成地图', en: 'Generate map with AI' },
  'webview.copyPrompt': { 'zh-CN': '复制 AI 生成提示词', en: 'Copy AI prompt' },
  'webview.rescan': { 'zh-CN': '重新扫描', en: 'Rescan' },

  // 错误
  'webview.missingVsCodeApi': { 'zh-CN': '缺少 VS Code Webview API。', en: 'VS Code Webview API is unavailable.' },
  'webview.missingAppRoot': { 'zh-CN': '缺少 #app 根节点。', en: 'Missing #app root element.' },

  // 浏览器预览
  'webview.previewNavigate': { 'zh-CN': '预览：跳转到 {file}:{line}', en: 'Preview: go to {file}:{line}' },
  'webview.previewNoAi': {
    'zh-CN': '浏览器预览模式无法调用本地 AI，请在 VS Code 中运行。',
    en: 'Local AI is unavailable in browser preview; run it in VS Code.',
  },
  'webview.previewUnavailable': { 'zh-CN': '浏览器预览模式下该操作不可用。', en: 'This action is unavailable in browser preview.' },
  'webview.shellExplorer': { 'zh-CN': '资源管理器', en: 'Explorer' },
  'webview.shellSearch': { 'zh-CN': '搜索', en: 'Search' },
  'webview.shellSourceControl': { 'zh-CN': '源代码管理', en: 'Source Control' },
  'webview.shellRunDebug': { 'zh-CN': '运行和调试', en: 'Run and Debug' },
  'webview.shellExtensions': { 'zh-CN': '扩展', en: 'Extensions' },
  'webview.shellActivityBar': { 'zh-CN': '活动栏', en: 'Activity Bar' },
  'webview.shellAccounts': { 'zh-CN': '帐户', en: 'Accounts' },
  'webview.shellManage': { 'zh-CN': '管理', en: 'Manage' },
  'webview.shellToggleTheme': { 'zh-CN': '切换预览主题', en: 'Toggle preview theme' },
  'webview.shellSplitEditor': { 'zh-CN': '拆分编辑器', en: 'Split Editor' },
  'webview.shellAppName': { 'zh-CN': '代码侦探', en: 'Code Detective' },
  'webview.shellPickSource': { 'zh-CN': '选择源码', en: 'Select source' },
  'webview.shellCodeEmpty': {
    'zh-CN': '点击地图中的节点或源码条目，这里会显示对应的源码。',
    en: 'Click a node or source entry on the map to show its source here.',
  },
  'webview.shellBrowserPreview': { 'zh-CN': '浏览器预览', en: 'Browser Preview' },
  'webview.shellMountMissing': { 'zh-CN': '预览外壳缺少地图挂载点。', en: 'Preview shell is missing the map mount point.' },
  'webview.shellDocTitle': { 'zh-CN': '{title} · 代码侦探', en: '{title} · Code Detective' },
  'webview.shellLines': { 'zh-CN': '行 {start}–{end}', en: 'Ln {start}–{end}' },
} satisfies Record<`webview.${string}`, Message>;
