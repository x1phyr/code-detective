import type { CodeMap } from '../../shared/types';
import { parseMap } from '../core/validator';
import { AiError } from './types';
import { extractJson } from './json';

/**
 * Turns raw model output into a validated map. Kept separate from the agent
 * layer so it can be tested without spawning any CLI.
 */
export function mapFromResponse(raw: string): CodeMap {
  const json = extractJson(raw);
  if (!json) throw new AiError('AI_NO_JSON', '没有在响应中找到合法的 JSON 对象。');
  return parseMap(json);
}
