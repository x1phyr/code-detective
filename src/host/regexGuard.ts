export const MAX_QUERY_LENGTH = 256;
/**
 * Rejects the usual catastrophic-backtracking shapes, such as `(a+)+` or `(a|a)*`.
 * JS regexes can't be interrupted, so this plus the per-line length cap and
 * time budget in searchSources is a mitigation rather than a hard guarantee.
 */
export function unsafeRegex(source: string): boolean {
  if (source.length > MAX_QUERY_LENGTH) return true;
  // A quantified group whose body itself contains a quantifier or alternation.
  return /\((?:[^()\\]|\\.)*(?:[+*}]|\|)(?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d+,?\d*\})/.test(source)
    || /\\[1-9]/.test(source);
}
