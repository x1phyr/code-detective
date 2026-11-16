import * as vscode from 'vscode';
import type { CodeMap } from '../../shared/types';
import { freeMapName, sanitizeMapId } from '../ai/mapNaming';
import type { MapRecord } from './repository';

export const MAP_DIR = '.code-detective/maps';

export interface MapWriteOptions {
  root: vscode.WorkspaceFolder;
  /** True when a map with this id is already known to the repository. */
  hasMap(key: string): boolean;
  /** Optional existing map record to overwrite in place when regenerating. */
  overwrite?: Pick<MapRecord, 'uri' | 'relativePath' | 'map'>;
}

export interface WrittenMap {
  key: string;
  id: string;
  relativePath: string;
}

/** Names handed out but not yet on disk, so concurrent writers never pick the same one. */
const reserved = new Set<string>();

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a validated map under `.code-detective/maps/`.
 * When `options.overwrite` is supplied, updates that exact file and keeps its `map.id`.
 * Otherwise chooses a collision-free id and file name.
 */
export async function writeMapFile(map: CodeMap, options: MapWriteOptions): Promise<WrittenMap> {
  const { root, overwrite } = options;
  if (overwrite) {
    const fixedId = overwrite.map?.id ? sanitizeMapId(overwrite.map.id) : sanitizeMapId(map.id || map.title);
    const updated: CodeMap = { ...map, id: fixedId };
    await saveMapAtUri(overwrite.uri, updated);
    return {
      key: `${root.uri.toString()}::${fixedId}`,
      id: fixedId,
      relativePath: overwrite.relativePath,
    };
  }

  const directory = vscode.Uri.joinPath(root.uri, ...MAP_DIR.split('/'));
  await vscode.workspace.fs.createDirectory(directory);
  const base = sanitizeMapId(map.id || map.title);
  const keyOf = (candidate: string): string => `${root.uri.toString()}::${candidate}`;
  const taken = async (candidate: string): Promise<boolean> =>
    reserved.has(keyOf(candidate))
    || options.hasMap(keyOf(candidate))
    || await exists(vscode.Uri.joinPath(directory, `${candidate}.json`));
  // freeMapName awaits between checks, so claim the name synchronously once found.
  const chosen = await freeMapName(base, async candidate => {
    if (await taken(candidate)) return true;
    if (reserved.has(keyOf(candidate))) return true;
    reserved.add(keyOf(candidate));
    return false;
  });
  const target = vscode.Uri.joinPath(directory, chosen.fileName);
  try {
    await saveMapAtUri(target, { ...map, id: chosen.id });
  } finally {
    reserved.delete(keyOf(chosen.id));
  }
  return {
    key: `${root.uri.toString()}::${chosen.id}`,
    id: chosen.id,
    relativePath: `${MAP_DIR}/${chosen.fileName}`,
  };
}

/** Persists an updated `CodeMap` (e.g. saved note or new aside) in place. */
export async function saveMapAtUri(uri: vscode.Uri, map: CodeMap): Promise<void> {
  const body = `${JSON.stringify(map, null, 2)}\n`;
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(body));
}

/** Deletes a map JSON file from disk. */
export async function deleteMapFile(uri: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.delete(uri, { useTrash: false });
}
