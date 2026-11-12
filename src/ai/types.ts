export interface AiCancel {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export class AiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AiError';
  }
}

export type AiPhase =
  | 'preparing'
  | 'running'
  | 'validating'
  | 'retry'
  | 'done'
  | 'error'
  | 'cancelled';

export interface AiCompletionRequest {
  system: string;
  user: string;
  cancel: AiCancel;
  onProgress?(text: string): void;
}

export interface AiProvider {
  readonly id: string;
  readonly label: string;
  complete(request: AiCompletionRequest): Promise<string>;
}
