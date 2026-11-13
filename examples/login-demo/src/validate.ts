import type { LoginForm } from './types';

/** 返回第一条错误信息；表单合法时返回 undefined。 */
export function validateForm(form: LoginForm): string | undefined {
  if (!form.username.trim()) return '请输入用户名';
  if (form.password.length < 8) return '密码至少 8 位';
  if (needsCaptcha(form.username) && !form.captcha) return '请输入验证码';
  return undefined;
}

const failures = new Map<string, number>();

function needsCaptcha(username: string): boolean {
  return (failures.get(username) ?? 0) >= 3;
}

export function recordFailure(username: string): void {
  failures.set(username, (failures.get(username) ?? 0) + 1);
}
