/**
 * 轻量 i18n：扩展宿主、核心逻辑与 webview 共用同一套文案。
 *
 * - 每条文案同时给出 `zh-CN` 与 `en`，由类型保证两种语言不会漏写。
 * - 文案按区域拆在 `./messages/*.ts`，key 以区域名开头（如 `host.mapNotFound`）。
 * - 插值使用 `{name}` 占位符：`t('host.mapNotFound', { name })`。
 * - 默认语言为 zh-CN；宿主启动时按 `vscode.env.language` 调用 `setLocale`，
 *   webview 从 `<html lang>` 读取宿主传来的语言。
 */
import { core } from './messages/core';
import { ai } from './messages/ai';
import { host } from './messages/host';
import { chat } from './messages/chat';
import { webview } from './messages/webview';

export type Locale = 'zh-CN' | 'en';
export const LOCALES: readonly Locale[] = ['zh-CN', 'en'];

/** 一条文案：两种语言都必须提供。 */
export type Message = Readonly<Record<Locale, string>>;

const catalog = { ...core, ...ai, ...host, ...chat, ...webview } satisfies Record<string, Message>;

export type MessageKey = keyof typeof catalog;
export type MessageParams = Readonly<Record<string, string | number>>;

let current: Locale = 'zh-CN';

/** 把 VS Code / 浏览器的语言标签（`zh-cn`、`zh-TW`、`en-US`…）归一到支持的语言。 */
export function resolveLocale(tag: string | undefined): Locale {
  return tag && /^zh\b/i.test(tag) ? 'zh-CN' : 'en';
}

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/** 取当前语言的文案；`{name}` 占位符按 params 替换，缺失的参数原样保留。 */
export function t(key: MessageKey, params?: MessageParams): string {
  const template: string = (catalog as Record<string, Message>)[key]![current];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match: string, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match);
}

/** 仅供测试：枚举所有 key，检查占位符在两种语言间一致。 */
export function allMessages(): Readonly<Record<string, Message>> {
  return catalog;
}
