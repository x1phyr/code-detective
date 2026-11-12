import * as vscode from 'vscode';
import { isLoopbackHost, normalizeBaseUrl } from './endpoint';

export { isLoopbackHost, normalizeBaseUrl };

export type AiProviderKind = 'auto' | 'openai-compatible' | 'cli' | 'vscode-lm';

export interface AiConfig {
  provider: AiProviderKind;
  baseUrl: string;
  model: string;
  cliCommand: string;
  cliArgs: string[];
  timeoutMs: number;
  allowRemote: boolean;
  vscodeLmVendor: string;
  vscodeLmFamily: string;
}

const SECTION = 'codeDetective.ai';
const SECRET_KEY = 'codeDetective.ai.apiKey';

export function readAiConfig(): AiConfig {
  const config = vscode.workspace.getConfiguration(SECTION);
  return {
    provider: config.get<AiProviderKind>('provider', 'auto'),
    baseUrl: config.get<string>('baseUrl', 'http://127.0.0.1:11434/v1').trim(),
    model: config.get<string>('model', '').trim(),
    cliCommand: config.get<string>('cli.command', 'claude').trim(),
    cliArgs: config.get<string[]>('cli.args', ['-p']) ?? ['-p'],
    timeoutMs: Math.min(Math.max(config.get<number>('timeoutMs', 180_000), 5_000), 900_000),
    allowRemote: config.get<boolean>('allowRemote', false),
    vscodeLmVendor: config.get<string>('vscodeLm.vendor', 'copilot').trim(),
    vscodeLmFamily: config.get<string>('vscodeLm.family', '').trim(),
  };
}

export async function readApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  const key = await secrets.get(SECRET_KEY);
  return key && key.length > 0 ? key : undefined;
}

export async function storeApiKey(secrets: vscode.SecretStorage, value: string): Promise<void> {
  await (value ? secrets.store(SECRET_KEY, value) : secrets.delete(SECRET_KEY));
}
