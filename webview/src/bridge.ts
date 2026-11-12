import type { BridgeMessage, HostMessage } from '../../shared/types';

export interface HostBridge {
  post<T>(type: string, payload: T, extra?: { mapKey?: string; mapRevision?: string }): void;
  onMessage(listener: (message: HostMessage) => void): void;
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
