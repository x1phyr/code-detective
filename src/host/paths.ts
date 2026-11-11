import * as vscode from 'vscode';
import { realpath } from 'node:fs/promises';
import * as path from 'node:path';

export class HostError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'HostError';
  }
}

export function uriKey(uri: vscode.Uri): string {
  return process.platform === 'win32' && uri.scheme === 'file'
    ? uri.fsPath.toLowerCase()
    : uri.toString();
}

export function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

export async function checkedSourceUri(root: vscode.Uri, file: string): Promise<{ uri: vscode.Uri; realUri: vscode.Uri }> {
  if (root.scheme !== 'file') {
    throw new HostError('SOURCE_OUTSIDE_ROOT', '当前版本只支持本地工作区中的源码位置。');
  }
  if (!file || file.includes('\\') || file.includes('\0') || /^[A-Za-z][\w+.-]*:/.test(file)
      || path.posix.isAbsolute(file) || file.split('/').some(part => part === '..' || part === '.' || !part)) {
    throw new HostError('SOURCE_OUTSIDE_ROOT', '来源必须是所属工作区内的规范相对路径。');
  }
  const target = path.resolve(root.fsPath, ...file.split('/'));
  if (!isWithin(root.fsPath, target)) {
    throw new HostError('SOURCE_OUTSIDE_ROOT', '来源位置超出所属工作区。');
  }
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(root.fsPath), realpath(target)]);
    if (!isWithin(realRoot, realTarget)) {
      throw new HostError('SOURCE_OUTSIDE_ROOT', '来源符号链接指向工作区之外，已禁用打开。');
    }
    return { uri: vscode.Uri.file(target), realUri: vscode.Uri.file(realTarget) };
  } catch (error) {
    if (error instanceof HostError) throw error;
    throw new HostError('SOURCE_NOT_FOUND', `无法读取来源文件：${file}`);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
