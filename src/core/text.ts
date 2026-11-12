/** Converts CRLF and lone CR line breaks to LF. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Splits file text into lines. A trailing line break terminates the last line
 * rather than starting a new empty one, so `'a\nb\n'` has two lines.
 */
export function splitLines(text: string): string[] {
  const lines = normalizeLineEndings(text).split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}
