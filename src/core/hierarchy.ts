import type { CodeMap, MapEdge, MapNode } from '../../shared/types';

/**
 * 地图的层级视图。
 *
 * - 节点通过 `parent` 归属到某个功能块；没有 parent 的节点在顶层。
 * - 有子节点的节点就是“功能块”，画布一次只画一层：当前功能块的直接子节点。
 * - 跨层的连线会被“提升”到当前层：两端分别找到它们在当前层的祖先，
 *   祖先不同才画；同一对祖先之间的多条连线合并成一条。
 */

/** 当前层用到的连线：原始连线，或若干条跨层连线合并后的代表。 */
export interface LevelEdge {
  id: string;
  from: string;
  to: string;
  /** 合并进来的原始连线 id；第一个是代表，用于选中与跳转源码。 */
  edgeIds: string[];
  /** 代表连线（第一条）。 */
  edge: MapEdge;
  /** 是否全部是支线（任意一条是主干就算主干）。 */
  branch: boolean;
}

export interface MapLevel {
  /** 当前功能块 id；顶层为 undefined。 */
  parent?: string;
  nodes: MapNode[];
  edges: LevelEdge[];
}

/** id → 节点。 */
export function nodeIndex(map: CodeMap): Map<string, MapNode> {
  return new Map(map.nodes.map(node => [node.id, node]));
}

/** 功能块 id → 直接子节点数。 */
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

/** 从顶层到 `id`（含）的功能块路径；`id` 不存在时返回空数组。 */
export function ancestry(map: CodeMap, id: string | undefined): MapNode[] {
  if (!id) return [];
  const known = nodeIndex(map);
  const chain: MapNode[] = [];
  const seen = new Set<string>();
  let cursor = known.get(id);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.parent ? known.get(cursor.parent) : undefined;
  }
  return chain;
}

/** 节点在 `level` 层的代表：它自己，或它在这一层的祖先功能块。不在这一层下面则返回 undefined。 */
export function representativeAt(map: CodeMap, id: string, level: string | undefined, known = nodeIndex(map)): string | undefined {
  const seen = new Set<string>();
  let cursor = known.get(id);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    const parent = cursor.parent && known.has(cursor.parent) ? cursor.parent : undefined;
    if (parent === level) return cursor.id;
    cursor = parent ? known.get(parent) : undefined;
  }
  return undefined;
}

/** 计算某一层要画的节点与连线。`level` 不存在时退回顶层。 */
export function levelOf(map: CodeMap, level: string | undefined): MapLevel {
  const known = nodeIndex(map);
  const parent = level && known.has(level) ? level : undefined;
  const nodes = map.nodes.filter(node => {
    const owner = node.parent && known.has(node.parent) ? node.parent : undefined;
    return owner === parent;
  });
  const merged = new Map<string, LevelEdge>();
  for (const edge of map.edges) {
    const from = representativeAt(map, edge.from, parent, known);
    const to = representativeAt(map, edge.to, parent, known);
    if (!from || !to || from === to) continue;
    const direct = from === edge.from && to === edge.to;
    const key = direct ? `edge:${edge.id}` : `lift:${from}->${to}`;
    const existing = merged.get(key);
    if (existing) {
      existing.edgeIds.push(edge.id);
      existing.branch &&= Boolean(edge.branch);
    } else {
      merged.set(key, { id: direct ? edge.id : key, from, to, edgeIds: [edge.id], edge, branch: Boolean(edge.branch) });
    }
  }
  return { parent, nodes, edges: [...merged.values()] };
}

/**
 * 支线折叠：从当前层的“主干”出发（入口 = 没有主干入边的节点），只沿主干边能到达的节点默认显示；
 * 只能经由支线到达的节点被折叠到发出该支线的节点上，显示成“+N”。
 * `expanded` 里的节点会把它的支线展开。
 */
export function collapseBranches(level: MapLevel, expanded: ReadonlySet<string>): {
  visible: Set<string>;
  /** 节点 id → 被折叠在它下面的节点数。 */
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
  // 入口：没有任何入边的节点；若全在环里，就取第一个没有主干入边的节点（再不行取第一个节点）。
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
  // 兜底：既不可见、也没有被折叠到任何可见节点下的节点，作为新的入口显示，避免节点“消失”。
  for (;;) {
    const covered = new Set<string>();
    for (const id of visible) for (const next of foldedUnder(id)) covered.add(next);
    const orphan = level.nodes.find(node => !visible.has(node.id) && !covered.has(node.id));
    if (!orphan) break;
    walk([orphan.id]);
  }

  // 统计每个可见节点下折叠了多少个节点（从它的支线出发能到、且当前不可见的节点）。
  const hidden = new Map<string, number>();
  for (const id of visible) {
    const size = foldedUnder(id).size;
    if (size > 0) hidden.set(id, size);
  }
  return { visible, hidden };
}
