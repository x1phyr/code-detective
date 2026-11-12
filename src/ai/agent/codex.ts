import type { AgentCli, AgentReply } from './types';

interface CodexEvent {
  type?: unknown;
  thread_id?: unknown;
  item?: { type?: unknown; text?: unknown };
}

/**
 * Codex CLI in non-interactive mode.
 *
 * Verified against 0.166: `codex exec --json --sandbox read-only` prints JSONL
 * events (`thread.started`, `item.completed`, `turn.completed`) and reads the
 * prompt from stdin. Resuming is `codex exec resume <thread-id>`; that subcommand
 * rejects `--sandbox`, so it is only passed for a fresh turn.
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
        // Keep the last agent message: earlier ones are interim narration.
        text = event.item.text;
      }
    }
    return { text, sessionId };
  }
}
