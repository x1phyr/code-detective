import type { CodeMap, Selection, ViewState } from '../../shared/types';

function uniqueSources(map: CodeMap, ids: readonly string[]): string[] {
  return [...new Set(ids)].filter(id => Object.hasOwn(map.sources, id));
}

export function sourceIdsForSelection(map: CodeMap, selection?: Selection): string[] {
  if (!selection) return [];
  if (selection.kind === 'node') {
    return uniqueSources(map, map.nodes.find(node => node.id === selection.id)?.sourceIds ?? []);
  }
  if (selection.kind === 'edge') {
    return uniqueSources(map, map.edges.find(edge => edge.id === selection.id)?.sourceIds ?? []);
  }
  if (selection.kind === 'step') {
    const step = map.walkthrough?.find(item => item.id === selection.id);
    if (!step) return [];
    const nodes = new Map(map.nodes.map(node => [node.id, node]));
    const edges = new Map(map.edges.map(edge => [edge.id, edge]));
    return uniqueSources(map, [
      ...step.nodeIds.flatMap(id => nodes.get(id)?.sourceIds ?? []),
      ...step.edgeIds.flatMap(id => edges.get(id)?.sourceIds ?? []),
    ]);
  }
  return [];
}

export function relatedSourceIds(map: CodeMap): string[] {
  return uniqueSources(map, [
    ...map.nodes.flatMap(node => node.sourceIds),
    ...map.edges.flatMap(edge => edge.sourceIds),
  ]);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Same viewport zoom bounds the host bridge enforces. */
export const ZOOM_RANGE = { min: 0.01, max: 20 } as const;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validSelection(map: CodeMap, value: unknown): Selection | undefined {
  if (!record(value) || typeof value.id !== 'string') return undefined;
  if (value.kind === 'node' && map.nodes.some(node => node.id === value.id)) return { kind: 'node', id: value.id };
  if (value.kind === 'edge' && map.edges.some(edge => edge.id === value.id)) return { kind: 'edge', id: value.id };
  if (value.kind === 'step' && map.walkthrough?.some(step => step.id === value.id)) return { kind: 'step', id: value.id };
  return undefined;
}

export function sanitizeViewState(map: CodeMap, state?: Partial<ViewState>): ViewState {
  const input: Record<string, unknown> = record(state) ? state : {};
  const output: ViewState = {
    highlightEnabled: typeof input.highlightEnabled === 'boolean' ? input.highlightEnabled : true,
  };

  let selection = validSelection(map, input.selection);
  let stepId = typeof input.stepId === 'string' && map.walkthrough?.some(step => step.id === input.stepId)
    ? input.stepId : undefined;
  if (selection?.kind === 'step') stepId = selection.id;
  if (input.selection !== undefined && !selection) {
    stepId = undefined;
  } else if (!selection && stepId) {
    selection = { kind: 'step', id: stepId };
  }
  if (selection) output.selection = selection;
  if (stepId) output.stepId = stepId;
  if (typeof input.sourceId === 'string' && sourceIdsForSelection(map, selection).includes(input.sourceId)) {
    output.sourceId = input.sourceId;
  }

  if (record(input.viewport) && finite(input.viewport.x) && finite(input.viewport.y)
    && finite(input.viewport.zoom) && input.viewport.zoom >= ZOOM_RANGE.min && input.viewport.zoom <= ZOOM_RANGE.max) {
    output.viewport = { x: input.viewport.x, y: input.viewport.y, zoom: input.viewport.zoom };
  }
  return output;
}
