import * as vscode from 'vscode';
import { AiError, type AgentSession, type AgentTurnRequest, type AgentTurnResponse } from '../ai/types';
import { errorMessage } from '../core/errors';
import { readSource, searchSources, TOOL_READ, TOOL_SEARCH } from './chat';
import { MAX_QUERY_LENGTH } from './regexGuard';
import { t } from '../../shared/i18n';

const MAX_SEARCH_RESULTS = 40;

function searchInputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string', description: t('chat.schemaQuery') },
      regex: { type: 'boolean', description: t('chat.schemaRegex') },
      caseSensitive: { type: 'boolean', description: t('chat.schemaCaseSensitive') },
      glob: { type: 'string', description: t('chat.schemaGlob') },
      maxResults: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_RESULTS, description: t('chat.schemaMaxResults') },
    },
  } as const;
}

function readInputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['file'],
    properties: {
      file: { type: 'string', description: t('chat.schemaFile') },
      startLine: { type: 'integer', minimum: 1, description: t('chat.schemaStartLine') },
      endLine: { type: 'integer', minimum: 1, description: t('chat.schemaEndLine') },
    },
  } as const;
}

async function selectModel(): Promise<vscode.LanguageModelChat> {
  if (!vscode.lm || typeof vscode.lm.selectChatModels !== 'function') {
    throw new AiError('AI_NOT_CONFIGURED', t('ai.copilotUnavailable'));
  }
  const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (copilotModels.length > 0) return copilotModels[0]!;
  const anyModels = await vscode.lm.selectChatModels();
  if (anyModels.length > 0) return anyModels[0]!;
  throw new AiError('AI_NOT_CONFIGURED', t('ai.copilotUnavailable'));
}

/**
 * Probes whether the host editor exposes a usable VS Code Language Model (`vscode.lm`)
 * within `timeoutMs`, returning `false` cleanly in Cursor or other non-VS-Code forks.
 */
export async function probeCopilotLm(timeoutMs = 1200): Promise<boolean> {
  if (!vscode.lm || typeof vscode.lm.selectChatModels !== 'function') {
    return false;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      selectModel().then(() => true, () => false),
      new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Direct VS Code Language Model (`vscode.lm`) session with read-only workspace tools.
 * Works inside the sidebar without requiring the user to install a separate local CLI.
 */
export class CopilotSession implements AgentSession {
  readonly id = 'copilot';
  readonly label: string;
  private readonly history: vscode.LanguageModelChatMessage[] = [];
  private turnCount = 0;

  constructor(private readonly root: vscode.WorkspaceFolder) {
    this.label = t('host.copilotLabel');
  }

  get sessionId(): string | undefined {
    return this.turnCount > 0 ? `copilot-${this.turnCount}` : undefined;
  }

  async send(request: Omit<AgentTurnRequest, 'sessionId'>): Promise<AgentTurnResponse> {
    const model = await selectModel();
    const cts = new vscode.CancellationTokenSource();
    const stopCancel = request.cancel.onCancellationRequested(() => cts.cancel());
    const timer = setTimeout(() => cts.cancel(), request.timeoutMs);

    const tools: vscode.LanguageModelChatTool[] = [
      { name: TOOL_SEARCH, description: t('chat.toolSearchDesc'), inputSchema: searchInputSchema() },
      { name: TOOL_READ, description: t('chat.toolReadDesc'), inputSchema: readInputSchema() },
    ];

    this.history.push(vscode.LanguageModelChatMessage.User(request.prompt));

    try {
      let finalReply = '';
      for (;;) {
        if (request.cancel.isCancellationRequested) {
          throw new AiError('AI_CANCELLED', t('ai.cancelled'));
        }
        if (cts.token.isCancellationRequested) {
          throw new AiError('AI_TIMEOUT', t('ai.cliTimeout', { command: this.label, seconds: Math.round(request.timeoutMs / 1000) }));
        }

        const response = await model.sendRequest(
          this.history,
          { tools, justification: t('chat.justifyExplore') },
          cts.token,
        );

        const calls: vscode.LanguageModelToolCallPart[] = [];
        let roundText = '';
        for await (const part of response.stream) {
          if (part instanceof vscode.LanguageModelToolCallPart) {
            calls.push(part);
          } else if (part instanceof vscode.LanguageModelTextPart) {
            roundText += part.value;
            request.onChunk?.(part.value);
            request.onDelta?.(part.value);
          }
        }

        if (calls.length === 0) {
          finalReply = roundText;
          if (roundText.trim()) {
            this.history.push(vscode.LanguageModelChatMessage.Assistant(roundText));
          }
          break;
        }

        this.history.push(vscode.LanguageModelChatMessage.Assistant(calls));
        const results: vscode.LanguageModelToolResultPart[] = [];

        for (const call of calls) {
          const out = await this.executeTool(call, request, cts.token);
          results.push(new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart(out)]));
        }
        this.history.push(vscode.LanguageModelChatMessage.User(results));
      }

      this.turnCount += 1;
      return { text: finalReply, sessionId: this.sessionId };
    } catch (error) {
      if (error instanceof AiError) throw error;
      if (request.cancel.isCancellationRequested) {
        throw new AiError('AI_CANCELLED', t('ai.cancelled'));
      }
      if (cts.token.isCancellationRequested) {
        throw new AiError('AI_TIMEOUT', t('ai.cliTimeout', { command: this.label, seconds: Math.round(request.timeoutMs / 1000) }));
      }
      throw new AiError('AI_COPILOT_FAILED', errorMessage(error));
    } finally {
      clearTimeout(timer);
      stopCancel.dispose();
      cts.dispose();
    }
  }

  private async executeTool(
    call: vscode.LanguageModelToolCallPart,
    request: Omit<AgentTurnRequest, 'sessionId'>,
    token: vscode.CancellationToken,
  ): Promise<string> {
    try {
      if (call.name === TOOL_SEARCH) {
        const input = (call.input ?? {}) as { query?: string; regex?: boolean; caseSensitive?: boolean; glob?: string; maxResults?: number };
        const query = String(input.query ?? '').slice(0, MAX_QUERY_LENGTH);
        request.onActivity?.({ kind: 'search', text: query, detail: input.glob });
        const matches = await searchSources(this.root, { ...input, query }, token);
        return matches.length === 0
          ? t('chat.noMatches')
          : matches.map(match => `${match.file}:${match.line}\t${match.text}`).join('\n');
      }
      if (call.name === TOOL_READ) {
        const input = (call.input ?? {}) as { file?: string; startLine?: number; endLine?: number };
        const file = String(input.file ?? '');
        const detail = input.startLine ? `${input.startLine}-${input.endLine ?? input.startLine + 199}` : undefined;
        request.onActivity?.({ kind: 'read', text: file, detail });
        const slice = await readSource(this.root, { file, startLine: input.startLine, endLine: input.endLine });
        return `${t('chat.readResultHeader', { file: slice.file, start: slice.startLine, end: slice.endLine, total: slice.totalLines })}\n${slice.content}`;
      }
      return `Unsupported tool: ${call.name}`;
    } catch (error) {
      return t('chat.toolFailed', { error: errorMessage(error) });
    }
  }
}
