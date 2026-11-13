const MAP_ID = /^[a-z0-9][a-z0-9-]*$/;
import { t } from '../../shared/i18n';

/** Highest `<base>-N` suffix tried before giving up. */
const MAX_SUFFIX = 100;

/**
 * Coerces a model-provided id or title into the map-id pattern enforced by the
 * v1 schema, so a generated file can never fail its own validation.
 */
export function sanitizeMapId(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return MAP_ID.test(slug) ? slug : 'ai-map';
}

/**
 * Picks the first free `<base>.json` / `<base>-N.json` name, keeping the map id
 * and the file name in sync because duplicate ids are a hard repository error.
 */
export async function freeMapName(
  base: string,
  taken: (id: string) => Promise<boolean>,
): Promise<{ id: string; fileName: string }> {
  let id = base;
  for (let index = 2; index < MAX_SUFFIX; index += 1) {
    if (!(await taken(id))) return { id, fileName: `${id}.json` };
    id = `${base}-${index}`;
  }
  // Never fall back to an occupied name: surface the conflict instead of overwriting.
  throw new Error(t('ai.fileNameConflict', { base, id }));
}
