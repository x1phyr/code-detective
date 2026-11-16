import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBridgeMessage, validateUiPatch, asRevealPayload, isCancellation } from '../src/host/bridge';
import { isCanonicalRelativePath, isWithin, resolveWithinRoot } from '../src/core/paths';
import { HostError } from '../src/core/errors';

function message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { protocolVersion: 1, requestId: 'r1', type: 'view.ready', payload: {}, ...overrides };
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as HostError).code;
  }
  assert.fail('expected a HostError');
}

test('接受最小的合法消息', () => {
  assert.equal(parseBridgeMessage(message()).type, 'view.ready');
});

test('拒绝错误协议版本、未知类型与非法 requestId', () => {
  assert.equal(codeOf(() => parseBridgeMessage(message({ protocolVersion: 2 }))), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'evil.run' }))), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => parseBridgeMessage(message({ requestId: '' }))), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => parseBridgeMessage(message({ requestId: 'x'.repeat(129) }))), 'INVALID_MESSAGE');
});

test('拒绝数组、null 与非普通对象', () => {
  assert.equal(codeOf(() => parseBridgeMessage([])), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => parseBridgeMessage(null)), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => parseBridgeMessage(new Date())), 'INVALID_MESSAGE');
});

test('拒绝未定义字段与超大消息', () => {
  assert.equal(codeOf(() => parseBridgeMessage(message({ extra: 1 }))), 'INVALID_MESSAGE');
  const huge = message({ type: 'map.open', mapKey: 'k', payload: {}, padding: 'x'.repeat(300 * 1024) });
  assert.equal(codeOf(() => parseBridgeMessage(huge)), 'INVALID_MESSAGE');
});

test('map.open 与 map.delete 必须携带 mapKey', () => {
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'map.open' }))), 'INVALID_MESSAGE');
  assert.equal(parseBridgeMessage(message({ type: 'map.open', mapKey: 'root::a' })).mapKey, 'root::a');
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'map.delete' }))), 'INVALID_MESSAGE');
  assert.equal(parseBridgeMessage(message({ type: 'map.delete', mapKey: 'root::a' })).mapKey, 'root::a');
});

test('全局消息不能携带地图字段', () => {
  assert.equal(codeOf(() => parseBridgeMessage(message({ mapKey: 'root::a' }))), 'INVALID_MESSAGE');
});

test('校验地图版本标识格式', () => {
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'map.open', mapKey: 'k', mapRevision: 'abc' }))), 'INVALID_MESSAGE');
});

test('source.reveal 与 source.openLocation 参数校验', () => {
  const valid = message({
    type: 'source.reveal',
    payload: { targetKind: 'node', targetId: 'n1', focusEditor: true },
  });
  assert.deepEqual(asRevealPayload(parseBridgeMessage(valid)).targetId, 'n1');
  assert.equal(codeOf(() => parseBridgeMessage(message({
    type: 'source.reveal',
    payload: { targetKind: 'pane', targetId: 'n1' },
  }))), 'INVALID_MESSAGE');

  assert.equal(parseBridgeMessage(message({
    type: 'source.openLocation',
    payload: { file: 'src/a.ts', startLine: 12, endLine: 15 },
  })).type, 'source.openLocation');
  assert.equal(codeOf(() => parseBridgeMessage(message({
    type: 'source.openLocation',
    payload: { file: 'src/a.ts', startLine: 0 },
  }))), 'INVALID_MESSAGE');
});

test('ui.patch 只接受声明的字段与有限数值，支持 null 清空 peek / openAsideId', () => {
  assert.deepEqual(validateUiPatch({ highlightEnabled: false }), { highlightEnabled: false });
  assert.deepEqual(validateUiPatch({ peek: null, openAsideId: null }), { peek: null, openAsideId: null });
  assert.deepEqual(validateUiPatch({ activeTab: 'map', peek: { kind: 'edge', id: 'e1' } }), {
    activeTab: 'map',
    peek: { kind: 'edge', id: 'e1' },
  });
  assert.equal(codeOf(() => validateUiPatch({ unknown: 1 })), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => validateUiPatch({ peek: { kind: 'step', id: 's1' } })), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => validateUiPatch({ viewport: { x: 0, y: 0, zoom: 0 } })), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => validateUiPatch({ viewport: { x: 0, y: 0, zoom: 1e9 } })), 'INVALID_MESSAGE');
});

test('节点位置固定，拒绝坐标补丁', () => {
  assert.equal(codeOf(() => validateUiPatch({ positions: { n1: { x: 1, y: 2 } } })), 'INVALID_MESSAGE');
});

test('取消类消息识别', () => {
  assert.equal(isCancellation(parseBridgeMessage(message({ type: 'ai.cancel' }))), true);
  assert.equal(isCancellation(parseBridgeMessage(message({ type: 'qa.cancel' }))), true);
  assert.equal(isCancellation(parseBridgeMessage(message({
    type: 'highlight.setEnabled',
    payload: { enabled: false },
  }))), true);
  assert.equal(isCancellation(parseBridgeMessage(message({ type: 'maps.refresh' }))), false);
});

test('相对路径判定拒绝越界与非法形式', () => {
  for (const file of ['', '.', '..', '../a.ts', 'a/../../b.ts', '/abs.ts', 'a\\b.ts', 'file:///x', 'a\u0000b.ts', 'src//a.ts']) {
    assert.equal(isCanonicalRelativePath(file), false, `expected rejection: ${JSON.stringify(file)}`);
  }
  for (const file of ['a.ts', 'src/a/b.ts', '.code-detective/maps/a.json']) {
    assert.equal(isCanonicalRelativePath(file), true, `expected acceptance: ${file}`);
  }
});

test('工作区边界判定不会把前缀相同的兄弟目录当作内部', () => {
  assert.equal(isWithin('/root/project', '/root/project/src/a.ts'), true);
  assert.equal(isWithin('/root/project', '/root/project-evil/a.ts'), false);
  assert.equal(isWithin('/root/project', '/root/other/a.ts'), false);
  assert.equal(resolveWithinRoot('/root/project', 'src/a.ts'), '/root/project/src/a.ts');
});

test('校验内嵌发起框与流式追问协议消息', () => {
  assert.equal(parseBridgeMessage(message({
    type: 'ai.generate',
    payload: { topic: '登录主流程', anchorFile: 'src/login.ts', startLine: 6, endLine: 14 },
  })).type, 'ai.generate');
  assert.equal(codeOf(() => parseBridgeMessage(message({
    type: 'ai.generate',
    payload: { topic: '   ' },
  }))), 'INVALID_MESSAGE');

  assert.equal(parseBridgeMessage(message({
    type: 'qa.ask',
    mapKey: 'root::demo',
    payload: { stepId: 's1', question: '这里为什么不重试？', includeSelection: true },
  })).type, 'qa.ask');
  assert.equal(parseBridgeMessage(message({
    type: 'qa.saveNote',
    mapKey: 'root::demo',
    payload: { exchangeId: 'qa-1' },
  })).type, 'qa.saveNote');
  assert.equal(parseBridgeMessage(message({
    type: 'qa.saveAside',
    mapKey: 'root::demo',
    payload: { exchangeId: 'qa-1', title: '补充岔路' },
  })).type, 'qa.saveAside');
});

test('接受 ai.refreshAgents 与 ai.openSettings 空载荷全局消息并拒绝多余字段', () => {
  assert.equal(parseBridgeMessage(message({ type: 'ai.refreshAgents' })).type, 'ai.refreshAgents');
  assert.equal(parseBridgeMessage(message({ type: 'ai.openSettings' })).type, 'ai.openSettings');
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'ai.refreshAgents', payload: { extra: 1 } }))), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'ai.openSettings', mapKey: 'root::a' }))), 'INVALID_MESSAGE');
});

test('不再接受已废弃的旧消息类型', () => {
  for (const type of ['map.openFile', 'highlight.clear', 'tour.stop']) {
    assert.equal(codeOf(() => parseBridgeMessage(message({ type }))), 'INVALID_MESSAGE');
  }
});
