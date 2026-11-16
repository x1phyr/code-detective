/**
 * 脉络图布局引擎（支持原地展开的 ELK Compound Group 阶段框）。
 *
 * - 顶层普通节点与未展开的阶段块直接作为 root children；
 * - 已展开的阶段作为含 `children` 的 ELK 复合节点（`INCLUDE_CHILDREN`），上下游保持同屏；
 * - 所有子节点坐标与组内连线折点均折算为全局画布坐标，方便 Vue Flow 统一渲染。
 */
export interface Size {
  width: number;
  height: number;
}

export interface LayoutGroupInput {
  id: string;
  childIds: string[];
}

export interface LayoutGraph {
  nodes: ({ id: string } & Size)[];
  groups?: LayoutGroupInput[];
  edges: { id: string; from: string; to: string; branch?: boolean; label?: Size }[];
}

export interface Point {
  x: number;
  y: number;
}

export interface NodeBox extends Point, Size {
  id: string;
}

export interface EdgeRoute {
  points: Point[];
  /** 标签中心点。 */
  label?: Point;
}

export interface LayoutResult {
  nodes: Record<string, NodeBox>;
  groups: Record<string, NodeBox>;
  edges: Record<string, EdgeRoute>;
}

export const NODE_WIDTH = 224;
const GROUP_PAD = { top: 38, left: 16, bottom: 16, right: 16 };

interface ElkLabel extends Partial<Point>, Size {
  text?: string;
}

interface ElkSection {
  startPoint: Point;
  endPoint: Point;
  bendPoints?: Point[];
}

interface ElkNode extends Partial<Point> {
  id: string;
  width?: number;
  height?: number;
  children?: ElkNode[];
  edges?: ElkEdge[];
  layoutOptions?: Record<string, string>;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  container?: string;
  labels?: ElkLabel[];
  sections?: ElkSection[];
  layoutOptions?: Record<string, string>;
}

interface ElkGraph extends ElkNode {
  edges?: ElkEdge[];
}

let worker: import('elkjs').ELK | undefined;

async function engine(): Promise<import('elkjs').ELK> {
  if (worker) return worker;
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  worker = new ELK();
  return worker;
}

/** ELK 不可用时的确定性兜底布局：按依赖深度分行，并为展开分组计算外包框。 */
export function fallbackLayout(map: LayoutGraph): LayoutResult {
  const depthOf = new Map<string, number>();
  for (const node of map.nodes) depthOf.set(node.id, 0);
  const incoming = new Map<string, string[]>();
  for (const edge of map.edges) {
    const list = incoming.get(edge.to) ?? [];
    list.push(edge.from);
    incoming.set(edge.to, list);
  }
  for (let pass = 0; pass < map.nodes.length; pass += 1) {
    let changed = false;
    for (const node of map.nodes) {
      const depth = Math.max(0, ...(incoming.get(node.id) ?? []).map(from => (depthOf.get(from) ?? 0) + 1));
      if ((depthOf.get(node.id) ?? 0) < depth && depth <= map.nodes.length) {
        depthOf.set(node.id, depth);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const rows = new Map<number, typeof map.nodes>();
  for (const node of map.nodes) {
    const depth = depthOf.get(node.id) ?? 0;
    rows.set(depth, [...(rows.get(depth) ?? []), node]);
  }
  const nodes: Record<string, NodeBox> = {};
  let y = 0;
  for (const depth of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(depth)!;
    let x = 0;
    for (const node of row) {
      nodes[node.id] = { id: node.id, x, y, width: node.width, height: node.height };
      x += node.width + 32;
    }
    y += Math.max(...row.map(node => node.height)) + 68;
  }

  const groups: Record<string, NodeBox> = {};
  for (const group of map.groups ?? []) {
    const boxes = group.childIds.map(id => nodes[id]).filter((b): b is NodeBox => Boolean(b));
    if (boxes.length === 0) continue;
    const minX = Math.min(...boxes.map(b => b.x)) - GROUP_PAD.left;
    const minY = Math.min(...boxes.map(b => b.y)) - GROUP_PAD.top;
    const maxX = Math.max(...boxes.map(b => b.x + b.width)) + GROUP_PAD.right;
    const maxY = Math.max(...boxes.map(b => b.y + b.height)) + GROUP_PAD.bottom;
    groups[group.id] = { id: group.id, x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  return { nodes, groups, edges: {} };
}

export async function computeLayout(map: LayoutGraph): Promise<LayoutResult> {
  if (map.nodes.length === 0) return { nodes: {}, groups: {}, edges: {} };
  let elk: import('elkjs').ELK;
  try {
    elk = await engine();
  } catch {
    return fallbackLayout(map);
  }

  const sizeById = new Map(map.nodes.map(node => [node.id, node]));
  const groupedChildOwner = new Map<string, string>();
  for (const group of map.groups ?? []) {
    for (const childId of group.childIds) {
      if (sizeById.has(childId)) groupedChildOwner.set(childId, group.id);
    }
  }

  const rootChildren: ElkNode[] = [];
  const emittedGroups = new Set<string>();

  // Preserve original node ordering so main path stays aligned vertically
  for (const node of map.nodes) {
    const ownerGroup = groupedChildOwner.get(node.id);
    if (!ownerGroup) {
      rootChildren.push({ id: node.id, width: node.width, height: node.height });
      continue;
    }
    if (emittedGroups.has(ownerGroup)) continue;
    emittedGroups.add(ownerGroup);
    const groupDef = (map.groups ?? []).find(g => g.id === ownerGroup);
    if (!groupDef) continue;
    const children = groupDef.childIds
      .map(cid => sizeById.get(cid))
      .filter((n): n is { id: string } & Size => Boolean(n))
      .map(n => ({ id: n.id, width: n.width, height: n.height }));
    if (children.length > 0) {
      rootChildren.push({
        id: groupDef.id,
        layoutOptions: {
          'elk.padding': `[top=${GROUP_PAD.top},left=${GROUP_PAD.left},bottom=${GROUP_PAD.bottom},right=${GROUP_PAD.right}]`,
          'elk.algorithm': 'layered',
          'elk.direction': 'DOWN',
          'elk.edgeRouting': 'ORTHOGONAL',
          'elk.spacing.nodeNode': '24',
          'elk.layered.spacing.nodeNodeBetweenLayers': '32',
        },
        children,
      });
    }
  }

  const graph: ElkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '32',
      'elk.spacing.edgeNode': '16',
      'elk.spacing.edgeEdge': '12',
      'elk.spacing.edgeLabel': '4',
      'elk.layered.spacing.nodeNodeBetweenLayers': '42',
      'elk.layered.spacing.edgeNodeBetweenLayers': '16',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '10',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.nodePlacement.favorStraightEdges': 'true',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      'elk.layered.mergeEdges': 'true',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.layered.edgeLabels.sideSelection': 'SMART_DOWN',
    },
    children: rootChildren,
    edges: map.edges.map(edge => ({
      id: edge.id,
      sources: [edge.from],
      targets: [edge.to],
      ...(edge.label ? { labels: [{ text: edge.id, width: edge.label.width, height: edge.label.height }] } : {}),
      layoutOptions: edge.branch
        ? { 'elk.layered.priority.straightness': '0', 'elk.layered.priority.shortness': '0' }
        : { 'elk.layered.priority.straightness': '10', 'elk.layered.priority.shortness': '10' },
    })),
  };

  try {
    const result = (await elk.layout(graph as never)) as unknown as ElkGraph;
    const nodes: Record<string, NodeBox> = {};
    const groups: Record<string, NodeBox> = {};
    const containerOffsets = new Map<string, Point>([['root', { x: 0, y: 0 }]]);

    for (const child of result.children ?? []) {
      const gx = child.x ?? 0;
      const gy = child.y ?? 0;
      if (child.children && child.children.length > 0) {
        groups[child.id] = {
          id: child.id,
          x: gx,
          y: gy,
          width: child.width ?? NODE_WIDTH + GROUP_PAD.left + GROUP_PAD.right,
          height: child.height ?? 120,
        };
        containerOffsets.set(child.id, { x: gx, y: gy });
        for (const inner of child.children) {
          nodes[inner.id] = {
            id: inner.id,
            x: gx + (inner.x ?? 0),
            y: gy + (inner.y ?? 0),
            width: inner.width ?? NODE_WIDTH,
            height: inner.height ?? 0,
          };
        }
      } else {
        nodes[child.id] = {
          id: child.id,
          x: gx,
          y: gy,
          width: child.width ?? NODE_WIDTH,
          height: child.height ?? 0,
        };
      }
    }

    if (map.nodes.some(node => !nodes[node.id])) return fallbackLayout(map);

    const edges: Record<string, EdgeRoute> = {};
    const collectEdges = (list: readonly ElkEdge[] | undefined, fallbackContainer: string): void => {
      for (const edge of list ?? []) {
        const section = edge.sections?.[0];
        if (!section) continue;
        const offset = containerOffsets.get(edge.container ?? fallbackContainer) ?? { x: 0, y: 0 };
        const shift = (pt: Point): Point => ({ x: pt.x + offset.x, y: pt.y + offset.y });
        const label = edge.labels?.[0];
        edges[edge.id] = {
          points: [
            shift(section.startPoint),
            ...(section.bendPoints ?? []).map(shift),
            shift(section.endPoint),
          ],
          ...(label && label.x !== undefined && label.y !== undefined
            ? { label: { x: label.x + offset.x + label.width / 2, y: label.y + offset.y + label.height / 2 } }
            : {}),
        };
      }
    };
    collectEdges(result.edges, 'root');
    for (const child of result.children ?? []) {
      if (child.edges?.length) collectEdges(child.edges, child.id);
    }

    return { nodes, groups, edges };
  } catch {
    return fallbackLayout(map);
  }
}

/** 正交折线 → 带圆角的 SVG 路径。 */
export function roundedPath(points: readonly Point[], radius = 6): string {
  if (points.length < 2) return '';
  const [first, ...rest] = points;
  let d = `M ${first!.x} ${first!.y}`;
  for (let index = 0; index < rest.length - 1; index += 1) {
    const previous = points[index]!;
    const corner = rest[index]!;
    const next = rest[index + 1]!;
    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r <= 0.5) {
      d += ` L ${corner.x} ${corner.y}`;
      continue;
    }
    const a = { x: corner.x - ((corner.x - previous.x) / inLength) * r, y: corner.y - ((corner.y - previous.y) / inLength) * r };
    const b = { x: corner.x + ((next.x - corner.x) / outLength) * r, y: corner.y + ((next.y - corner.y) / outLength) * r };
    d += ` L ${a.x} ${a.y} Q ${corner.x} ${corner.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L ${last.x} ${last.y}`;
}
