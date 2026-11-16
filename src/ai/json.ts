const FENCE = /```(?:json|jsonc)?\s*([\s\S]*?)```/gi;

/** Returns the balanced `{...}` region starting at `start`, or undefined when unclosed. */
function balanced(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}

/**
 * Models tend to wrap JSON in prose or Markdown fences. Extract the first
 * candidate that actually parses as a JSON object.
 */
export function extractJson(raw: string): string | undefined {
  const candidates: string[] = [];
  for (const match of raw.matchAll(FENCE)) {
    const body = match[1]?.trim();
    if (body) candidates.push(body);
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) candidates.push(trimmed);
  let seen = 0;
  for (let index = raw.indexOf('{'); index >= 0 && seen < 8; index = raw.indexOf('{', index + 1)) {
    const body = balanced(raw, index);
    if (body) {
      candidates.push(body);
      seen += 1;
    }
  }
  let firstValid: string | undefined;
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const serialized = JSON.stringify(value);
        const obj = value as Record<string, unknown>;
        if ('sources' in obj || 'nodes' in obj || 'walkthrough' in obj || 'schemaVersion' in obj) {
          return serialized;
        }
        firstValid ??= serialized;
      }
    } catch { /* try the next candidate */ }
  }
  return firstValid;
}
