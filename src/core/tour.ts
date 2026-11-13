import type { CodeMap, WalkthroughStep } from '../../shared/types';
import { sourceIdsForSelection } from './selection';

/**
 * 导读的路线与位置，不依赖 VS Code，方便单测。
 *
 * - 主线：所有不带 `aside` 的步骤，按书写顺序。
 * - 岔路：带 `aside` 的步骤，只能从某一步的 `branches` 进入；进入时记住出发点，
 *   岔路的“下一步”就是回到出发点（像真人带看：“先绕过去看一眼，再回来”）。
 * - 用户随时可以跳到任意一步；跳到主线步骤会清空岔路栈。
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
  if (step.sourceId && map.sources[step.sourceId]) return step.sourceId;
  return sourceIdsForSelection(map, { kind: 'step', id: step.id })[0];
}

/** 一个岔路步骤是从哪一步岔出来的（第一个在 branches 里列出它的步骤）。 */
export function asideOrigin(map: CodeMap, stepId: string): WalkthroughStep | undefined {
  return map.walkthrough?.find(step => step.branches?.includes(stepId));
}

export function tourView(map: CodeMap, position: TourPosition): TourStepView | undefined {
  const step = stepById(map, position.stepId);
  if (!step) return undefined;
  const line = mainline(map);
  const returnTo = stepById(map, position.returnTo.at(-1)) ?? (step.aside ? asideOrigin(map, step.id) : undefined);
  // 岔路步骤的序号用它在主线上的出发点来算，进度条不会因为绕路而跳。
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

/**
 * 移动到 `target`：
 * - 目标是当前步骤的岔路：压栈，看完回来；
 * - 目标就是栈顶（“回到出发点”）：出栈；
 * - 其它情况（主线跳转、直接点了别的步骤）：清空栈。
 */
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

/** 从当前位置前进（delta=1）或后退（delta=-1）。岔路里后退 = 回到出发点。 */
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
