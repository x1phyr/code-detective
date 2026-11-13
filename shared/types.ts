import { t, type MessageKey } from './i18n';

export interface SourceRef {
  file: string;
  startLine: number;
  endLine: number;
  anchorText?: string;
  /** One-line explanation shown beside the highlighted code (≤ 200 chars). */
  note?: string;
}
export interface MapNode {
  id: string;
  label: string;
  description?: string;
  /** `exit`：提前返回 / 抛错 / 结束，画成终止节点。 */
  kind?: 'step' | 'function' | 'condition' | 'event' | 'exit';
  /**
   * 所属功能块（另一个节点的 id）。有子节点的节点就是“功能块”，
   * 画布按层显示：顶层只画没有 parent 的节点，点进功能块再看它的子流程。
   */
  parent?: string;
  sourceIds: string[];
}
export interface MapEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  description?: string;
  kind?: 'call' | 'flow' | 'event' | 'related';
  /**
   * 分支条件，例如“未命中缓存”“校验失败”。写了 branch 的边是支线（异常、提前返回、重试等），
   * 默认折叠；不写的边是主干（正常路径），竖直排在中轴。
   */
  branch?: string;
  sourceIds: string[];
}
export interface WalkthroughStep {
  id: string;
  title: string;
  /** 这一步是什么：1–3 句话。 */
  description?: string;
  nodeIds: string[];
  edgeIds: string[];
  /** 这一步只看的那段代码；不写时取节点 / 连线的第一处源码。 */
  sourceId?: string;
  /** 为什么这样写。 */
  why?: string;
  /** 容易踩坑、值得注意的地方。 */
  watch?: string;
  /** 这一步里可以先跳过不看的部分。 */
  skip?: string;
  /** 贯穿例子走到这一步时发生了什么。 */
  example?: string;
  /** 岔路：不在主线上，只能从某一步的 `branches` 进入，看完回到出发的那一步。 */
  aside?: boolean;
  /** 从这一步可以岔出去看的支线步骤（必须是 aside 步骤）。 */
  branches?: string[];
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
  walkthrough?: WalkthroughStep[];
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
export interface ViewState {
  selection?: Selection;
  sourceId?: string;
  stepId?: string;
  highlightEnabled: boolean;
  /** 视口变换；节点坐标由固定布局计算，不保存。 */
  viewport?: { x: number; y: number; zoom: number };
}
export interface MapSummary {
  key: string;
  title: string;
  rootName: string;
  fileName: string;
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
export interface InitializePayload {
  maps: MapSummary[];
  current?: MapSnapshot;
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
  | { protocolVersion: 1; type: 'notice'; payload: NoticePayload }
  | { protocolVersion: 1; type: 'theme'; payload: { kind: ThemeKind } }
  /** 标题栏「适应窗口」按钮：让画布缩放到能看到整张图。 */
  | { protocolVersion: 1; type: 'view.fit'; payload: Record<string, never> };

export const DEFAULT_VIEW_STATE: ViewState = {
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
