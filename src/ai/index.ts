import * as vscode from 'vscode';
import { readApiKey, normalizeBaseUrl, type AiConfig } from './config';
import { OpenAiCompatibleProvider } from './openaiCompatible';
import { CliAgentProvider } from './cliAgent';
import { VsCodeLmProvider, countVsCodeLmModels } from './vscodeLm';
import { pickModel } from './modelPick';
import { autoPlan, type AutoSource } from './select';
import { AiError, type AiProvider } from './types';

export interface LocalProbe {
  id: string;
  baseUrl: string;
  label: string;
}

/** Known local OpenAI-compatible defaults; only loopback addresses are probed. */
export const LOCAL_PROBES: LocalProbe[] = [
  { id: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', label: 'Ollama' },
  { id: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', label: 'LM Studio' },
  { id: 'llamacpp', baseUrl: 'http://127.0.0.1:8080/v1', label: 'llama.cpp / vLLM' },
  { id: 'localai', baseUrl: 'http://127.0.0.1:8081/v1', label: 'LocalAI' },
];

export interface ResolvedProvider {
  provider: AiProvider;
  detail: string;
}

export interface AiEnvironment {
  secrets: vscode.SecretStorage;
  log: vscode.OutputChannel;
  cwd: string;
}

async function tryOpenAi(config: AiConfig, env: AiEnvironment): Promise<ResolvedProvider | undefined> {
  // Without a model name the request would always fail; let the caller fall through.
  if (!config.model.trim()) return undefined;
  const apiKey = await readApiKey(env.secrets);
  const baseUrl = normalizeBaseUrl(config.baseUrl, config);
  const provider = new OpenAiCompatibleProvider({
    baseUrl,
    model: config.model,
    apiKey,
    timeoutMs: config.timeoutMs,
  });
  return { provider, detail: `${baseUrl} · ${config.model}` };
}

async function tryCli(config: AiConfig, env: AiEnvironment): Promise<ResolvedProvider | undefined> {
  if (!config.cliCommand) return undefined;
  return {
    provider: new CliAgentProvider({
      command: config.cliCommand,
      args: config.cliArgs,
      cwd: env.cwd,
      timeoutMs: config.timeoutMs,
    }),
    detail: `${config.cliCommand} ${config.cliArgs.join(' ')}`.trim(),
  };
}

async function tryVsCodeLm(config: AiConfig): Promise<ResolvedProvider | undefined> {
  if (await countVsCodeLmModels() === 0) return undefined;
  return {
    provider: new VsCodeLmProvider({ vendor: config.vscodeLmVendor, family: config.vscodeLmFamily }),
    detail: config.vscodeLmVendor || '任意可用模型',
  };
}

/** Probes loopback servers in order and returns the first one that answers. */
async function probeLocal(apiKey: string | undefined, timeoutMs: number): Promise<ResolvedProvider | undefined> {
  for (const probe of LOCAL_PROBES) {
    const provider = new OpenAiCompatibleProvider({ baseUrl: probe.baseUrl, model: '', apiKey, timeoutMs: Math.min(timeoutMs, 1_500) });
    const models = await provider.listModels().catch(() => []);
    const model = pickModel(models);
    if (!model) continue;
    return {
      provider: new OpenAiCompatibleProvider({ baseUrl: probe.baseUrl, model, apiKey, timeoutMs }),
      detail: `${probe.label} · ${model}（自动探测）`,
    };
  }
  return undefined;
}

/** One step of the `auto` chain; failures fall through to the next source. */
async function attempt(
  source: AutoSource,
  config: AiConfig,
  env: AiEnvironment,
): Promise<ResolvedProvider | undefined> {
  switch (source) {
    case 'configured-openai':
      return tryOpenAi(config, env).catch(() => undefined);
    case 'local-probe':
      return probeLocal(await readApiKey(env.secrets), config.timeoutMs);
    case 'cli':
      return tryCli(config, env);
    case 'vscode-lm':
      return tryVsCodeLm(config);
  }
}

/**
 * Builds the provider for the configured mode. `auto` prefers a reachable local
 * OpenAI-compatible server, then the configured endpoint (only when a model is
 * named), then the CLI agent, then `vscode.lm`.
 */
export async function resolveProvider(config: AiConfig, env: AiEnvironment): Promise<ResolvedProvider> {
  switch (config.provider) {
    case 'openai-compatible': {
      const resolved = await tryOpenAi(config, env);
      if (!resolved) throw new AiError('AI_NOT_CONFIGURED', 'OpenAI 兼容服务未配置。');
      return resolved;
    }
    case 'cli': {
      const resolved = await tryCli(config, env);
      if (!resolved) throw new AiError('AI_NOT_CONFIGURED', '未配置本地 CLI 命令。');
      return resolved;
    }
    case 'vscode-lm': {
      const resolved = await tryVsCodeLm(config);
      if (!resolved) throw new AiError('AI_NO_MODEL', 'VS Code 中没有可用的语言模型。');
      return resolved;
    }
    case 'auto':
    default: {
      for (const source of autoPlan({ model: config.model, cliCommand: config.cliCommand })) {
        const resolved = await attempt(source, config, env);
        if (resolved) return resolved;
      }
      throw new AiError('AI_NOT_CONFIGURED',
        '没有找到可用的 AI。请启动本地模型服务（如 Ollama）、配置 CLI 命令，或安装 Copilot Chat。');
    }
  }
}
