import type { CodeMap, WalkthroughStep } from '../../shared/types';
import { sourceIdsForSelection } from './selection';

/**
 * 导读的路线与位置，不依赖 VS Code，方便单测。
 *
 * - 主线：所有不带 `aside` 的步骤，按书写顺序。
 * - 岔路：带 `aside` 的步骤，从主线某一步的 `branches` 内嵌展开阅读；
 *   看完可收起或继续走主线的下一步。
 */
export interface TourPosition {
  stepId: string;
  /** 从哪些步骤岔出来的（栈顶 = 最近一次）；在主线上时为空。 */
  returnTo: string[];
}

export interface TourStepView {
  step: WalkthroughStep;
  /** 主线上的序号（从 1 开始）；岔路步骤为出发点的序号。 */
  index: number;
  total: number;
  /** 这一步对应的唯一一段代码。 */
  sourceId?: string;
  previous?: string;
  /** 下一步：岔路里是“回到出发点”，主线上是下一个主线步骤。 */
  next?: string;
  /** 下一步是不是“回到出发点”。 */
  returning: boolean;
  /** 可以从这里岔出去的步骤。 */
  branches: WalkthroughStep[];
  /** 已经从哪里岔出来（用于“返回”按钮）。 */
  returnTo?: WalkthroughStep;
  /** 是否是主线最后一步（显示总结和练习）。 */
  last: boolean;
}

export function mainline(map: CodeMap): WalkthroughStep[] {
  return (map.walkthrough ?? []).filter(step => !step.aside);
}

function stepById(map: CodeMap, id: string | undefined): WalkthroughStep | undefined {
  return id ? map.walkthrough?.find(step => step.id === id) : undefined;
}

/** 这一步要打开的代码：显式 `sourceId` 优先，否则取所含节点 / 连线的第一处源码。 */
export function stepSource(map: CodeMap, step: WalkthroughStep): string | undefined {
  if (step.sourceId && Object.hasOwn(map.sources, step.sourceId)) return step.sourceId;
  return sourceIdsForSelection(map, { kind: 'step', id: step.id })[0];
}

/** 一个岔路步骤是从哪一步岔出来的（第一个在 branches 里列出它的步骤）。 */
export function asideOrigin(map: CodeMap, stepId: string): WalkthroughStep | undefined {
  return map.walkthrough?.find(step => step.branches?.includes(stepId));
}

/**
 * 查找脉络图上某个节点（或收起分组内子节点）对应的带读步骤：
 * 返回关联的主线步号（1-based）及首先匹配的 stepId，供脉络图徽章与一键跳讲义使用。
 */
export function stepsForNode(
  map: CodeMap,
  nodeId: string,
  includeChildren = false,
): { numbers: number[]; firstStepId?: string } {
  const targetNodeIds = new Set<string>([nodeId]);
  if (includeChildren) {
    for (const node of map.nodes) {
      if (node.parent === nodeId) targetNodeIds.add(node.id);
    }
  }
  const nodeSources = new Set<string>();
  for (const node of map.nodes) {
    if (targetNodeIds.has(node.id)) {
      for (const sid of node.sourceIds) nodeSources.add(sid);
    }
  }

  const line = mainline(map);
  const numbers: number[] = [];
  let firstStepId: string | undefined;

  line.forEach((step, idx) => {
    const matchesNode = step.nodeIds.some(id => targetNodeIds.has(id));
    const matchesSource = Boolean(step.sourceId && nodeSources.has(step.sourceId));
    if (matchesNode || matchesSource) {
      numbers.push(idx + 1);
      if (!firstStepId) firstStepId = step.id;
    }
  });

  if (!firstStepId) {
    const aside = (map.walkthrough ?? []).find(
      step => step.aside && (step.nodeIds.some(id => targetNodeIds.has(id)) || (step.sourceId && nodeSources.has(step.sourceId))),
    );
    if (aside) firstStepId = aside.id;
  }

  return { numbers, firstStepId };
}

export function tourView(map: CodeMap, position: TourPosition): TourStepView | undefined {
  const step = stepById(map, position.stepId);
  if (!step) return undefined;
  const line = mainline(map);
  const returnTo = stepById(map, position.returnTo.at(-1)) ?? (step.aside ? asideOrigin(map, step.id) : undefined);
  let anchor: WalkthroughStep | undefined = step;
  const seen = new Set<string>();
  while (anchor?.aside && !seen.has(anchor.id)) {
    seen.add(anchor.id);
    anchor = anchor.id === step.id ? returnTo : asideOrigin(map, anchor.id);
  }
  const at = anchor ? line.findIndex(item => item.id === anchor!.id) : -1;
  const branches = (step.branches ?? []).map(id => stepById(map, id)).filter((item): item is WalkthroughStep => Boolean(item));
  const view: TourStepView = {
    step,
    index: at + 1,
    total: line.length,
    sourceId: stepSource(map, step),
    branches,
    returning: false,
    last: !step.aside && at === line.length - 1,
  };
  if (returnTo) view.returnTo = returnTo;
  if (step.aside) {
    if (returnTo) {
      view.next = returnTo.id;
      view.returning = true;
    }
  } else {
    if (at > 0) view.previous = line[at - 1]!.id;
    if (at >= 0 && at < line.length - 1) view.next = line[at + 1]!.id;
  }
  return view;
}

export function moveTo(map: CodeMap, position: TourPosition | undefined, target: string): TourPosition | undefined {
  const step = stepById(map, target);
  if (!step) return position;
  if (!position) return { stepId: target, returnTo: [] };
  const current = stepById(map, position.stepId);
  if (current?.branches?.includes(target) && step.aside) {
    return { stepId: target, returnTo: [...position.returnTo, position.stepId] };
  }
  const stack = [...position.returnTo];
  const back = stack.lastIndexOf(target);
  if (back >= 0) return { stepId: target, returnTo: stack.slice(0, back) };
  return { stepId: target, returnTo: step.aside ? stack : [] };
}

export function stepBy(map: CodeMap, position: TourPosition | undefined, delta: 1 | -1): TourPosition | undefined {
  const line = mainline(map);
  if (!position) {
    const first = delta > 0 ? line[0] : line.at(-1);
    return first ? { stepId: first.id, returnTo: [] } : undefined;
  }
  const view = tourView(map, position);
  if (!view) return undefined;
  const target = delta > 0 ? view.next : (view.step.aside ? view.returnTo?.id : view.previous);
  return target ? moveTo(map, position, target) : position;
}
