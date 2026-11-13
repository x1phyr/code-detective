import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { parseMap, MAP_LIMITS } from '../src/core/validator';
import type { CodeMap } from '../shared/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.join(here, '..', 'examples', 'bag-demo', '.code-detective', 'maps', 'bag-demo.json');

function example(): CodeMap {
  return parseMap(readFileSync(examplePath, 'utf8'));
}

function withChange(mutate: (map: CodeMap) => void): string {
  const map = example();
  mutate(map);
  return JSON.stringify(map);
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  assert.fail('expected parseMap to throw');
}

test('示例地图通过完整校验', () => {
  const map = example();
  assert.equal(map.schemaVersion, 1);
  assert.equal(map.id, 'bag-demo');
  assert.equal(map.nodes.length, 5);
  assert.equal(map.edges.length, 5);
  assert.equal(Object.keys(map.sources).length, 7);
});

test('拒绝非法 JSON 与重复键', () => {
  assert.match(codeOf(() => parseMap('{')), /JSON 语法错误/);
  assert.match(codeOf(() => parseMap('{"a":1,"a":2}')), /重复 JSON 键 "a"/);
});

test('拒绝缺失字段与未知字段', () => {
  assert.match(codeOf(() => parseMap('{}')), /缺少必填字段/);
  const unknownField = withChange(map => { (map as unknown as Record<string, unknown>).extra = true; });
  assert.match(codeOf(() => parseMap(unknownField)), /不支持字段 "extra"/);
});

test('拒绝重复 ID 与悬空引用', () => {
  const duplicate = withChange(map => { map.nodes[1]!.id = map.nodes[0]!.id; });
  assert.match(codeOf(() => parseMap(duplicate)), /重复 ID/);

  const badNodeRef = withChange(map => { map.nodes[0]!.sourceIds = ['missing']; });
  assert.match(codeOf(() => parseMap(badNodeRef)), /引用了不存在的 ID/);

  const badEdgeTarget = withChange(map => { map.edges[0]!.to = 'nowhere'; });
  assert.match(codeOf(() => parseMap(badEdgeTarget)), /找不到节点/);
});

test('拒绝绝对路径、URI、父目录与回溯路径', () => {
  for (const file of ['/etc/passwd', 'C:/windows', 'file:///tmp/a.ts', '../outside.ts', 'src/../../x.ts', 'src//a.ts', 'src\\a.ts']) {
    const text = withChange(map => { map.sources['button.id']!.file = file; });
    assert.match(codeOf(() => parseMap(text)), /file/, `expected rejection for ${file}`);
  }
});

test('拒绝行号顺序颠倒与锚点行数不符', () => {
  const inverted = withChange(map => {
    map.sources['button.id']!.startLine = 9;
    map.sources['button.id']!.endLine = 3;
  });
  assert.match(codeOf(() => parseMap(inverted)), /endLine 必须大于或等于 startLine/);

  const badAnchor = withChange(map => { map.sources['repo.load']!.anchorText = 'only one line'; });
  assert.match(codeOf(() => parseMap(badAnchor)), /必须包含 startLine 至 endLine 的全部完整行/);
});

test('拒绝超出数量上限的地图', () => {
  const oversized = withChange(map => {
    while (map.nodes.length < MAP_LIMITS.nodes) {
      const index = map.nodes.length;
      map.nodes.push({ id: `n${index}`, label: `节点 ${index}`, sourceIds: [] });
    }
    map.nodes.push({ id: 'n-extra', label: '多余', sourceIds: [] });
  });
  assert.match(codeOf(() => parseMap(oversized)), /不能超过/);
});

test('校验错误带行列信息', () => {
  const text = `{
  "schemaVersion": 1,
  "id": "demo",
  "id": "demo"
}`;
  const message = codeOf(() => parseMap(text));
  assert.match(message, /第 4 行/);
});

test('拒绝重复的导读步骤 ID', () => {
  const text = withChange(map => {
    const first = map.walkthrough?.[0];
    assert.ok(first, '示例地图需要导读步骤');
    map.walkthrough!.push({ ...first, title: '重复' });
  });
  assert.match(codeOf(() => parseMap(text)), /\/walkthrough\/\d+\/id.*重复 ID|重复 ID/);
});

test('拒绝空白路径段与带下划线的 scheme', () => {
  for (const file of [' ', 'src/ /a.ts', 'src/', 'my_dir:x/a.ts']) {
    const text = withChange(map => { map.sources['button.id']!.file = file; });
    assert.match(codeOf(() => parseMap(text)), /file/, `expected rejection for ${JSON.stringify(file)}`);
  }
});

test('数量上限：恰好达到上限时通过，超过一个时拒绝', () => {
  const build = (counts: { nodes?: number; edges?: number; sources?: number; steps?: number }): string => {
    const sourceCount = counts.sources ?? 1;
    const nodeCount = counts.nodes ?? 2;
    const sources: CodeMap['sources'] = {};
    for (let index = 0; index < sourceCount; index += 1) sources[`s${index}`] = { file: 'a.ts', startLine: 1, endLine: 1 };
    const map: CodeMap = {
      schemaVersion: 1,
      id: 'limits',
      title: 'limits',
      sources,
      nodes: Array.from({ length: nodeCount }, (_, index) => ({ id: `n${index}`, label: 'N', sourceIds: ['s0'] })),
      edges: Array.from({ length: counts.edges ?? 0 }, (_, index) => ({ id: `e${index}`, from: 'n0', to: 'n1', sourceIds: [] })),
      walkthrough: Array.from({ length: counts.steps ?? 0 }, (_, index) => ({ id: `w${index}`, title: 'W', nodeIds: ['n0'], edgeIds: [] })),
    };
    return JSON.stringify(map);
  };
  const cases: [keyof typeof MAP_LIMITS & ('nodes' | 'edges' | 'sources' | 'steps'), number][] = [
    ['nodes', MAP_LIMITS.nodes],
    ['edges', MAP_LIMITS.edges],
    ['sources', MAP_LIMITS.sources],
    ['steps', MAP_LIMITS.steps],
  ];
  for (const [key, limit] of cases) {
    assert.doesNotThrow(() => parseMap(build({ [key]: limit })), `${key} = ${limit}`);
    assert.match(codeOf(() => parseMap(build({ [key]: limit + 1 }))), /不能超过/, `${key} = ${limit + 1}`);
  }
});

test('anchorText 中的单独 CR 按换行计算行数', () => {
  const text = withChange(map => {
    map.sources['button.id'] = { file: 'a.ts', startLine: 1, endLine: 2, anchorText: 'a\rb' };
  });
  assert.doesNotThrow(() => parseMap(text));
});

test('parent 必须指向存在的其他节点且不能成环；branch / exit 是合法字段', () => {
  const ok = parseMap(withChange(map => {
    map.nodes[1]!.parent = map.nodes[0]!.id;
    map.nodes[1]!.kind = 'exit';
    map.edges[0]!.branch = '失败';
  }));
  assert.equal(ok.nodes[1]!.parent, ok.nodes[0]!.id);
  assert.equal(ok.edges[0]!.branch, '失败');

  assert.match(codeOf(() => parseMap(withChange(map => { map.nodes[0]!.parent = map.nodes[0]!.id; }))), /parent 不能指向节点自己/);
  assert.match(codeOf(() => parseMap(withChange(map => { map.nodes[0]!.parent = 'ghost'; }))), /parent 引用了不存在的节点 "?ghost"?/);
  assert.match(codeOf(() => parseMap(withChange(map => {
    map.nodes[0]!.parent = map.nodes[1]!.id;
    map.nodes[1]!.parent = map.nodes[0]!.id;
  }))), /parent 链形成了环/);
});

test('导读字段：sourceId 必须存在，branches 只能指向别的 aside 步骤', () => {
  const ok = parseMap(withChange(map => {
    const [first, second] = map.walkthrough!;
    first!.sourceId = Object.keys(map.sources)[0];
    first!.why = '为什么';
    first!.branches = [second!.id];
    second!.aside = true;
    map.tour = { example: '例子', recap: '总结', exercise: '练习' };
  }));
  assert.equal(ok.tour?.example, '例子');
  assert.match(codeOf(() => parseMap(withChange(map => { map.walkthrough![0]!.sourceId = 'ghost'; }))), /ghost/);
  assert.match(codeOf(() => parseMap(withChange(map => { map.walkthrough![0]!.branches = [map.walkthrough![1]!.id]; }))), /aside/);
  assert.match(codeOf(() => parseMap(withChange(map => {
    map.walkthrough![0]!.aside = true;
    map.walkthrough![0]!.branches = [map.walkthrough![0]!.id];
  }))), /不能指向自己/);
  assert.match(codeOf(() => parseMap(withChange(map => { (map.tour as Record<string, unknown>) = { other: 1 }; }))), /other/);
});
