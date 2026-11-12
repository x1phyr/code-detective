import type { AgentCli, AgentReply } from './types';

/** Read-only tools a map author needs; the agent must never edit the workspace. */
const READ_ONLY_TOOLS = 'Read,Grep,Glob,LS';
/** Tools that cannot modify the workspace or run commands. */
const SAFE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'TodoWrite']);

/**
 * Applies `codeDetective.ai.cli.allowedTools`, keeping only tools that can't
 * write files or run commands (`Edit`, `Write`, `Bash` … are dropped).
 * Falls back to the default set when nothing usable remains.
 */
export function readOnlyTools(configured: string): string {
  const kept = configured.split(',').map(tool => tool.trim()).filter(tool => SAFE_TOOLS.has(tool));
  return kept.length > 0 ? [...new Set(kept)].join(',') : READ_ONLY_TOOLS;
}

interface ClaudeEnvelope {
  result?: unknown;
  is_error?: unknown;
  session_id?: unknown;
}

/**
 * Claude Code in single-shot mode.
 *
 * Verified against 2.1.x: `claude -p --output-format json` prints one envelope
 * `{ result, session_id, is_error }`, and the prompt may come from stdin.
 * `--session-id` pins the id so the next turn can `--resume` it.
 */
export class ClaudeCli implements AgentCli {
  readonly id = 'claude';
  readonly label = 'Claude Code';

  constructor(
    private readonly command = 'claude',
    private readonly extraArgs: readonly string[] = [],
    allowedTools = READ_ONLY_TOOLS,
  ) {
    this.tools = readOnlyTools(allowedTools);
  }

  /** Effective `--allowedTools` value after removing anything that can write. */
  readonly tools: string;

  args(): string[] {
    return [this.command, '-p', '--output-format', 'json', '--allowedTools', this.tools, ...this.extraArgs];
  }

  resumeArgs(sessionId: string): string[] {
    return [...this.args(), '--resume', sessionId];
  }

  parse(stdout: string, stderr: string): AgentReply {
    const envelope = parseEnvelope(stdout);
    if (!envelope) {
      const detail = (stderr.trim() || stdout.trim()).slice(0, 600);
      throw new Error(`无法解析 ${this.label} 的输出。${detail}`);
    }
    if (envelope.is_error === true) {
      throw new Error(`${this.label} 返回错误：${String(envelope.result ?? '未知原因')}`);
    }
    const text = typeof envelope.result === 'string' ? envelope.result : '';
    const sessionId = typeof envelope.session_id === 'string' ? envelope.session_id : undefined;
    return { text, sessionId };
  }
}

/** Last JSON object on stdout; the CLI may print warnings before the envelope. */
function parseEnvelope(stdout: string): ClaudeEnvelope | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  for (const candidate of [trimmed, trimmed.split('\n').at(-1) ?? '']) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as ClaudeEnvelope;
    } catch { /* try the next candidate */ }
  }
  return undefined;
}
