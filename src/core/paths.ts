import * as path from 'node:path';
import { HostError } from './errors';

export function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

/** Anything that looks like a URI scheme or a drive letter (`C:`, `file:`, `my_dir:`). */
const SCHEME = /^[A-Za-z][\w+.-]*:/;

/**
 * The single path rule for map sources, shared by the validator and the host
 * (and mirrored by the `file` pattern in `schemas/code-map-v1.schema.json`):
 * a non-empty, `/`-separated relative path with no scheme / drive prefix, no
 * backslashes or control characters, and no empty, whitespace-only, `.` or
 * `..` segments.
 */
export function isCanonicalRelativePath(file: string): boolean {
  if (typeof file !== 'string' || !file || file.includes('\\') || SCHEME.test(file)) return false;
  if (/[\u0000-\u001f\u007f]/.test(file)) return false;
  if (path.posix.isAbsolute(file)) return false;
  return !file.split('/').some(part => part === '..' || part === '.' || part.trim().length === 0);
}

export function assertRelativeSourcePath(file: string, message = '来源必须是所属工作区内的规范相对路径。'): void {
  if (!isCanonicalRelativePath(file)) throw new HostError('SOURCE_OUTSIDE_ROOT', message);
}

export function resolveWithinRoot(root: string, file: string): string {
  const target = path.resolve(root, ...file.split('/'));
  if (!isWithin(root, target)) {
    throw new HostError('SOURCE_OUTSIDE_ROOT', '来源位置超出所属工作区。');
  }
  return target;
}
