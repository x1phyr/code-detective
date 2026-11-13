import type { CodeMap, MapNode } from '../../shared/types';

export interface Positioned {
  id: string;
  x: number;
  y: number;
}

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 76;

interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkNode[];
  layoutOptions?: Record<string, string>;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
}

interface ElkGraph extends ElkNode {
  children?: ElkNode[];
  edges?: ElkEdge[];
}

let worker: import('elkjs').ELK | undefined;

async function engine(): Promise<import('elkjs').ELK> {
  if (worker) return worker;
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  worker = new ELK();
  return worker;
}

/**
 * Deterministic fallback used when ELK is unavailable so the map stays usable.
 */
export function fallbackLayout(map: CodeMap): Record<string, Positioned> {
  const columns = new Map<string, number>();
  for (const node of map.nodes) columns.set(node.id, 0);
  const incoming = new Map<string, string[]>();
  for (const edge of map.edges) {
    const list = incoming.get(edge.to) ?? [];
    list.push(edge.from);
    incoming.set(edge.to, list);
  }
  for (let pass = 0; pass < map.nodes.length; pass += 1) {
    let changed = false;
    for (const node of map.nodes) {
      const depth = Math.max(0, ...(incoming.get(node.id) ?? []).map(from => (columns.get(from) ?? 0) + 1));
      if ((columns.get(node.id) ?? 0) < depth && depth <= map.nodes.length) {
        columns.set(node.id, depth);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // 竖向排列：依赖深度决定行（y），同一深度的节点横向并排（x）。
  const slots = new Map<number, number>();
  const output: Record<string, Positioned> = {};
  for (const node of map.nodes) {
    const depth = columns.get(node.id) ?? 0;
    const slot = slots.get(depth) ?? 0;
    slots.set(depth, slot + 1);
    output[node.id] = { id: node.id, x: slot * (NODE_WIDTH + 28), y: depth * (NODE_HEIGHT + 56) };
  }
  return output;
}

export async function computeLayout(map: CodeMap): Promise<Record<string, Positioned>> {
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
      'elk.spacing.nodeNode': '28',
      'elk.layered.spacing.nodeNodeBetweenLayers': '56',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children: map.nodes.map((node: MapNode) => ({ id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: map.edges.map(edge => ({ id: edge.id, sources: [edge.from], targets: [edge.to] })),
  };
  try {
    const result = await elk.layout(graph as never);
    const output: Record<string, Positioned> = {};
    for (const child of (result.children ?? []) as ElkNode[]) {
      output[child.id] = { id: child.id, x: child.x ?? 0, y: child.y ?? 0 };
    }
    const fallback = Object.keys(output).length === map.nodes.length ? undefined : fallbackLayout(map);
    for (const node of map.nodes) output[node.id] ??= fallback?.[node.id] ?? { id: node.id, x: 0, y: 0 };
    return output;
  } catch {
    return fallbackLayout(map);
  }
}
