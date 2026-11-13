import type { CodeMap, MapEdge, MapNode, Selection, SourceState } from '../../shared/types';
import { t, type MessageKey } from '../../shared/i18n';

export interface NodeData {
  node: MapNode;
  active: boolean;
  related: boolean;
  /** 有选中对象时，与之无关的节点淡出，而不是换颜色。 */
  dimmed: boolean;
}

export interface EdgeData {
  edge: MapEdge;
  active: boolean;
  related: boolean;
  dimmed: boolean;
}

const NODE_KIND_KEYS = {
  step: 'webview.nodeKindStep',
  function: 'webview.nodeKindFunction',
  condition: 'webview.nodeKindCondition',
  event: 'webview.nodeKindEvent',
  default: 'webview.nodeKindDefault',
} as const satisfies Record<NonNullable<MapNode['kind']> | 'default', MessageKey>;

/** 节点类型的显示名；按调用时的语言取文案，因此不能做成模块级常量。 */
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
    const step = map.walkthrough?.find(item => item.id === selection.id);
    step?.nodeIds.forEach(id => nodes.add(id));
    step?.edgeIds.forEach(id => edges.add(id));
  }
  return { nodes, edges };
}

export function selectedEdgeIds(map: CodeMap, selection?: Selection): Set<string> {
  if (!selection) return new Set();
  if (selection.kind === 'edge') return new Set([selection.id]);
  if (selection.kind === 'step') {
    return new Set(map.walkthrough?.find(step => step.id === selection.id)?.edgeIds ?? []);
  }
  return new Set();
}

export function statusTone(state: SourceState | undefined): 'ok' | 'warn' | 'error' | 'idle' {
  if (!state || state === 'pending') return 'idle';
  if (state === 'matched') return 'ok';
  if (state === 'range-only' || state === 'relocated') return 'warn';
  return 'error';
}

export function edgeKindLabel(edge: MapEdge): string {
  switch (edge.kind) {
    case 'call': return t('webview.edgeKindCall');
    case 'flow': return t('webview.edgeKindFlow');
    case 'event': return t('webview.edgeKindEvent');
    case 'related': return t('webview.edgeKindRelated');
    default: return '';
  }
}
