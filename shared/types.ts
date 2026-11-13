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
  kind?: 'step' | 'function' | 'condition' | 'event';
  sourceIds: string[];
}
export interface MapEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  description?: string;
  kind?: 'call' | 'flow' | 'event' | 'related';
  sourceIds: string[];
}
export interface WalkthroughStep {
  id: string;
  title: string;
  description?: string;
  nodeIds: string[];
  edgeIds: string[];
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
export const SOURCE_STATE_LABELS: Record<SourceState, string> = {
  pending: '检查位置中',
  'range-only': '按行号定位',
  matched: '位置匹配',
  relocated: '位置已恢复，需复核',
  stale: '源码已变更',
  missing: '文件不存在',
  'out-of-range': '行号越界',
  'outside-root': '超出工作区',
};
