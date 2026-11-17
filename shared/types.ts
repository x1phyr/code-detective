import { t, type MessageKey } from './i18n';

export interface SourceRef {
  file: string;
  startLine: number;
  endLine: number;
  anchorText?: string;
  /** Enclosing function or Class.method symbol name for this slice. */
  symbol?: string;
  /** Short branch/variant tag when this source is one of a node's parallel implementations. */
  variantLabel?: string;
  /** One-line explanation shown beside the highlighted code (≤ 200 chars). */
  note?: string;
}

export type NodeSourceMode = 'slices' | 'variants';

export interface MapNode {
  id: string;
  label: string;
  description?: string;
  /** `exit`：提前返回 / 抛错 / 结束，画成终止节点。 */
  kind?: 'step' | 'function' | 'condition' | 'event' | 'exit';
  /**
   * 所属阶段分组（顶层节点的 id，最多允许 1 层分组）。
   * 有子节点的节点在脉络图上可原地展开为分组框（Compound Node），上下游保持同屏可见。
   */
  parent?: string;
  /** Semantic role when a leaf node links multiple source slices. */
  sourceMode?: NodeSourceMode;
  sourceIds: string[];
}

export interface MapEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  description?: string;
  kind?: 'call' | 'delegated' | 'dispatch' | 'event' | 'flow' | 'related';
  /**
   * 分支条件，例如“未命中缓存”“校验失败”。写了 branch 的边是支线（异常、提前返回、重试等），
   * 默认折叠；不写的边是主干（正常路径），竖直排在中轴。
   */
  branch?: string;
  /** Ordered intermediate pass-through source hops between `from` and `to`. */
  via?: string[];
  sourceIds: string[];
}

/** 用户在带读问答中沉淀下来的个人笔记，随讲义 JSON 一起持久化。 */
export interface StepNote {
  id: string;
  question?: string;
  answer: string;
  createdAt?: string;
}

export interface WalkthroughStep {
  id: string;
  title: string;
  /** 这一步是什么：1–3 句话。 */
  description?: string;
  nodeIds: string[];
  edgeIds: string[];
  /** 这一步聚焦阅读的那段代码；不写时取关联节点 / 连线的第一处源码。 */
  sourceId?: string;
  /** 为什么这样写。 */
  why?: string;
  /** 容易踩坑、值得注意的地方。 */
  watch?: string;
  /** 这一步里可以先跳过不看的部分。 */
  skip?: string;
  /** 贯穿例子走到这一步时发生了什么。 */
  example?: string;
  /** 岔路：不在主线上，从主线某一步的 `branches` 内嵌展开阅读。 */
  aside?: boolean;
  /** 从这一步可以岔出去看的支线步骤（必须是 aside 步骤）。 */
  branches?: string[];
  /** 用户就这一步追问后保存下来的补充笔记。 */
  notes?: StepNote[];
}

/** 导读的整体设定：一个贯穿全程的例子、收尾总结和动手练习。 */
export interface TourInfo {
  /** 贯穿例子，例如“用户 alice 输错密码三次后再登录”。 */
  example?: string;
  /** 看完后的总结。 */
  recap?: string;
  /** 一个可以自己动手验证理解的小练习。 */
  exercise?: string;
}

export interface CodeMap {
  $schema?: string;
  schemaVersion: 1;
  id: string;
  title: string;
  description?: string;
  sources: Record<string, SourceRef>;
  nodes: MapNode[];
  edges: MapEdge[];
  /** 带读讲义步骤（第一主角，必填，至少含 1 个主线步骤）。 */
  walkthrough: WalkthroughStep[];
  tour?: TourInfo;
}

export type SourceState = 'pending' | 'range-only' | 'matched' | 'relocated' | 'stale' | 'missing' | 'out-of-range' | 'outside-root';

export interface SourceStatus {
  state: SourceState;
  file: string;
  startLine: number;
  endLine: number;
  message?: string;
}

export interface Selection {
  kind: 'node' | 'edge' | 'step';
  id: string;
}

export type ViewTab = 'walkthrough' | 'map';

/** 脉络图上临时点击节点或连线触发的源码预览，绝不冲掉当前的带读步骤进度。 */
export interface PeekTarget {
  kind: 'node' | 'edge';
  id: string;
}

export interface ViewState {
  /** 当前展示的主标签页：默认 'walkthrough'（带读讲义）。 */
  activeTab: ViewTab;
  /** 当前正在阅读的步骤 id（主线或内嵌展开的岔路）。 */
  activeStepId?: string;
  /** 当前在主线步骤下展开查看的岔路步骤 id（内嵌子卡）。 */
  openAsideId?: string;
  /** 已读过的步骤 id 集合，用于时间轴显示进度。 */
  visitedStepIds?: string[];
  /** 脉络图上的非破坏性临时预览目标。 */
  peek?: PeekTarget;
  /** 当前在编辑器中定位的具体 sourceId。 */
  sourceId?: string;
  /** 脉络图上已原地展开的阶段分组节点 id。 */
  expandedGroupIds?: string[];
  /** 脉络图上已展开支线的节点 id。 */
  expandedBranchIds?: string[];
  highlightEnabled: boolean;
  /** 画布视口变换；节点坐标由固定布局计算，不保存。 */
  viewport?: { x: number; y: number; zoom: number };
}

export interface MapSummary {
  key: string;
  title: string;
  rootName: string;
  fileName: string;
  stepCount?: number;
  nodeCount?: number;
  revision?: string;
  error?: string;
}

export interface MapSnapshot {
  key: string;
  revision: string;
  map: CodeMap;
  statuses: Record<string, SourceStatus>;
  ui: ViewState;
  error?: string;
}

export interface AgentOption {
  id: string;
  label: string;
  kind: 'cli' | 'copilot' | 'custom';
  available?: boolean;
  badge?: string;
  detail?: string;
}

export interface AiTraceItem {
  id: string;
  kind: 'search' | 'read' | 'think' | 'status' | 'retry';
  text: string;
  detail?: string;
  timestamp: number;
}

export interface AiStatusPayload {
  busy: boolean;
  topic?: string;
  agentId?: string;
  agentLabel?: string;
  phase?: AiPhase;
  traces: AiTraceItem[];
  error?: string;
}

export interface EditorSelectionSlice {
  file: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  preview: string;
}

export interface EditorContextPayload {
  activeFile?: string;
  cursorLine?: number;
  activeSymbol?: string;
  /** 光标当前落入的步骤 id（用于柔和跟随标记“📍光标在此”）。 */
  matchedStepIds: string[];
  /** 光标当前落入的脉络图节点 id。 */
  matchedNodeIds: string[];
  /** 编辑器内当前选中的代码片段（用于就地发起或自动带入追问）。 */
  selection?: EditorSelectionSlice;
}

export interface QaExchange {
  id: string;
  stepId: string;
  question: string;
  selection?: { file: string; startLine: number; endLine: number };
  answer: string;
  status: 'streaming' | 'done' | 'error';
  activity?: string;
  savedNoteId?: string;
  savedAsideId?: string;
}

export interface ComposeDraftPayload {
  open: boolean;
  topic?: string;
  anchorFile?: string;
  anchorSymbol?: string;
  startLine?: number;
  endLine?: number;
  overwriteKey?: string;
}

export interface InitializePayload {
  maps: MapSummary[];
  current?: MapSnapshot;
  agents: AgentOption[];
  currentAgentId: string;
  aiStatus: AiStatusPayload;
  editorContext: EditorContextPayload;
  qa: QaExchange[];
  /** 独立 Editor Tab 打开的全景脉络图模式。 */
  standaloneMap?: boolean;
}

export interface RevealPayload {
  targetKind: Selection['kind'];
  targetId: string;
  sourceId?: string;
  focusEditor?: boolean;
}

export interface BridgeMessage<T = unknown> {
  protocolVersion: 1;
  requestId: string;
  type: string;
  mapKey?: string;
  mapRevision?: string;
  payload: T;
}

export interface NoticePayload {
  message: string;
  severity?: 'info' | 'warning' | 'error';
}

export type ThemeKind = 'dark' | 'light' | 'high-contrast' | 'high-contrast-light';

export type AiPhase = 'preparing' | 'running' | 'validating' | 'retry' | 'done' | 'error' | 'cancelled';

export type HostMessage =
  | { protocolVersion: 1; type: 'initialize'; payload: InitializePayload }
  | { protocolVersion: 1; type: 'maps'; payload: { maps: MapSummary[] } }
  | { protocolVersion: 1; type: 'snapshot'; payload: { snapshot?: MapSnapshot; error?: string } }
  | { protocolVersion: 1; type: 'agents'; payload: { agents: AgentOption[]; currentAgentId: string } }
  | { protocolVersion: 1; type: 'ai.status'; payload: AiStatusPayload }
  | { protocolVersion: 1; type: 'ai.compose'; payload: ComposeDraftPayload }
  | { protocolVersion: 1; type: 'editor.context'; payload: EditorContextPayload }
  | { protocolVersion: 1; type: 'qa.state'; payload: { mapId?: string; exchanges: QaExchange[] } }
  | { protocolVersion: 1; type: 'notice'; payload: NoticePayload }
  | { protocolVersion: 1; type: 'theme'; payload: { kind: ThemeKind } }
  /** 标题栏「适应窗口」按钮：让画布缩放到能看到整张图。 */
  | { protocolVersion: 1; type: 'view.fit'; payload: Record<string, never> };

export const DEFAULT_VIEW_STATE: ViewState = {
  activeTab: 'walkthrough',
  highlightEnabled: true,
};

const SOURCE_STATE_LABEL_KEYS = {
  pending: 'core.state.pending',
  'range-only': 'core.state.rangeOnly',
  matched: 'core.state.matched',
  relocated: 'core.state.relocated',
  stale: 'core.state.stale',
  missing: 'core.state.missing',
  'out-of-range': 'core.state.outOfRange',
  'outside-root': 'core.state.outsideRoot',
} as const satisfies Record<SourceState, MessageKey>;

/** 来源状态的显示文案；按调用时的语言取值（语言在模块加载后才设置）。 */
export function sourceStateLabel(state: SourceState): string {
  return t(SOURCE_STATE_LABEL_KEYS[state]);
}
