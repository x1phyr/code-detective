import { AiError } from './types';

const LOOPBACK = new Set(['127.0.0.1', '::1', '[::1]', 'localhost', '0.0.0.0']);

export function isLoopbackHost(url: URL): boolean {
  return LOOPBACK.has(url.hostname.toLowerCase());
}

export interface EndpointPolicy {
  allowRemote: boolean;
}

/**
 * Validates and normalizes the OpenAI-compatible base URL. Remote hosts are
 * rejected unless the user explicitly opted in, so source code cannot leave
 * the machine by accident.
 */
export function normalizeBaseUrl(raw: string, policy: EndpointPolicy): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AiError('AI_BAD_URL', `AI 服务地址无效：${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AiError('AI_BAD_URL', 'AI 服务地址必须是 http 或 https。');
  }
  if (!policy.allowRemote && !isLoopbackHost(url)) {
    throw new AiError('AI_REMOTE_BLOCKED', `默认只连接本机 AI 服务（127.0.0.1 / localhost），已阻止 ${url.host}。`
      + '如确需远程服务，请在设置中开启 codeDetective.ai.allowRemote。');
  }
  return url.toString().replace(/\/+$/, '');
}
