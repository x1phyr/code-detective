/**
 * A coding agent that runs locally on the user's machine (`claude`, `codex`, ...).
 *
 * Every agent is driven non-interactively in the workspace root, so the agent
 * reads the real files itself. The prompt always goes through stdin — never as a
 * command-line argument — so user text can never be parsed as CLI flags.
 */
export interface AgentActivity {
  kind: 'search' | 'read' | 'think' | 'status';
  text: string;
  detail?: string;
}

export interface AgentStreamCallbacks {
  onDelta?(delta: string): void;
  onActivity?(activity: AgentActivity): void;
}

export interface AgentTurn extends AgentStreamCallbacks {
  /** Prompt text written to stdin. */
  prompt: string;
  cwd: string;
  timeoutMs: number;
  cancel: AgentCancel;
  /** Raw stdout/stderr text, used for the streaming character counter. */
  onChunk?(chunk: string): void;
}

export interface AgentCancel {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface AgentReply {
  /** The assistant's final answer. */
  text: string;
  /** Opaque session handle; pass it back to continue the same conversation. */
  sessionId?: string;
}

export interface AgentCli {
  /** Stable id used in settings, e.g. `claude` / `codex`. */
  readonly id: string;
  readonly label: string;
  /** Argv for a fresh session. The prompt is *not* included. */
  args(): string[];
  /** Argv used to continue `sessionId`, or undefined when resuming is unsupported. */
  resumeArgs?(sessionId: string): string[] | undefined;
  /** Optional real-time JSONL line observer to surface exploration footprints and text deltas. */
  onStreamLine?(line: string, callbacks: AgentStreamCallbacks): void;
  /** Optional real-time plain-text chunk observer for CLIs that stream text directly. */
  onStreamChunk?(chunk: string, callbacks: AgentStreamCallbacks): void;
  /** Turns raw stdout into the reply, extracting a session id when available. */
  parse(stdout: string, stderr: string): AgentReply;
}

export class AgentError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AgentError';
  }
}
