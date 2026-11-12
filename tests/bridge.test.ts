import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBridgeMessage, validateUiPatch, asRevealPayload, isCancellation, validateGeneratePayload } from '../src/host/bridge';
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

test('map.open 必须携带 mapKey', () => {
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'map.open' }))), 'INVALID_MESSAGE');
  assert.equal(parseBridgeMessage(message({ type: 'map.open', mapKey: 'root::a' })).mapKey, 'root::a');
});

test('全局消息不能携带地图字段', () => {
  assert.equal(codeOf(() => parseBridgeMessage(message({ mapKey: 'root::a' }))), 'INVALID_MESSAGE');
});

test('校验地图版本标识格式', () => {
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'map.open', mapKey: 'k', mapRevision: 'abc' }))), 'INVALID_MESSAGE');
});

test('source.reveal 参数校验', () => {
  const valid = message({
    type: 'source.reveal',
    payload: { targetKind: 'node', targetId: 'n1', focusEditor: true },
  });
  assert.deepEqual(asRevealPayload(parseBridgeMessage(valid)).targetId, 'n1');
  assert.equal(codeOf(() => parseBridgeMessage(message({
    type: 'source.reveal',
    payload: { targetKind: 'pane', targetId: 'n1' },
  }))), 'INVALID_MESSAGE');
});

test('ui.patch 只接受声明的字段与有限数值', () => {
  assert.deepEqual(validateUiPatch({ highlightEnabled: false }), { highlightEnabled: false });
  assert.equal(codeOf(() => validateUiPatch({ unknown: 1 })), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => validateUiPatch({ viewport: { x: 0, y: 0, zoom: 0 } })), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => validateUiPatch({ viewport: { x: 0, y: 0, zoom: 1e9 } })), 'INVALID_MESSAGE');
});

test('节点位置固定，拒绝坐标补丁', () => {
  assert.equal(codeOf(() => validateUiPatch({ positions: { n1: { x: 1, y: 2 } } })), 'INVALID_MESSAGE');
});

test('取消类消息识别', () => {
  const stop = parseBridgeMessage(message({ type: 'tour.stop' }));
  assert.equal(isCancellation(stop), true);
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

test('ai.generate 只接受合法话题与工作区相对文件', () => {
  assert.equal(parseBridgeMessage(message({
    type: 'ai.generate',
    payload: { topic: '背包加载流程', agent: 'codex', files: ['src/bag-button.ts', 'src/bag-panel.ts'] },
  })).type, 'ai.generate');

  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'ai.generate', payload: { topic: '   ' } }))), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'ai.generate', payload: { topic: 'x'.repeat(4001) } }))), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'ai.generate', payload: { topic: 'a', agent: '../evil' } }))), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'ai.generate', payload: { topic: 'a', files: ['../secret.ts'] } }))), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'ai.generate', payload: { topic: 'a', files: ['/etc/passwd'] } }))), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'ai.generate', payload: { topic: 'a', files: ['src/./a.ts'] } }))), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'ai.generate', payload: { topic: 'a', files: ['C:\\a.ts'] } }))), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'ai.generate', payload: { topic: 'a', files: ['src/a\u0000.ts'] } }))), 'INVALID_MESSAGE');
  // 真实项目里的中文目录、空格与 @scope 文件名必须能通过。
  for (const file of ['src/背包/打开面板.ts', 'src/my file.ts', '@types/shared.d.ts', 'src/a+b.ts']) {
    assert.equal(parseBridgeMessage(message({ type: 'ai.generate', payload: { topic: 'a', files: [file] } })).type, 'ai.generate');
  }
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'ai.generate', payload: { topic: 'a', extra: 1 } }))), 'INVALID_MESSAGE');
});

test('ai.generate 拒绝非法文件数量与类型', () => {
  assert.equal(codeOf(() => validateGeneratePayload({ topic: 'a', files: new Array(41).fill('a.ts') })), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => validateGeneratePayload({ topic: 'a', files: [1] })), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => validateGeneratePayload({ topic: 'a', files: 'src/a.ts' })), 'INVALID_MESSAGE');
});

test('ai.select 只接受合法的 agent 标识', () => {
  assert.equal(parseBridgeMessage(message({ type: 'ai.select', payload: { agent: 'claude' } })).type, 'ai.select');
  assert.equal(parseBridgeMessage(message({ type: 'ai.select', payload: { agent: 'my-agent_2' } })).type, 'ai.select');
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'ai.select', payload: { agent: '' } }))), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'ai.select', payload: { agent: '../evil' } }))), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'ai.select', payload: { agent: 'claude', model: 'x' } }))), 'INVALID_MESSAGE');
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'ai.select', payload: {} }))), 'INVALID_MESSAGE');
});

test('ai.status 与 ai.cancel 是全局消息，不能携带地图字段', () => {
  assert.equal(parseBridgeMessage(message({ type: 'ai.status' })).type, 'ai.status');
  assert.equal(parseBridgeMessage(message({ type: 'ai.cancel' })).type, 'ai.cancel');
  assert.equal(codeOf(() => parseBridgeMessage(message({ type: 'ai.status', mapKey: 'k' }))), 'INVALID_MESSAGE');
});
