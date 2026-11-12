export type AiPhase =
  | 'preparing'
  | 'running'
  | 'validating'
  | 'retry'
  | 'done'
  | 'error'
  | 'cancelled';

export interface AgentCancel {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

/** One turn of a multi-turn agent conversation. */
export interface AgentTurnRequest {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  cancel: AgentCancel;
  /** Raw CLI output, used for the streaming character counter. */
  onChunk?(chunk: string): void;
}

export interface AgentTurnResponse {
  text: string;
  sessionId?: string;
}

export class AiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AiError';
  }
}

/**
 * A conversation with one local agent CLI. The agent runs inside the workspace
 * with its own read tools, so the plugin never ships source text to it.
 */
export interface AgentSession {
  readonly id: string;
  readonly label: string;
  /** Session handle of the last turn; pass it to continue the conversation. */
  readonly sessionId?: string;
  /** Sends one message and returns the reply plus the session to continue with. */
  send(request: Omit<AgentTurnRequest, 'sessionId'>): Promise<AgentTurnResponse>;
}
