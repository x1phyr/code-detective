import type { LoginResult, User } from './types';

export function routeAfterLogin(user: User): LoginResult {
  if (user.mustChangePassword) return { page: '/account/password' };
  if (user.firstLogin) return { page: '/onboarding' };
  return { page: redirectTarget() ?? '/home' };
}

function redirectTarget(): string | undefined {
  const target = new URLSearchParams(location.search).get('redirect');
  return target?.startsWith('/') ? target : undefined;
}
