import * as vscode from 'vscode';
import { checkedSourceUri } from './paths';

/** Upper bound for files read whole (readSource tool, anchor filling). */
export const MAX_READ_BYTES = 2 * 1024 * 1024;

/**
 * Reads a workspace-relative file after the canonical-path and realpath checks,
 * so neither chat tools nor AI generation can read outside the folder.
 */
export async function readWorkspaceText(root: vscode.WorkspaceFolder, file: string): Promise<string> {
  const { realUri } = await checkedSourceUri(root.uri, file);
  const stat = await vscode.workspace.fs.stat(realUri);
  if (stat.size > MAX_READ_BYTES) {
    throw new Error(`${file} 超过 ${MAX_READ_BYTES / 1024 / 1024} MiB，不读取。`);
  }
  const bytes = await vscode.workspace.fs.readFile(realUri);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
