import type { AgentCli, AgentReply, AgentStreamCallbacks } from './types';

interface CodexEvent {
  type?: unknown;
  thread_id?: unknown;
  item?: {
    type?: unknown;
    text?: unknown;
    command?: unknown;
  };
}

/**
 * Codex CLI in non-interactive JSONL mode (`codex exec --json --sandbox read-only`).
 */
export class CodexCli implements AgentCli {
  readonly id = 'codex';
  readonly label = 'Codex CLI';

  constructor(
    private readonly command = 'codex',
    private readonly extraArgs: readonly string[] = [],
  ) { }

  args(): string[] {
    return [this.command, 'exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', ...this.extraArgs];
  }

  resumeArgs(sessionId: string): string[] {
    return [this.command, 'exec', 'resume', sessionId, '--json', '--skip-git-repo-check', ...this.extraArgs];
  }

  onStreamLine(line: string, callbacks: AgentStreamCallbacks): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    let event: CodexEvent;
    try { event = JSON.parse(trimmed) as CodexEvent; } catch { return; }
    if ((event.type === 'item.started' || event.type === 'item.completed') && event.item) {
      if (event.item.type === 'command_execution' && typeof event.item.command === 'string' && event.type === 'item.started') {
        const cmd = event.item.command.trim().slice(0, 80);
        const isSearch = /\b(rg|grep|find)\b/.test(cmd);
        callbacks.onActivity?.({ kind: isSearch ? 'search' : 'read', text: cmd });
      } else if (event.item.type === 'agent_message' && typeof event.item.text === 'string' && event.type === 'item.completed') {
        callbacks.onDelta?.(event.item.text);
      } else if (event.item.type === 'reasoning' && typeof event.item.text === 'string' && event.type === 'item.completed') {
        callbacks.onActivity?.({ kind: 'think', text: event.item.text.slice(0, 100) });
      }
    }
  }

  parse(stdout: string, _stderr: string): AgentReply {
    let text = '';
    let sessionId: string | undefined;
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      let event: CodexEvent;
      try { event = JSON.parse(trimmed) as CodexEvent; } catch { continue; }
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
        sessionId = event.thread_id;
      }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message'
        && typeof event.item.text === 'string') {
        text = event.item.text;
      }
    }
    return { text, sessionId };
  }
}
