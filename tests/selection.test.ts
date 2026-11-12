import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relatedSourceIds, sanitizeViewState, sourceIdsForSelection } from '../src/core/selection';
import type { CodeMap } from '../shared/types';

const map: CodeMap = {
  schemaVersion: 1,
  id: 'demo',
  title: '示例',
  sources: {
    a: { file: 'a.ts', startLine: 1, endLine: 2 },
    b: { file: 'b.ts', startLine: 3, endLine: 4 },
    c: { file: 'c.ts', startLine: 5, endLine: 6 },
  },
  nodes: [
    { id: 'n1', label: '一', sourceIds: ['a', 'b'] },
    { id: 'n2', label: '二', sourceIds: ['b', 'c'] },
  ],
  edges: [{ id: 'e1', from: 'n1', to: 'n2', sourceIds: ['c'] }],
  walkthrough: [{ id: 's1', title: '一步', nodeIds: ['n1'], edgeIds: ['e1'] }],
};

test('节点来源会去重并过滤未知 ID', () => {
  assert.deepEqual(sourceIdsForSelection(map, { kind: 'node', id: 'n1' }), ['a', 'b']);
  assert.deepEqual(sourceIdsForSelection(map, { kind: 'node', id: 'missing' }), []);
});

test('连线与步骤来源会合并子对象', () => {
  assert.deepEqual(sourceIdsForSelection(map, { kind: 'edge', id: 'e1' }), ['c']);
  assert.deepEqual(sourceIdsForSelection(map, { kind: 'step', id: 's1' }), ['a', 'b', 'c']);
});

test('相关来源包含全部节点与连线', () => {
  assert.deepEqual(relatedSourceIds(map), ['a', 'b', 'c']);
});

test('视图状态会丢弃不存在的引用', () => {
  const state = sanitizeViewState(map, {
    selection: { kind: 'node', id: 'ghost' },
    sourceId: 'a',
    highlightEnabled: false,
    viewport: { x: 0, y: 0, zoom: 0 },
  });
  assert.equal(state.selection, undefined);
  assert.equal(state.sourceId, undefined);
  assert.equal(state.highlightEnabled, false);
  assert.equal(state.viewport, undefined);
});

test('步骤选择会同步 stepId 并限定 sourceId', () => {
  const state = sanitizeViewState(map, { selection: { kind: 'step', id: 's1' }, sourceId: 'c' });
  assert.deepEqual(state.selection, { kind: 'step', id: 's1' });
  assert.equal(state.stepId, 's1');
  assert.equal(state.sourceId, 'c');

  const rejected = sanitizeViewState(map, { selection: { kind: 'step', id: 's1' }, sourceId: 'unknown' });
  assert.equal(rejected.sourceId, undefined);
});

test('仅 stepId 时会推导出步骤选择', () => {
  const state = sanitizeViewState(map, { stepId: 's1' });
  assert.deepEqual(state.selection, { kind: 'step', id: 's1' });
});

test('默认开启高亮且不保存节点位置', () => {
  const state = sanitizeViewState(map, undefined);
  assert.equal(state.highlightEnabled, true);
  assert.equal('positions' in state, false);
});

test('无效选择会清除 stepId', () => {
  const state = sanitizeViewState(map, { selection: { kind: 'step', id: 'ghost' }, stepId: 's1' });
  assert.equal(state.selection, undefined);
  assert.equal(state.stepId, undefined);
  const malformed = sanitizeViewState(map, { selection: 'n1' as never, stepId: 's1' });
  assert.equal(malformed.stepId, undefined);
});

test('视口缩放限制在 0.01–20 之间', () => {
  const zoom = (value: number) => sanitizeViewState(map, { viewport: { x: 1, y: 2, zoom: value } }).viewport;
  assert.deepEqual(zoom(1), { x: 1, y: 2, zoom: 1 });
  assert.deepEqual(zoom(0.01), { x: 1, y: 2, zoom: 0.01 });
  assert.deepEqual(zoom(20), { x: 1, y: 2, zoom: 20 });
  assert.equal(zoom(0.009), undefined);
  assert.equal(zoom(20.5), undefined);
  assert.equal(zoom(1e300), undefined);
  assert.equal(zoom(Number.POSITIVE_INFINITY), undefined);
});

test('原型链上的名字不会被当成已有来源', () => {
  const state = sanitizeViewState(map, { selection: { kind: 'node', id: 'n1' }, sourceId: 'constructor' });
  assert.equal(state.sourceId, undefined);
});
