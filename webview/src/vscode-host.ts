import type { HostMessage } from '../../shared/types';
import { envelope, type HostBridge, type WebviewPersistedState } from './bridge';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

export function hasVsCodeApi(): boolean {
  return typeof window.acquireVsCodeApi === 'function';
}

class VsCodeHost implements HostBridge {
  readonly preview = false;

  constructor(private readonly api: VsCodeApi) {}

  post<T>(type: string, payload: T, extra?: { mapKey?: string; mapRevision?: string }): void {
    this.api.postMessage(envelope(type, payload, extra));
  }

  onMessage(listener: (message: HostMessage) => void): void {
    window.addEventListener('message', event => listener(event.data as HostMessage));
  }

  saveState(state: WebviewPersistedState): void {
    this.api.setState(state);
  }
}

export function createVsCodeHost(): HostBridge {
  const api = window.acquireVsCodeApi?.();
  if (!api) throw new Error('缺少 VS Code Webview API。');
  return new VsCodeHost(api);
}
