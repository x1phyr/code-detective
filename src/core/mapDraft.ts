import type { CodeMap, MapEdge, MapNode, SourceRef, WalkthroughStep } from '../../shared/types';
import { sanitizeMapId } from '../ai/mapNaming';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const NODE_KINDS = new Set(['step', 'function', 'condition', 'event']);
const EDGE_KINDS = new Set(['call', 'flow', 'event', 'related']);
const MAX_SHORT_TEXT = 200;

function validId(value: unknown): string | undefined {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : undefined;
}

/** Clips schema-limited text so one over-long title cannot fail the whole map. */
function shortText(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  if (text.length === 0) return fallback;
  return text.slice(0, MAX_SHORT_TEXT);
}

function line(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= 1 ? number : undefined;
}

function sourceRef(value: unknown): SourceRef | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.file !== 'string' || value.file.length === 0) return undefined;
  const startLine = line(value.startLine);
  const endLine = line(value.endLine);
  if (startLine === undefined || endLine === undefined || endLine < startLine) return undefined;
  // anchorText is always regenerated from the real file, never trusted from the model.
  return { file: value.file, startLine, endLine };
}

function node(value: unknown): MapNode | undefined {
  if (!isRecord(value)) return undefined;
  const id = validId(value.id);
  const label = shortText(value.label);
  if (!id || !label) return undefined;
  const sourceIds = Array.isArray(value.sourceIds)
    ? value.sourceIds.filter((item): item is string => validId(item) !== undefined)
    : [];
  const output: MapNode = { id, label, sourceIds };
  if (typeof value.description === 'string') output.description = value.description;
  if (typeof value.kind === 'string' && NODE_KINDS.has(value.kind)) {
    output.kind = value.kind as MapNode['kind'];
  }
  return output;
}

function edge(value: unknown): MapEdge | undefined {
  if (!isRecord(value)) return undefined;
  const id = validId(value.id);
  const from = validId(value.from);
  const to = validId(value.to);
  if (!id || !from || !to) return undefined;
  const sourceIds = Array.isArray(value.sourceIds)
    ? value.sourceIds.filter((item): item is string => validId(item) !== undefined)
    : [];
  const output: MapEdge = { id, from, to, sourceIds };
  const label = shortText(value.label);
  if (label) output.label = label;
  if (typeof value.description === 'string') output.description = value.description;
  if (typeof value.kind === 'string' && EDGE_KINDS.has(value.kind)) {
    output.kind = value.kind as MapEdge['kind'];
  }
  return output;
}

function step(value: unknown): WalkthroughStep | undefined {
  if (!isRecord(value)) return undefined;
  const id = validId(value.id);
  const title = shortText(value.title);
  if (!id || !title) return undefined;
  const ids = (input: unknown): string[] => Array.isArray(input)
    ? input.filter((item): item is string => validId(item) !== undefined)
    : [];
  const output: WalkthroughStep = { id, title, nodeIds: ids(value.nodeIds), edgeIds: ids(value.edgeIds) };
  if (typeof value.description === 'string') output.description = value.description;
  return output;
}

function list<T>(value: unknown, parse: (item: unknown) => T | undefined): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(parse).filter((item): item is T => item !== undefined);
}

/**
 * Normalizes model-authored JSON into something the strict validator accepts:
 * fills the defaults the writer always provides, coerces ids and text into the
 * schema's shapes, and strips `anchorText`, which is regenerated from the real
 * files instead of trusted from the model.
 */
export function normalizeDraft(input: unknown): CodeMap {
  if (!isRecord(input)) throw new Error('地图必须是 JSON 对象。');
  const draft = structuredClone(input) as Record<string, unknown>;
  const title = shortText(draft.title);
  if (!title) throw new Error('地图需要一个非空的 title（不超过 200 字）。');
  if (!isRecord(draft.sources)) {
    throw new Error('sources 必须是对象：键为 sourceId，值为 file / startLine / endLine。');
  }

  const sources: Record<string, SourceRef> = {};
  for (const [key, value] of Object.entries(draft.sources)) {
    const id = validId(key);
    const ref = sourceRef(value);
    if (id && ref) sources[id] = ref;
  }

  const map: CodeMap = {
    schemaVersion: 1,
    id: sanitizeMapId(typeof draft.id === 'string' ? draft.id : title),
    title,
    sources,
    nodes: list(draft.nodes, node),
    edges: list(draft.edges, edge),
  };
  if (typeof draft.description === 'string') map.description = draft.description;
  if (Array.isArray(draft.walkthrough)) map.walkthrough = list(draft.walkthrough, step);
  return map;
}

/**
 * Shape the chat model is asked to produce: identical to a v1 map minus
 * `anchorText` (and minus `schemaVersion`, which the host adds). Keeping the
 * anchor text out of the model's hands removes the single most common
 * validation failure — mis-copied source lines.
 */
export const DRAFT_MAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'sources', 'nodes', 'edges'],
  properties: {
    id: { type: 'string', description: 'kebab-case 地图 id，可省略' },
    title: { type: 'string', description: '地图标题，不超过 200 字' },
    description: { type: 'string', description: '可选说明' },
    sources: {
      type: 'object',
      description: '源码位置表，键为 sourceId',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'startLine', 'endLine'],
        properties: {
          file: { type: 'string', description: '工作区相对路径，使用 / 分隔' },
          startLine: { type: 'integer', minimum: 1 },
          endLine: { type: 'integer', minimum: 1 },
        },
      },
    },
    nodes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'sourceIds'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          description: { type: 'string' },
          kind: { enum: ['step', 'function', 'condition', 'event'] },
          sourceIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'from', 'to', 'sourceIds'],
        properties: {
          id: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          label: { type: 'string' },
          description: { type: 'string' },
          kind: { enum: ['call', 'flow', 'event', 'related'] },
          sourceIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    walkthrough: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'nodeIds', 'edgeIds'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          nodeIds: { type: 'array', items: { type: 'string' } },
          edgeIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export interface DroppedItem {
  id: string;
  reason: string;
}

export interface AnchorFillResult {
  map: CodeMap;
  /** Sources removed because the file or the line range could not be read. */
  droppedSources: DroppedItem[];
  droppedNodes: DroppedItem[];
  droppedEdges: DroppedItem[];
  droppedSteps: DroppedItem[];
  /** Sources whose range had to be clamped to the file length. */
  clamped: string[];
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}

/**
 * Rebuilds every source from the real file so `anchorText` always matches the
 * declared range. A source that cannot be resolved is dropped together with the
 * references to it, and the resulting map is still schema-valid — the caller can
 * report the drops back to the model instead of failing the whole request.
 */
export function fillAnchors(
  input: CodeMap,
  read: (file: string) => string | undefined,
): AnchorFillResult {
  const droppedSources: DroppedItem[] = [];
  const clamped: string[] = [];
  const sources: Record<string, SourceRef> = {};
  const fullText = new Map<string, string>();

  for (const [id, ref] of Object.entries(input.sources ?? {})) {
    let text = fullText.get(ref.file);
    if (text === undefined) {
      text = read(ref.file);
      if (text === undefined) {
        droppedSources.push({ id, reason: `无法读取 ${ref.file}` });
        continue;
      }
      fullText.set(ref.file, text);
    }
    const lines = splitLines(text);
    if (text.length === 0 || lines.every(line => line.trim().length === 0)) {
      droppedSources.push({ id, reason: `${ref.file} 为空文件` });
      continue;
    }
    // Trailing newline produces an empty final element; keep anchors on real content.
    const last = lines.length > 1 && lines.at(-1) === '' ? lines.length - 1 : lines.length;
    const from = Math.min(Math.max(ref.startLine, 1), last);
    const to = Math.min(Math.max(ref.endLine, from), last);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) {
      droppedSources.push({ id, reason: `${ref.file} 的行号无效` });
      continue;
    }
    if (from !== ref.startLine || to !== ref.endLine) {
      clamped.push(`${id}: ${ref.startLine}-${ref.endLine} → ${from}-${to}`);
    }
    sources[id] = {
      file: ref.file,
      startLine: from,
      endLine: to,
      anchorText: lines.slice(from - 1, to).join('\n'),
    };
  }

  const keepSource = (ids: readonly string[] | undefined): string[] =>
    [...new Set(ids ?? [])].filter(id => sources[id] !== undefined);

  const droppedNodes: DroppedItem[] = [];
  const nodes: MapNode[] = [];
  for (const node of input.nodes ?? []) {
    const sourceIds = keepSource(node.sourceIds);
    if (node.sourceIds?.length && sourceIds.length === 0) {
      droppedNodes.push({ id: node.id, reason: '引用的源码位置都不可用' });
      continue;
    }
    nodes.push({ ...node, sourceIds });
  }

  const nodeIds = new Set(nodes.map(node => node.id));
  const droppedEdges: DroppedItem[] = [];
  const edges: MapEdge[] = [];
  for (const edge of input.edges ?? []) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      droppedEdges.push({ id: edge.id, reason: `端点 ${edge.from} → ${edge.to} 已被移除` });
      continue;
    }
    edges.push({ ...edge, sourceIds: keepSource(edge.sourceIds) });
  }

  const edgeIds = new Set(edges.map(edge => edge.id));
  const droppedSteps: DroppedItem[] = [];
  const walkthrough: WalkthroughStep[] = [];
  for (const step of input.walkthrough ?? []) {
    const nodeRefs = (step.nodeIds ?? []).filter(id => nodeIds.has(id));
    const edgeRefs = (step.edgeIds ?? []).filter(id => edgeIds.has(id));
    if (nodeRefs.length === 0 && edgeRefs.length === 0) {
      droppedSteps.push({ id: step.id, reason: '引用的节点与连线都被移除了' });
      continue;
    }
    walkthrough.push({ ...step, nodeIds: nodeRefs, edgeIds: edgeRefs });
  }

  if (nodes.length === 0) {
    throw new Error('没有任何节点能对应到可读的源码位置；请先读取文件确认行号后再提交。');
  }

  const map: CodeMap = {
    schemaVersion: 1,
    id: input.id,
    title: input.title,
    sources,
    nodes,
    edges,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.walkthrough === undefined ? {} : { walkthrough }),
  };
  return { map, droppedSources, droppedNodes, droppedEdges, droppedSteps, clamped };
}

/** Human-readable summary of everything `fillAnchors` had to change. */
export function describeAdjustments(result: AnchorFillResult): string[] {
  const lines: string[] = [];
  const group = (label: string, items: readonly { id: string; reason: string }[]): void => {
    if (items.length === 0) return;
    lines.push(`${label}：${items.map(item => `${item.id}（${item.reason}）`).join('、')}`);
  };
  group('已丢弃的来源', result.droppedSources);
  group('已丢弃的节点', result.droppedNodes);
  group('已丢弃的连线', result.droppedEdges);
  group('已丢弃的导读步骤', result.droppedSteps);
  if (result.clamped.length > 0) lines.push(`已按文件长度裁剪行号：${result.clamped.join('、')}`);
  return lines;
}
