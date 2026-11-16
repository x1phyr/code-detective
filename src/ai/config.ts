import * as vscode from 'vscode';
import { readOnlyTools } from './agent/claude';
import { DEFAULT_AGENT } from './index';

export { DEFAULT_AGENT };

export interface AiConfig {
  /** Which agent CLI drives the exploration: `copilot` / `agy` / `codex` / `claude` / a custom id. */
  agent: string;
  /** True when the user explicitly configured `codeDetective.ai.agent` in global/workspace settings. */
  agentExplicit?: boolean;
  /** Path or bare command of the agent executable. */
  command: string;
  /** Extra argv appended after the built-in args of a built-in agent (e.g. `--model`). */
  extraArgs: string[];
  /** Additional agent definitions, so the list stays extensible. */
  customAgents: { id: string; label: string; command: string; args: string[] }[];
  timeoutMs: number;
  /** Tool names the agent may use; kept read-only so maps never mutate code. */
  allowedTools: string;
}

const SECTION = 'codeDetective.ai';

export function readAiConfig(): AiConfig {
  const config = vscode.workspace.getConfiguration(SECTION);
  const inspected = config.inspect?.<string>('agent');
  const explicit = [
    inspected?.workspaceFolderValue,
    inspected?.workspaceValue,
    inspected?.globalValue,
  ]
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .find(Boolean);

  const toolsInspected = config.inspect?.<string>('cli.allowedTools');
  const explicitTools = [
    toolsInspected?.workspaceFolderValue,
    toolsInspected?.workspaceValue,
    toolsInspected?.globalValue,
  ]
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .find(Boolean);

  return {
    agent: explicit || config.get<string>('agent', DEFAULT_AGENT).trim() || DEFAULT_AGENT,
    agentExplicit: Boolean(explicit),
    command: config.get<string>('cli.command', '').trim(),
    extraArgs: config.get<string[]>('cli.extraArgs', []) ?? [],
    customAgents: config.get<AiConfig['customAgents']>('cli.agents', []) ?? [],
    timeoutMs: Math.min(Math.max(config.get<number>('timeoutMs', 300_000), 10_000), 1_800_000),
    // Filtered to read-only tools, so the status shown is what actually runs.
    allowedTools: readOnlyTools(explicitTools ?? ''),
  };
}
