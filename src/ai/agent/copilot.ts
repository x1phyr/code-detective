import type { AgentCli, AgentReply, AgentStreamCallbacks } from './types';
import { t } from '../../../shared/i18n';

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\x1B\[[0-9;?]*[A-Za-z]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isEnvelopeObject(obj: Record<string, unknown>): boolean {
  return 'is_error' in obj
    || 'result' in obj
    || 'response' in obj
    || 'session_id' in obj
    || 'sessionId' in obj
    || 'conversation_id' in obj
    || obj.type === 'result'
    || obj.event === 'result'
    || obj.status === 'ERROR';
}

function extractReplyFromEnvelope(
  obj: Record<string, unknown>,
  label: string,
): AgentReply | undefined {
  if (!isEnvelopeObject(obj)) return undefined;

  const nested = isRecord(obj.result) ? obj.result : undefined;
  if (obj.is_error === true || obj.status === 'ERROR' || nested?.status === 'ERROR') {
    const err = nested?.error
      ?? nested?.message
      ?? nested?.response
      ?? obj.error
      ?? obj.message
      ?? obj.result
      ?? obj.response
      ?? t('ai.unknownReason');
    throw new Error(t('ai.agentReturnedError', { agent: label, error: String(err) }));
  }

  const text = asString(nested?.response)
    ?? asString(nested?.text)
    ?? (typeof obj.result === 'string' ? obj.result : undefined)
    ?? asString(obj.response)
    ?? asString(obj.text);

  if (text === undefined) return undefined;

  const sessionId = asString(nested?.session_id)
    ?? asString(nested?.sessionId)
    ?? asString(nested?.conversation_id)
    ?? asString(obj.session_id)
    ?? asString(obj.sessionId)
    ?? asString(obj.conversation_id);

  return { text, sessionId };
}

/**
 * GitHub Copilot standalone CLI (`copilot`) in non-interactive silent mode (`-s`)
 * with write & shell tools denied so workspace files stay strictly read-only.
 */
export class CopilotCli implements AgentCli {
  readonly id = 'copilot';
  readonly label = 'GitHub Copilot';

  constructor(
    private readonly command = 'copilot',
    private readonly extraArgs: readonly string[] = [],
  ) {}

  args(): string[] {
    return [
      this.command,
      '-s',
      '--no-ask-user',
      '--allow-all-tools',
      '--deny-tool',
      'write',
      '--deny-tool',
      'shell',
      ...this.extraArgs,
    ];
  }

  resumeArgs(sessionId: string): string[] {
    return [...this.args(), '--resume', sessionId];
  }

  onStreamChunk(chunk: string, callbacks: AgentStreamCallbacks): void {
    const clean = stripAnsi(chunk);
    if (!clean) return;
    if (!clean.trimStart().startsWith('{')) {
      callbacks.onDelta?.(clean);
    }
  }

  parse(stdout: string, stderr: string): AgentReply {
    const clean = stripAnsi(stdout).trim();
    if (!clean) {
      const detail = stderr.trim().slice(0, 600);
      throw new Error(t('ai.unparsableOutput', { agent: this.label, detail }));
    }

    if (clean.startsWith('{')) {
      try {
        const direct: unknown = JSON.parse(clean);
        if (isRecord(direct)) {
          const reply = extractReplyFromEnvelope(direct, this.label);
          if (reply) return reply;
          // Raw JSON payload (such as a CodeMap JSON printed directly by `-s`).
          return { text: clean };
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes(this.label)) throw error;
        // Fall through to JSONL scan or plain-text fallback.
      }

      const lines = clean.split('\n').map(l => l.trim()).filter(l => l.startsWith('{'));
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          const obj = JSON.parse(lines[i]!) as unknown;
          if (isRecord(obj)) {
            const reply = extractReplyFromEnvelope(obj, this.label);
            if (reply) return reply;
          }
        } catch (error) {
          if (error instanceof Error && error.message.includes(this.label)) throw error;
        }
      }
    }

    return { text: clean };
  }
}
