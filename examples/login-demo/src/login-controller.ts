import { authenticate } from './auth-service';
import { routeAfterLogin } from './router';
import type { LoginForm, LoginResult } from './types';
import { validateForm } from './validate';

export async function onSubmit(form: LoginForm): Promise<LoginResult> {
  const problem = validateForm(form);
  if (problem) return showError(problem);

  const result = await authenticate(form.username, form.password);
  if (!result.ok) return showError(result.reason);

  return routeAfterLogin(result.user);
}

function showError(message: string): LoginResult {
  console.warn(`[login] ${message}`);
  return { error: message };
}
