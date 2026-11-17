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

/** 取指定语言（默认当前语言）的文案；`{name}` 占位符按 params 替换，缺失的参数原样保留。 */
export function t(key: MessageKey, params?: MessageParams, locale: Locale = current): string {
  const template: string = (catalog as Record<string, Message>)[key]![locale];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match: string, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match);
}

const KANA_OR_HANGUL_RE = /[\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u;
const HAN_RE = /\p{Script=Han}/u;
const OTHER_NON_LATIN_RE = /[\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}]/u;

/**
 * 根据用户输入（主题或提问）的散文文本判断提示词应使用的语言框架。
 *
 * - 先剔除代码块、反引号代码、路径与常见代码标识符，避免把 `closeBagPanel` 或 `src/a.ts` 误判为英文。
 * - 包含日/韩/西里尔等非汉字脚本时返回 `'en'`，防止中文提示词示例把非中文语言带偏成中文。
 * - 仅包含代码符号、路径或空串时回退到 `fallback`（默认当前 UI 语言）。
 */
export function detectPromptLocale(input: string | undefined, fallback: Locale = current): Locale {
  if (!input || !input.trim()) return fallback;
  const prose = input.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  if (KANA_OR_HANGUL_RE.test(prose)) return 'en';
  if (HAN_RE.test(prose)) return 'zh-CN';
  if (OTHER_NON_LATIN_RE.test(prose)) return 'en';

  const cleaned = prose
    .replace(/\([^)]*:\d+(?:-\d+)?\)/g, ' ')
    .replace(/\S*(?:[/:\\]|\w\.\w|\.\w)\S*/g, ' ')
    .replace(/\b[A-Za-z_$][\w$]*\([^)]*\)/g, ' ')
    .replace(/\b[A-Za-z]*[a-z][A-Z]\w*\b/g, ' ')
    .replace(/\b[A-Z]{2,}[a-z]\w*\b/g, ' ')
    .replace(/\b\w*[_0-9]\w*\b/g, ' ')
    .replace(/\b[A-Za-z]+(?:-[A-Za-z0-9]+)+\b/g, ' ');
  const words = cleaned.match(/[A-Za-zÀ-ÖØ-öø-ÿ]{2,}/g) ?? [];
  const hasPhrase = /\s|[?!,;]/.test(prose.trim());
  if (words.length >= 2 || (words.length >= 1 && hasPhrase)) return 'en';
  return fallback;
}

/** 仅供测试：枚举所有 key，检查占位符在两种语言间一致。 */
export function allMessages(): Readonly<Record<string, Message>> {
  return catalog;
}
