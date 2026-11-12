import type { BridgeMessage, RevealPayload, Selection, ViewState } from '../../shared/types';
import { HostError } from '../core/errors';
import { isCanonicalRelativePath } from '../core/paths';

const GLOBAL_MESSAGES = new Set(['view.ready', 'maps.refresh', 'prompt.copy', 'help.open', 'ai.status', 'ai.cancel']);
const TYPES = new Set([...GLOBAL_MESSAGES, 'map.open', 'source.reveal', 'tour.goto', 'tour.stop', 'highlight.clear', 'highlight.setEnabled', 'ui.patch', 'map.openFile', 'ai.generate', 'ai.select']);
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function fail(message: string): never { throw new HostError('INVALID_MESSAGE', message); }
function exactKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('消息中包含未定义字段。');
}
function id(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10_000_000; }
function selection(value: unknown): value is Selection {
  return isObject(value) && Object.keys(value).every(key => ['kind', 'id'].includes(key))
    && typeof value.kind === 'string' && ['node', 'edge', 'step'].includes(value.kind) && id(value.id);
}

export function validateUiPatch(value: Record<string, unknown>): Partial<ViewState> {
  exactKeys(value, ['selection', 'sourceId', 'stepId', 'highlightEnabled', 'viewport']);
  if (value.selection !== undefined && !selection(value.selection)) fail('选中对象格式无效。');
  if (value.sourceId !== undefined && !id(value.sourceId)) fail('来源 ID 格式无效。');
  if (value.stepId !== undefined && !id(value.stepId)) fail('步骤 ID 格式无效。');
  if (value.highlightEnabled !== undefined && typeof value.highlightEnabled !== 'boolean') fail('高亮状态必须是布尔值。');
  if (value.viewport !== undefined) {
    if (!isObject(value.viewport)) fail('画布视口格式无效。');
    exactKeys(value.viewport, ['x', 'y', 'zoom']);
    if (!finite(value.viewport.x) || !finite(value.viewport.y) || !finite(value.viewport.zoom)
      || value.viewport.zoom < 0.01 || value.viewport.zoom > 20) fail('画布视口坐标或缩放值无效。');
  }
  return value as Partial<ViewState>;
}

const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const MAX_FILE_PATH_LENGTH = 1024;

export function validateGeneratePayload(value: Record<string, unknown>): void {
  exactKeys(value, ['topic', 'agent', 'files']);
  if (typeof value.topic !== 'string' || value.topic.trim().length === 0 || value.topic.length > 4000) {
    fail('请填写要分析的话题（1–4000 字）。');
  }
  if (value.agent !== undefined && (typeof value.agent !== 'string' || !AGENT_ID.test(value.agent))) {
    fail('agent 标识无效。');
  }
  if (value.files !== undefined) {
    if (!Array.isArray(value.files) || value.files.length > 40) fail('文件列表格式无效。');
    for (const file of value.files) {
      // 允许中文、空格等真实文件名；越界与规范化规则统一由 core/paths 判定。
      if (typeof file !== 'string' || file.length > MAX_FILE_PATH_LENGTH || !isCanonicalRelativePath(file)) {
        fail('文件路径必须是工作区相对路径。');
      }
    }
  }
}

export function parseBridgeMessage(value: unknown): BridgeMessage<Record<string, unknown>> {
  if (!isObject(value)) fail('消息必须是普通对象。');
  exactKeys(value, ['protocolVersion', 'requestId', 'type', 'mapKey', 'mapRevision', 'payload']);
  if (value.protocolVersion !== 1 || typeof value.requestId !== 'string' || !value.requestId || value.requestId.length > 128
    || typeof value.type !== 'string' || !TYPES.has(value.type) || !isObject(value.payload)) fail('消息格式或协议版本无效。');
  if (value.mapKey !== undefined && (typeof value.mapKey !== 'string' || !value.mapKey || value.mapKey.length > 16_384)) fail('地图标识无效。');
  if (value.mapRevision !== undefined && (typeof value.mapRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.mapRevision))) fail('地图版本标识无效。');
  if (JSON.stringify(value).length > 256 * 1024) fail('消息过大。');
  const payload = value.payload;
  if (GLOBAL_MESSAGES.has(value.type)) {
    exactKeys(payload, []);
    if (value.mapKey !== undefined || value.mapRevision !== undefined) fail('初始化或全局操作不应携带地图字段。');
  } else if (value.type === 'source.reveal') {
    exactKeys(payload, ['targetKind', 'targetId', 'sourceId', 'focusEditor']);
    if (typeof payload.targetKind !== 'string' || !['node', 'edge', 'step'].includes(payload.targetKind) || !id(payload.targetId)
      || (payload.sourceId !== undefined && !id(payload.sourceId))
      || (payload.focusEditor !== undefined && typeof payload.focusEditor !== 'boolean')) fail('来源导航参数无效。');
  } else if (value.type === 'tour.goto') {
    exactKeys(payload, ['stepId']);
    if (!id(payload.stepId)) fail('步骤 ID 格式无效。');
  } else if (value.type === 'highlight.setEnabled') {
    exactKeys(payload, ['enabled']);
    if (typeof payload.enabled !== 'boolean') fail('高亮开关必须是布尔值。');
  } else if (value.type === 'ui.patch') {
    validateUiPatch(payload);
  } else if (value.type === 'ai.generate') {
    validateGeneratePayload(payload);
  } else if (value.type === 'ai.select') {
    exactKeys(payload, ['agent']);
    if (typeof payload.agent !== 'string' || !AGENT_ID.test(payload.agent)) fail('agent 标识无效。');
  } else {
    exactKeys(payload, []);
  }
  if (value.type === 'map.open' && !value.mapKey) fail('打开地图需要 mapKey。');
  return value as unknown as BridgeMessage<Record<string, unknown>>;
}

export function asRevealPayload(message: BridgeMessage<Record<string, unknown>>): RevealPayload {
  return message.payload as unknown as RevealPayload;
}

export function isCancellation(message: BridgeMessage<Record<string, unknown>>): boolean {
  return message.type === 'tour.stop' || message.type === 'highlight.clear'
    || (message.type === 'highlight.setEnabled' && message.payload.enabled === false);
}
