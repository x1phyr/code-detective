import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeFocusSelection,
  focusedSourceIds,
  matchCursorToMap,
  sanitizeViewState,
  sourceIdsForSelection,
} from '../src/core/selection';
import type { CodeMap, SourceStatus } from '../shared/types';

const map: CodeMap = {
  schemaVersion: 1,
  id: 'demo',
  title: '示例',
  sources: {
    a: { file: 'a.ts', startLine: 1, endLine: 4 },
    b: { file: 'b.ts', startLine: 3, endLine: 8 },
    c: { file: 'c.ts', startLine: 5, endLine: 10 },
  },
  nodes: [
    { id: 'grp', label: '阶段', sourceIds: ['a'] },
    { id: 'n1', label: '一', parent: 'grp', sourceIds: ['a', 'b'] },
    { id: 'n2', label: '二', sourceIds: ['b', 'c'] },
  ],
  edges: [{ id: 'e1', from: 'n1', to: 'n2', sourceIds: ['c'] }],
  walkthrough: [
    { id: 's1', title: '第一步', nodeIds: ['n1'], edgeIds: ['e1'], branches: ['x1'] },
    { id: 'x1', title: '岔路', aside: true, nodeIds: ['n2'], edgeIds: [], sourceId: 'c' },
    { id: 's2', title: '第二步', nodeIds: ['n2'], edgeIds: [], sourceId: 'b' },
  ],
};

test('节点来源会去重并过滤未知 ID', () => {
  assert.deepEqual(sourceIdsForSelection(map, { kind: 'node', id: 'n1' }), ['a', 'b']);
  assert.deepEqual(sourceIdsForSelection(map, { kind: 'node', id: 'missing' }), []);
});

test('连线与步骤来源会合并子对象，显式 sourceId 排在首位', () => {
  assert.deepEqual(sourceIdsForSelection(map, { kind: 'edge', id: 'e1' }), ['c']);
  assert.deepEqual(sourceIdsForSelection(map, { kind: 'step', id: 's1' }), ['a', 'b', 'c']);
  assert.deepEqual(sourceIdsForSelection(map, { kind: 'step', id: 's2' }), ['b', 'c']);
});

test('默认聚焦第一条主线步骤，且克制高亮只返回单一活动代码段', () => {
  const state = sanitizeViewState(map, undefined);
  assert.equal(state.activeTab, 'walkthrough');
  assert.equal(state.activeStepId, 's1');
  assert.equal(state.highlightEnabled, true);
  assert.equal(state.sourceId, 'a');
  assert.deepEqual(focusedSourceIds(map, state), ['a']);

  const disabled = sanitizeViewState(map, { highlightEnabled: false });
  assert.deepEqual(focusedSourceIds(map, disabled), []);
});

test('脉络图 peek 只临时改变焦点而不抹掉主线阅读进度 activeStepId', () => {
  const state = sanitizeViewState(map, {
    activeTab: 'map',
    activeStepId: 's2',
    peek: { kind: 'node', id: 'n1' },
    sourceId: 'b',
  });
  assert.equal(state.activeStepId, 's2');
  assert.deepEqual(state.peek, { kind: 'node', id: 'n1' });
  assert.deepEqual(activeFocusSelection(map, state), { kind: 'node', id: 'n1' });
  assert.deepEqual(focusedSourceIds(map, state), ['b']);
});

test('openAsideId 只允许当前步骤所属的合法岔路', () => {
  const valid = sanitizeViewState(map, { activeStepId: 's1', openAsideId: 'x1' });
  assert.equal(valid.openAsideId, 'x1');
  assert.deepEqual(activeFocusSelection(map, valid), { kind: 'step', id: 'x1' });

  const invalid = sanitizeViewState(map, { activeStepId: 's2', openAsideId: 'x1' });
  assert.equal(invalid.openAsideId, undefined);
});

test('视图状态丢弃不存在的 peek、分组与越界缩放', () => {
  const state = sanitizeViewState(map, {
    peek: { kind: 'node', id: 'ghost' },
    expandedGroupIds: ['grp', 'n2', 'ghost'],
    sourceId: 'unknown',
    viewport: { x: 0, y: 0, zoom: 0 },
  });
  assert.equal(state.peek, undefined);
  assert.deepEqual(state.expandedGroupIds, ['grp']);
  assert.equal(state.sourceId, 'a');
  assert.equal(state.viewport, undefined);
});

test('视口缩放限制在 0.01–20 之间', () => {
  const zoom = (value: number) => sanitizeViewState(map, { viewport: { x: 1, y: 2, zoom: value } }).viewport;
  assert.deepEqual(zoom(1), { x: 1, y: 2, zoom: 1 });
  assert.deepEqual(zoom(0.01), { x: 1, y: 2, zoom: 0.01 });
  assert.deepEqual(zoom(20), { x: 1, y: 2, zoom: 20 });
  assert.equal(zoom(0.009), undefined);
  assert.equal(zoom(20.5), undefined);
  assert.equal(zoom(Number.POSITIVE_INFINITY), undefined);
});

test('原型链上的名字不会被当成已有来源', () => {
  const state = sanitizeViewState(map, { peek: { kind: 'node', id: 'n1' }, sourceId: 'constructor' });
  assert.equal(state.sourceId, 'a');
});

test('matchCursorToMap 柔和反查光标命中的步骤与节点', () => {
  const statuses: Record<string, SourceStatus> = {
    a: { file: 'a.ts', startLine: 1, endLine: 4, state: 'matched' },
    b: { file: 'b.ts', startLine: 3, endLine: 8, state: 'matched' },
    c: { file: 'c.ts', startLine: 5, endLine: 10, state: 'matched' },
  };
  const hitB = matchCursorToMap(map, statuses, 'b.ts', 5);
  assert.deepEqual(hitB.matchedNodeIds, ['n1', 'n2']);
  assert.deepEqual(hitB.matchedStepIds, ['s2']);

  const miss = matchCursorToMap(map, statuses, 'b.ts', 99);
  assert.deepEqual(miss, { matchedStepIds: [], matchedNodeIds: [] });
});
