import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRAFT_MAP_SCHEMA, describeAdjustments, fillAnchors, normalizeDraft } from '../src/core/mapDraft';
import { MAP_LIMITS, parseMap } from '../src/core/validator';
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
  assert.deepEqual([...schema.required].sort(), ['edges', 'nodes', 'sources', 'title', 'walkthrough']);
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
  assert.equal((normalized as unknown as Record<string, unknown>).$schema, undefined);
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
  assert.deepEqual(normalized.walkthrough, []);
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

test('缺少 title 时给出可读错误；空草稿、外层包装与 fallbackTitle 均按规则处理', () => {
  assert.throws(() => normalizeDraft({}), /空的讲义草稿/);
  assert.throws(() => normalizeDraft({ map: {} }), /空的讲义草稿/);
  assert.throws(() => normalizeDraft({ title: '   ', sources: {}, nodes: [], edges: [] }), /title/);
  assert.throws(() => normalizeDraft({ sources: {}, nodes: [], edges: [] }), /title/);

  const unwrapped = normalizeDraft({
    map: {
      title: '外层包装',
      sources: { s1: { file: 'a.ts', startLine: 1, endLine: 1 } },
      nodes: [{ id: 'n1', label: 'N', sourceIds: ['s1'] }],
      edges: [],
    },
  });
  assert.equal(unwrapped.title, '外层包装');

  const withFallback = normalizeDraft({
    sources: { s1: { file: 'a.ts', startLine: 1, endLine: 1 } },
    nodes: [{ id: 'n1', label: 'N', sourceIds: ['s1'] }],
    edges: [],
  }, { fallbackTitle: '登录链路' });
  assert.equal(withFallback.title, '登录链路');
});

const oneLine = (): string => 'line\n';

test('normalize 阶段丢弃的来源、节点、连线与步骤会进入调整报告', () => {
  const normalized = normalizeDraft({
    title: 'x',
    sources: { good: { file: 'a.ts', startLine: 1, endLine: 1 }, 'bad id!': { file: 'a.ts', startLine: 1, endLine: 1 }, nullRef: null },
    nodes: ['nope', { id: 'n1', label: 'N', sourceIds: ['good', 'bad id!', 'nullRef'] }, { id: 'n2' }],
    edges: [{ id: 'e1', from: 'n1' }],
    walkthrough: [{ id: 'w1', title: 'W', nodeIds: ['n1', 'x y'], edgeIds: [] }, { title: 'no id' }],
  });
  const filled = fillAnchors(normalized, oneLine);
  assert.deepEqual(filled.droppedSources.map(item => item.id).sort(), ['bad id!', 'nullRef']);
  assert.deepEqual(filled.droppedNodes.map(item => item.id), ['nodes[0]', 'n2']);
  assert.deepEqual(filled.droppedEdges.map(item => item.id), ['e1']);
  assert.deepEqual(filled.droppedSteps.map(item => item.id), ['walkthrough[1]']);
  assert.equal(filled.filteredRefs.some(ref => ref.includes('n1.sourceIds') && ref.includes('bad id!')), true);
  assert.equal(filled.filteredRefs.some(ref => ref.includes('n1.sourceIds') && ref.includes('nullRef')), true);
  assert.equal(filled.filteredRefs.some(ref => ref.includes('w1.nodeIds') && ref.includes('x y')), true);
  const report = describeAdjustments(filled).join('\n');
  for (const text of ['已丢弃的来源', '已丢弃的节点', '已丢弃的连线', '已丢弃的导读步骤', '已移除的引用']) {
    assert.match(report, new RegExp(text));
  }
  assert.deepEqual(filled.map.nodes[0]?.sourceIds, ['good']);
  assert.doesNotThrow(() => parseMap(JSON.stringify(filled.map)));
});

test('sourceIds 在 normalize 阶段全部失效的节点会被丢弃，而不是变成无锚点节点', () => {
  const normalized = normalizeDraft({
    title: 'x',
    sources: { good: { file: 'a.ts', startLine: 1, endLine: 1 }, broken: { file: 'a.ts', startLine: 'x', endLine: 1 } },
    nodes: [
      { id: 'n1', label: 'N', sourceIds: ['good'] },
      { id: 'lost', label: 'L', sourceIds: ['broken'] },
      { id: 'lost2', label: 'L2', sourceIds: [42] },
      { id: 'free', label: 'F', sourceIds: [] },
    ],
    edges: [],
  });
  const filled = fillAnchors(normalized, oneLine);
  assert.deepEqual(filled.map.nodes.map(node => node.id), ['n1', 'free']);
  assert.deepEqual(filled.droppedNodes.map(item => item.id), ['lost', 'lost2']);
  assert.match(describeAdjustments(filled).join('\n'), /lost（引用的源码位置都不可用）/);
});

test('被移除目标的引用会被报告', () => {
  const input = draft();
  input.edges[0]!.sourceIds = ['s1', 'gone'];
  input.walkthrough![0]!.nodeIds = ['click', 'ghost'];
  const filled = fillAnchors(input, readDemo);
  assert.equal(filled.filteredRefs.some(ref => ref.includes('e1.sourceIds') && ref.includes('gone')), true);
  assert.equal(filled.filteredRefs.some(ref => ref.includes('w1.nodeIds') && ref.includes('ghost')), true);
  assert.doesNotThrow(() => parseMap(JSON.stringify(filled.map)));
});

test('重复 id 只保留第一个，步骤内重复引用会去重', () => {
  const normalized = normalizeDraft({
    title: 'x',
    sources: { s1: { file: 'a.ts', startLine: 1, endLine: 1 } },
    nodes: [
      { id: 'n1', label: 'first', sourceIds: ['s1'] },
      { id: 'n1', label: 'second', sourceIds: ['s1'] },
      { id: 'n2', label: 'N2', sourceIds: ['s1'] },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', sourceIds: [] },
      { id: 'e1', from: 'n2', to: 'n1', sourceIds: [] },
    ],
    walkthrough: [
      { id: 'w1', title: 'A', nodeIds: ['n1', 'n1', 'n2'], edgeIds: ['e1', 'e1'] },
      { id: 'w1', title: 'B', nodeIds: ['n2'], edgeIds: [] },
    ],
  });
  const filled = fillAnchors(normalized, oneLine);
  assert.deepEqual(filled.map.nodes.map(node => node.label), ['first', 'N2']);
  assert.equal(filled.map.edges.length, 1);
  assert.deepEqual(filled.map.walkthrough, [{ id: 'w1', title: 'A', nodeIds: ['n1', 'n2'], edgeIds: ['e1'] }]);
  assert.deepEqual(filled.droppedNodes.map(item => item.id), ['n1']);
  assert.deepEqual(filled.droppedEdges.map(item => item.id), ['e1']);
  assert.deepEqual(filled.droppedSteps.map(item => item.id), ['w1']);
  assert.match(describeAdjustments(filled).join('\n'), /重复使用同一 id/);
  assert.doesNotThrow(() => parseMap(JSON.stringify(filled.map)));
});

test('fillAnchors 直接收到重复 id 的地图时同样只丢弃重复项', () => {
  const input = draft();
  input.nodes.push({ id: 'click', label: 'dup', sourceIds: ['s1'] });
  input.edges.push({ id: 'e1', from: 'render', to: 'click', sourceIds: [] });
  input.walkthrough!.push({ id: 'w1', title: 'dup', nodeIds: ['click'], edgeIds: [] });
  input.walkthrough![0]!.nodeIds = ['click', 'click'];
  const filled = fillAnchors(input, readDemo);
  assert.equal(filled.map.nodes.length, 2);
  assert.equal(filled.map.edges.length, 1);
  assert.equal(filled.map.walkthrough?.length, 1);
  assert.deepEqual(filled.map.walkthrough?.[0]?.nodeIds, ['click']);
  assert.doesNotThrow(() => parseMap(JSON.stringify(filled.map)));
});

test('原型链上的名字可以作为 sourceId 使用', () => {
  // Parsed from text so `__proto__` is an own key, exactly as a model response would arrive.
  const normalized = normalizeDraft(JSON.parse(`{
    "title": "x",
    "sources": {
      "__proto__": { "file": "a.ts", "startLine": 1, "endLine": 1 },
      "constructor": { "file": "a.ts", "startLine": 1, "endLine": 1 }
    },
    "nodes": [
      { "id": "n1", "label": "P", "sourceIds": ["__proto__"] },
      { "id": "n2", "label": "C", "sourceIds": ["constructor"] },
      { "id": "n3", "label": "T", "sourceIds": ["toString", "hasOwnProperty"] }
    ],
    "edges": []
  }`));
  assert.deepEqual(Object.keys(normalized.sources), ['__proto__', 'constructor']);
  const filled = fillAnchors(normalized, oneLine);
  assert.deepEqual(Object.keys(filled.map.sources), ['__proto__', 'constructor']);
  assert.deepEqual(filled.map.nodes.map(node => [node.id, node.sourceIds]), [['n1', ['__proto__']], ['n2', ['constructor']]]);
  assert.deepEqual(filled.droppedNodes.map(item => item.id), ['n3']);
  const parsed = parseMap(JSON.stringify(filled.map));
  assert.equal(Object.hasOwn(parsed.sources, '__proto__'), true);
});

test('起始行超出文件末尾时丢弃来源，而不是锚定到无关的最后一行', () => {
  const input = draft();
  input.sources.s2 = { file: 'src/bag-panel.ts', startLine: 50, endLine: 60 };
  const filled = fillAnchors(input, readDemo);
  assert.equal(filled.map.sources.s2, undefined);
  assert.match(filled.droppedSources.find(item => item.id === 's2')?.reason ?? '', /只有 4 行/);
  assert.deepEqual(filled.droppedNodes.map(item => item.id), ['render']);
  assert.deepEqual(filled.clamped, []);
});

test('起始行恰好是最后一行时只裁剪 endLine', () => {
  const input = draft();
  input.sources.s2 = { file: 'src/bag-panel.ts', startLine: 4, endLine: 9 };
  const filled = fillAnchors(input, readDemo);
  assert.deepEqual(filled.map.sources.s2, {
    file: 'src/bag-panel.ts',
    startLine: 4,
    endLine: 4,
    anchorText: 'export function renderBag() {}',
    symbol: 'renderBag',
  });
  assert.deepEqual(filled.clamped, ['s2: 4-9 → 4-4']);
});

test('末尾换行之后的“空行”不算文件中的一行', () => {
  const input = draft();
  input.sources.s1 = { file: 'src/bag-button.ts', startLine: 4, endLine: 4 };
  const filled = fillAnchors(input, readDemo);
  assert.equal(filled.map.sources.s1, undefined);
  assert.match(filled.droppedSources[0]?.reason ?? '', /只有 3 行/);
});

test('CRLF 与单独的 CR 换行都会被规范化', () => {
  const input = draft();
  input.sources = {
    s1: { file: 'cr.ts', startLine: 2, endLine: 3 },
    s2: { file: 'crlf.ts', startLine: 2, endLine: 3 },
  };
  const files: Record<string, string> = { 'cr.ts': 'a\rb\rc\r', 'crlf.ts': 'a\r\nb\r\nc\r\n' };
  const filled = fillAnchors(input, file => files[file]);
  assert.equal(filled.map.sources.s1?.anchorText, 'b\nc');
  assert.equal(filled.map.sources.s2?.anchorText, 'b\nc');
  assert.deepEqual(filled.clamped, []);
});

test('超长文本按码点截断，不会留下孤立的代理项', () => {
  const normalized = normalizeDraft({
    title: `${'t'.repeat(199)}😀😀`,
    sources: { s1: { file: 'a.ts', startLine: 1, endLine: 1 } },
    nodes: [{ id: 'n1', label: '😀'.repeat(300), sourceIds: ['s1'] }],
    edges: [],
  });
  assert.equal(normalized.title, `${'t'.repeat(199)}😀`);
  assert.equal(Array.from(normalized.nodes[0]!.label).length, 200);
  assert.equal(normalized.nodes[0]!.label, '😀'.repeat(200));
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(normalized.title), false);
  assert.doesNotThrow(() => parseMap(JSON.stringify(fillAnchors(normalized, oneLine).map)));
});

test('字符串行号只接受普通十进制整数', () => {
  const normalized = normalizeDraft({
    title: 'x',
    sources: {
      ok: { file: 'a.ts', startLine: '2', endLine: '3' },
      hex: { file: 'a.ts', startLine: '0x2', endLine: '3' },
      exp: { file: 'a.ts', startLine: '1', endLine: '3e0' },
      spaced: { file: 'a.ts', startLine: ' 1', endLine: '1' },
      decimal: { file: 'a.ts', startLine: '1.0', endLine: '1' },
      empty: { file: 'a.ts', startLine: '', endLine: '1' },
    },
    nodes: [{ id: 'n1', label: 'N', sourceIds: ['ok'] }],
    edges: [],
  });
  assert.deepEqual(Object.keys(normalized.sources), ['ok']);
  assert.deepEqual(normalized.sources.ok, { file: 'a.ts', startLine: 2, endLine: 3 });
  const dropped = fillAnchors(normalized, () => '1\n2\n3\n').droppedSources.map(item => item.id).sort();
  assert.deepEqual(dropped, ['decimal', 'empty', 'exp', 'hex', 'spaced']);
});

test('非规范路径的来源在 normalize 阶段被丢弃并报告', () => {
  const normalized = normalizeDraft({
    title: 'x',
    sources: {
      ok: { file: 'src/a.ts', startLine: 1, endLine: 1 },
      abs: { file: '/etc/passwd', startLine: 1, endLine: 1 },
      blank: { file: ' ', startLine: 1, endLine: 1 },
    },
    nodes: [{ id: 'n1', label: 'N', sourceIds: ['ok', 'abs'] }],
    edges: [],
  });
  assert.deepEqual(Object.keys(normalized.sources), ['ok']);
  const filled = fillAnchors(normalized, oneLine);
  assert.deepEqual(filled.droppedSources.map(item => item.id).sort(), ['abs', 'blank']);
  assert.doesNotThrow(() => parseMap(JSON.stringify(filled.map)));
});

test('超出校验器数量上限的条目会被裁掉并报告', () => {
  const nodes = Array.from({ length: MAP_LIMITS.nodes + 1 }, (_, index) => ({ id: `n${index}`, label: 'N', sourceIds: ['s1'] }));
  const steps = Array.from({ length: MAP_LIMITS.steps + 3 }, (_, index) => ({ id: `w${index}`, title: 'W', nodeIds: ['n0'], edgeIds: [] }));
  const edges = Array.from({ length: MAP_LIMITS.edges + 2 }, (_, index) => ({ id: `e${index}`, from: 'n0', to: 'n1', sourceIds: [] }));
  const sources: Record<string, unknown> = {};
  for (let index = 0; index < MAP_LIMITS.sources + 1; index += 1) sources[index === 0 ? 's1' : `x${index}`] = { file: 'a.ts', startLine: 1, endLine: 1 };
  const normalized = normalizeDraft({ title: 'x', sources, nodes, edges, walkthrough: steps });
  assert.equal(normalized.nodes.length, MAP_LIMITS.nodes);
  assert.equal(normalized.edges.length, MAP_LIMITS.edges);
  assert.equal(normalized.walkthrough?.length, MAP_LIMITS.steps);
  assert.equal(Object.keys(normalized.sources).length, MAP_LIMITS.sources);
  const filled = fillAnchors(normalized, oneLine);
  assert.deepEqual(filled.droppedNodes.map(item => item.id), [`n${MAP_LIMITS.nodes}`]);
  assert.equal(filled.droppedEdges.length, 2);
  assert.equal(filled.droppedSteps.length, 3);
  assert.equal(filled.droppedSources.length, 1);
  assert.match(describeAdjustments(filled).join('\n'), /数量上限 500/);
  assert.doesNotThrow(() => parseMap(JSON.stringify(filled.map)));
});

test('草稿保留 parent / branch / exit，去掉悬空或成环的 parent', () => {
  const input = draft();
  input.nodes.push({ id: 'block', label: '功能块', sourceIds: [] });
  input.nodes[0]!.parent = 'block';
  input.nodes[1]!.parent = 'ghost';
  input.nodes[1]!.kind = 'exit';
  input.edges[0]!.branch = '失败时';
  const filled = fillAnchors(normalizeDraft(input), readDemo);
  const byId = new Map(filled.map.nodes.map(node => [node.id, node]));
  assert.equal(byId.get('click')!.parent, 'block');
  assert.equal(byId.get('render')!.parent, undefined);
  assert.equal(byId.get('render')!.kind, 'exit');
  assert.equal(filled.map.edges[0]!.branch, '失败时');
  assert.equal(filled.filteredRefs.some(ref => ref.includes('render.parent') && ref.includes('ghost')), true);
  parseMap(JSON.stringify(filled.map));

  const cyclic = draft();
  cyclic.nodes[0]!.parent = 'render';
  cyclic.nodes[1]!.parent = 'click';
  const fixed = fillAnchors(normalizeDraft(cyclic), readDemo);
  parseMap(JSON.stringify(fixed.map));
  assert.equal(fixed.filteredRefs.some(ref => ref.includes('parent')), true);
});

test('草稿保留导读字段，去掉悬空的 sourceId 和指向非岔路的 branches', () => {
  const input = draft() as CodeMap & { walkthrough: NonNullable<CodeMap['walkthrough']> };
  input.walkthrough[0]!.sourceId = 's2';
  input.walkthrough[0]!.why = '  原因  ';
  input.walkthrough[0]!.branches = ['side', 'w1', 'ghost'];
  input.walkthrough.push({ id: 'side', title: '岔路', nodeIds: ['render'], edgeIds: [], aside: true, sourceId: 'nope' });
  (input as CodeMap).tour = { example: '例子', recap: '' };
  const filled = fillAnchors(normalizeDraft(input), readDemo);
  const [main, side] = filled.map.walkthrough!;
  assert.equal(main!.sourceId, 's2');
  assert.equal(main!.why, '原因');
  assert.deepEqual(main!.branches, ['side']);
  assert.equal(side!.aside, true);
  assert.equal(side!.sourceId, undefined);
  assert.deepEqual(filled.map.tour, { example: '例子' });
  parseMap(JSON.stringify(filled.map));
});

test('缺少带读主线时自动按节点兜底生成，并拍平超过 1 层的嵌套 parent', () => {
  const input = draft();
  input.walkthrough = [];
  input.nodes.push({ id: 'top', label: '顶层阶段', sourceIds: [] });
  input.nodes[0]!.parent = 'top';
  input.nodes[1]!.parent = 'click';
  const filled = fillAnchors(normalizeDraft(input), readDemo);
  assert.ok(filled.map.walkthrough.length >= 1, '应自动兜底生成主线带读步骤');
  const byId = new Map(filled.map.nodes.map(node => [node.id, node]));
  assert.equal(byId.get('click')!.parent, 'top');
  assert.equal(byId.get('render')!.parent, 'top', '超过 1 层的嵌套应拍平到顶层分组');
  assert.doesNotThrow(() => parseMap(JSON.stringify(filled.map)));
});

test('agent 写的 ./ 前缀、反斜杠和工作区内绝对路径会被改成相对路径', async () => {
  const { repairDraftPath } = await import('../src/core/mapDraft');
  assert.equal(repairDraftPath('./src/a.ts'), 'src/a.ts');
  assert.equal(repairDraftPath('src\\a.ts'), 'src/a.ts');
  assert.equal(repairDraftPath('/work/proj/src/a.ts', '/work/proj'), 'src/a.ts');
  assert.equal(repairDraftPath('/work/proj/src/a.ts', '/work/proj/'), 'src/a.ts');
  assert.equal(repairDraftPath('/elsewhere/a.ts', '/work/proj'), '/elsewhere/a.ts');
});

test('全部节点都不可用时，错误里带上源码被丢掉的原因', async () => {
  const { fillAnchors, normalizeDraft } = await import('../src/core/mapDraft');
  const draft = normalizeDraft({
    title: '空',
    sources: { s1: { file: 'missing.ts', startLine: 1, endLine: 2 } },
    nodes: [{ id: 'n1', label: '一', sourceIds: ['s1'] }],
    edges: [],
    walkthrough: [{ id: 'w1', title: '一', nodeIds: ['n1'], edgeIds: [] }],
  });
  assert.throws(() => fillAnchors(draft, () => undefined), /s1: .*missing\.ts/);
});

test('fillAnchors 自动补全 symbol、保留 variantLabel/sourceMode，并校验过滤 edge.via', () => {
  const input = draft();
  input.sources.s1 = { file: 'src/bag-button.ts', startLine: 2, endLine: 2, variantLabel: '按钮触发' };
  input.sources.hopBad = { file: 'src/missing.ts', startLine: 1, endLine: 1 };
  input.nodes[0]!.sourceMode = 'variants';
  input.edges[0]!.via = ['s2', 'hopBad'];
  delete input.edges[0]!.kind;

  const filled = fillAnchors(normalizeDraft(input), readDemo);
  assert.equal(filled.map.sources.s1?.symbol, 'onBagClick');
  assert.equal(filled.map.sources.s1?.variantLabel, '按钮触发');
  assert.equal(filled.map.sources.s2?.symbol, 'openBag');
  assert.equal(filled.map.nodes[0]!.sourceMode, 'variants');
  assert.deepEqual(filled.map.edges[0]!.via, ['s2']);
  assert.equal(filled.map.edges[0]!.kind, 'delegated');
  assert.equal(filled.filteredRefs.some(r => r.includes('e1.via') && r.includes('hopBad')), true);
  assert.doesNotThrow(() => parseMap(JSON.stringify(filled.map)));
});
