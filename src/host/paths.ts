import * as vscode from 'vscode';
import { realpath } from 'node:fs/promises';
import { HostError, errorMessage } from '../core/errors';
import { assertRelativeSourcePath, isWithin, resolveWithinRoot } from '../core/paths';
import { t } from '../../shared/i18n';

export { HostError, errorMessage, isWithin };

export function uriKey(uri: vscode.Uri): string {
  return process.platform === 'win32' && uri.scheme === 'file'
    ? uri.fsPath.toLowerCase()
    : uri.toString();
}

export async function checkedSourceUri(root: vscode.Uri, file: string): Promise<{ uri: vscode.Uri; realUri: vscode.Uri }> {
  if (root.scheme !== 'file') {
    throw new HostError('SOURCE_OUTSIDE_ROOT', t('host.sourceOutsideRoot'));
  }
  assertRelativeSourcePath(file);
  const target = resolveWithinRoot(root.fsPath, file);
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(root.fsPath), realpath(target)]);
    if (!isWithin(realRoot, realTarget)) {
      throw new HostError('SOURCE_OUTSIDE_ROOT', t('host.symlinkOutsideRoot'));
    }
    return { uri: vscode.Uri.file(target), realUri: vscode.Uri.file(realTarget) };
  } catch (error) {
    if (error instanceof HostError) throw error;
    throw new HostError('SOURCE_NOT_FOUND', t('host.sourceUnreadable', { file }));
  }
}
