import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSourceText } from '../src/core/source';

const anchor = 'function a() {\n  return 1;\n}';

test('锚点与声明范围完全一致时匹配', () => {
  const status = resolveSourceText({ file: 'a.ts', startLine: 2, endLine: 4, anchorText: anchor }, `// head\n${anchor}\n// tail`);
  assert.equal(status.state, 'matched');
  assert.equal(status.startLine, 2);
  assert.equal(status.endLine, 4);
});

test('CRLF 文本与 LF 锚点视为同一内容', () => {
  const status = resolveSourceText({ file: 'a.ts', startLine: 1, endLine: 3, anchorText: anchor }, anchor.replaceAll('\n', '\r\n'));
  assert.equal(status.state, 'matched');
});

test('唯一匹配会恢复到新位置', () => {
  const status = resolveSourceText({ file: 'a.ts', startLine: 1, endLine: 3, anchorText: anchor }, `// moved\n// again\n${anchor}`);
  assert.equal(status.state, 'relocated');
  assert.equal(status.startLine, 3);
  assert.equal(status.endLine, 5);
});

test('多个完整匹配时不猜测位置', () => {
  const status = resolveSourceText(
    { file: 'a.ts', startLine: 1, endLine: 3, anchorText: anchor },
    `// header\n${anchor}\n\n${anchor}`,
  );
  assert.equal(status.state, 'stale');
  assert.match(status.message ?? '', /多个完整匹配/);
});

test('锚点缺失时标记为需要复核', () => {
  const status = resolveSourceText({ file: 'a.ts', startLine: 1, endLine: 3, anchorText: anchor }, 'entirely different');
  assert.equal(status.state, 'stale');
});

test('没有锚点时仅按行号定位', () => {
  assert.equal(resolveSourceText({ file: 'a.ts', startLine: 1, endLine: 2 }, 'a\nb\nc').state, 'range-only');
  assert.equal(resolveSourceText({ file: 'a.ts', startLine: 9, endLine: 10 }, 'a\nb').state, 'out-of-range');
  assert.equal(resolveSourceText({ file: 'a.ts', startLine: 1, endLine: 1 }, 'a', true).state, 'stale');
});

test('非法行号直接判定越界', () => {
  assert.equal(resolveSourceText({ file: 'a.ts', startLine: 0, endLine: 1 }, 'a').state, 'out-of-range');
  assert.equal(resolveSourceText({ file: 'a.ts', startLine: 3, endLine: 2 }, 'a\nb\nc').state, 'out-of-range');
  assert.equal(resolveSourceText({ file: 'a.ts', startLine: 1.5, endLine: 2 }, 'a\nb').state, 'out-of-range');
});

test('锚点行数与声明范围不符时不使用锚点', () => {
  const status = resolveSourceText({ file: 'a.ts', startLine: 1, endLine: 5, anchorText: anchor }, anchor);
  assert.equal(status.state, 'stale');
  assert.match(status.message ?? '', /行数与声明范围不同/);
});

test('末尾换行不会多出一行', () => {
  assert.equal(resolveSourceText({ file: 'a.ts', startLine: 3, endLine: 3 }, 'a\nb\n').state, 'out-of-range');
  assert.equal(resolveSourceText({ file: 'a.ts', startLine: 2, endLine: 2 }, 'a\nb\n').state, 'range-only');
  assert.notEqual(resolveSourceText({ file: 'a.ts', startLine: 3, endLine: 3, anchorText: '' }, 'a\nb\n').state, 'matched');
  assert.equal(resolveSourceText({ file: 'a.ts', startLine: 2, endLine: 2, anchorText: 'b' }, 'a\nb\n').state, 'matched');
  // A genuinely blank last line (two trailing newlines) still counts.
  assert.equal(resolveSourceText({ file: 'a.ts', startLine: 3, endLine: 3, anchorText: '' }, 'a\nb\n\n').state, 'matched');
});

test('单独的 CR 换行与 LF 视为同一内容', () => {
  assert.equal(resolveSourceText({ file: 'a.ts', startLine: 1, endLine: 3, anchorText: anchor }, anchor.replaceAll('\n', '\r')).state, 'matched');
  assert.equal(resolveSourceText({ file: 'a.ts', startLine: 2, endLine: 2, anchorText: 'b' }, 'a\rb\rc').state, 'matched');
  assert.equal(resolveSourceText({ file: 'a.ts', startLine: 1, endLine: 3, anchorText: anchor.replaceAll('\n', '\r') }, anchor).state, 'matched');
});
