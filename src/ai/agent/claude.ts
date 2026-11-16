import { emitToolActivity } from './activity';
import type { AgentCli, AgentReply, AgentStreamCallbacks } from './types';
import { t } from '../../../shared/i18n';

/** Read-only / exploration tools in Claude Code; lets the harness freely spawn Explore subagents, use LSP/skills, and search. */
const READ_ONLY_TOOLS = 'Read,Grep,Glob,LS,Agent,Task,Skill,LSP,ToolSearch,NotebookRead,WebFetch,WebSearch,TodoWrite';
/** Tools that cannot mutate workspace files or run arbitrary shell commands. */
const SAFE_TOOLS = new Set(READ_ONLY_TOOLS.split(','));
/** Hard-blocked mutating tools so workspace files stay untouched. */
const DISALLOWED_WRITE_TOOLS = 'Edit,Write,NotebookEdit';

export function readOnlyTools(configured: string): string {
  const kept = configured.split(',').map(tool => tool.trim()).filter(tool => SAFE_TOOLS.has(tool));
  return kept.length > 0 ? [...new Set(kept)].join(',') : READ_ONLY_TOOLS;
}

interface ClaudeEnvelope {
  type?: unknown;
  result?: unknown;
  is_error?: unknown;
  session_id?: unknown;
  message?: {
    content?: Array<{
      type?: unknown;
      text?: unknown;
      name?: unknown;
      input?: Record<string, unknown>;
    }>;
  };
}

/**
 * Claude Code in non-interactive streaming JSONL mode (`--output-format stream-json --verbose`),
 * while remaining compatible with single-envelope JSON (`--output-format json`) in `parse`.
 */
export class ClaudeCli implements AgentCli {
  readonly id = 'claude';
  readonly label = 'Claude Code';
  readonly tools: string;

  constructor(
    private readonly command = 'claude',
    private readonly extraArgs: readonly string[] = [],
    allowedTools = READ_ONLY_TOOLS,
  ) {
    this.tools = readOnlyTools(allowedTools);
  }

  args(): string[] {
    return [
      this.command,
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--allowedTools',
      this.tools,
      '--disallowedTools',
      DISALLOWED_WRITE_TOOLS,
      ...this.extraArgs,
    ];
  }

  resumeArgs(sessionId: string): string[] {
    return [...this.args(), '--resume', sessionId];
  }

  onStreamLine(line: string, callbacks: AgentStreamCallbacks): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    let obj: ClaudeEnvelope;
    try {
      obj = JSON.parse(trimmed) as ClaudeEnvelope;
    } catch {
      return;
    }
    if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
      for (const item of obj.message.content) {
        if (item.type === 'text' && typeof item.text === 'string' && item.text) {
          callbacks.onDelta?.(item.text);
        } else if (item.type === 'tool_use' && typeof item.name === 'string') {
          emitToolActivity(item.name, item.input, callbacks);
        }
      }
    }
  }

  parse(stdout: string, stderr: string): AgentReply {
    const envelope = parseEnvelope(stdout);
    if (!envelope) {
      const detail = (stderr.trim() || stdout.trim()).slice(0, 600);
      throw new Error(t('ai.unparsableOutput', { agent: this.label, detail }));
    }
    if (envelope.is_error === true) {
      throw new Error(t('ai.agentReturnedError', { agent: this.label, error: String(envelope.result ?? t('ai.unknownReason')) }));
    }
    const text = typeof envelope.result === 'string' ? envelope.result : '';
    const sessionId = typeof envelope.session_id === 'string' ? envelope.session_id : undefined;
    return { text, sessionId };
  }
}

/** Finds the final result envelope from either single-JSON output or stream-json JSONL output. */
function parseEnvelope(stdout: string): ClaudeEnvelope | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    const direct: unknown = JSON.parse(trimmed);
    if (direct !== null && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as ClaudeEnvelope;
    }
  } catch { /* fall through to JSONL scan */ }

  const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l.startsWith('{'));
  let lastAssistantText: string | undefined;
  let sessionId: string | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]!) as ClaudeEnvelope;
      if (typeof obj.session_id === 'string' && !sessionId) sessionId = obj.session_id;
      if ('result' in obj || obj.is_error === true) {
        return obj;
      }
      if (!lastAssistantText && obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
        const textBlock = obj.message.content.find(c => c.type === 'text' && typeof c.text === 'string');
        if (textBlock && typeof textBlock.text === 'string') lastAssistantText = textBlock.text;
      }
    } catch { /* ignore non-JSON line */ }
  }
  if (lastAssistantText !== undefined) {
    return { result: lastAssistantText, session_id: sessionId, is_error: false };
  }
  return undefined;
}
