import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ancestry, childCounts, collapseBranches, findParentCycle, levelOf, representativeAt } from '../src/core/hierarchy';
import type { CodeMap, MapEdge, MapNode } from '../shared/types';

function map(nodes: MapNode[], edges: MapEdge[]): CodeMap {
  return { schemaVersion: 1, id: 'h', title: 'h', sources: {}, nodes, edges };
}

/*
 * 顶层：entry → auth → done
 * auth 是功能块：check → (fail 支线) / load → retry(支线)
 */
function sample(): CodeMap {
  return map(
    [
      { id: 'entry', label: '入口', sourceIds: [] },
      { id: 'auth', label: '认证', sourceIds: [] },
      { id: 'check', label: '校验', sourceIds: [], parent: 'auth', kind: 'condition' },
      { id: 'fail', label: '校验失败', sourceIds: [], parent: 'auth', kind: 'exit' },
      { id: 'load', label: '加载用户', sourceIds: [], parent: 'auth' },
      { id: 'cache', label: '读缓存', sourceIds: [], parent: 'load' },
      { id: 'db', label: '查库', sourceIds: [], parent: 'load' },
      { id: 'retry', label: '重试', sourceIds: [], parent: 'auth' },
      { id: 'done', label: '完成', sourceIds: [] },
    ],
    [
      { id: 'e1', from: 'entry', to: 'check', sourceIds: [] },
      { id: 'e2', from: 'check', to: 'fail', sourceIds: [], branch: '无效' },
      { id: 'e3', from: 'check', to: 'cache', sourceIds: [] },
      { id: 'e4', from: 'cache', to: 'db', sourceIds: [], branch: '未命中' },
      { id: 'e5', from: 'db', to: 'retry', sourceIds: [], branch: '超时' },
      { id: 'e6', from: 'cache', to: 'done', sourceIds: [] },
      { id: 'e7', from: 'db', to: 'done', sourceIds: [] },
    ],
  );
}

test('childCounts 与 ancestry', () => {
  const m = sample();
  const counts = childCounts(m);
  assert.equal(counts.get('auth'), 4);
  assert.equal(counts.get('load'), 2);
  assert.equal(counts.get('entry'), undefined);
  assert.deepEqual(ancestry(m, 'load').map(node => node.id), ['auth', 'load']);
  assert.deepEqual(ancestry(m, undefined), []);
  assert.deepEqual(ancestry(m, 'missing'), []);
});

test('representativeAt 找到节点在某一层的祖先', () => {
  const m = sample();
  assert.equal(representativeAt(m, 'db', undefined), 'auth');
  assert.equal(representativeAt(m, 'db', 'auth'), 'load');
  assert.equal(representativeAt(m, 'db', 'load'), 'db');
  assert.equal(representativeAt(m, 'entry', 'auth'), undefined);
});

test('顶层把跨层连线提升到功能块并合并', () => {
  const level = levelOf(sample(), undefined);
  assert.deepEqual(level.nodes.map(node => node.id), ['entry', 'auth', 'done']);
  const byPair = new Map(level.edges.map(edge => [`${edge.from}->${edge.to}`, edge]));
  assert.deepEqual([...byPair.keys()].sort(), ['auth->done', 'entry->auth']);
  const out = byPair.get('auth->done')!;
  assert.deepEqual(out.edgeIds, ['e6', 'e7']);
  assert.equal(out.branch, false);
  assert.equal(out.id, 'lift:auth->done');
});

test('功能块内部：直接连线保留原 id，块内连线不越界', () => {
  const level = levelOf(sample(), 'auth');
  assert.equal(level.parent, 'auth');
  assert.deepEqual(level.nodes.map(node => node.id), ['check', 'fail', 'load', 'retry']);
  const ids = level.edges.map(edge => `${edge.id}:${edge.from}->${edge.to}:${edge.branch}`).sort();
  assert.deepEqual(ids, [
    'e2:check->fail:true',
    'lift:check->load:check->load:false',
    'lift:load->retry:load->retry:true',
  ]);
});

test('不存在的层退回顶层', () => {
  assert.equal(levelOf(sample(), 'nope').parent, undefined);
});

test('支线默认折叠，展开后可见', () => {
  const level = levelOf(sample(), 'auth');
  const folded = collapseBranches(level, new Set());
  assert.deepEqual([...folded.visible].sort(), ['check', 'load']);
  assert.equal(folded.hidden.get('check'), 1);
  assert.equal(folded.hidden.get('load'), 1);

  const open = collapseBranches(level, new Set(['check']));
  assert.ok(open.visible.has('fail'));
  assert.equal(open.hidden.has('check'), false);
  assert.equal(open.hidden.get('load'), 1);
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
  const { visible } = collapseBranches(levelOf(m, undefined), new Set());
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
