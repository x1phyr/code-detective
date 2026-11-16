import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asideOrigin, mainline, moveTo, stepBy, stepSource, stepsForNode, tourView } from '../src/core/tour';
import { questionPrompt } from '../src/ai/question';
import { setLocale } from '../shared/i18n';
import type { CodeMap } from '../shared/types';

function map(): CodeMap {
  return {
    schemaVersion: 1,
    id: 'tour',
    title: '导读',
    sources: {
      a: { file: 'a.ts', startLine: 1, endLine: 2 },
      b: { file: 'b.ts', startLine: 3, endLine: 4 },
      c: { file: 'c.ts', startLine: 5, endLine: 6 },
    },
    nodes: [
      { id: 'n1', label: '一', sourceIds: ['a'] },
      { id: 'n2', label: '二', sourceIds: ['a', 'b'] },
      { id: 'n3', label: '三', sourceIds: ['c'] },
    ],
    edges: [],
    walkthrough: [
      { id: 's1', title: '第一步', nodeIds: ['n1'], edgeIds: [] },
      { id: 's2', title: '第二步', nodeIds: ['n2'], edgeIds: [], sourceId: 'b', branches: ['x1'] },
      { id: 'x1', title: '岔路一', nodeIds: ['n3'], edgeIds: [], aside: true, branches: ['x2'] },
      { id: 'x2', title: '岔路二', nodeIds: ['n3'], edgeIds: [], aside: true },
      { id: 's3', title: '第三步', nodeIds: ['n3'], edgeIds: [] },
    ],
    tour: { example: 'alice 登录', recap: '总结', exercise: '练习' },
  };
}

test('主线不含岔路步骤；岔路的出发点来自 branches', () => {
  const m = map();
  assert.deepEqual(mainline(m).map(step => step.id), ['s1', 's2', 's3']);
  assert.equal(asideOrigin(m, 'x1')?.id, 's2');
  assert.equal(asideOrigin(m, 'x2')?.id, 'x1');
});

test('步骤源码：显式 sourceId 优先，否则取第一处', () => {
  const m = map();
  assert.equal(stepSource(m, m.walkthrough![1]!), 'b');
  assert.equal(stepSource(m, m.walkthrough![0]!), 'a');
});

test('主线上前进后退；最后一步标记 last', () => {
  const m = map();
  let position = stepBy(m, undefined, 1);
  assert.equal(position?.stepId, 's1');
  assert.equal(tourView(m, position!)?.previous, undefined);
  position = stepBy(m, position, 1);
  const second = tourView(m, position!)!;
  assert.equal(second.index, 2);
  assert.equal(second.total, 3);
  assert.deepEqual(second.branches.map(step => step.id), ['x1']);
  position = stepBy(m, position, 1);
  const third = tourView(m, position!)!;
  assert.equal(third.last, true);
  assert.equal(third.next, undefined);
  // 末尾再前进停在原地。
  assert.equal(stepBy(m, position, 1)?.stepId, 's3');
  assert.equal(stepBy(m, undefined, -1)?.stepId, 's3');
});

test('走岔路会记住出发点，“下一步”和“上一步”都是回去；嵌套岔路逐层返回', () => {
  const m = map();
  let position = moveTo(m, { stepId: 's2', returnTo: [] }, 'x1')!;
  assert.deepEqual(position, { stepId: 'x1', returnTo: ['s2'] });
  let view = tourView(m, position)!;
  assert.equal(view.returning, true);
  assert.equal(view.next, 's2');
  assert.equal(view.index, 2, '岔路的序号沿用出发点');

  position = moveTo(m, position, 'x2')!;
  assert.deepEqual(position.returnTo, ['s2', 'x1']);
  view = tourView(m, position)!;
  assert.equal(view.returnTo?.id, 'x1');
  assert.equal(view.index, 2);

  position = stepBy(m, position, 1)!;
  assert.deepEqual(position, { stepId: 'x1', returnTo: ['s2'] });
  position = stepBy(m, position, -1)!;
  assert.deepEqual(position, { stepId: 's2', returnTo: [] });
});

test('直接跳到主线步骤会清空岔路栈；直接打开岔路时用 branches 推断出发点', () => {
  const m = map();
  const inside = { stepId: 'x2', returnTo: ['s2', 'x1'] };
  assert.deepEqual(moveTo(m, inside, 's1'), { stepId: 's1', returnTo: [] });
  const direct = moveTo(m, undefined, 'x1')!;
  assert.deepEqual(direct, { stepId: 'x1', returnTo: [] });
  assert.equal(tourView(m, direct)?.next, 's2');
  assert.equal(moveTo(m, direct, 'missing'), direct);
});

test('提问提示词带上地图、步骤、代码位置、贯穿例子和之前的问答', () => {
  setLocale('zh-CN');
  const m = map();
  const prompt = questionPrompt({
    map: m,
    step: m.walkthrough![1]!,
    source: m.sources.b,
    index: 2,
    total: 3,
    history: [{ question: '之前的问题', answer: '之前的回答' }],
    selection: { file: 'b.ts', startLine: 3, endLine: 4, preview: 'const x = 1;' },
    question: '为什么要这样？',
  });
  assert.match(prompt, /当前步骤（2\/3）：第二步/);
  assert.match(prompt, /b\.ts 第 3–4 行/);
  assert.match(prompt, /const x = 1;/);
  assert.match(prompt, /路径\/文件\.ts:行号/);
  assert.match(prompt, /贯穿例子：alice 登录/);
  assert.match(prompt, /Q: 之前的问题/);
  assert.match(prompt, /用户的问题：为什么要这样？/);
  assert.doesNotMatch(prompt, /岔路一/, '大纲只列主线');
  setLocale('en');
  assert.match(questionPrompt({ map: m, step: m.walkthrough![0]!, index: 1, total: 3, history: [], question: 'q' }), /Current step \(1\/3\)/);
  setLocale('zh-CN');
});

test('stepsForNode 返回节点关联的主线步号与首步 ID', () => {
  const m = map();
  assert.deepEqual(stepsForNode(m, 'n1'), { numbers: [1], firstStepId: 's1' });
  assert.deepEqual(stepsForNode(m, 'n3'), { numbers: [3], firstStepId: 's3' });
});
