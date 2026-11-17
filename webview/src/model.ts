import type { CodeMap, MapEdge, MapNode, Selection, SourceRef, SourceState, SourceStatus } from '../../shared/types';
import { sourceStateLabel } from '../../shared/types';
import { extractSnippetSymbol } from '../../src/core/calls';
import type { EffectiveSourceMode } from '../../src/core/selection';
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
  /** 多源码关系分类。 */
  sourceMode: EffectiveSourceMode;
  /** 单/同函数切片叶子节点展示的精确符号与行号范围。 */
  codeAnchor?: string;
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

/** 从 SourceRef 取得声明符号名，旧地图缺少 symbol 时从 anchorText 回退提取。 */
export function sourceSymbol(ref: SourceRef | undefined): string | undefined {
  if (!ref) return undefined;
  return ref.symbol || extractSnippetSymbol(ref.anchorText);
}

/** 格式化文件与起止行区间。 */
export function formatSourceRange(file: string, startLine?: number, endLine?: number, short = false): string {
  const displayFile = short ? (file.split('/').pop() ?? file) : file;
  if (!startLine) return displayFile;
  const range = endLine && endLine > startLine ? `${startLine}–${endLine}` : `${startLine}`;
  return `${displayFile}:${range}`;
}

/** 为单一职责或同函数分段的叶子节点生成卡片副标（如 `ExampleSession.onReconnect · 115–141`）。 */
export function formatNodeAnchor(
  map: CodeMap,
  node: MapNode,
  statuses: Readonly<Record<string, SourceStatus>>,
  hasChildren: boolean,
  mode: EffectiveSourceMode,
): string | undefined {
  if (hasChildren || (mode !== 'single' && mode !== 'slices')) return undefined;
  const ownIds = node.sourceIds.filter(id => Object.hasOwn(map.sources, id));
  const primaryId = ownIds[0];
  if (!primaryId) return undefined;
  const primaryRef = map.sources[primaryId]!;
  const primaryStatus = statuses[primaryId];
  const file = primaryStatus?.file ?? primaryRef.file;

  let minStart = primaryStatus?.startLine ?? primaryRef.startLine;
  let maxEnd = primaryStatus?.endLine ?? primaryRef.endLine;
  for (const id of ownIds.slice(1)) {
    const ref = map.sources[id]!;
    const st = statuses[id];
    if ((st?.file ?? ref.file) !== file) continue;
    minStart = Math.min(minStart, st?.startLine ?? ref.startLine);
    maxEnd = Math.max(maxEnd, st?.endLine ?? ref.endLine);
  }

  const sym = sourceSymbol(primaryRef);
  const shortSym = sym?.split('.').pop();
  if (sym && shortSym && !node.label.includes(shortSym)) {
    const linePart = maxEnd > minStart ? `${minStart}–${maxEnd}` : `${minStart}`;
    return `${sym} · ${linePart}`;
  }
  return formatSourceRange(file, minStart, maxEnd, true);
}

function shortHopName(ref: SourceRef): string {
  const sym = sourceSymbol(ref);
  if (sym) {
    return sym.includes('.') ? sym.split('.')[0]! : sym;
  }
  const base = ref.file.split('/').pop() ?? ref.file;
  return base.replace(/\.[^.]+$/, '');
}

export interface EdgeBadgeInfo {
  text?: string;
  bridgeHops: number;
  kind?: MapEdge['kind'];
  interactive: boolean;
}

/** 生成连线标签与透传跳数元信息。 */
export function edgeBadge(
  map: CodeMap,
  edge: { edge: MapEdge; edgeIds: readonly string[] },
): EdgeBadgeInfo {
  if (edge.edgeIds.length > 1) {
    return {
      text: t('webview.mergedEdges', { count: edge.edgeIds.length }),
      bridgeHops: 0,
      kind: edge.edge.kind,
      interactive: true,
    };
  }
  const via = (edge.edge.via ?? []).filter(id => Object.hasOwn(map.sources, id));
  if (via.length > 0) {
    const names: string[] = [];
    for (const id of via) {
      const name = shortHopName(map.sources[id]!);
      if (names.at(-1) !== name) names.push(name);
    }
    const viaSummary = edge.edge.label && edge.edge.label.length <= 24
      ? edge.edge.label
      : names.length > 2
        ? `${names[0]} → ${names.at(-1)}`
        : names.join(' → ');
    const hopText = viaSummary
      ? t('webview.edgeBridgeHopsWithVia', { count: via.length, via: viaSummary })
      : t('webview.edgeBridgeHops', { count: via.length });
    return {
      text: edge.edge.branch ? `${edge.edge.branch} · ${hopText}` : hopText,
      bridgeHops: via.length,
      kind: edge.edge.kind ?? 'delegated',
      interactive: true,
    };
  }
  const ownSources = edge.edge.sourceIds.filter(id => Object.hasOwn(map.sources, id));
  return {
    text: edge.edge.branch ?? edge.edge.label,
    bridgeHops: 0,
    kind: edge.edge.kind,
    interactive: edge.edge.kind === 'delegated' || ownSources.length > 1,
  };
}

/** 连线上显示的文字：合并的跨层连线显示“N 条调用”，透传边显示跳数胶囊，支线显示分支条件，其余显示 label。 */
export function edgeText(
  edge: { edge: MapEdge; edgeIds: readonly string[] },
  map?: CodeMap,
): string | undefined {
  if (map) return edgeBadge(map, edge).text;
  if (edge.edgeIds.length > 1) return t('webview.mergedEdges', { count: edge.edgeIds.length });
  const viaCount = edge.edge.via?.length ?? 0;
  if (viaCount > 0) {
    const hopText = t('webview.edgeBridgeHops', { count: viaCount });
    return edge.edge.branch ? `${edge.edge.branch} · ${hopText}` : hopText;
  }
  return edge.edge.branch ?? edge.edge.label;
}

export interface CallTraceItem {
  key: string;
  role: 'caller' | 'hop' | 'target';
  roleLabel: string;
  sourceId: string;
  targetKind: 'node' | 'edge';
  targetId: string;
  symbol?: string;
  note?: string;
  location: string;
  titleAttr: string;
  tone: 'ok' | 'warn' | 'error' | 'idle';
}

function makeTraceItem(
  map: CodeMap,
  statuses: Readonly<Record<string, SourceStatus>>,
  params: {
    key: string;
    role: 'caller' | 'hop' | 'target';
    roleLabel: string;
    sourceId: string;
    targetKind: 'node' | 'edge';
    targetId: string;
  },
): CallTraceItem | undefined {
  const ref = map.sources[params.sourceId];
  if (!ref) return undefined;
  const st = statuses[params.sourceId];
  const file = st?.file ?? ref.file;
  const start = st?.startLine ?? ref.startLine;
  const end = st?.endLine ?? ref.endLine;
  const location = formatSourceRange(file, start, end, false);
  return {
    ...params,
    symbol: sourceSymbol(ref),
    note: ref.note,
    location,
    titleAttr: `${location} · ${st ? sourceStateLabel(st.state) : t('webview.sourceUnchecked')}`,
    tone: statusTone(st?.state),
  };
}

/** 构造用于 Call Trace Popover 展示的有序调用栈（发起 -> 中间透传跳 -> 落地）。 */
export function buildCallTrace(
  map: CodeMap,
  statuses: Readonly<Record<string, SourceStatus>>,
  levelEdge: { edge: MapEdge; edgeIds: readonly string[] },
): CallTraceItem[] {
  const items: CallTraceItem[] = [];
  const edgeById = new Map(map.edges.map(e => [e.id, e]));
  const nodeById = new Map(map.nodes.map(n => [n.id, n]));

  if (levelEdge.edgeIds.length > 1) {
    levelEdge.edgeIds.forEach((eid, eIdx) => {
      const e = edgeById.get(eid);
      if (!e) return;
      const own = e.sourceIds.filter(id => Object.hasOwn(map.sources, id));
      const via = (e.via ?? []).filter(id => Object.hasOwn(map.sources, id));
      const primary = own[0] ?? nodeById.get(e.from)?.sourceIds.find(id => Object.hasOwn(map.sources, id));
      if (primary) {
        const targetKind = own.includes(primary) ? 'edge' : 'node';
        const targetId = targetKind === 'edge' ? e.id : e.from;
        const item = makeTraceItem(map, statuses, {
          key: `${eid}:caller:${primary}:${eIdx}`,
          role: 'caller',
          roleLabel: e.label ?? e.branch ?? t('webview.callTraceCaller'),
          sourceId: primary,
          targetKind,
          targetId,
        });
        if (item) items.push(item);
      }
      via.forEach((vid, vIdx) => {
        const item = makeTraceItem(map, statuses, {
          key: `${eid}:via:${vid}:${vIdx}`,
          role: 'hop',
          roleLabel: t('webview.callTraceHop', { step: vIdx + 1 }),
          sourceId: vid,
          targetKind: 'edge',
          targetId: e.id,
        });
        if (item) items.push(item);
      });
    });
    return items;
  }

  const e = levelEdge.edge;
  const own = e.sourceIds.filter(id => Object.hasOwn(map.sources, id));
  const via = (e.via ?? []).filter(id => Object.hasOwn(map.sources, id));
  const fromNode = nodeById.get(e.from);
  const toNode = nodeById.get(e.to);

  const callerId = own[0] ?? fromNode?.sourceIds.find(id => Object.hasOwn(map.sources, id));
  if (callerId) {
    const targetKind = own.includes(callerId) ? 'edge' : 'node';
    const targetId = targetKind === 'edge' ? e.id : e.from;
    const item = makeTraceItem(map, statuses, {
      key: `caller:${callerId}`,
      role: 'caller',
      roleLabel: t('webview.callTraceCaller'),
      sourceId: callerId,
      targetKind,
      targetId,
    });
    if (item) items.push(item);
  }

  const hopSources = via.length > 0 ? [...own.slice(1), ...via] : own.slice(1);
  hopSources.forEach((sid, idx) => {
    const item = makeTraceItem(map, statuses, {
      key: `hop:${idx}:${sid}`,
      role: 'hop',
      roleLabel: t('webview.callTraceHop', { step: idx + 1 }),
      sourceId: sid,
      targetKind: 'edge',
      targetId: e.id,
    });
    if (item) items.push(item);
  });

  const targetId = toNode?.sourceIds.find(id => Object.hasOwn(map.sources, id));
  if (targetId && items.at(-1)?.sourceId !== targetId) {
    const item = makeTraceItem(map, statuses, {
      key: `target:${targetId}`,
      role: 'target',
      roleLabel: t('webview.callTraceTarget'),
      sourceId: targetId,
      targetKind: 'node',
      targetId: e.to,
    });
    if (item) items.push(item);
  }

  return items;
}

export interface VariantItem {
  sourceId: string;
  tag: string;
  symbol?: string;
  note?: string;
  location: string;
  titleAttr: string;
  tone: 'ok' | 'warn' | 'error' | 'idle';
}

/** 构造用于多态/并列实现切换器展示的分支列表。 */
export function buildVariantItems(
  map: CodeMap,
  statuses: Readonly<Record<string, SourceStatus>>,
  node: MapNode,
): VariantItem[] {
  const items: VariantItem[] = [];
  for (const sourceId of node.sourceIds) {
    const ref = map.sources[sourceId];
    if (!ref) continue;
    const st = statuses[sourceId];
    const file = st?.file ?? ref.file;
    const start = st?.startLine ?? ref.startLine;
    const end = st?.endLine ?? ref.endLine;
    const location = formatSourceRange(file, start, end, false);
    const sym = sourceSymbol(ref);
    const fallbackTag = (sym?.includes('.') ? sym.split('.')[0] : sym)
      ?? (file.split('/').pop() ?? file).replace(/\.[^.]+$/, '');
    items.push({
      sourceId,
      tag: ref.variantLabel ?? fallbackTag,
      symbol: sym,
      note: ref.note,
      location,
      titleAttr: `${location} · ${st ? sourceStateLabel(st.state) : t('webview.sourceUnchecked')}`,
      tone: statusTone(st?.state),
    });
  }
  return items;
}

export interface EdgeData {
  edge: MapEdge;
  active: boolean;
  related: boolean;
  dimmed: boolean;
  merged: number;
  bridgeHops: number;
  kind?: MapEdge['kind'];
  branch: boolean;
  interactive: boolean;
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
