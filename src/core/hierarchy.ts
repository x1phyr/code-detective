import type { CodeMap, MapEdge, MapNode } from '../../shared/types';

/**
 * 脉络图的阶段分组与支线折叠投影（原地展开分组框模型）。
 *
 * - 节点最多有 1 层 `parent`（阶段分组）。
 * - 分组未展开时：在画布上显示为一个带「展开 · N 步」按钮的阶段块，跨入/跨出该分组的连线提升到该分组节点。
 * - 分组展开时（Compound Group）：分组变为原地包围框（`CompoundGroup`），其内部子节点与外部上下游节点同屏渲染，告别“钻进子层看不见外面”。
 */

/** 画布上的一条可见连线：原始连线，或收起分组时提升合并后的代表连线。 */
export interface LevelEdge {
  id: string;
  from: string;
  to: string;
  /** 包含的所有原始连线 id。 */
  edgeIds: string[];
  /** 代表连线（第一条）。 */
  edge: MapEdge;
  /** 是否全部为支线（只要含一条主干连线就算主干）。 */
  branch: boolean;
}

export interface CompoundGroup {
  node: MapNode;
  childIds: string[];
}

export interface CompoundProjection {
  /** 当前在画布上作为普通卡片渲染的节点（含未展开的分组块、已展开分组内的可见子节点、普通顶层节点）。 */
  nodes: MapNode[];
  /** 当前已原地展开的分组包围框。 */
  groups: CompoundGroup[];
  /** 当前可见节点之间的连线。 */
  edges: LevelEdge[];
  /** 节点 id → 被折叠在它支线后面的节点数量。 */
  hiddenBranches: Map<string, number>;
  /** 分组节点 id → 直接子节点数量。 */
  groupChildCounts: Map<string, number>;
}

/** id → 节点。 */
export function nodeIndex(map: CodeMap): Map<string, MapNode> {
  return new Map(map.nodes.map(node => [node.id, node]));
}

/** 分组块 id → 直接子节点数。 */
export function childCounts(map: CodeMap): Map<string, number> {
  const counts = new Map<string, number>();
  const known = nodeIndex(map);
  for (const node of map.nodes) {
    if (node.parent && known.has(node.parent)) counts.set(node.parent, (counts.get(node.parent) ?? 0) + 1);
  }
  return counts;
}

/** 返回 parent 链里第一个出现环的节点 id，没有环返回 undefined。 */
export function findParentCycle(map: CodeMap): string | undefined {
  const known = nodeIndex(map);
  for (const node of map.nodes) {
    const seen = new Set<string>([node.id]);
    let cursor = node.parent ? known.get(node.parent) : undefined;
    while (cursor) {
      if (seen.has(cursor.id)) return node.id;
      seen.add(cursor.id);
      cursor = cursor.parent ? known.get(cursor.parent) : undefined;
    }
  }
  return undefined;
}

/**
 * 节点在当前展开态下的可见代表：
 * - 顶层节点返回自己；
 * - 子节点若其所属分组已展开，返回自己；若分组未展开，返回分组节点 id。
 */
export function visibleRepresentative(
  map: CodeMap,
  nodeId: string,
  expandedGroups: ReadonlySet<string>,
  known = nodeIndex(map),
): string | undefined {
  const node = known.get(nodeId);
  if (!node) return undefined;
  if (node.parent && known.has(node.parent)) {
    return expandedGroups.has(node.parent) ? node.id : node.parent;
  }
  return node.id;
}

/**
 * 计算当前画布的原地分组与支线折叠投影。
 */
export function projectCompoundGraph(
  map: CodeMap,
  expandedGroups: ReadonlySet<string>,
  expandedBranches: ReadonlySet<string>,
): CompoundProjection {
  const known = nodeIndex(map);
  const groupChildCounts = childCounts(map);

  // 1. 先确定未折叠支线前的候选节点：
  //    - 已展开的分组作为包围框，不作为普通卡片节点，而是放入其子节点；
  //    - 未展开的分组本身作为普通卡片节点，其子节点不出现。
  const candidateNodes: MapNode[] = [];
  for (const node of map.nodes) {
    const hasParent = Boolean(node.parent && known.has(node.parent));
    if (hasParent) {
      if (expandedGroups.has(node.parent!)) {
        candidateNodes.push(node);
      }
    } else {
      const isExpandedGroup = (groupChildCounts.get(node.id) ?? 0) > 0 && expandedGroups.has(node.id);
      if (!isExpandedGroup) {
        candidateNodes.push(node);
      }
    }
  }

  // 2. 将所有原始连线投影到 candidateNodes：
  const candidateIds = new Set(candidateNodes.map(n => n.id));
  const merged = new Map<string, LevelEdge>();
  for (const edge of map.edges) {
    const from = visibleRepresentative(map, edge.from, expandedGroups, known);
    const to = visibleRepresentative(map, edge.to, expandedGroups, known);
    if (!from || !to || from === to) continue;
    // 若端点本身是一个已展开的分组（比如边直接连在分组节点上），重定向到该分组的入口/出口子节点
    const resolvedFrom = candidateIds.has(from)
      ? from
      : candidateNodes.find(n => n.parent === from)?.id;
    const resolvedTo = candidateIds.has(to)
      ? to
      : candidateNodes.find(n => n.parent === to)?.id;
    if (!resolvedFrom || !resolvedTo || resolvedFrom === resolvedTo) continue;

    const direct = resolvedFrom === edge.from && resolvedTo === edge.to;
    const key = direct ? `edge:${edge.id}` : `lift:${resolvedFrom}->${resolvedTo}`;
    const existing = merged.get(key);
    if (existing) {
      existing.edgeIds.push(edge.id);
      existing.branch &&= Boolean(edge.branch);
    } else {
      merged.set(key, {
        id: direct ? edge.id : key,
        from: resolvedFrom,
        to: resolvedTo,
        edgeIds: [edge.id],
        edge,
        branch: Boolean(edge.branch),
      });
    }
  }

  const allEdges = [...merged.values()];

  // 3. 在候选节点图上执行支线折叠：
  const { visible, hidden } = collapseBranches({ nodes: candidateNodes, edges: allEdges }, expandedBranches);
  const visibleNodes = candidateNodes.filter(n => visible.has(n.id));
  const visibleEdges = allEdges.filter(e => visible.has(e.from) && visible.has(e.to));

  // 4. 组装已展开且至少有 1 个可见子节点的分组框：
  const groups: CompoundGroup[] = [];
  for (const [groupId, count] of groupChildCounts) {
    if (count > 0 && expandedGroups.has(groupId)) {
      const groupNode = known.get(groupId);
      const childIds = visibleNodes.filter(n => n.parent === groupId).map(n => n.id);
      if (groupNode && childIds.length > 0) {
        groups.push({ node: groupNode, childIds });
      }
    }
  }

  return {
    nodes: visibleNodes,
    groups,
    edges: visibleEdges,
    hiddenBranches: hidden,
    groupChildCounts,
  };
}

export function collapseBranches(
  level: { nodes: readonly MapNode[]; edges: readonly LevelEdge[] },
  expanded: ReadonlySet<string>,
): {
  visible: Set<string>;
  hidden: Map<string, number>;
} {
  const ids = new Set(level.nodes.map(node => node.id));
  const outgoing = new Map<string, LevelEdge[]>();
  const mainIncoming = new Set<string>();
  for (const edge of level.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
    if (!edge.branch) mainIncoming.add(edge.to);
  }
  const anyIncoming = new Set(level.edges.filter(edge => ids.has(edge.from)).map(edge => edge.to));
  let roots = level.nodes.filter(node => !anyIncoming.has(node.id)).map(node => node.id);
  if (roots.length === 0) {
    const first = level.nodes.find(node => !mainIncoming.has(node.id)) ?? level.nodes[0];
    roots = first ? [first.id] : [];
  }

  const visible = new Set<string>();
  const walk = (start: string[]): void => {
    const queue = [...start];
    while (queue.length) {
      const id = queue.shift()!;
      if (visible.has(id)) continue;
      visible.add(id);
      for (const edge of outgoing.get(id) ?? []) {
        if (!edge.branch || expanded.has(id)) queue.push(edge.to);
      }
    }
  };
  const foldedUnder = (id: string): Set<string> => {
    const reach = new Set<string>();
    if (expanded.has(id)) return reach;
    const stack = (outgoing.get(id) ?? []).filter(edge => edge.branch).map(edge => edge.to);
    while (stack.length) {
      const next = stack.pop()!;
      if (visible.has(next) || reach.has(next)) continue;
      reach.add(next);
      for (const edge of outgoing.get(next) ?? []) stack.push(edge.to);
    }
    return reach;
  };

  walk(roots);
  for (;;) {
    const covered = new Set<string>();
    for (const id of visible) for (const next of foldedUnder(id)) covered.add(next);
    const orphan = level.nodes.find(node => !visible.has(node.id) && !covered.has(node.id));
    if (!orphan) break;
    walk([orphan.id]);
  }

  const hidden = new Map<string, number>();
  for (const id of visible) {
    const size = foldedUnder(id).size;
    if (size > 0) hidden.set(id, size);
  }
  return { visible, hidden };
}
