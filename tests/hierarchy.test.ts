import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  childCounts,
  collapseBranches,
  findParentCycle,
  projectCompoundGraph,
  visibleRepresentative,
} from '../src/core/hierarchy';
import type { CodeMap, MapEdge, MapNode } from '../shared/types';

function map(nodes: MapNode[], edges: MapEdge[]): CodeMap {
  return {
    schemaVersion: 1,
    id: 'h',
    title: 'h',
    sources: {},
    nodes,
    edges,
    walkthrough: [{ id: 'w1', title: '一步', nodeIds: nodes[0] ? [nodes[0].id] : [], edgeIds: [] }],
  };
}

/*
 * 顶层：entry → auth → done
 * auth 是阶段分组（最多 1 层 parent）：check → (fail 支线) / load → retry(支线)
 */
function sample(): CodeMap {
  return map(
    [
      { id: 'entry', label: '入口', sourceIds: [] },
      { id: 'auth', label: '认证阶段', sourceIds: [] },
      { id: 'check', label: '校验凭证', sourceIds: [], parent: 'auth', kind: 'condition' },
      { id: 'fail', label: '校验失败', sourceIds: [], parent: 'auth', kind: 'exit' },
      { id: 'load', label: '加载用户', sourceIds: [], parent: 'auth' },
      { id: 'retry', label: '退避重试', sourceIds: [], parent: 'auth' },
      { id: 'done', label: '完成跳转', sourceIds: [] },
    ],
    [
      { id: 'e1', from: 'entry', to: 'check', sourceIds: [] },
      { id: 'e2', from: 'check', to: 'fail', sourceIds: [], branch: '无效' },
      { id: 'e3', from: 'check', to: 'load', sourceIds: [] },
      { id: 'e4', from: 'load', to: 'retry', sourceIds: [], branch: '超时' },
      { id: 'e5', from: 'load', to: 'done', sourceIds: [] },
    ],
  );
}

test('childCounts 与 visibleRepresentative 根据分组展开状态映射代表节点', () => {
  const m = sample();
  const counts = childCounts(m);
  assert.equal(counts.get('auth'), 4);
  assert.equal(counts.get('entry'), undefined);

  assert.equal(visibleRepresentative(m, 'load', new Set()), 'auth');
  assert.equal(visibleRepresentative(m, 'load', new Set(['auth'])), 'load');
  assert.equal(visibleRepresentative(m, 'entry', new Set(['auth'])), 'entry');
  assert.equal(visibleRepresentative(m, 'missing', new Set()), undefined);
});

test('收起分组时将跨边界连线汇合到分组卡片，隐藏组内连线', () => {
  const proj = projectCompoundGraph(sample(), new Set(), new Set());
  assert.equal(proj.groups.length, 0);
  assert.deepEqual(proj.nodes.map(node => node.id), ['entry', 'auth', 'done']);
  const byPair = new Map(proj.edges.map(edge => [`${edge.from}->${edge.to}`, edge]));
  assert.deepEqual([...byPair.keys()].sort(), ['auth->done', 'entry->auth']);
  assert.deepEqual(byPair.get('entry->auth')!.edgeIds, ['e1']);
  assert.deepEqual(byPair.get('auth->done')!.edgeIds, ['e5']);
});

test('就地展开分组时保留上下游节点于同一画布，并暴露分组框与组内主干节点', () => {
  const proj = projectCompoundGraph(sample(), new Set(['auth']), new Set());
  assert.equal(proj.groups.length, 1);
  assert.equal(proj.groups[0]!.node.id, 'auth');
  assert.deepEqual(proj.groups[0]!.childIds, ['check', 'load']);
  // 展开后上下游 entry / done 仍在同一张图上，且支线 fail / retry 默认收起
  assert.deepEqual(proj.nodes.map(node => node.id), ['entry', 'check', 'load', 'done']);
  assert.equal(proj.hiddenBranches.get('check'), 1);
  assert.equal(proj.hiddenBranches.get('load'), 1);

  // 展开 check 的支线后 fail 出现在分组内
  const withBranch = projectCompoundGraph(sample(), new Set(['auth']), new Set(['check']));
  assert.ok(withBranch.groups[0]!.childIds.includes('fail'));
  assert.ok(withBranch.nodes.some(node => node.id === 'fail'));
});

test('全是环时仍有入口', () => {
  const m = map(
    [
      { id: 'a', label: 'a', sourceIds: [] },
      { id: 'b', label: 'b', sourceIds: [] },
    ],
    [
      { id: 'ab', from: 'a', to: 'b', sourceIds: [] },
      { id: 'ba', from: 'b', to: 'a', sourceIds: [], branch: '回到开头' },
    ],
  );
  const { visible } = collapseBranches({ nodes: m.nodes, edges: m.edges.map(e => ({ id: e.id, from: e.from, to: e.to, edge: e, edgeIds: [e.id], branch: Boolean(e.branch) })) }, new Set());
  assert.deepEqual([...visible].sort(), ['a', 'b']);
});

test('findParentCycle 发现 parent 环', () => {
  assert.equal(findParentCycle(sample()), undefined);
  const m = map(
    [
      { id: 'a', label: 'a', sourceIds: [], parent: 'b' },
      { id: 'b', label: 'b', sourceIds: [], parent: 'a' },
    ],
    [],
  );
  assert.ok(findParentCycle(m));
});

test('环里的入口只取一个，其余支线照常折叠', () => {
  const m = map(
    [
      { id: 'post', label: 'post', sourceIds: [] },
      { id: 'ok', label: 'ok', sourceIds: [] },
      { id: 'retry', label: 'retry', sourceIds: [] },
      { id: 'giveup', label: 'giveup', sourceIds: [] },
    ],
    [
      { id: 'a', from: 'post', to: 'ok', sourceIds: [] },
      { id: 'b', from: 'post', to: 'retry', sourceIds: [], branch: '失败' },
      { id: 'c', from: 'retry', to: 'post', sourceIds: [], branch: '再试' },
      { id: 'd', from: 'retry', to: 'giveup', sourceIds: [], branch: '用尽' },
      { id: 'e', from: 'giveup', to: 'post', sourceIds: [], branch: '回到入口' },
    ],
  );
  const proj = projectCompoundGraph(m, new Set(), new Set());
  assert.deepEqual(proj.nodes.map(n => n.id).sort(), ['ok', 'post']);
  assert.equal(proj.hiddenBranches.get('post'), 2);
});

test('只经由不可见节点才能到达的节点不会消失', () => {
  const m = map(
    [
      { id: 'a', label: 'a', sourceIds: [] },
      { id: 'x', label: 'x', sourceIds: [] },
      { id: 'y', label: 'y', sourceIds: [] },
    ],
    [
      { id: 'xy', from: 'x', to: 'y', sourceIds: [], branch: '去' },
      { id: 'yx', from: 'y', to: 'x', sourceIds: [], branch: '回' },
    ],
  );
  const proj = projectCompoundGraph(m, new Set(), new Set());
  const visible = new Set(proj.nodes.map(n => n.id));
  assert.ok(visible.has('a'));
  assert.ok(visible.has('x') || visible.has('y'));
  assert.equal([...proj.hiddenBranches.values()].reduce((sum, n) => sum + n, 0) + visible.size, 3);
});
