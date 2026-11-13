import type { HostMessage, InitializePayload, MapSnapshot, MapSummary, SourceStatus, ViewState } from '../../shared/types';
import { DEFAULT_VIEW_STATE } from '../../shared/types';
import { sanitizeViewState, sourceIdsForSelection } from '../../src/core/selection';
import type { HostBridge } from './bridge';
import { demoMap } from './preview-data';
import { currentPreviewTheme, nextPreviewTheme, setPreviewTheme } from './preview-theme';

const mapKey = 'preview::bag-demo';
const revision = '0'.repeat(64);

const summaries: MapSummary[] = [
  {
    key: mapKey,
    title: demoMap.title,
    rootName: 'bag-demo',
    fileName: '.code-detective/maps/bag-demo.json',
    revision,
  },
];

function initialStatuses(): Record<string, SourceStatus> {
  const output: Record<string, SourceStatus> = {};
  for (const [id, ref] of Object.entries(demoMap.sources)) {
    output[id] = { file: ref.file, startLine: ref.startLine, endLine: ref.endLine, state: 'matched' };
  }
  return output;
}

export function createPreviewHost(): HostBridge {
  let ui: ViewState = sanitizeViewState(demoMap, DEFAULT_VIEW_STATE);
  const listeners: ((message: HostMessage) => void)[] = [];

  // 让 Webview 的 --vscode-* 变量在一开始就有值，和 VS Code 中的渲染条件一致。
  setPreviewTheme(currentPreviewTheme());

  const emit = (message: HostMessage): void => {
    for (const listener of listeners) listener(message);
  };

  const snapshot = (): MapSnapshot => ({
    key: mapKey,
    revision,
    map: demoMap,
    statuses: initialStatuses(),
    ui: structuredClone(ui),
  });

  const initialize = (): InitializePayload => ({ maps: summaries, current: snapshot() });

  const patch = (next: Partial<ViewState>): void => {
    ui = sanitizeViewState(demoMap, { ...ui, ...next });
    emit({ protocolVersion: 1, type: 'snapshot', payload: { snapshot: snapshot() } });
  };

  const notice = (message: string, severity: 'info' | 'warning' | 'error' = 'info'): void => {
    emit({ protocolVersion: 1, type: 'notice', payload: { message, severity } });
  };

  const reveal = (targetKind: 'node' | 'edge' | 'step', targetId: string, sourceId?: string): void => {
    const available = sourceIdsForSelection(demoMap, { kind: targetKind, id: targetId });
    const chosen = sourceId && available.includes(sourceId) ? sourceId : available[0];
    if (!chosen) {
      notice('这个对象没有关联源码。', 'warning');
      return;
    }
    patch({ sourceId: chosen });
    const ref = demoMap.sources[chosen]!;
    notice(`预览：跳转到 ${ref.file}:${ref.startLine}`);
  };

  const handle = (type: string, payload: Record<string, unknown>): void => {
    switch (type) {
      case 'view.ready':
        emit({ protocolVersion: 1, type: 'initialize', payload: initialize() });
        emit({ protocolVersion: 1, type: 'theme', payload: { kind: currentPreviewTheme() } });
        return;
      case 'preview.theme': {
        setPreviewTheme(nextPreviewTheme());
        emit({ protocolVersion: 1, type: 'theme', payload: { kind: currentPreviewTheme() } });
        return;
      }
      case 'maps.refresh':
        emit({ protocolVersion: 1, type: 'maps', payload: { maps: summaries } });
        return;
      case 'map.open':
        emit({ protocolVersion: 1, type: 'snapshot', payload: { snapshot: snapshot() } });
        return;
      case 'ui.patch':
        patch(payload as Partial<ViewState>);
        return;
      case 'source.reveal':
        reveal(payload.targetKind as 'node' | 'edge' | 'step', String(payload.targetId),
          typeof payload.sourceId === 'string' ? payload.sourceId : undefined);
        return;
      case 'tour.goto':
        patch({ selection: { kind: 'step', id: String(payload.stepId) }, stepId: String(payload.stepId) });
        return;
      case 'tour.stop':
        patch({ stepId: undefined, selection: undefined });
        return;
      case 'highlight.setEnabled':
        patch({ highlightEnabled: payload.enabled === true });
        return;
      case 'highlight.clear':
        patch({ highlightEnabled: false });
        return;
      case 'ai.open':
        notice('浏览器预览模式无法调用本地 AI，请在 VS Code 中运行。');
        return;
      case 'prompt.copy':
      case 'help.open':
      case 'map.openFile':
        notice('浏览器预览模式下该操作不可用。');
        return;
      default:
        return;
    }
  };

  return {
    preview: true,
    post<T>(type: string, payload: T): void {
      handle(type, (payload ?? {}) as Record<string, unknown>);
    },
    onMessage(listener: (message: HostMessage) => void): void {
      listeners.push(listener);
    },
    saveState(): void {
      // 浏览器预览没有 Webview 持久化状态。
    },
  };
}
