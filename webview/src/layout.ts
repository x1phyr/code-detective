/**
 * 布局只关心“当前层里可见的节点和连线”，与地图格式解耦。
 *
 * - 节点尺寸用真实渲染后的尺寸（首次用估计值），避免连线和标签压在节点上。
 * - 连线的走向和标签位置都取 ELK 的路由结果，而不是在两端之间直接连线，
 *   这样跨层的长连线会绕开中间的节点，标签也不会落在节点上。
 * - 主干连线权重高、走中轴；支线权重低、被挤到两侧。
 */
export interface Size {
  width: number;
  height: number;
}

export interface LayoutGraph {
  nodes: ({ id: string } & Size)[];
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
  edges: Record<string, EdgeRoute>;
}

export const NODE_WIDTH = 220;

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
  layoutOptions?: Record<string, string>;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
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

/** ELK 不可用时的确定性兜底布局：按依赖深度分行，同一行横向并排；连线由画布自行连接。 */
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
    y += Math.max(...row.map(node => node.height)) + 64;
  }
  return { nodes, edges: {} };
}

export async function computeLayout(map: LayoutGraph): Promise<LayoutResult> {
  let elk: import('elkjs').ELK;
  try {
    elk = await engine();
  } catch {
    return fallbackLayout(map);
  }
  const graph: ElkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '32',
      'elk.spacing.edgeNode': '16',
      'elk.spacing.edgeEdge': '12',
      'elk.spacing.edgeLabel': '4',
      'elk.layered.spacing.nodeNodeBetweenLayers': '40',
      'elk.layered.spacing.edgeNodeBetweenLayers': '16',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '10',
      // 主干对齐成一条竖线：同一节点的进/出边共用一个端口，节点放置偏向拉直主干，
      // 并尊重地图里节点/连线的书写顺序（主干在左，支线在右）。
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.nodePlacement.favorStraightEdges': 'true',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      'elk.layered.mergeEdges': 'true',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.layered.edgeLabels.sideSelection': 'SMART_DOWN',
    },
    children: map.nodes.map(node => ({ id: node.id, width: node.width, height: node.height })),
    edges: map.edges.map(edge => ({
      id: edge.id,
      sources: [edge.from],
      targets: [edge.to],
      ...(edge.label ? { labels: [{ text: edge.id, width: edge.label.width, height: edge.label.height }] } : {}),
      // 主干尽量拉直、支线可以弯：ELK 会优先让高优先级的边保持竖直、短。
      layoutOptions: edge.branch
        ? { 'elk.layered.priority.straightness': '0', 'elk.layered.priority.shortness': '0' }
        : { 'elk.layered.priority.straightness': '10', 'elk.layered.priority.shortness': '10' },
    })),
  };
  try {
    const result = (await elk.layout(graph as never)) as unknown as ElkGraph;
    const nodes: Record<string, NodeBox> = {};
    for (const child of result.children ?? []) {
      nodes[child.id] = { id: child.id, x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? NODE_WIDTH, height: child.height ?? 0 };
    }
    if (map.nodes.some(node => !nodes[node.id])) return fallbackLayout(map);
    const edges: Record<string, EdgeRoute> = {};
    for (const edge of result.edges ?? []) {
      const section = edge.sections?.[0];
      if (!section) continue;
      const label = edge.labels?.[0];
      edges[edge.id] = {
        points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint],
        ...(label && label.x !== undefined && label.y !== undefined
          ? { label: { x: label.x + label.width / 2, y: label.y + label.height / 2 } }
          : {}),
      };
    }
    return { nodes, edges };
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
