import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRAFT_MAP_SCHEMA, describeAdjustments, fillAnchors, normalizeDraft } from '../src/core/mapDraft';
import { parseMap } from '../src/core/validator';
import type { CodeMap } from '../shared/types';

const demoFiles: Record<string, string> = {
  'src/bag-button.ts': 'export function onBagClick() {\n  openBag();\n}\n',
  'src/bag-panel.ts': 'export function openBag() {\n  renderBag();\n}\nexport function renderBag() {}\n',
};

function readDemo(file: string): string | undefined {
  return demoFiles[file];
}

function draft(): CodeMap {
  return {
    schemaVersion: 1,
    id: 'bag-flow',
    title: '背包打开流程',
    sources: {
      s1: { file: 'src/bag-button.ts', startLine: 1, endLine: 3 },
      s2: { file: 'src/bag-panel.ts', startLine: 1, endLine: 4 },
    },
    nodes: [
      { id: 'click', label: '点击背包按钮', sourceIds: ['s1'] },
      { id: 'render', label: '渲染面板', sourceIds: ['s2'] },
    ],
    edges: [{ id: 'e1', from: 'click', to: 'render', label: '调用', sourceIds: ['s1'] }],
    walkthrough: [{ id: 'w1', title: '第一步', nodeIds: ['click', 'render'], edgeIds: ['e1'] }],
  };
}

test('草稿 schema 与 v1 地图字段一致，但不接受 anchorText 与 schemaVersion', () => {
  const schema = DRAFT_MAP_SCHEMA as unknown as {
    required: readonly string[];
    properties: Record<string, any>;
  };
  assert.deepEqual([...schema.required].sort(), ['edges', 'nodes', 'sources', 'title']);
  assert.equal(schema.properties.schemaVersion, undefined);
  const source = schema.properties.sources.additionalProperties;
  assert.deepEqual([...source.required].sort(), ['endLine', 'file', 'startLine']);
  assert.equal(source.properties.anchorText, undefined);
  assert.equal(source.additionalProperties, false);
});

test('按真实文件补全 anchorText 后能通过严格校验', () => {
  const filled = fillAnchors(draft(), readDemo);
  assert.equal(filled.map.sources.s1?.anchorText, 'export function onBagClick() {\n  openBag();\n}');
  assert.equal(filled.map.sources.s2?.anchorText, 'export function openBag() {\n  renderBag();\n}\nexport function renderBag() {}');
  assert.deepEqual(describeAdjustments(filled), []);
  const parsed = parseMap(JSON.stringify(filled.map));
  assert.equal(parsed.nodes.length, 2);
  assert.equal(parsed.walkthrough?.length, 1);
});

test('模型自带的 anchorText 会被真实文件覆盖', () => {
  const input = draft();
  input.sources.s1 = { ...input.sources.s1!, anchorText: '不存在的文本' };
  const filled = fillAnchors(input, readDemo);
  assert.equal(filled.map.sources.s1?.anchorText, demoFiles['src/bag-button.ts']!.replace(/\n$/, ''));
});

test('行号越界时按文件长度裁剪并报告', () => {
  const input = draft();
  input.sources.s2 = { file: 'src/bag-panel.ts', startLine: 2, endLine: 99 };
  const filled = fillAnchors(input, readDemo);
  const ref = filled.map.sources.s2!;
  // Trailing newline is not treated as a real line, so the range clamps to content.
  assert.deepEqual([ref.startLine, ref.endLine], [2, demoFiles['src/bag-panel.ts']!.trimEnd().split('\n').length]);
  assert.equal(describeAdjustments(filled).some(line => line.includes('裁剪行号')), true);
  assert.doesNotThrow(() => parseMap(JSON.stringify(filled.map)));
});

test('无法读取的来源连同引用一起移除，地图仍然有效', () => {
  const input = draft();
  input.sources.s3 = { file: 'src/missing.ts', startLine: 1, endLine: 2 };
  input.nodes.push({ id: 'ghost', label: '不存在的节点', sourceIds: ['s3'] });
  input.edges.push({ id: 'e2', from: 'render', to: 'ghost', sourceIds: ['s3'] });
  const filled = fillAnchors(input, readDemo);
  assert.deepEqual(filled.droppedSources.map(item => item.id), ['s3']);
  assert.deepEqual(filled.droppedNodes.map(item => item.id), ['ghost']);
  assert.deepEqual(filled.droppedEdges.map(item => item.id), ['e2']);
  assert.deepEqual(filled.map.walkthrough?.[0]?.nodeIds, ['click', 'render']);
  assert.doesNotThrow(() => parseMap(JSON.stringify(filled.map)));
});

test('没有任何可用节点时给出可读错误', () => {
  const input = draft();
  input.sources = { s1: { file: 'src/none.ts', startLine: 1, endLine: 1 } };
  assert.throws(() => fillAnchors(input, readDemo), /没有任何节点/);
});

test('normalizeDraft 补默认值并剥掉 anchorText 与 $schema', () => {
  const normalized = normalizeDraft({
    $schema: './schema.json',
    title: 'My Flow!',
    sources: { s1: { file: 'a.ts', startLine: 1, endLine: 1, anchorText: 'x' } },
    nodes: [{ id: 'n1', label: 'N', sourceIds: ['s1'] }],
    edges: [],
    walkthrough: [],
  });
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.id, 'my-flow');
  assert.equal(normalized.sources.s1?.anchorText, undefined);
  assert.equal(normalized.$schema, undefined);
});

test('模型给的 id 一律规范化为 schema 形式', () => {
  const base = {
    sources: { s1: { file: 'a.ts', startLine: 1, endLine: 1 } },
    nodes: [{ id: 'n1', label: 'N', sourceIds: ['s1'] }],
    edges: [],
  };
  assert.equal(normalizeDraft({ ...base, id: 'Bag Demo', title: '背包' }).id, 'bag-demo');
  assert.equal(normalizeDraft({ ...base, id: 'UPPER_CASE', title: '背包' }).id, 'upper-case');
  assert.equal(normalizeDraft({ ...base, title: '中文标题' }).id, 'ai-map');
});

test('超长文本会被裁剪而不是让整张地图失败', () => {
  const normalized = normalizeDraft({
    title: 't'.repeat(500),
    sources: { s1: { file: 'a.ts', startLine: 1, endLine: 1 } },
    nodes: [{ id: 'n1', label: 'l'.repeat(500), sourceIds: ['s1'] }],
    edges: [],
  });
  assert.equal(normalized.title.length, 200);
  assert.equal(normalized.nodes[0]?.label.length, 200);
  const filled = fillAnchors(normalized, () => 'line\n');
  assert.doesNotThrow(() => parseMap(JSON.stringify(filled.map)));
});

test('畸形的来源、节点与步骤被丢弃而不是抛 TypeError', () => {
  const normalized = normalizeDraft({
    title: 'x',
    sources: {
      good: { file: 'a.ts', startLine: 1, endLine: 1 },
      nullRef: null,
      numberRef: 5,
      noFile: { startLine: 1, endLine: 1 },
      reversed: { file: 'a.ts', startLine: 4, endLine: 2 },
      stringLines: { file: 'a.ts', startLine: '1', endLine: '1' },
    },
    nodes: ['nope', { id: 'n1', label: 'N', sourceIds: ['good'] }],
    edges: [],
    walkthrough: { bad: 1 },
  });
  assert.deepEqual(Object.keys(normalized.sources).sort(), ['good', 'stringLines']);
  assert.deepEqual(normalized.nodes.map(node => node.id), ['n1']);
  assert.equal(normalized.walkthrough, undefined);
});

test('重复的 sourceIds 会被去重，避免 uniqueItems 校验失败', () => {
  const normalized = normalizeDraft({
    title: 'x',
    sources: { s1: { file: 'a.ts', startLine: 1, endLine: 1 } },
    nodes: [{ id: 'n1', label: 'N', sourceIds: ['s1', 's1'] }],
    edges: [],
  });
  const filled = fillAnchors(normalized, () => 'line\n');
  assert.deepEqual(filled.map.nodes[0]?.sourceIds, ['s1']);
  assert.doesNotThrow(() => parseMap(JSON.stringify(filled.map)));
});

test('缺少 title 时给出可读错误', () => {
  assert.throws(() => normalizeDraft({ title: '   ', sources: {}, nodes: [], edges: [] }), /title/);
  assert.throws(() => normalizeDraft({ sources: {}, nodes: [], edges: [] }), /title/);
});
