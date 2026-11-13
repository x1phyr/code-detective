import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CodeMap } from '../shared/types';
import { annotateSource, escapeMarkdown, INLINE_NOTE_MAX } from '../src/core/annotations';
import { parseMap } from '../src/core/validator';

const map: CodeMap = {
  schemaVersion: 1,
  id: 'demo',
  title: 'Demo',
  sources: {
    withNote: { file: 'src/a.ts', startLine: 1, endLine: 2, note: '先查缓存再请求接口' },
    bare: { file: 'src/b.ts', startLine: 3, endLine: 3 },
  },
  nodes: [
    { id: 'n1', label: '读取数据', description: '优先使用缓存', sourceIds: ['withNote'] },
    { id: 'n2', label: '兜底', description: '没有数据时返回空列表', sourceIds: ['bare'] },
  ],
  edges: [],
  walkthrough: [{ id: 'w1', title: '读数据', description: '看看缓存', nodeIds: ['n1'], edgeIds: [] }],
};

test('优先显示来源自己的 note', () => {
  const result = annotateSource(map, 'withNote', { kind: 'node', id: 'n1' });
  assert.equal(result?.inline, '先查缓存再请求接口');
  assert.match(result!.hover, /\*\*读取数据\*\*/);
  assert.match(result!.hover, /src\/a\.ts:1-2/);
});

test('没有 note 的旧地图回退到所属节点的 label 与 description', () => {
  const result = annotateSource(map, 'bare', { kind: 'node', id: 'n2' });
  assert.equal(result?.inline, '兜底 · 没有数据时返回空列表');
});

test('导读步骤里悬停显示步骤序号与说明', () => {
  const result = annotateSource(map, 'withNote', { kind: 'step', id: 'w1' });
  assert.match(result!.hover, /步骤 1\/1 · 读数据/);
  assert.match(result!.hover, /看看缓存/);
});

test('行尾文字按码点截断并加省略号', () => {
  const long = { ...map, sources: { s: { file: 'a.ts', startLine: 1, endLine: 1, note: '😀'.repeat(100) } } };
  const inline = annotateSource(long, 's')!.inline;
  assert.equal(Array.from(inline).length, INLINE_NOTE_MAX);
  assert.ok(inline.endsWith('…'));
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(inline), '不应留下半个代理对');
});

test('悬停里的地图文本会转义 Markdown', () => {
  assert.equal(escapeMarkdown('[x](http://evil)'), '\\[x\\]\\(http://evil\\)');
  const evil = { ...map, sources: { s: { file: 'a.ts', startLine: 1, endLine: 1, note: '[点我](command:foo)' } } };
  assert.ok(!annotateSource(evil, 's')!.hover.includes('](command:'));
});

test('没有任何可显示文字时不加注释；不存在的来源返回 undefined', () => {
  assert.equal(annotateSource(map, 'bare'), undefined);
  assert.equal(annotateSource(map, 'missing'), undefined);
  assert.equal(annotateSource(map, 'constructor'), undefined);
});

test('note 是可选字段，校验器接受并拒绝空白 note', () => {
  assert.equal(parseMap(JSON.stringify(map)).sources.withNote!.note, '先查缓存再请求接口');
  const blank = { ...map, sources: { ...map.sources, withNote: { ...map.sources.withNote!, note: '   ' } } };
  assert.throws(() => parseMap(JSON.stringify(blank)));
});
