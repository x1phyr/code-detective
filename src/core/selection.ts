import type { CodeMap, PeekTarget, Selection, SourceStatus, ViewState, ViewTab } from '../../shared/types';

function uniqueSources(map: CodeMap, ids: readonly string[]): string[] {
  return [...new Set(ids)].filter(id => Object.hasOwn(map.sources, id));
}

export function sourceIdsForSelection(map: CodeMap, selection?: Selection): string[] {
  if (!selection) return [];
  if (selection.kind === 'node') {
    const node = map.nodes.find(item => item.id === selection.id);
    if (!node) return [];
    const childSources = map.nodes.filter(item => item.parent === node.id).flatMap(item => item.sourceIds);
    return uniqueSources(map, [...node.sourceIds, ...childSources]);
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
      ...(step.sourceId ? [step.sourceId] : []),
      ...step.nodeIds.flatMap(id => nodes.get(id)?.sourceIds ?? []),
      ...step.edgeIds.flatMap(id => edges.get(id)?.sourceIds ?? []),
    ]);
  }
  return [];
}

/**
 * 当前真正要在编辑器中高亮的目标（精准克制高亮）：
 * - 若用户刚在脉络图上点了某个节点/连线预览（`peek`），优先高亮预览处；
 * - 否则若展开了内嵌岔路（`openAsideId`），高亮该岔路步骤；
 * - 否则高亮当前主线步骤（`activeStepId`）。
 */
export function activeFocusSelection(map: CodeMap, ui?: ViewState): Selection | undefined {
  if (!ui) return undefined;
  if (ui.peek) {
    if (ui.peek.kind === 'node' && map.nodes.some(n => n.id === ui.peek!.id)) return ui.peek;
    if (ui.peek.kind === 'edge' && map.edges.some(e => e.id === ui.peek!.id)) return ui.peek;
  }
  if (ui.openAsideId && map.walkthrough.some(s => s.id === ui.openAsideId)) {
    return { kind: 'step', id: ui.openAsideId };
  }
  if (ui.activeStepId && map.walkthrough.some(s => s.id === ui.activeStepId)) {
    return { kind: 'step', id: ui.activeStepId };
  }
  return undefined;
}

/**
 * 当前焦点在编辑器中需要高亮的精准 sourceId 列表（通常只有 1 处，绝不再铺满整张地图的所有 sources）。
 */
export function focusedSourceIds(map: CodeMap, ui?: ViewState): string[] {
  if (ui?.highlightEnabled === false) return [];
  const focus = activeFocusSelection(map, ui);
  if (!focus) return [];
  const candidates = sourceIdsForSelection(map, focus);
  if (ui?.sourceId && candidates.includes(ui.sourceId)) return [ui.sourceId];
  if (focus.kind === 'step') {
    const step = map.walkthrough.find(s => s.id === focus.id);
    if (step?.sourceId && Object.hasOwn(map.sources, step.sourceId)) return [step.sourceId];
  }
  return candidates.length > 0 ? [candidates[0]!] : [];
}

/**
 * 光标反向匹配：根据当前活动文件的相对路径和光标行号（1-based），
 * 返回光标落入的步骤 id 与脉络图节点 id，用于侧栏柔和跟随标记“📍光标在此”。
 */
export function matchCursorToMap(
  map: CodeMap,
  statuses: Readonly<Record<string, SourceStatus>>,
  relativeFile: string,
  line: number,
): { matchedStepIds: string[]; matchedNodeIds: string[] } {
  if (!relativeFile || line < 1) return { matchedStepIds: [], matchedNodeIds: [] };
  const hitSources = new Set<string>();
  for (const [id, ref] of Object.entries(map.sources)) {
    const status = statuses[id];
    const file = status?.file ?? ref.file;
    const start = status?.startLine ?? ref.startLine;
    const end = status?.endLine ?? ref.endLine;
    if (file === relativeFile && line >= start && line <= end) {
      hitSources.add(id);
    }
  }
  if (hitSources.size === 0) return { matchedStepIds: [], matchedNodeIds: [] };

  const matchedNodeIds = map.nodes
    .filter(node => node.sourceIds.some(id => hitSources.has(id)))
    .map(node => node.id);

  const matchedStepIds = map.walkthrough
    .filter(step => {
      if (step.sourceId) return hitSources.has(step.sourceId);
      const stepSources = sourceIdsForSelection(map, { kind: 'step', id: step.id });
      return stepSources[0] !== undefined && hitSources.has(stepSources[0]);
    })
    .map(step => step.id);

  return { matchedStepIds, matchedNodeIds };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const ZOOM_RANGE = { min: 0.01, max: 20 } as const;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validPeek(map: CodeMap, value: unknown): PeekTarget | undefined {
  if (!record(value) || typeof value.id !== 'string') return undefined;
  if (value.kind === 'node' && map.nodes.some(node => node.id === value.id)) return { kind: 'node', id: value.id };
  if (value.kind === 'edge' && map.edges.some(edge => edge.id === value.id)) return { kind: 'edge', id: value.id };
  return undefined;
}

function validIdArray(value: unknown, known: ReadonlySet<string>): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept = [...new Set(value.filter((item): item is string => typeof item === 'string' && known.has(item)))];
  return kept.length > 0 ? kept : undefined;
}

export function sanitizeViewState(map: CodeMap, state?: Partial<ViewState>): ViewState {
  const input: Record<string, unknown> = record(state) ? state : {};
  const activeTab: ViewTab = input.activeTab === 'map' ? 'map' : 'walkthrough';
  const output: ViewState = {
    activeTab,
    highlightEnabled: typeof input.highlightEnabled === 'boolean' ? input.highlightEnabled : true,
  };

  const mainlineSteps = map.walkthrough.filter(step => !step.aside);
  const allStepIds = new Set(map.walkthrough.map(step => step.id));
  const mainlineIds = new Set(mainlineSteps.map(step => step.id));
  const asideIds = new Set(map.walkthrough.filter(step => step.aside).map(step => step.id));
  const nodeIds = new Set(map.nodes.map(node => node.id));

  let activeStepId = typeof input.activeStepId === 'string' && mainlineIds.has(input.activeStepId)
    ? input.activeStepId
    : undefined;
  // 若传入的是 aside stepId，自动定位到它的出发主线步骤并展开该岔路。
  let openAsideId = typeof input.openAsideId === 'string' && asideIds.has(input.openAsideId)
    ? input.openAsideId
    : undefined;
  if (!activeStepId && typeof input.activeStepId === 'string' && asideIds.has(input.activeStepId)) {
    openAsideId = input.activeStepId;
    const origin = map.walkthrough.find(step => !step.aside && step.branches?.includes(openAsideId!));
    activeStepId = origin?.id;
  }
  if (!activeStepId && mainlineSteps.length > 0) {
    activeStepId = mainlineSteps[0]!.id;
  }
  // 校验 openAsideId 确实属于当前 activeStepId 的 branches（否则收起失效岔路）。
  if (openAsideId && activeStepId) {
    const activeStep = map.walkthrough.find(step => step.id === activeStepId);
    if (!activeStep?.branches?.includes(openAsideId)) {
      openAsideId = undefined;
    }
  }
  if (activeStepId) output.activeStepId = activeStepId;
  if (openAsideId) output.openAsideId = openAsideId;

  const visited = validIdArray(input.visitedStepIds, allStepIds) ?? [];
  const visitedSet = new Set(visited);
  if (activeStepId) visitedSet.add(activeStepId);
  if (openAsideId) visitedSet.add(openAsideId);
  if (visitedSet.size > 0) output.visitedStepIds = [...visitedSet];

  const peek = validPeek(map, input.peek);
  if (peek) output.peek = peek;

  const groupParents = new Set(map.nodes.map(n => n.parent).filter((p): p is string => typeof p === 'string' && nodeIds.has(p)));
  const expandedGroups = validIdArray(input.expandedGroupIds, groupParents);
  if (expandedGroups) output.expandedGroupIds = expandedGroups;

  const expandedBranches = validIdArray(input.expandedBranchIds, nodeIds);
  if (expandedBranches) output.expandedBranchIds = expandedBranches;

  const focus = activeFocusSelection(map, output);
  const candidates = sourceIdsForSelection(map, focus);
  if (typeof input.sourceId === 'string' && candidates.includes(input.sourceId)) {
    output.sourceId = input.sourceId;
  } else if (candidates[0]) {
    output.sourceId = candidates[0];
  }

  if (record(input.viewport) && finite(input.viewport.x) && finite(input.viewport.y)
    && finite(input.viewport.zoom) && input.viewport.zoom >= ZOOM_RANGE.min && input.viewport.zoom <= ZOOM_RANGE.max) {
    output.viewport = { x: input.viewport.x, y: input.viewport.y, zoom: input.viewport.zoom };
  }
  return output;
}
