import type { AgentStreamCallbacks } from './types';

export function shortPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '';
  const parts = raw.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

/** Maps a read/search/other tool invocation to a concise UI exploration footprint. */
export function emitToolActivity(
  name: string,
  rawInput: unknown,
  callbacks: AgentStreamCallbacks,
): void {
  const input = (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput))
    ? rawInput as Record<string, unknown>
    : {};

  if (name === 'Read' || name === 'read_file' || name === 'view_file') {
    const target = shortPath(input.file_path ?? input.path ?? input.Path ?? input.target_file ?? input.file);
    callbacks.onActivity?.({ kind: 'read', text: target || 'source file' });
    return;
  }

  if (name === 'Grep' || name === 'grep_search') {
    const pattern = typeof input.pattern === 'string'
      ? input.pattern
      : typeof input.query === 'string'
        ? input.query
        : typeof input.Query === 'string'
          ? input.Query
          : '';
    callbacks.onActivity?.({ kind: 'search', text: pattern || 'pattern' });
    return;
  }

  if (
    name === 'Glob'
    || name === 'LS'
    || name === 'find_by_name'
    || name === 'list_dir'
  ) {
    const pattern = typeof input.pattern === 'string'
      ? input.pattern
      : typeof input.Pattern === 'string'
        ? input.Pattern
        : shortPath(input.path ?? input.search_directory ?? input.SearchDirectory ?? input.directory_path);
    callbacks.onActivity?.({ kind: 'search', text: pattern || name });
    return;
  }

  if (name === 'Agent' || name === 'Task' || name === 'invoke_subagent') {
    const desc = typeof input.description === 'string'
      ? input.description
      : typeof input.Role === 'string'
        ? input.Role
        : name;
    callbacks.onActivity?.({ kind: 'think', text: desc.slice(0, 100) });
    return;
  }

  callbacks.onActivity?.({ kind: 'status', text: name });
}
