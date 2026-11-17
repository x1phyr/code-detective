import type { Message } from '../index';

/** core 区域的文案。key 统一以 `core.` 开头。 */
export const core = {
  // shared/types.ts —— 来源状态标签
  'core.state.pending': { 'zh-CN': '检查位置中', en: 'Checking location' },
  'core.state.rangeOnly': { 'zh-CN': '按行号定位', en: 'Located by line numbers' },
  'core.state.matched': { 'zh-CN': '位置匹配', en: 'Location matched' },
  'core.state.relocated': { 'zh-CN': '位置已恢复，需复核', en: 'Location recovered, needs review' },
  'core.state.stale': { 'zh-CN': '源码已变更', en: 'Source changed' },
  'core.state.missing': { 'zh-CN': '文件不存在', en: 'File not found' },
  'core.state.outOfRange': { 'zh-CN': '行号越界', en: 'Lines out of range' },
  'core.state.outsideRoot': { 'zh-CN': '超出工作区', en: 'Outside workspace' },

  // 通用标点
  'core.listSeparator': { 'zh-CN': '、', en: ', ' },

  // annotations.ts
  'core.annotationStepHeading': { 'zh-CN': '步骤 {index}/{total} · {title}', en: 'Step {index}/{total} · {title}' },
  'core.annotationDefaultHeading': { 'zh-CN': '代码侦探', en: 'Code Detective' },

  // paths.ts
  'core.sourcePathNotCanonical': {
    'zh-CN': '来源必须是所属工作区内的规范相对路径。',
    en: 'Source must be a canonical relative path within its workspace.',
  },
  'core.sourceOutsideRoot': { 'zh-CN': '来源位置超出所属工作区。', en: 'Source location is outside its workspace.' },

  // source.ts
  'core.sourceLinesInvalid': { 'zh-CN': '来源行号无效，需要更新地图。', en: 'Source line numbers are invalid; the map needs updating.' },
  'core.sourceChangedNoAnchor': {
    'zh-CN': '文件已变更，且没有文本锚点；请让 AI 更新地图后再精确定位。',
    en: 'The file has changed and there is no text anchor; ask the AI to update the map for precise locating.',
  },
  'core.sourceOutOfRange': {
    'zh-CN': '来源为第 {startLine}–{endLine} 行，当前文件只有 {lineCount} 行。',
    en: 'Source spans lines {startLine}–{endLine}, but the file now has only {lineCount} lines.',
  },
  'core.sourceRangeOnly': { 'zh-CN': '仅按行号定位，未提供文本锚点。', en: 'Located by line numbers only; no text anchor provided.' },
  'core.anchorLineCountMismatch': {
    'zh-CN': '文本锚点的行数与声明范围不同，请让 AI 更新地图。',
    en: 'The text anchor line count differs from the declared range; ask the AI to update the map.',
  },
  'core.sourceRelocated': { 'zh-CN': '位置已恢复，内容需 AI 复核。', en: 'Location recovered; content needs AI review.' },
  'core.anchorAmbiguous': {
    'zh-CN': '文本锚点存在多个完整匹配，无法确定原位置；请让 AI 更新地图。',
    en: 'The text anchor matches in multiple places, so the original location is unclear; ask the AI to update the map.',
  },
  'core.anchorNotFound': {
    'zh-CN': '文本锚点已改变或不存在；请让 AI 更新地图。',
    en: 'The text anchor has changed or no longer exists; ask the AI to update the map.',
  },

  // mapDraft.ts —— 草稿校验原因
  'core.draftNotObject': { 'zh-CN': '不是对象', en: 'not an object' },
  'core.draftMissingFile': { 'zh-CN': '缺少 file', en: 'missing file' },
  'core.draftFileNotCanonical': {
    'zh-CN': 'file {file} 不是规范的工作区相对路径',
    en: 'file {file} is not a canonical workspace-relative path',
  },
  'core.draftLinesNotPositive': { 'zh-CN': '行号必须是正整数', en: 'line numbers must be positive integers' },
  'core.draftEndBeforeStart': { 'zh-CN': 'endLine 小于 startLine', en: 'endLine is less than startLine' },
  'core.draftRefInvalidId': {
    'zh-CN': '{owner}.{field} 中的 {id}（ID 格式无效）',
    en: '{id} in {owner}.{field} (invalid ID format)',
  },
  'core.draftIdInvalid': { 'zh-CN': 'id 缺失或格式无效', en: 'id is missing or invalid' },
  'core.draftMissingLabel': { 'zh-CN': '缺少 label', en: 'missing label' },
  'core.draftEndpointsInvalid': { 'zh-CN': 'from / to 缺失或格式无效', en: 'from / to is missing or invalid' },
  'core.draftMissingTitle': { 'zh-CN': '缺少 title', en: 'missing title' },
  'core.draftDuplicateId': { 'zh-CN': '与前面的 {name} 重复使用同一 id', en: 'reuses an id already used in earlier {name}' },
  'core.draftOverLimit': { 'zh-CN': '超出 {name} 数量上限 {limit}', en: 'exceeds the {name} limit of {limit}' },
  'core.draftMapNotObject': { 'zh-CN': '地图必须是 JSON 对象。', en: 'The map must be a JSON object.' },
  'core.draftMapEmpty': {
    'zh-CN': '模型返回了空的讲义草稿（输出可能被截断），请重试或缩小话题范围。',
    en: 'The model returned an empty guide draft (output may have been truncated); retry or narrow the topic.',
  },
  'core.draftMapNeedsTitle': {
    'zh-CN': '地图需要一个非空的 title（不超过 200 字）。',
    en: 'The map needs a non-empty title (at most 200 characters).',
  },
  'core.draftSourcesNotObject': {
    'zh-CN': 'sources 必须是对象：键为 sourceId，值为 file / startLine / endLine。',
    en: 'sources must be an object: keys are sourceIds, values are file / startLine / endLine.',
  },
  'core.draftSourceIdInvalid': { 'zh-CN': 'sourceId 格式无效', en: 'invalid sourceId format' },
  'core.draftSourcesOverLimit': { 'zh-CN': '超出 sources 数量上限 {limit}', en: 'exceeds the sources limit of {limit}' },
  'core.draftFileUnreadable': { 'zh-CN': '无法读取 {file}', en: 'cannot read {file}' },
  'core.draftFileEmpty': { 'zh-CN': '{file} 为空文件', en: '{file} is empty' },
  'core.draftFileLinesInvalid': { 'zh-CN': '{file} 的行号无效', en: 'invalid line numbers for {file}' },
  'core.draftStartBeyondFile': {
    'zh-CN': '{file} 只有 {last} 行，起始行 {startLine} 超出文件范围',
    en: '{file} has only {last} lines; start line {startLine} is beyond the end of the file',
  },
  'core.draftRefMissingTarget': {
    'zh-CN': '{owner}.{field} 中的 {id}（目标不存在或已被移除）',
    en: '{id} in {owner}.{field} (target missing or removed)',
  },
  'core.draftNodeSourcesUnavailable': { 'zh-CN': '引用的源码位置都不可用', en: 'none of its source locations are usable' },
  'core.draftEdgeEndpointRemoved': {
    'zh-CN': '端点 {from} → {to} 已被移除或不存在',
    en: 'endpoint {from} → {to} was removed or does not exist',
  },
  'core.draftStepRefsRemoved': {
    'zh-CN': '引用的节点与连线都被移除了',
    en: 'all of its referenced nodes and edges were removed',
  },
  'core.draftNoUsableNodes': {
    'zh-CN': '没有任何节点能对应到可读的源码位置；请先读取文件确认行号后再提交。',
    en: 'No node maps to a readable source location; read the files to confirm line numbers before submitting.',
  },

  // mapDraft.ts —— 调整报告
  'core.adjustGroup': { 'zh-CN': '{label}：{items}', en: '{label}: {items}' },
  'core.adjustItem': { 'zh-CN': '{id}（{reason}）', en: '{id} ({reason})' },
  'core.adjustDroppedSources': { 'zh-CN': '已丢弃的来源', en: 'Dropped sources' },
  'core.adjustDroppedNodes': { 'zh-CN': '已丢弃的节点', en: 'Dropped nodes' },
  'core.adjustDroppedEdges': { 'zh-CN': '已丢弃的连线', en: 'Dropped edges' },
  'core.adjustDroppedSteps': { 'zh-CN': '已丢弃的导读步骤', en: 'Dropped walkthrough steps' },
  'core.adjustRemovedRefs': { 'zh-CN': '已移除的引用：{items}', en: 'Removed references: {items}' },
  'core.adjustClamped': { 'zh-CN': '已按文件长度裁剪行号：{items}', en: 'Line numbers clamped to file length: {items}' },

  // validator.ts
  'core.schemaType': { 'zh-CN': '{path}：必须为 {type} 类型', en: '{path}: must be of type {type}' },
  'core.schemaMinLength': { 'zh-CN': '{path}：至少需要 {limit} 个字符', en: '{path}: minimum length is {limit}' },
  'core.schemaMaxLength': { 'zh-CN': '{path}：不能超过 {limit} 个字符', en: '{path}: maximum length is {limit}' },
  'core.schemaMinItems': { 'zh-CN': '{path}：至少需要 {limit} 项', en: '{path}: minimum item count is {limit}' },
  'core.schemaMinProperties': { 'zh-CN': '{path}：至少需要 {limit} 个字段', en: '{path}: minimum property count is {limit}' },
  'core.schemaMinimum': { 'zh-CN': '{path}：不能小于 {limit}', en: '{path}: must be at least {limit}' },
  'core.schemaMaximum': { 'zh-CN': '{path}：不能大于 {limit}', en: '{path}: must be at most {limit}' },
  'core.schemaPattern': { 'zh-CN': '{path}：必须匹配格式 {pattern}', en: '{path}: must match pattern {pattern}' },
  'core.schemaConstraint': { 'zh-CN': '{path}：不满足 {constraint} 约束', en: '{path}: does not satisfy the {constraint} constraint' },
  'core.validateFailedAt': { 'zh-CN': '地图校验失败 {path}：{message}', en: 'Map validation failed at {path}: {message}' },
  'core.validateFailed': { 'zh-CN': '地图校验失败：\n{details}', en: 'Map validation failed:\n{details}' },
  'core.location': { 'zh-CN': '第 {line} 行，第 {column} 列', en: 'line {line}, column {column}' },
  'core.duplicateJsonKey': { 'zh-CN': '重复 JSON 键 {key}（{location}）', en: 'duplicate JSON key {key} ({location})' },
  'core.schemaUnknownField': { 'zh-CN': '{path}：不支持字段 {field}', en: '{path}: unsupported field {field}' },
  'core.schemaMissingField': { 'zh-CN': '{path}：缺少必填字段 {field}', en: '{path}: missing required field {field}' },
  'core.schemaConst': {
    'zh-CN': '{path}：必须为 {value}；当前仅支持 schemaVersion 1',
    en: '{path}: must be {value}; only schemaVersion 1 is supported',
  },
  'core.schemaMaxItems': { 'zh-CN': '{path}：数量不能超过 {limit}', en: '{path}: must have at most {limit} items' },
  'core.schemaMaxSources': { 'zh-CN': '{path}：来源数量不能超过 {limit}', en: '{path}: must have at most {limit} sources' },
  'core.schemaUniqueItems': { 'zh-CN': '{path}：引用数组内的 ID 不得重复', en: '{path}: IDs in a reference array must be unique' },
  'core.schemaEnum': { 'zh-CN': '{path}：仅允许 {values}', en: '{path}: only {values} allowed' },
  'core.duplicateId': { 'zh-CN': '重复 ID {id}', en: 'duplicate ID {id}' },
  'core.unknownRefId': { 'zh-CN': '引用了不存在的 ID {id}', en: 'references nonexistent ID {id}' },
  'core.fileNotCanonical': {
    'zh-CN': 'file 必须是以 / 分隔的工作区相对文件路径：不能使用绝对路径、URI、反斜杠或控制字符，也不能包含 .、..、空白或空路径段',
    en: 'file must be a /-separated workspace-relative file path: no absolute paths, URIs, backslashes or control characters, and no ., .., blank or empty path segments',
  },
  'core.mapTooLarge': { 'zh-CN': '地图超过 2 MiB 上限，请按功能拆分地图', en: 'The map exceeds the 2 MiB limit; split it by feature' },
  'core.jsonUnparsable': {
    'zh-CN': '无法解析 JSON；请检查嵌套深度和文件内容',
    en: 'Cannot parse JSON; check the nesting depth and file contents',
  },
  'core.jsonSyntaxErrorAt': {
    'zh-CN': 'JSON 语法错误：{code}（{location}）；只接受完整的标准 JSON',
    en: 'JSON syntax error: {code} ({location}); only complete standard JSON is accepted',
  },
  'core.jsonEmpty': { 'zh-CN': '文件没有完整 JSON 内容', en: 'The file has no complete JSON content' },
  'core.jsonSyntaxError': { 'zh-CN': 'JSON 语法错误；只接受完整的标准 JSON', en: 'JSON syntax error; only complete standard JSON is accepted' },
  'core.endBeforeStart': { 'zh-CN': 'endLine 必须大于或等于 startLine', en: 'endLine must be greater than or equal to startLine' },
  'core.anchorIncomplete': {
    'zh-CN': '必须包含 startLine 至 endLine 的全部完整行，不能只提供其中一段文本',
    en: 'must contain every full line from startLine to endLine, not just part of the text',
  },
  'core.edgeNodeNotFound': { 'zh-CN': '找不到节点 {id}', en: 'node {id} not found' },
  'core.parentSelf': { 'zh-CN': 'parent 不能指向节点自己。', en: 'parent cannot point to the node itself.' },
  'core.parentNotFound': { 'zh-CN': 'parent 引用了不存在的节点 {id}。', en: 'parent references a missing node {id}.' },
  'core.stepBranchSelf': { 'zh-CN': '步骤的 branches 不能指向自己。', en: 'A step cannot list itself in branches.' },
  'core.stepBranchNotAside': { 'zh-CN': 'branches 里的步骤 {id} 必须标记 aside: true。', en: 'Step {id} in branches must set aside: true.' },
  'core.draftStepSourceRemoved': { 'zh-CN': '{id}.sourceId 指向不存在的源码，已去掉', en: '{id}.sourceId pointed to a missing source; removed' },
  'core.parentCycle': { 'zh-CN': '节点 {id} 的 parent 链形成了环。', en: 'The parent chain of node {id} forms a cycle.' },
  'core.parentTooDeep': {
    'zh-CN': '节点 {id} 的分组 {parent} 本身已有上级分组；脉络图最多只允许 1 层阶段分组。',
    en: 'Group {parent} of node {id} already has a parent; at most one level of grouping is allowed.',
  },
  'core.walkthroughEmpty': {
    'zh-CN': 'walkthrough 至少需要 1 个主线带读步骤（aside 不为 true）。',
    en: 'walkthrough must contain at least one main-line step (aside is not true).',
  },
  'core.stepNeedsAnchor': {
    'zh-CN': '步骤必须至少关联 sourceId、nodeIds 或 edgeIds 之一。',
    en: 'A step must reference at least one of sourceId, nodeIds or edgeIds.',
  },
  'core.draftParentCycle': { 'zh-CN': '{id}.parent 形成环，已移到上一层', en: '{id}.parent formed a cycle; moved up a level' },
  'core.draftParentFlattened': {
    'zh-CN': '{id}.parent 超过 1 层分组，已归并到顶层分组 {target}',
    en: '{id}.parent exceeded 1 level of grouping; merged into top-level group {target}',
  },
  'core.draftWalkthroughSynthesized': {
    'zh-CN': '模型未给出有效的带读步骤，已按主干节点自动生成基础导读顺序',
    en: 'No valid walkthrough steps were provided; basic reading steps were synthesized from main nodes',
  },
} satisfies Record<`core.${string}`, Message>;
