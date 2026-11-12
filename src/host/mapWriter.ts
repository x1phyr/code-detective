import * as vscode from 'vscode';
import type { CodeMap } from '../../shared/types';
import { freeMapName, sanitizeMapId } from '../ai/mapNaming';

export const MAP_DIR = '.code-detective/maps';

export interface MapWriteOptions {
  root: vscode.WorkspaceFolder;
  /** True when a map with this id is already known to the repository. */
  hasMap(key: string): boolean;
}

export interface WrittenMap {
  key: string;
  id: string;
  relativePath: string;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a validated map under `.code-detective/maps/`, never overwriting an
 * existing file: the id and the file name stay in sync by bumping a suffix.
 */
export async function writeMapFile(map: CodeMap, options: MapWriteOptions): Promise<WrittenMap> {
  const { root } = options;
  const directory = vscode.Uri.joinPath(root.uri, ...MAP_DIR.split('/'));
  await vscode.workspace.fs.createDirectory(directory);
  const base = sanitizeMapId(map.id || map.title);
  const taken = async (candidate: string): Promise<boolean> =>
    options.hasMap(`${root.uri.toString()}::${candidate}`)
    || await exists(vscode.Uri.joinPath(directory, `${candidate}.json`));
  const chosen = await freeMapName(base, taken);
  const target = vscode.Uri.joinPath(directory, chosen.fileName);
  const body = `${JSON.stringify({ ...map, id: chosen.id }, null, 2)}\n`;
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(body));
  return {
    key: `${root.uri.toString()}::${chosen.id}`,
    id: chosen.id,
    relativePath: `${MAP_DIR}/${chosen.fileName}`,
  };
}
