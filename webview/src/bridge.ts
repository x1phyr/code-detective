import type { BridgeMessage, HostMessage } from '../../shared/types';

export interface WebviewPersistedState {
  mapKey: string;
}

export interface HostBridge {
  post<T>(type: string, payload: T, extra?: { mapKey?: string; mapRevision?: string }): void;
  onMessage(listener: (message: HostMessage) => void): void;
  /** 持久化 Webview 状态（VS Code `setState`）；宿主的 serializer 用 `mapKey` 在重载后恢复地图。 */
  saveState(state: WebviewPersistedState): void;
  readonly preview: boolean;
}

let counter = 0;

export function envelope<T>(
  type: string,
  payload: T,
  extra?: { mapKey?: string; mapRevision?: string },
): BridgeMessage<T> {
  counter += 1;
  return { protocolVersion: 1, requestId: `w${counter}`, type, payload, ...extra };
}
