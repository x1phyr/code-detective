import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { CodeMap, SourceStatus, ViewState } from '../shared/types';
import { sanitizeViewState, sourceIdsForSelection } from '../src/core/selection';
import { mainline } from '../src/core/tour';
import { resolveSourceText } from '../src/core/source';
import { parseMap } from '../src/core/validator';
import { parseBridgeMessage, validateUiPatch } from '../src/host/bridge';
import { isCanonicalRelativePath } from '../src/core/paths';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.join(here, '..', 'examples', 'bag-demo');
const mapPath = path.join(exampleRoot, '.code-detective', 'maps', 'bag-demo.json');

/**
 * Minimal stand-in for the host pipeline: parse a map, resolve every source
 * against the real demo files, then replay bridge messages the webview sends.
 */
class FakeController {
  map: CodeMap;
  ui: ViewState;
  statuses: Record<string, SourceStatus> = {};
  readonly posted: { type: string; payload: unknown }[] = [];

  constructor(map: CodeMap) {
    this.map = map;
    this.ui = sanitizeViewState(map, { highlightEnabled: true });
    this.resolveAll();
  }

  resolveAll(): void {
    for (const [id, ref] of Object.entries(this.map.sources)) {
      const file = path.join(exampleRoot, ref.file);
      let text = '';
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        this.statuses[id] = { ...ref, state: 'missing', message: `无法读取来源文件：${ref.file}` };
        continue;
      }
      this.statuses[id] = resolveSourceText(ref, text);
    }
  }

  receive(raw: unknown): void {
    const message = parseBridgeMessage(raw);
    this.posted.push({ type: message.type, payload: message.payload });
    switch (message.type) {
      case 'ui.patch': {
        const patch = validateUiPatch(message.payload);
        const { openAsideId, peek, sourceId, ...rest } = patch;
        const next: Partial<ViewState> = { ...this.ui, ...rest };
        if (openAsideId === null) delete next.openAsideId;
        else if (openAsideId !== undefined) next.openAsideId = openAsideId;
        if (peek === null) delete next.peek;
        else if (peek !== undefined) next.peek = peek;
        if (sourceId === null) delete next.sourceId;
        else if (sourceId !== undefined) next.sourceId = sourceId;
        this.ui = sanitizeViewState(this.map, next);
        return;
      }
      case 'tour.goto': {
        const stepId = String((message.payload as { stepId: string }).stepId);
        const step = this.map.walkthrough.find(s => s.id === stepId);
        if (!step) return;
        const firstSource = sourceIdsForSelection(this.map, { kind: 'step', id: stepId })[0];
        if (step.aside) {
          this.ui = sanitizeViewState(this.map, { ...this.ui, openAsideId: stepId, peek: undefined, sourceId: firstSource });
        } else {
          this.ui = sanitizeViewState(this.map, { ...this.ui, activeStepId: stepId, openAsideId: undefined, peek: undefined, sourceId: firstSource });
        }
        return;
      }
      case 'highlight.setEnabled':
        this.ui = sanitizeViewState(this.map, { ...this.ui, highlightEnabled: (message.payload as { enabled?: boolean }).enabled === true });
        return;
      default:
        return;
    }
  }
}

function envelope(type: string, payload: unknown = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { protocolVersion: 1, requestId: 'test', type, payload, ...extra };
}

function loadDemo(): FakeController {
  return new FakeController(parseMap(readFileSync(mapPath, 'utf8')));
}

test('示例地图的所有来源都能在真实文件中定位', () => {
  const controller = loadDemo();
  for (const [id, status] of Object.entries(controller.statuses)) {
    assert.equal(status.state, 'matched', `${id} 期望 matched，实际 ${status.state}`);
  }
});

test('login-demo 的所有来源同样能在真实文件中精确匹配', () => {
  const loginRoot = path.join(here, '..', 'examples', 'login-demo');
  const loginMap = parseMap(readFileSync(path.join(loginRoot, '.code-detective', 'maps', 'login-demo.json'), 'utf8'));
  for (const [id, ref] of Object.entries(loginMap.sources)) {
    const text = readFileSync(path.join(loginRoot, ref.file), 'utf8');
    const status = resolveSourceText(ref, text);
    assert.equal(status.state, 'matched', `login-demo ${id} 期望 matched，实际 ${status.state}`);
  }
});

test('closebagpanel 与各示例地图的所有来源精确匹配且保持在 5 行以内', () => {
  const cases = [
    { root: exampleRoot, file: path.join(exampleRoot, '.code-detective', 'maps', 'bag-demo.json'), name: 'bag-demo' },
    { root: exampleRoot, file: path.join(exampleRoot, '.code-detective', 'maps', 'closebagpanel.json'), name: 'closebagpanel' },
    {
      root: path.join(here, '..', 'examples', 'login-demo'),
      file: path.join(here, '..', 'examples', 'login-demo', '.code-detective', 'maps', 'login-demo.json'),
      name: 'login-demo',
    },
  ];
  for (const item of cases) {
    const parsed = parseMap(readFileSync(item.file, 'utf8'));
    for (const [id, ref] of Object.entries(parsed.sources)) {
      const text = readFileSync(path.join(item.root, ref.file), 'utf8');
      const status = resolveSourceText(ref, text);
      assert.equal(status.state, 'matched', `${item.name} ${id} 期望 matched，实际 ${status.state}`);
      assert.ok(ref.endLine - ref.startLine + 1 <= 5, `${item.name} ${id} 应聚焦关键语句（<= 5 行），实际 ${ref.endLine - ref.startLine + 1} 行`);
    }
  }
});

test('脉络图窥探节点会保留当前带读步骤与高亮开关', () => {
  const controller = loadDemo();
  const initialStep = controller.ui.activeStepId;
  controller.receive(envelope('ui.patch', { activeTab: 'map', peek: { kind: 'node', id: 'openBagPanel' } }));
  assert.deepEqual(controller.ui.peek, { kind: 'node', id: 'openBagPanel' });
  assert.equal(controller.ui.activeStepId, initialStep);
  assert.equal(controller.ui.highlightEnabled, true);

  controller.receive(envelope('ui.patch', { peek: null }));
  assert.equal(controller.ui.peek, undefined);
});

test('未知 peek 目标会被丢弃而不是写入持久状态', () => {
  const controller = loadDemo();
  controller.receive(envelope('ui.patch', { peek: { kind: 'node', id: 'ghost' } }));
  assert.equal(controller.ui.peek, undefined);
});

test('导读步骤可以在主线间跳转并就地展开岔路', () => {
  const controller = loadDemo();
  const steps = mainline(controller.map);
  assert.equal(steps.length, 6);

  controller.receive(envelope('tour.goto', { stepId: 'w.read' }));
  assert.equal(controller.ui.activeStepId, 'w.read');
  assert.equal(controller.ui.openAsideId, undefined);

  controller.receive(envelope('tour.goto', { stepId: 'w.fallback' }));
  assert.equal(controller.ui.activeStepId, 'w.read');
  assert.equal(controller.ui.openAsideId, 'w.fallback');

  controller.receive(envelope('tour.goto', { stepId: 'w.refresh' }));
  assert.equal(controller.ui.activeStepId, 'w.refresh');
  assert.equal(controller.ui.openAsideId, undefined);
});

test('拒绝节点位置补丁，布局保持固定', () => {
  const controller = loadDemo();
  assert.throws(
    () => controller.receive(envelope('ui.patch', { positions: { openBagPanel: { x: 120, y: 40 } } })),
    /未定义字段/,
  );
  assert.equal('positions' in controller.ui, false);
});

test('关闭高亮后状态保持关闭', () => {
  const controller = loadDemo();
  controller.receive(envelope('highlight.setEnabled', { enabled: false }));
  assert.equal(controller.ui.highlightEnabled, false);
  controller.receive(envelope('ui.patch', { peek: { kind: 'node', id: 'bindBagButton' } }));
  assert.equal(controller.ui.highlightEnabled, false);
});

test('来源路径都落在示例工作区内', () => {
  const controller = loadDemo();
  for (const ref of Object.values(controller.map.sources)) {
    assert.equal(isCanonicalRelativePath(ref.file), true, ref.file);
  }
});

test('拒绝伪造的消息与越界视图数据', () => {
  const controller = loadDemo();
  assert.throws(() => controller.receive(envelope('source.reveal', { targetKind: 'nope', targetId: 'x' })));
  assert.throws(() => controller.receive(envelope('ui.patch', { viewport: { x: 0, y: 0, zoom: 99 } })));
  assert.throws(() => controller.receive(envelope('view.ready', { extra: true })));
});
