export interface LoginForm {
  username: string;
  password: string;
  captcha?: string;
}

export interface User {
  id: string;
  name: string;
  mustChangePassword: boolean;
  firstLogin: boolean;
}

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; reason: string };

export type LoginResult = { page: string } | { error: string };
