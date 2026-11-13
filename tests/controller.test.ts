import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { CodeMap, SourceStatus, ViewState } from '../shared/types';
import { sanitizeViewState } from '../src/core/selection';
import { resolveSourceText } from '../src/core/source';
import { parseMap } from '../src/core/validator';
import { parseBridgeMessage } from '../src/host/bridge';
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
      case 'ui.patch':
        this.ui = sanitizeViewState(this.map, { ...this.ui, ...(message.payload as Partial<ViewState>) });
        return;
      case 'tour.goto':
        this.ui = sanitizeViewState(this.map, {
          ...this.ui,
          selection: { kind: 'step', id: String(message.payload.stepId) },
          stepId: String(message.payload.stepId),
        });
        return;
      case 'highlight.setEnabled':
        this.ui = sanitizeViewState(this.map, { ...this.ui, highlightEnabled: message.payload.enabled === true });
        return;
      case 'tour.stop':
        this.ui = sanitizeViewState(this.map, { ...this.ui, stepId: undefined, selection: undefined });
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

test('选中节点会同步视图状态并保留高亮开关', () => {
  const controller = loadDemo();
  controller.receive(envelope('ui.patch', { selection: { kind: 'node', id: 'open' } }));
  assert.deepEqual(controller.ui.selection, { kind: 'node', id: 'open' });
  assert.equal(controller.ui.highlightEnabled, true);
});

test('未知选择会被丢弃而不是写入持久状态', () => {
  const controller = loadDemo();
  controller.receive(envelope('ui.patch', { selection: { kind: 'node', id: 'ghost' } }));
  assert.equal(controller.ui.selection, undefined);
});

test('导读步骤可以前进、后退并停止', () => {
  const controller = loadDemo();
  const steps = controller.map.walkthrough ?? [];
  assert.equal(steps.length, 3);

  controller.receive(envelope('tour.goto', { stepId: steps[0]!.id }));
  assert.equal(controller.ui.stepId, steps[0]!.id);
  assert.deepEqual(controller.ui.selection, { kind: 'step', id: steps[0]!.id });

  controller.receive(envelope('tour.goto', { stepId: steps[2]!.id }));
  assert.equal(controller.ui.stepId, steps[2]!.id);

  controller.receive(envelope('tour.stop'));
  assert.equal(controller.ui.stepId, undefined);
  assert.equal(controller.ui.selection, undefined);
});

test('拒绝节点位置补丁，布局保持固定', () => {
  const controller = loadDemo();
  assert.throws(
    () => controller.receive(envelope('ui.patch', { positions: { open: { x: 120, y: 40 } } })),
    /未定义字段/,
  );
  assert.equal('positions' in controller.ui, false);
});

test('关闭高亮后状态保持关闭', () => {
  const controller = loadDemo();
  controller.receive(envelope('highlight.setEnabled', { enabled: false }));
  assert.equal(controller.ui.highlightEnabled, false);
  controller.receive(envelope('ui.patch', { selection: { kind: 'node', id: 'click' } }));
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

