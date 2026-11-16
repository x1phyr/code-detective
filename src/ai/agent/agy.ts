import { emitToolActivity } from './activity';
import type { AgentCli, AgentReply, AgentStreamCallbacks } from './types';
import { t } from '../../../shared/i18n';

interface AgyEnvelope {
  event?: unknown;
  type?: unknown;
  status?: unknown;
  is_error?: unknown;
  error?: unknown;
  message?: unknown;
  conversation_id?: unknown;
  session_id?: unknown;
  response?: unknown;
  text?: unknown;
  delta?: unknown;
  text_delta?: unknown;
  thinking?: unknown;
  thought?: unknown;
  structured_output?: unknown;
  tool_info?: unknown;
  tool?: unknown;
  result?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseToolArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function extractResultText(obj: Record<string, unknown>): string | undefined {
  if (typeof obj.response === 'string') return obj.response;
  if (typeof obj.text === 'string') return obj.text;
  if (typeof obj.result === 'string') return obj.result;
  if (obj.structured_output !== undefined) {
    return typeof obj.structured_output === 'string'
      ? obj.structured_output
      : JSON.stringify(obj.structured_output);
  }
  return undefined;
}

/**
 * Google Antigravity CLI (`agy`) in headless streaming JSONL mode
 * (`agy -p --output-format stream-json`), supporting `--conversation` resume.
 */
export class AgyCli implements AgentCli {
  readonly id = 'agy';
  readonly label = 'Antigravity (agy)';

  constructor(
    private readonly command = 'agy',
    private readonly extraArgs: readonly string[] = [],
  ) {}

  args(): string[] {
    return [
      this.command,
      '-p',
      '--output-format',
      'stream-json',
      ...this.extraArgs,
    ];
  }

  resumeArgs(sessionId: string): string[] {
    return [...this.args(), '--conversation', sessionId];
  }

  onStreamLine(line: string, callbacks: AgentStreamCallbacks): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    let obj: AgyEnvelope;
    try {
      obj = JSON.parse(trimmed) as AgyEnvelope;
    } catch {
      return;
    }

    if (obj.event === 'step_update' || obj.type === 'step_update') {
      const toolObj = isRecord(obj.tool_info)
        ? obj.tool_info
        : isRecord(obj.tool)
          ? obj.tool
          : undefined;
      if (toolObj) {
        const name = asString(toolObj.name) ?? asString(toolObj.tool_name) ?? asString(toolObj.tool);
        if (name) {
          const input = parseToolArgs(toolObj.input ?? toolObj.arguments ?? toolObj.parameters) ?? toolObj;
          emitToolActivity(name, input, callbacks);
        }
      }

      const delta = asString(obj.delta) ?? asString(obj.text_delta) ?? asString(obj.text);
      if (delta) {
        callbacks.onDelta?.(delta);
      }

      const thought = asString(obj.thinking) ?? asString(obj.thought);
      if (thought) {
        callbacks.onActivity?.({ kind: 'think', text: thought.slice(0, 100) });
      }
      return;
    }

    if (obj.type === 'assistant' && isRecord(obj.message) && Array.isArray(obj.message.content)) {
      for (const item of obj.message.content) {
        if (!isRecord(item)) continue;
        if (item.type === 'text' && typeof item.text === 'string' && item.text) {
          callbacks.onDelta?.(item.text);
        } else if (item.type === 'tool_use' && typeof item.name === 'string') {
          emitToolActivity(item.name, item.input, callbacks);
        }
      }
    }
  }

  parse(stdout: string, stderr: string): AgentReply {
    const trimmed = stdout.trim();
    if (!trimmed) {
      const detail = stderr.trim().slice(0, 600);
      throw new Error(t('ai.unparsableOutput', { agent: this.label, detail }));
    }

    // Try single JSON object first (e.g. `--output-format json` override via extraArgs).
    try {
      const direct: unknown = JSON.parse(trimmed);
      if (isRecord(direct)) {
        const reply = this.parseEnvelope(direct);
        if (reply) return reply;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes(this.label)) throw error;
      /* fall through to JSONL scan */
    }

    const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l.startsWith('{'));
    let sessionId: string | undefined;
    let streamedDelta = '';
    let lastAssistantText: string | undefined;

    // Collect forward deltas and session id across all lines.
    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as AgyEnvelope;
        const sid = asString(obj.conversation_id) ?? asString(obj.session_id);
        if (sid) sessionId = sid;
        if (isRecord(obj.result)) {
          const innerSid = asString(obj.result.conversation_id) ?? asString(obj.result.session_id);
          if (innerSid) sessionId = innerSid;
        }
        if (obj.event === 'step_update' || obj.type === 'step_update') {
          const delta = asString(obj.delta) ?? asString(obj.text_delta) ?? asString(obj.text);
          if (delta) streamedDelta += delta;
        }
      } catch {
        /* ignore malformed line */
      }
    }

    for (let i = lines.length - 1; i >= 0; i -= 1) {
      let obj: unknown;
      try {
        obj = JSON.parse(lines[i]!);
      } catch {
        continue;
      }
      if (!isRecord(obj)) continue;

      const reply = this.parseEnvelope(obj, sessionId);
      if (reply) return reply;

      if (!lastAssistantText && obj.type === 'assistant' && isRecord(obj.message) && Array.isArray(obj.message.content)) {
        const texts = obj.message.content
          .filter((c): c is Record<string, unknown> => isRecord(c) && c.type === 'text' && typeof c.text === 'string')
          .map(c => c.text as string);
        if (texts.length > 0) lastAssistantText = texts.join('');
      }
    }

    if (lastAssistantText !== undefined) {
      return { text: lastAssistantText, sessionId };
    }
    if (streamedDelta.trim()) {
      return { text: streamedDelta, sessionId };
    }

    const detail = (stderr.trim() || trimmed).slice(0, 600);
    throw new Error(t('ai.unparsableOutput', { agent: this.label, detail }));
  }

  private parseEnvelope(obj: Record<string, unknown>, fallbackSessionId?: string): AgentReply | undefined {
    const outerSid = asString(obj.conversation_id) ?? asString(obj.session_id) ?? fallbackSessionId;

    if (isRecord(obj.result)) {
      const inner = obj.result;
      const innerSid = asString(inner.conversation_id) ?? asString(inner.session_id) ?? outerSid;
      if (inner.status === 'ERROR' || obj.status === 'ERROR' || obj.is_error === true) {
        const err = inner.error ?? inner.message ?? inner.response ?? obj.error ?? obj.message ?? t('ai.unknownReason');
        throw new Error(t('ai.agentReturnedError', { agent: this.label, error: String(err) }));
      }
      const text = extractResultText(inner) ?? extractResultText(obj);
      if (text !== undefined) {
        return { text, sessionId: innerSid };
      }
      return undefined;
    }

    if (
      obj.event === 'result'
      || obj.type === 'result'
      || 'result' in obj
      || obj.is_error === true
      || obj.status === 'ERROR'
    ) {
      if (obj.is_error === true || obj.status === 'ERROR') {
        const err = obj.error ?? obj.result ?? obj.response ?? obj.message ?? t('ai.unknownReason');
        throw new Error(t('ai.agentReturnedError', { agent: this.label, error: String(err) }));
      }
      const text = extractResultText(obj);
      if (text !== undefined) {
        return { text, sessionId: outerSid };
      }
    }

    return undefined;
  }
}
