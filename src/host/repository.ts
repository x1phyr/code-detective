import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { parseMap } from '../core/validator';
import type { CodeMap, MapSummary } from '../../shared/types';
import { checkedSourceUri, errorMessage } from './paths';

const MAX_MAP_BYTES = 2 * 1024 * 1024;

export interface MapRecord {
  key: string;
  uri: vscode.Uri;
  root: vscode.WorkspaceFolder;
  relativePath: string;
  map?: CodeMap;
  revision?: string;
  error?: string;
}

export function mapKey(root: vscode.Uri, id: string): string {
  return `${root.toString()}::${id}`;
}

export class MapRepository implements vscode.Disposable {
  private files = new Map<string, MapRecord>();
  private records = new Map<string, MapRecord>();
  private watchers: vscode.Disposable[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private latest?: Promise<void>;
  private disposed = false;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly log: vscode.OutputChannel) {}

  installWatchers(): void {
    for (const watcher of this.watchers) watcher.dispose();
    this.watchers = [];
    for (const root of vscode.workspace.workspaceFolders ?? []) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '.code-detective/maps/*.json'));
      this.watchers.push(watcher,
        watcher.onDidCreate(() => this.schedule()),
        watcher.onDidChange(() => this.schedule()),
        watcher.onDidDelete(() => this.schedule()));
    }
  }

  schedule(): void {
    if (this.disposed) return;
    // Only debounce here. Bumping `generation` would abandon an in-flight
    // refresh that a caller (e.g. "write map, refresh, open it") is awaiting.
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh().catch(error => this.log.appendLine(`地图扫描失败：${errorMessage(error)}`));
    }, 200);
  }

  /**
   * Rescans every workspace folder. When a newer refresh supersedes this one,
   * the returned promise waits for that newer scan, so on resolve `get()`
   * always reflects files written before the call.
   */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const run = this.scan(++this.generation);
    this.latest = run;
    await run;
  }

  private async scan(generation: number): Promise<void> {
    const superseded = async (): Promise<boolean> => {
      if (this.disposed) return true;
      if (generation === this.generation) return false;
      await this.latest;
      return true;
    };
    const oldFiles = this.files;
    const nextFiles = new Map<string, MapRecord>();
    const roots = vscode.workspace.workspaceFolders ?? [];
    for (const root of roots) {
      let uris: vscode.Uri[];
      try {
        uris = await vscode.workspace.findFiles(new vscode.RelativePattern(root, '.code-detective/maps/*.json'), null);
      } catch (error) {
        this.log.appendLine(`无法扫描 ${root.name}：${errorMessage(error)}`);
        for (const [key, record] of oldFiles) {
          if (record.root.uri.toString() === root.uri.toString()) {
            nextFiles.set(key, { ...record, error: '地图目录扫描失败，保留上次有效结果。' });
          }
        }
        continue;
      }
      for (let offset = 0; offset < uris.length; offset += 8) {
        const batch = await Promise.all(uris.slice(offset, offset + 8).map(uri => this.readFile(root, uri, oldFiles.get(uri.toString()))));
        for (const record of batch) nextFiles.set(record.uri.toString(), record);
        if (await superseded()) return;
      }
    }
    if (await superseded()) return;

    const groups = new Map<string, MapRecord[]>();
    for (const record of nextFiles.values()) {
      const group = groups.get(record.key) ?? [];
      group.push(record);
      groups.set(record.key, group);
    }
    const nextRecords = new Map<string, MapRecord>();
    for (const [key, group] of groups) {
      if (group.length === 1) {
        nextRecords.set(key, group[0]);
      } else {
        const previous = this.records.get(key);
        const error = `地图 id 冲突：${group.map(item => item.relativePath).join('、')}。请为同一工作区内的地图设置不同 id。`;
        nextRecords.set(key, previous?.map
          ? { ...previous, error }
          : { ...group[0], map: undefined, revision: undefined, error });
      }
    }
    this.files = nextFiles;
    this.records = nextRecords;
    this.changed.fire();
  }

  private async readFile(root: vscode.WorkspaceFolder, uri: vscode.Uri, previous?: MapRecord): Promise<MapRecord> {
    const relativePath = path.relative(root.uri.fsPath, uri.fsPath).split(path.sep).join('/');
    const base: MapRecord = previous
      ? { ...previous, root, uri, relativePath, error: undefined }
      : { root, uri, relativePath, key: mapKey(root.uri, `invalid:${relativePath}`) };
    try {
      const localPath = uri.path.slice(root.uri.path.replace(/\/$/, '').length + 1);
      await checkedSourceUri(root.uri, localPath);
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > MAX_MAP_BYTES) throw new Error('地图文件超过 2 MiB，请拆分成较小的话题地图。');
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > MAX_MAP_BYTES) throw new Error('地图文件超过 2 MiB，请拆分成较小的话题地图。');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const map = parseMap(text);
      const revision = createHash('sha256').update(bytes).digest('hex');
      return { root, uri, relativePath, key: mapKey(root.uri, map.id), map, revision };
    } catch (error) {
      return { ...base, error: errorMessage(error) };
    }
  }

  get(key: string): MapRecord | undefined { return this.records.get(key); }

  summaries(): MapSummary[] {
    return [...this.records.values()].map(record => ({
      key: record.key,
      title: record.map?.title ?? record.relativePath.split('/').at(-1) ?? '无效地图',
      rootName: record.root.name,
      fileName: record.relativePath,
      revision: record.revision,
      error: record.error,
    })).sort((a, b) => a.rootName.localeCompare(b.rootName) || a.title.localeCompare(b.title));
  }

  dispose(): void {
    this.disposed = true;
    ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    for (const watcher of this.watchers) watcher.dispose();
    this.changed.dispose();
  }
}
