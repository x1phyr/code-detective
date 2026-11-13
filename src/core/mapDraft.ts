import type { CodeMap, MapEdge, MapNode, SourceRef, TourInfo, WalkthroughStep } from '../../shared/types';
import { t } from '../../shared/i18n';
import { sanitizeMapId } from '../ai/mapNaming';
import { isCanonicalRelativePath } from './paths';
import { splitLines } from './text';
import { MAP_LIMITS } from './validator';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const NODE_KINDS = new Set(['step', 'function', 'condition', 'event', 'exit']);
const EDGE_KINDS = new Set(['call', 'flow', 'event', 'related']);
const MAX_SHORT_TEXT = 200;
const DECIMAL = /^\d+$/;

function validId(value: unknown): string | undefined {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : undefined;
}

/** Truncates by code point so a surrogate pair is never split in half. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return Array.from(text).slice(0, max).join('');
}

/** Clips schema-limited text so one over-long title cannot fail the whole map. */
function shortText(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  if (text.length === 0) return fallback;
  return clip(text, MAX_SHORT_TEXT);
}

/** Accepts positive safe integers, or strings that are plain decimal integers. */
function line(value: unknown): number | undefined {
  const number = typeof value === 'string' ? (DECIMAL.test(value) ? Number(value) : undefined) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= 1 ? number : undefined;
}

/** Short printable label for an id-like value the model sent, for reports. */
function display(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  return clip(text, 64);
}

export interface DroppedItem {
  id: string;
  reason: string;
}

/** Everything `normalizeDraft` removed; carried to `fillAnchors` via `drafts`. */
interface NormalizeReport {
  droppedSources: DroppedItem[];
  droppedNodes: DroppedItem[];
  droppedEdges: DroppedItem[];
  droppedSteps: DroppedItem[];
  filteredRefs: string[];
  /** Nodes whose original `sourceIds` were non-empty, even if normalization emptied them. */
  anchoredNodes: Set<string>;
}

const drafts = new WeakMap<CodeMap, NormalizeReport>();

type Parsed<T> = { item: T } | { reason: string };

function sourceRef(value: unknown): Parsed<SourceRef> {
  if (!isRecord(value)) return { reason: t('core.draftNotObject') };
  if (typeof value.file !== 'string' || value.file.length === 0) return { reason: t('core.draftMissingFile') };
  if (!isCanonicalRelativePath(value.file)) return { reason: t('core.draftFileNotCanonical', { file: display(value.file) }) };
  const startLine = line(value.startLine);
  const endLine = line(value.endLine);
  if (startLine === undefined || endLine === undefined) return { reason: t('core.draftLinesNotPositive') };
  if (endLine < startLine) return { reason: t('core.draftEndBeforeStart') };
  // anchorText is always regenerated from the real file, never trusted from the model.
  const note = shortText(value.note);
  return { item: note ? { file: value.file, startLine, endLine, note } : { file: value.file, startLine, endLine } };
}

/** Keeps valid, unique ids; records the rest as filtered references. */
function idList(input: unknown, owner: string, field: string, report: NormalizeReport): string[] {
  if (!Array.isArray(input)) return [];
  const output = new Set<string>();
  for (const item of input) {
    const id = validId(item);
    if (id) output.add(id);
    else report.filteredRefs.push(t('core.draftRefInvalidId', { owner, field, id: display(item) }));
  }
  return [...output];
}

function node(value: unknown, report: NormalizeReport): Parsed<MapNode> {
  if (!isRecord(value)) return { reason: t('core.draftNotObject') };
  const id = validId(value.id);
  if (!id) return { reason: t('core.draftIdInvalid') };
  const label = shortText(value.label);
  if (!label) return { reason: t('core.draftMissingLabel') };
  const sourceIds = idList(value.sourceIds, id, 'sourceIds', report);
  const output: MapNode = { id, label, sourceIds };
  if (typeof value.description === 'string') output.description = value.description;
  if (typeof value.kind === 'string' && NODE_KINDS.has(value.kind)) {
    output.kind = value.kind as MapNode['kind'];
  }
  const parent = validId(value.parent);
  if (parent && parent !== id) output.parent = parent;
  return { item: output };
}

function edge(value: unknown, report: NormalizeReport): Parsed<MapEdge> {
  if (!isRecord(value)) return { reason: t('core.draftNotObject') };
  const id = validId(value.id);
  if (!id) return { reason: t('core.draftIdInvalid') };
  const from = validId(value.from);
  const to = validId(value.to);
  if (!from || !to) return { reason: t('core.draftEndpointsInvalid') };
  const sourceIds = idList(value.sourceIds, id, 'sourceIds', report);
  const output: MapEdge = { id, from, to, sourceIds };
  const label = shortText(value.label);
  if (label) output.label = label;
  if (typeof value.description === 'string') output.description = value.description;
  if (typeof value.kind === 'string' && EDGE_KINDS.has(value.kind)) {
    output.kind = value.kind as MapEdge['kind'];
  }
  const branch = shortText(value.branch);
  if (branch) output.branch = branch;
  return { item: output };
}

function step(value: unknown, report: NormalizeReport): Parsed<WalkthroughStep> {
  if (!isRecord(value)) return { reason: t('core.draftNotObject') };
  const id = validId(value.id);
  if (!id) return { reason: t('core.draftIdInvalid') };
  const title = shortText(value.title);
  if (!title) return { reason: t('core.draftMissingTitle') };
  const output: WalkthroughStep = {
    id,
    title,
    nodeIds: idList(value.nodeIds, id, 'nodeIds', report),
    edgeIds: idList(value.edgeIds, id, 'edgeIds', report),
  };
  if (typeof value.description === 'string') output.description = value.description;
  const sourceId = validId(value.sourceId);
  if (sourceId) output.sourceId = sourceId;
  for (const key of ['why', 'watch', 'skip', 'example'] as const) {
    if (typeof value[key] === 'string' && value[key].trim()) output[key] = value[key].trim();
  }
  if (value.aside === true) output.aside = true;
  if (Array.isArray(value.branches)) {
    const branches = idList(value.branches, id, 'branches', report);
    if (branches.length) output.branches = branches;
  }
  return { item: output };
}

function tourInfo(value: unknown): TourInfo | undefined {
  if (!isRecord(value)) return undefined;
  const output: TourInfo = {};
  for (const key of ['example', 'recap', 'exercise'] as const) {
    if (typeof value[key] === 'string' && value[key].trim()) output[key] = value[key].trim();
  }
  return Object.keys(output).length ? output : undefined;
}

/**
 * Parses an id-bearing list, dropping (and reporting) malformed items, items
 * that reuse an earlier id, and anything past the validator's count limit.
 */
function list<T extends { id: string }>(
  value: unknown,
  name: string,
  limit: number,
  parse: (item: unknown) => Parsed<T>,
  dropped: DroppedItem[],
): T[] {
  if (!Array.isArray(value)) return [];
  const output: T[] = [];
  const seen = new Set<string>();
  value.forEach((raw, index) => {
    const parsed = parse(raw);
    const label = isRecord(raw) && typeof raw.id === 'string' && raw.id ? display(raw.id) : `${name}[${index}]`;
    if ('reason' in parsed) {
      dropped.push({ id: label, reason: parsed.reason });
    } else if (seen.has(parsed.item.id)) {
      dropped.push({ id: label, reason: t('core.draftDuplicateId', { name }) });
    } else if (output.length >= limit) {
      dropped.push({ id: label, reason: t('core.draftOverLimit', { name, limit }) });
    } else {
      seen.add(parsed.item.id);
      output.push(parsed.item);
    }
  });
  return output;
}

/**
 * Normalizes model-authored JSON into something the strict validator accepts:
 * fills the defaults the writer always provides, coerces ids and text into the
 * schema's shapes, and strips `anchorText`, which is regenerated from the real
 * files instead of trusted from the model. Every item it has to drop is
 * remembered and surfaces later through `fillAnchors` / `describeAdjustments`.
 */
export function normalizeDraft(input: unknown): CodeMap {
  if (!isRecord(input)) throw new Error(t('core.draftMapNotObject'));
  const draft = structuredClone(input) as Record<string, unknown>;
  const title = shortText(draft.title);
  if (!title) throw new Error(t('core.draftMapNeedsTitle'));
  if (!isRecord(draft.sources)) {
    throw new Error(t('core.draftSourcesNotObject'));
  }

  const report: NormalizeReport = {
    droppedSources: [],
    droppedNodes: [],
    droppedEdges: [],
    droppedSteps: [],
    filteredRefs: [],
    anchoredNodes: new Set(),
  };

  // A Map (not a plain object) so ids like `constructor` / `__proto__` are ordinary keys.
  const sources = new Map<string, SourceRef>();
  for (const [key, value] of Object.entries(draft.sources)) {
    const id = validId(key);
    if (!id) {
      report.droppedSources.push({ id: display(key), reason: t('core.draftSourceIdInvalid') });
      continue;
    }
    const parsed = sourceRef(value);
    if ('reason' in parsed) {
      report.droppedSources.push({ id, reason: parsed.reason });
    } else if (sources.size >= MAP_LIMITS.sources) {
      report.droppedSources.push({ id, reason: t('core.draftSourcesOverLimit', { limit: MAP_LIMITS.sources }) });
    } else {
      sources.set(id, parsed.item);
    }
  }

  const nodes = list(draft.nodes, 'nodes', MAP_LIMITS.nodes, raw => {
    const parsed = node(raw, report);
    if ('item' in parsed && isRecord(raw) && Array.isArray(raw.sourceIds) && raw.sourceIds.length > 0) {
      report.anchoredNodes.add(parsed.item.id);
    }
    return parsed;
  }, report.droppedNodes);

  const map: CodeMap = {
    schemaVersion: 1,
    id: sanitizeMapId(typeof draft.id === 'string' ? draft.id : title),
    title,
    sources: Object.fromEntries(sources),
    nodes,
    edges: list(draft.edges, 'edges', MAP_LIMITS.edges, raw => edge(raw, report), report.droppedEdges),
  };
  if (typeof draft.description === 'string') map.description = draft.description;
  if (Array.isArray(draft.walkthrough)) {
    map.walkthrough = list(draft.walkthrough, 'walkthrough', MAP_LIMITS.steps, raw => step(raw, report), report.droppedSteps);
  }
  const tour = tourInfo(draft.tour);
  if (tour) map.tour = tour;
  drafts.set(map, report);
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
          note: { type: 'string', description: '这段代码做了什么，一句话，不超过 200 字；会显示在代码行尾' },
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
          kind: { enum: ['step', 'function', 'condition', 'event', 'exit'] },
          parent: { type: 'string', description: '所属功能块（另一个节点的 id），不写在顶层' },
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
          branch: { type: 'string', description: '分支条件，例如“未命中缓存”；不写表示主干' },
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
          sourceId: { type: 'string', description: '这一步只看的那段代码（sources 的 id）' },
          why: { type: 'string', description: '为什么这样写' },
          watch: { type: 'string', description: '值得注意、容易踩坑的地方' },
          skip: { type: 'string', description: '这一步可以先跳过不看的部分' },
          example: { type: 'string', description: '贯穿例子走到这一步时发生了什么' },
          aside: { type: 'boolean', description: '岔路步骤，从某一步的 branches 进入' },
          branches: { type: 'array', items: { type: 'string' }, description: '可以岔出去看的 aside 步骤 id' },
        },
      },
    },
    tour: {
      type: 'object',
      additionalProperties: false,
      properties: {
        example: { type: 'string', description: '贯穿全程的具体例子' },
        recap: { type: 'string', description: '看完后的总结' },
        exercise: { type: 'string', description: '一个动手验证理解的小练习' },
      },
    },
  },
} as const;

export interface AnchorFillResult {
  map: CodeMap;
  /** Sources removed because they were malformed or their file / line range could not be read. */
  droppedSources: DroppedItem[];
  droppedNodes: DroppedItem[];
  droppedEdges: DroppedItem[];
  droppedSteps: DroppedItem[];
  /** References removed from kept items because the target was invalid or dropped. */
  filteredRefs: string[];
  /** Sources whose range had to be clamped to the file length. */
  clamped: string[];
}

/**
 * Rebuilds every source from the real file so `anchorText` always matches the
 * declared range. A source that cannot be resolved is dropped together with the
 * references to it, items reusing an earlier id are dropped, and the resulting
 * map is still schema-valid — the caller can report the drops back to the model
 * instead of failing the whole request. Drops made earlier by `normalizeDraft`
 * on this same map are merged into the result.
 */
export function fillAnchors(
  input: CodeMap,
  read: (file: string) => string | undefined,
): AnchorFillResult {
  const prior = drafts.get(input);
  const droppedSources: DroppedItem[] = [...(prior?.droppedSources ?? [])];
  const droppedNodes: DroppedItem[] = [...(prior?.droppedNodes ?? [])];
  const droppedEdges: DroppedItem[] = [...(prior?.droppedEdges ?? [])];
  const droppedSteps: DroppedItem[] = [...(prior?.droppedSteps ?? [])];
  const filteredRefs: string[] = [...(prior?.filteredRefs ?? [])];
  const clamped: string[] = [];
  const sources = new Map<string, SourceRef>();
  const fullText = new Map<string, string[] | undefined>();

  for (const [id, ref] of Object.entries(input.sources ?? {})) {
    let lines = fullText.get(ref.file);
    if (!fullText.has(ref.file)) {
      const text = read(ref.file);
      lines = text === undefined ? undefined : splitLines(text);
      fullText.set(ref.file, lines);
    }
    if (lines === undefined) {
      droppedSources.push({ id, reason: t('core.draftFileUnreadable', { file: ref.file }) });
      continue;
    }
    if (lines.every(line => line.trim().length === 0)) {
      droppedSources.push({ id, reason: t('core.draftFileEmpty', { file: ref.file }) });
      continue;
    }
    if (!Number.isSafeInteger(ref.startLine) || !Number.isSafeInteger(ref.endLine)
      || ref.startLine < 1 || ref.endLine < ref.startLine) {
      droppedSources.push({ id, reason: t('core.draftFileLinesInvalid', { file: ref.file }) });
      continue;
    }
    // splitLines already drops the empty element after a trailing newline.
    const last = lines.length;
    if (ref.startLine > last) {
      droppedSources.push({ id, reason: t('core.draftStartBeyondFile', { file: ref.file, last, startLine: ref.startLine }) });
      continue;
    }
    const from = ref.startLine;
    const to = Math.min(ref.endLine, last);
    if (to !== ref.endLine) {
      clamped.push(`${id}: ${ref.startLine}-${ref.endLine} → ${from}-${to}`);
    }
    sources.set(id, {
      file: ref.file,
      startLine: from,
      endLine: to,
      anchorText: lines.slice(from - 1, to).join('\n'),
      ...(ref.note ? { note: ref.note } : {}),
    });
  }

  /** Unique refs whose target exists; reports the ones removed. */
  const keep = (
    ids: readonly string[] | undefined,
    known: { has(id: string): boolean },
    owner: string,
    field: string,
    report: boolean,
  ): string[] => {
    const output: string[] = [];
    for (const id of new Set(ids ?? [])) {
      if (known.has(id)) output.push(id);
      else if (report) filteredRefs.push(t('core.draftRefMissingTarget', { owner, field, id }));
    }
    return output;
  };

  const nodes: MapNode[] = [];
  const nodeIds = new Set<string>();
  for (const node of input.nodes ?? []) {
    if (nodeIds.has(node.id)) {
      droppedNodes.push({ id: node.id, reason: t('core.draftDuplicateId', { name: 'nodes' }) });
      continue;
    }
    const anchored = (node.sourceIds?.length ?? 0) > 0 || prior?.anchoredNodes.has(node.id) === true;
    const sourceIds = keep(node.sourceIds, sources, node.id, 'sourceIds', false);
    if (anchored && sourceIds.length === 0) {
      droppedNodes.push({ id: node.id, reason: t('core.draftNodeSourcesUnavailable') });
      continue;
    }
    keep(node.sourceIds, sources, node.id, 'sourceIds', true);
    nodeIds.add(node.id);
    nodes.push({ ...node, sourceIds });
  }

  // parent 指向被删除的节点、或形成环时，只去掉 parent（节点回到上一层），不丢节点。
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) {
    if (node.parent !== undefined && !byId.has(node.parent)) {
      filteredRefs.push(t('core.draftRefMissingTarget', { owner: node.id, field: 'parent', id: node.parent }));
      delete node.parent;
    }
  }
  for (const node of nodes) {
    const seen = new Set<string>([node.id]);
    let cursor = node.parent ? byId.get(node.parent) : undefined;
    while (cursor) {
      if (seen.has(cursor.id)) {
        filteredRefs.push(t('core.draftParentCycle', { id: node.id }));
        delete node.parent;
        break;
      }
      seen.add(cursor.id);
      cursor = cursor.parent ? byId.get(cursor.parent) : undefined;
    }
  }

  const edges: MapEdge[] = [];
  const edgeIds = new Set<string>();
  for (const edge of input.edges ?? []) {
    if (edgeIds.has(edge.id)) {
      droppedEdges.push({ id: edge.id, reason: t('core.draftDuplicateId', { name: 'edges' }) });
      continue;
    }
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      droppedEdges.push({ id: edge.id, reason: t('core.draftEdgeEndpointRemoved', { from: edge.from, to: edge.to }) });
      continue;
    }
    edgeIds.add(edge.id);
    edges.push({ ...edge, sourceIds: keep(edge.sourceIds, sources, edge.id, 'sourceIds', true) });
  }

  const stepIds = new Set<string>();
  const walkthrough: WalkthroughStep[] = [];
  for (const step of input.walkthrough ?? []) {
    if (stepIds.has(step.id)) {
      droppedSteps.push({ id: step.id, reason: t('core.draftDuplicateId', { name: 'walkthrough' }) });
      continue;
    }
    const nodeRefs = keep(step.nodeIds, nodeIds, step.id, 'nodeIds', false);
    const edgeRefs = keep(step.edgeIds, edgeIds, step.id, 'edgeIds', false);
    if (nodeRefs.length === 0 && edgeRefs.length === 0) {
      droppedSteps.push({ id: step.id, reason: t('core.draftStepRefsRemoved') });
      continue;
    }
    keep(step.nodeIds, nodeIds, step.id, 'nodeIds', true);
    keep(step.edgeIds, edgeIds, step.id, 'edgeIds', true);
    stepIds.add(step.id);
    const fixed: WalkthroughStep = { ...step, nodeIds: nodeRefs, edgeIds: edgeRefs };
    if (fixed.sourceId !== undefined && !sources.has(fixed.sourceId)) {
      filteredRefs.push(t('core.draftStepSourceRemoved', { id: step.id }));
      delete fixed.sourceId;
    }
    walkthrough.push(fixed);
  }
  // 岔路只能指向存在的 aside 步骤；指向主线步骤的岔路会让“看完回来”失去意义，直接去掉。
  const asides = new Set(walkthrough.filter(step => step.aside).map(step => step.id));
  for (const step of walkthrough) {
    if (!step.branches) continue;
    const kept = keep(step.branches.filter(id => id !== step.id), asides, step.id, 'branches', true);
    if (kept.length) step.branches = kept;
    else delete step.branches;
  }

  if (nodes.length === 0) {
    throw new Error(t('core.draftNoUsableNodes'));
  }

  const map: CodeMap = {
    schemaVersion: 1,
    id: input.id,
    title: input.title,
    sources: Object.fromEntries(sources),
    nodes,
    edges,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.walkthrough === undefined ? {} : { walkthrough }),
    ...(input.tour === undefined ? {} : { tour: input.tour }),
  };
  return { map, droppedSources, droppedNodes, droppedEdges, droppedSteps, filteredRefs, clamped };
}

/** Human-readable summary of everything `normalizeDraft` and `fillAnchors` had to change. */
export function describeAdjustments(result: AnchorFillResult): string[] {
  const lines: string[] = [];
  const group = (label: string, items: readonly { id: string; reason: string }[]): void => {
    if (items.length === 0) return;
    const sep = t('core.listSeparator');
    lines.push(t('core.adjustGroup', { label, items: items.map(item => t('core.adjustItem', item)).join(sep) }));
  };
  group(t('core.adjustDroppedSources'), result.droppedSources);
  group(t('core.adjustDroppedNodes'), result.droppedNodes);
  group(t('core.adjustDroppedEdges'), result.droppedEdges);
  group(t('core.adjustDroppedSteps'), result.droppedSteps);
  if (result.filteredRefs?.length) lines.push(t('core.adjustRemovedRefs', { items: result.filteredRefs.join(t('core.listSeparator')) }));
  if (result.clamped.length > 0) lines.push(t('core.adjustClamped', { items: result.clamped.join(t('core.listSeparator')) }));
  return lines;
}
