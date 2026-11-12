import { AiError, type AiCompletionRequest, type AiProvider } from './types';
import { describeFetchError } from './http';

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  /** Optional display label; defaults to the model or host. */
  label?: string;
}

interface StreamChunk {
  choices?: { delta?: { content?: string }; message?: { content?: string } }[];
  error?: { message?: string };
}

function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly id = 'openai-compatible';

  constructor(private readonly options: OpenAiCompatibleOptions) {}

  get label(): string {
    return `OpenAI 兼容（${this.options.label ?? (this.options.model || new URL(this.options.baseUrl).host)}）`;
  }

  get model(): string { return this.options.model; }

  /** Fast availability probe that never sends user code. */
  async listModels(): Promise<string[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.options.timeoutMs, 1_500));
    try {
      const response = await fetch(`${this.options.baseUrl}/models`, {
        signal: controller.signal,
        headers: { accept: 'application/json', ...authHeaders(this.options.apiKey) },
      });
      if (!response.ok) return [];
      const body = await response.json() as { data?: { id?: unknown }[] };
      return (body.data ?? []).map(item => (typeof item.id === 'string' ? item.id : '')).filter(Boolean).slice(0, 200);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async complete({ system, user, cancel, onProgress }: AiCompletionRequest): Promise<string> {
    const endpoint = `${this.options.baseUrl}/chat/completions`;
    // One controller for both paths: the subscription cancels, the timer times out.
    const controller = new AbortController();
    let timedOut = false;
    const unsubscribe = cancel.onCancellationRequested(() => controller.abort());
    if (cancel.isCancellationRequested) controller.abort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.options.timeoutMs);
    const finish = (): void => {
      clearTimeout(timer);
      unsubscribe.dispose();
    };
    try {
      return await this.stream(endpoint, { system, user, onProgress }, controller.signal);
    } catch (error) {
      if (timedOut) {
        throw new AiError('AI_TIMEOUT',
          `AI 服务超过 ${Math.round(this.options.timeoutMs / 1000)} 秒未响应，已中止。`);
      }
      if (cancel.isCancellationRequested) throw new AiError('AI_CANCELLED', 'AI 请求已取消。');
      if (error instanceof AiError) throw error;
      throw new AiError('AI_UNREACHABLE', describeFetchError(error, this.options.baseUrl));
    } finally {
      finish();
    }
  }

  private async stream(
    endpoint: string,
    body: { system: string; user: string; onProgress?: (text: string) => void },
    signal: AbortSignal,
  ): Promise<string> {
    const { system, user, onProgress } = body;
    const response = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...authHeaders(this.options.apiKey),
      },
      body: JSON.stringify({
        model: this.options.model,
        stream: true,
        temperature: 0.1,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 600).trim();
      throw new AiError('AI_HTTP_ERROR', `AI 服务返回 ${response.status} ${response.statusText}。${detail}`);
    }
    if (!response.body) throw new AiError('AI_EMPTY_RESPONSE', 'AI 服务返回了空响应。');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        let chunk: StreamChunk;
        try { chunk = JSON.parse(payload) as StreamChunk; } catch { continue; }
        if (chunk.error?.message) throw new AiError('AI_STREAM_ERROR', chunk.error.message);
        const choice = chunk.choices?.[0];
        const piece = choice?.delta?.content ?? choice?.message?.content;
        if (piece) {
          text += piece;
          onProgress?.(text);
        }
      }
    }
    if (!text.trim()) throw new AiError('AI_EMPTY_RESPONSE', 'AI 没有返回任何内容。');
    return text;
  }
}
