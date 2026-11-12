import type { AiConfig } from './config';
import { ClaudeCli } from './agent/claude';
import { CodexCli } from './agent/codex';
import { runAgent } from './agent/runner';
import type { AgentCli } from './agent/types';
import { AiError, type AgentSession, type AgentTurnRequest, type AgentTurnResponse } from './types';

export type { AgentCli } from './agent/types';
export { AgentError } from './agent/types';

export interface AgentDescriptor {
  id: string;
  label: string;
  /** Builds the CLI adapter for this agent. */
  create(command: string, config: AiConfig): AgentCli;
}

/**
 * Built-in agents. Adding one is a single entry here plus a settings override
 * through `codeDetective.ai.cli.agents`, so the list stays extensible.
 */
export const AGENTS: AgentDescriptor[] = [
  { id: 'claude', label: 'Claude Code', create: (command, config) => new ClaudeCli(command, config.extraArgs, config.allowedTools) },
  { id: 'codex', label: 'Codex CLI', create: (command, config) => new CodexCli(command, config.extraArgs) },
];

function customAgent(config: AiConfig): AgentCli | undefined {
  const custom = config.customAgents.find(item => item.id === config.agent);
  if (!custom) return undefined;
  const args = [custom.command, ...custom.args];
  return {
    id: custom.id,
    label: custom.label || custom.id,
    args: () => args,
    parse(stdout) {
      // Custom agents are expected to print the answer as the last non-empty line.
      const text = stdout.trim().split('\n').filter(line => line.trim().length > 0).at(-1) ?? '';
      return { text };
    },
  };
}

/** Resolves the configured agent, falling back to the first when unknown. */
export function agentCli(config: AiConfig): AgentCli {
  const descriptor = AGENTS.find(item => item.id === config.agent);
  if (!descriptor) {
    const custom = customAgent(config);
    if (custom) return custom;
    throw new AiError('AI_NOT_CONFIGURED',
      `未知的 agent：${config.agent}。可选：${AGENTS.map(item => item.id).join('、')}。`);
  }
  const command = config.command || descriptor.id;
  return descriptor.create(command, config);
}

/** A live conversation: each `send` continues the CLI session when supported. */
class Session implements AgentSession {
  private current?: string;

  constructor(
    readonly id: string,
    readonly label: string,
    private readonly cli: AgentCli,
  ) { }

  get sessionId(): string | undefined { return this.current; }

  async send(request: Omit<AgentTurnRequest, 'sessionId'>): Promise<AgentTurnResponse> {
    const reply = await runAgent({
      ...request,
      cli: this.cli,
      sessionId: this.current,
    });
    this.current = reply.sessionId ?? this.current;
    return { text: reply.text, sessionId: this.current };
  }
}

export function createSession(config: AiConfig): AgentSession {
  const cli = agentCli(config);
  return new Session(cli.id, cli.label, cli);
}

/** Built-in agents plus any user-defined ones, for the settings picker. */
export function agentCatalog(config: AiConfig): { id: string; label: string }[] {
  return [
    ...AGENTS.map(item => ({ id: item.id, label: item.label })),
    ...config.customAgents.map(item => ({ id: item.id, label: item.label || item.id })),
  ];
}
