import type { CodeMap, MapEdge, MapNode, Selection, SourceState } from '../../shared/types';
import { t, type MessageKey } from '../../shared/i18n';

export interface NodeData {
  node: MapNode;
  active: boolean;
  peeked: boolean;
  related: boolean;
  dimmed: boolean;
  cursorHere: boolean;
  /** 关联的主线带读步骤徽章，例如 `#1` 或 `#3–4`。 */
  stepBadge?: string;
  /** 阶段块的直接子节点数；0 表示普通节点。 */
  children: number;
  /** 折叠在它支线后面的节点数。 */
  hidden: number;
  /** 支线是否已展开。 */
  expanded: boolean;
  /** 关联的源码处数。 */
  sources: number;
  /** 有源码位置漂移或缺失。 */
  warn: boolean;
  /** 布局时使用的高度；节点按这个高度渲染，保证连线正好接在边上。 */
  height: number;
}

export interface GroupNodeData {
  node: MapNode;
  width: number;
  height: number;
  stepBadge?: string;
  active: boolean;
  dimmed: boolean;
}

/** 格式化步骤编号列表为短徽章，例如 [3, 4, 5] -> "#3–5"，[1, 4] -> "#1,#4"。 */
export function formatStepBadge(indices: readonly number[]): string | undefined {
  if (indices.length === 0) return undefined;
  if (indices.length === 1) return `#${indices[0]}`;
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const contiguous = sorted.every((val, idx) => idx === 0 || val === sorted[idx - 1]! + 1);
  if (contiguous) return `#${sorted[0]}–${sorted.at(-1)}`;
  if (sorted.length <= 2) return sorted.map(n => `#${n}`).join(',');
  return `#${sorted[0]}..#${sorted.at(-1)}`;
}

/** 连线上显示的文字：合并的跨层连线显示“N 条调用”，支线显示分支条件，其余显示 label。 */
export function edgeText(edge: { edge: MapEdge; edgeIds: readonly string[] }): string | undefined {
  if (edge.edgeIds.length > 1) return t('webview.mergedEdges', { count: edge.edgeIds.length });
  return edge.edge.branch ?? edge.edge.label;
}

export interface EdgeData {
  edge: MapEdge;
  active: boolean;
  related: boolean;
  dimmed: boolean;
  merged: number;
  branch: boolean;
  label?: string;
  route?: import('./layout').EdgeRoute;
}

const NODE_KIND_KEYS = {
  step: 'webview.nodeKindStep',
  function: 'webview.nodeKindFunction',
  condition: 'webview.nodeKindCondition',
  event: 'webview.nodeKindEvent',
  exit: 'webview.nodeKindExit',
  default: 'webview.nodeKindDefault',
} as const satisfies Record<NonNullable<MapNode['kind']> | 'default', MessageKey>;

export function nodeKindLabel(kind: MapNode['kind']): string {
  return t(NODE_KIND_KEYS[kind ?? 'default']);
}

export function relatedSelection(map: CodeMap, selection?: Selection): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  if (!selection) return { nodes, edges };
  if (selection.kind === 'node') {
    nodes.add(selection.id);
    for (const edge of map.edges) {
      if (edge.from === selection.id || edge.to === selection.id) {
        edges.add(edge.id);
        nodes.add(edge.from);
        nodes.add(edge.to);
      }
    }
  } else if (selection.kind === 'edge') {
    const edge = map.edges.find(item => item.id === selection.id);
    edges.add(selection.id);
    if (edge) {
      nodes.add(edge.from);
      nodes.add(edge.to);
    }
  } else {
    const step = map.walkthrough.find(item => item.id === selection.id);
    step?.nodeIds.forEach(id => nodes.add(id));
    step?.edgeIds.forEach(id => edges.add(id));
  }
  return { nodes, edges };
}

export function statusTone(state: SourceState | undefined): 'ok' | 'warn' | 'error' | 'idle' {
  if (!state || state === 'pending') return 'idle';
  if (state === 'matched') return 'ok';
  if (state === 'range-only' || state === 'relocated') return 'warn';
  return 'error';
}
