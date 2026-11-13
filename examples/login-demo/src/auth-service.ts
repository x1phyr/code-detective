import type { AuthResult, User } from './types';
import { recordFailure } from './validate';

const tokenCache = new Map<string, string>();
const MAX_ATTEMPTS = 3;

export async function authenticate(username: string, password: string): Promise<AuthResult> {
  const cached = tokenCache.get(username);
  if (cached) return { ok: true, user: await loadProfile(cached) };

  const token = await requestToken(username, password);
  if (typeof token !== 'string') {
    recordFailure(username);
    return { ok: false, reason: token.reason };
  }
  tokenCache.set(username, token);
  return { ok: true, user: await loadProfile(token) };
}

async function requestToken(username: string, password: string): Promise<string | { reason: string }> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (response.ok) return ((await response.json()) as { token: string }).token;
    if (response.status === 401) return { reason: '用户名或密码错误' };
    if (response.status === 423) return { reason: '账号已锁定，请联系管理员' };
    await delay(200 * 2 ** attempt);
  }
  return { reason: '服务暂时不可用，请稍后再试' };
}

async function loadProfile(token: string): Promise<User> {
  const response = await fetch('/api/me', { headers: { authorization: `Bearer ${token}` } });
  return (await response.json()) as User;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
