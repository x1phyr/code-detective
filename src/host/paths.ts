import * as vscode from 'vscode';
import { realpath } from 'node:fs/promises';
import { HostError, errorMessage } from '../core/errors';
import { assertRelativeSourcePath, isWithin, resolveWithinRoot } from '../core/paths';

export { HostError, errorMessage, isWithin };

export function uriKey(uri: vscode.Uri): string {
  return process.platform === 'win32' && uri.scheme === 'file'
    ? uri.fsPath.toLowerCase()
    : uri.toString();
}

export async function checkedSourceUri(root: vscode.Uri, file: string): Promise<{ uri: vscode.Uri; realUri: vscode.Uri }> {
  if (root.scheme !== 'file') {
    throw new HostError('SOURCE_OUTSIDE_ROOT', '当前版本只支持本地工作区中的源码位置。');
  }
  assertRelativeSourcePath(file);
  const target = resolveWithinRoot(root.fsPath, file);
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
