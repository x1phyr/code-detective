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
