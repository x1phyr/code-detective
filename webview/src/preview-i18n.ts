import type { CodeMap } from '../../shared/types';
import type { Locale } from '../../shared/i18n';
import english from './preview.en.json';

/** Translate only bundled demo copy. Never translate or mutate a user's map. */
export function localizePreviewMap(map: CodeMap, locale: Locale): CodeMap {
  const result = structuredClone(map);
  if (locale !== 'en') return result;
  const translations = (english as Record<string, Record<string, string>>)[map.id];
  if (!translations) return result;

  function visit(value: unknown, path = ''): void {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      const pointer = `${path}/${key}`;
      if (typeof item === 'string' && Object.hasOwn(translations!, pointer)) {
        (value as Record<string, unknown>)[key] = translations![pointer];
      } else {
        visit(item, pointer);
      }
    }
  }
  visit(result);
  return result;
}
