import type { BridgeMessage, RevealPayload, Selection, ViewState } from '../../shared/types';
import { HostError } from '../core/errors';
import { t } from '../../shared/i18n';

const GLOBAL_MESSAGES = new Set(['view.ready', 'maps.refresh', 'prompt.copy', 'help.open', 'ai.open']);
const TYPES = new Set([...GLOBAL_MESSAGES, 'map.open', 'source.reveal', 'tour.goto', 'tour.stop', 'highlight.setEnabled', 'ui.patch']);
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function fail(message: string): never { throw new HostError('INVALID_MESSAGE', message); }
function exactKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(t('host.bridgeUnknownField'));
}
function id(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10_000_000; }
function selection(value: unknown): value is Selection {
  return isObject(value) && Object.keys(value).every(key => ['kind', 'id'].includes(key))
    && typeof value.kind === 'string' && ['node', 'edge', 'step'].includes(value.kind) && id(value.id);
}

/**
 * `selection: null` is the explicit "clear" signal: JSON drops `undefined`
 * keys, so the webview cannot express clearing any other way.
 */
export type UiPatch = Omit<Partial<ViewState>, 'selection'> & { selection?: Selection | null };

export function validateUiPatch(value: Record<string, unknown>): UiPatch {
  exactKeys(value, ['selection', 'sourceId', 'stepId', 'highlightEnabled', 'viewport']);
  if (value.selection !== undefined && value.selection !== null && !selection(value.selection)) fail(t('host.bridgeBadSelection'));
  if (value.sourceId !== undefined && !id(value.sourceId)) fail(t('host.bridgeBadSourceId'));
  if (value.stepId !== undefined && !id(value.stepId)) fail(t('host.bridgeBadStepId'));
  if (value.highlightEnabled !== undefined && typeof value.highlightEnabled !== 'boolean') fail(t('host.bridgeBadHighlightState'));
  if (value.viewport !== undefined) {
    if (!isObject(value.viewport)) fail(t('host.bridgeBadViewport'));
    exactKeys(value.viewport, ['x', 'y', 'zoom']);
    if (!finite(value.viewport.x) || !finite(value.viewport.y) || !finite(value.viewport.zoom)
      || value.viewport.zoom < 0.01 || value.viewport.zoom > 20) fail(t('host.bridgeBadViewportValues'));
  }
  return value as UiPatch;
}

const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const MAX_FILE_PATH_LENGTH = 1024;

export function parseBridgeMessage(value: unknown): BridgeMessage<Record<string, unknown>> {
  if (!isObject(value)) fail(t('host.bridgeNotObject'));
  exactKeys(value, ['protocolVersion', 'requestId', 'type', 'mapKey', 'mapRevision', 'payload']);
  if (value.protocolVersion !== 1 || typeof value.requestId !== 'string' || !value.requestId || value.requestId.length > 128
    || typeof value.type !== 'string' || !TYPES.has(value.type) || !isObject(value.payload)) fail(t('host.bridgeBadEnvelope'));
  if (value.mapKey !== undefined && (typeof value.mapKey !== 'string' || !value.mapKey || value.mapKey.length > 16_384)) fail(t('host.bridgeBadMapKey'));
  if (value.mapRevision !== undefined && (typeof value.mapRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.mapRevision))) fail(t('host.bridgeBadMapRevision'));
  if (JSON.stringify(value).length > 256 * 1024) fail(t('host.bridgeTooLarge'));
  const payload = value.payload;
  if (GLOBAL_MESSAGES.has(value.type)) {
    exactKeys(payload, []);
    if (value.mapKey !== undefined || value.mapRevision !== undefined) fail(t('host.bridgeUnexpectedMapFields'));
  } else if (value.type === 'source.reveal') {
    exactKeys(payload, ['targetKind', 'targetId', 'sourceId', 'focusEditor']);
    if (typeof payload.targetKind !== 'string' || !['node', 'edge', 'step'].includes(payload.targetKind) || !id(payload.targetId)
      || (payload.sourceId !== undefined && !id(payload.sourceId))
      || (payload.focusEditor !== undefined && typeof payload.focusEditor !== 'boolean')) fail(t('host.bridgeBadNavigate'));
  } else if (value.type === 'tour.goto') {
    exactKeys(payload, ['stepId']);
    if (!id(payload.stepId)) fail(t('host.bridgeBadStepId'));
  } else if (value.type === 'highlight.setEnabled') {
    exactKeys(payload, ['enabled']);
    if (typeof payload.enabled !== 'boolean') fail(t('host.bridgeBadHighlightToggle'));
  } else if (value.type === 'ui.patch') {
    validateUiPatch(payload);
  } else {
    exactKeys(payload, []);
  }
  if (value.type === 'map.open' && !value.mapKey) fail(t('host.bridgeOpenNeedsMapKey'));
  return value as unknown as BridgeMessage<Record<string, unknown>>;
}

export function asRevealPayload(message: BridgeMessage<Record<string, unknown>>): RevealPayload {
  return message.payload as unknown as RevealPayload;
}

export function isCancellation(message: BridgeMessage<Record<string, unknown>>): boolean {
  return message.type === 'tour.stop'
    || (message.type === 'highlight.setEnabled' && message.payload.enabled === false);
}
