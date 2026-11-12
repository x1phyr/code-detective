import * as vscode from 'vscode';
import { readOnlyTools } from './agent/claude';

/** Built-in agent CLIs. Users can add more via `codeDetective.ai.cli.extra`. */
export const DEFAULT_AGENT = 'claude';

export interface AiConfig {
  /** Which agent CLI drives the exploration: `claude` / `codex` / a custom id. */
  agent: string;
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
  return {
    agent: config.get<string>('agent', DEFAULT_AGENT).trim() || DEFAULT_AGENT,
    command: config.get<string>('cli.command', '').trim(),
    extraArgs: config.get<string[]>('cli.extraArgs', []) ?? [],
    customAgents: config.get<AiConfig['customAgents']>('cli.agents', []) ?? [],
    timeoutMs: Math.min(Math.max(config.get<number>('timeoutMs', 300_000), 10_000), 1_800_000),
    // Filtered to read-only tools, so the status shown is what actually runs.
    allowedTools: readOnlyTools(config.get<string>('cli.allowedTools', 'Read,Grep,Glob,LS')),
  };
}
