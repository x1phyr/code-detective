import type { BridgeMessage, PeekTarget, RevealPayload, ViewState } from '../../shared/types';
import { HostError } from '../core/errors';
import { isCanonicalRelativePath } from '../core/paths';
import { t } from '../../shared/i18n';

const GLOBAL_EMPTY_MESSAGES = new Set([
  'view.ready',
  'maps.refresh',
  'prompt.copy',
  'help.open',
  'ai.open',
  'ai.cancel',
  'ai.refreshAgents',
  'ai.openSettings',
  'map.popout',
]);
const GLOBAL_TYPED_MESSAGES = new Set(['ai.generate', 'ai.setAgent', 'source.openLocation']);
const GLOBAL_MESSAGES = new Set([...GLOBAL_EMPTY_MESSAGES, ...GLOBAL_TYPED_MESSAGES]);

const TYPES = new Set([
  ...GLOBAL_MESSAGES,
  'map.open',
  'map.delete',
  'source.reveal',
  'tour.goto',
  'tour.step',
  'highlight.setEnabled',
  'ui.patch',
  'qa.ask',
  'qa.cancel',
  'qa.saveNote',
  'qa.saveAside',
  'note.delete',
]);

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_FILE_PATH_LENGTH = 1024;
const MAX_TOPIC_LENGTH = 2000;
const MAX_QUESTION_LENGTH = 4000;

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function fail(message: string): never { throw new HostError('INVALID_MESSAGE', message); }
function exactKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(t('host.bridgeUnknownField'));
}
function id(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }
function idList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 512 && value.every(id);
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10_000_000; }
function posInt(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1_000_000; }
function peekTarget(value: unknown): value is PeekTarget {
  return isObject(value) && Object.keys(value).every(key => ['kind', 'id'].includes(key))
    && typeof value.kind === 'string' && ['node', 'edge'].includes(value.kind) && id(value.id);
}

/**
 * `null` is the explicit "clear" signal for nullable fields (`openAsideId`, `peek`, `sourceId`),
 * since JSON drops `undefined` keys over `postMessage`.
 */
export type UiPatch = Omit<Partial<ViewState>, 'openAsideId' | 'peek' | 'sourceId'> & {
  openAsideId?: string | null;
  peek?: PeekTarget | null;
  sourceId?: string | null;
};

export function validateUiPatch(value: Record<string, unknown>): UiPatch {
  exactKeys(value, [
    'activeTab',
    'activeStepId',
    'openAsideId',
    'visitedStepIds',
    'peek',
    'sourceId',
    'expandedGroupIds',
    'expandedBranchIds',
    'highlightEnabled',
    'viewport',
  ]);
  if (value.activeTab !== undefined && value.activeTab !== 'walkthrough' && value.activeTab !== 'map') {
    fail(t('host.bridgeBadTab'));
  }
  if (value.activeStepId !== undefined && !id(value.activeStepId)) fail(t('host.bridgeBadStepId'));
  if (value.openAsideId !== undefined && value.openAsideId !== null && !id(value.openAsideId)) fail(t('host.bridgeBadStepId'));
  if (value.visitedStepIds !== undefined && !idList(value.visitedStepIds)) fail(t('host.bridgeBadIdList'));
  if (value.peek !== undefined && value.peek !== null && !peekTarget(value.peek)) fail(t('host.bridgeBadSelection'));
  if (value.sourceId !== undefined && value.sourceId !== null && !id(value.sourceId)) fail(t('host.bridgeBadSourceId'));
  if (value.expandedGroupIds !== undefined && !idList(value.expandedGroupIds)) fail(t('host.bridgeBadIdList'));
  if (value.expandedBranchIds !== undefined && !idList(value.expandedBranchIds)) fail(t('host.bridgeBadIdList'));
  if (value.highlightEnabled !== undefined && typeof value.highlightEnabled !== 'boolean') fail(t('host.bridgeBadHighlightState'));
  if (value.viewport !== undefined) {
    if (!isObject(value.viewport)) fail(t('host.bridgeBadViewport'));
    exactKeys(value.viewport, ['x', 'y', 'zoom']);
    if (!finite(value.viewport.x) || !finite(value.viewport.y) || !finite(value.viewport.zoom)
      || value.viewport.zoom < 0.01 || value.viewport.zoom > 20) fail(t('host.bridgeBadViewportValues'));
  }
  return value as UiPatch;
}

export function parseBridgeMessage(value: unknown): BridgeMessage<Record<string, unknown>> {
  if (!isObject(value)) fail(t('host.bridgeNotObject'));
  exactKeys(value, ['protocolVersion', 'requestId', 'type', 'mapKey', 'mapRevision', 'payload']);
  if (value.protocolVersion !== 1 || typeof value.requestId !== 'string' || !value.requestId || value.requestId.length > 128
    || typeof value.type !== 'string' || !TYPES.has(value.type) || !isObject(value.payload)) fail(t('host.bridgeBadEnvelope'));
  if (value.mapKey !== undefined && (typeof value.mapKey !== 'string' || !value.mapKey || value.mapKey.length > 16_384)) fail(t('host.bridgeBadMapKey'));
  if (value.mapRevision !== undefined && (typeof value.mapRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.mapRevision))) fail(t('host.bridgeBadMapRevision'));
  if (JSON.stringify(value).length > 256 * 1024) fail(t('host.bridgeTooLarge'));

  const payload = value.payload;
  if (GLOBAL_MESSAGES.has(value.type) && (value.mapKey !== undefined || value.mapRevision !== undefined)) {
    fail(t('host.bridgeUnexpectedMapFields'));
  }

  switch (value.type) {
    case 'view.ready':
    case 'maps.refresh':
    case 'prompt.copy':
    case 'help.open':
    case 'ai.open':
    case 'ai.cancel':
    case 'ai.refreshAgents':
    case 'ai.openSettings':
    case 'map.popout':
    case 'qa.cancel':
      exactKeys(payload, []);
      break;
    case 'map.open':
    case 'map.delete':
      exactKeys(payload, []);
      if (!value.mapKey) fail(t('host.bridgeOpenNeedsMapKey'));
      break;
    case 'ai.setAgent':
      exactKeys(payload, ['agentId']);
      if (typeof payload.agentId !== 'string' || !AGENT_ID.test(payload.agentId)) fail(t('host.bridgeBadAgentId'));
      break;
    case 'ai.generate':
      exactKeys(payload, ['topic', 'agentId', 'anchorFile', 'anchorSymbol', 'startLine', 'endLine', 'overwriteKey']);
      if (typeof payload.topic !== 'string' || !payload.topic.trim() || payload.topic.length > MAX_TOPIC_LENGTH) {
        fail(t('host.bridgeBadTopic'));
      }
      if (payload.agentId !== undefined && (typeof payload.agentId !== 'string' || !AGENT_ID.test(payload.agentId))) {
        fail(t('host.bridgeBadAgentId'));
      }
      if (payload.anchorFile !== undefined && (typeof payload.anchorFile !== 'string' || payload.anchorFile.length > MAX_FILE_PATH_LENGTH || !isCanonicalRelativePath(payload.anchorFile))) {
        fail(t('host.bridgeBadLocation'));
      }
      if (payload.anchorSymbol !== undefined && (typeof payload.anchorSymbol !== 'string' || payload.anchorSymbol.length > 256)) {
        fail(t('host.bridgeBadLocation'));
      }
      if (payload.startLine !== undefined && !posInt(payload.startLine)) fail(t('host.bridgeBadLocation'));
      if (payload.endLine !== undefined && !posInt(payload.endLine)) fail(t('host.bridgeBadLocation'));
      if (payload.overwriteKey !== undefined && (typeof payload.overwriteKey !== 'string' || !payload.overwriteKey || payload.overwriteKey.length > 16_384)) {
        fail(t('host.bridgeBadMapKey'));
      }
      break;
    case 'source.reveal':
      exactKeys(payload, ['targetKind', 'targetId', 'sourceId', 'focusEditor']);
      if (typeof payload.targetKind !== 'string' || !['node', 'edge', 'step'].includes(payload.targetKind) || !id(payload.targetId)
        || (payload.sourceId !== undefined && !id(payload.sourceId))
        || (payload.focusEditor !== undefined && typeof payload.focusEditor !== 'boolean')) fail(t('host.bridgeBadNavigate'));
      break;
    case 'source.openLocation':
      exactKeys(payload, ['file', 'startLine', 'endLine']);
      if (typeof payload.file !== 'string' || payload.file.length > MAX_FILE_PATH_LENGTH || !isCanonicalRelativePath(payload.file)) {
        fail(t('host.bridgeBadLocation'));
      }
      if (!posInt(payload.startLine)) fail(t('host.bridgeBadLocation'));
      if (payload.endLine !== undefined && (!posInt(payload.endLine) || payload.endLine < payload.startLine)) {
        fail(t('host.bridgeBadLocation'));
      }
      break;
    case 'tour.goto':
      exactKeys(payload, ['stepId']);
      if (!id(payload.stepId)) fail(t('host.bridgeBadStepId'));
      break;
    case 'tour.step':
      exactKeys(payload, ['delta']);
      if (payload.delta !== 1 && payload.delta !== -1) fail(t('host.bridgeBadStepId'));
      break;
    case 'highlight.setEnabled':
      exactKeys(payload, ['enabled']);
      if (typeof payload.enabled !== 'boolean') fail(t('host.bridgeBadHighlightToggle'));
      break;
    case 'ui.patch':
      validateUiPatch(payload);
      break;
    case 'qa.ask':
      exactKeys(payload, ['stepId', 'question', 'includeSelection']);
      if (!id(payload.stepId)) fail(t('host.bridgeBadStepId'));
      if (typeof payload.question !== 'string' || !payload.question.trim() || payload.question.length > MAX_QUESTION_LENGTH) {
        fail(t('host.bridgeBadQuestion'));
      }
      if (payload.includeSelection !== undefined && typeof payload.includeSelection !== 'boolean') {
        fail(t('host.bridgeUnknownField'));
      }
      break;
    case 'qa.saveNote':
      exactKeys(payload, ['exchangeId']);
      if (!id(payload.exchangeId)) fail(t('host.bridgeBadStepId'));
      break;
    case 'qa.saveAside':
      exactKeys(payload, ['exchangeId', 'title']);
      if (!id(payload.exchangeId)) fail(t('host.bridgeBadStepId'));
      if (payload.title !== undefined && (typeof payload.title !== 'string' || payload.title.length > 200)) {
        fail(t('host.bridgeUnknownField'));
      }
      break;
    case 'note.delete':
      exactKeys(payload, ['stepId', 'noteId']);
      if (!id(payload.stepId) || !id(payload.noteId)) fail(t('host.bridgeBadStepId'));
      break;
    default:
      fail(t('host.bridgeBadEnvelope'));
  }

  return value as unknown as BridgeMessage<Record<string, unknown>>;
}

export function asRevealPayload(message: BridgeMessage<Record<string, unknown>>): RevealPayload {
  return message.payload as unknown as RevealPayload;
}

export function isCancellation(message: BridgeMessage<Record<string, unknown>>): boolean {
  return message.type === 'ai.cancel'
    || message.type === 'qa.cancel'
    || (message.type === 'highlight.setEnabled' && message.payload.enabled === false);
}
