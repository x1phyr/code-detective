import * as vscode from 'vscode';
import type { CodeMap, SourceStatus } from '../../shared/types';
import { resolveSourceText } from '../core/source';
import { SOURCE_STATE_LABELS } from '../../shared/types';
import { HostError, errorMessage } from '../core/errors';
import { checkedSourceUri, uriKey } from './paths';
import type { MapRecord } from './repository';

export type AcceptedMap = MapRecord & { map: CodeMap; revision: string };

export const USABLE_SOURCE_STATES = new Set<SourceStatus['state']>(['range-only', 'matched', 'relocated']);

export function isUsableSource(status: SourceStatus | undefined): boolean {
  return status !== undefined && USABLE_SOURCE_STATES.has(status.state);
}

interface Resolved {
  status: SourceStatus;
  fileKeys?: Set<string>;
}

const BATCH = 8;

export class SourceService implements vscode.Disposable {
  private resolved = new Map<string, Resolved>();
  private current?: AcceptedMap;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly listeners: vscode.Disposable[];
  readonly onDidChange = this.changed.event;

  constructor(private readonly log: vscode.OutputChannel) {
    this.listeners = [
      vscode.workspace.onDidChangeTextDocument(event => {
        if (this.current && this.trackedDocuments(event.document)) this.schedule();
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        if (this.current && this.trackedDocuments(document)) this.schedule();
      }),
    ];
  }

  private trackedDocuments(document: vscode.TextDocument): boolean {
    if (!this.current) return false;
    const key = uriKey(document.uri);
    for (const item of this.resolved.values()) if (item.fileKeys?.has(key)) return true;
    return false;
  }

  reset(record?: AcceptedMap): void {
    ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.current = record;
    this.resolved = new Map();
    if (!record) { this.changed.fire(); return; }
    for (const id of Object.keys(record.map.sources)) {
      const ref = record.map.sources[id]!;
      this.resolved.set(id, {
        status: { file: ref.file, startLine: ref.startLine, endLine: ref.endLine, state: 'pending', message: '正在检查源码位置…' },
      });
    }
    void this.run();
  }

  schedule(): void {
    if (this.disposed || !this.current) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.run(); }, 250);
  }

  private async run(): Promise<void> {
    const record = this.current;
    if (this.disposed || !record) return;
    const generation = ++this.generation;
    for (const id of Object.keys(record.map.sources)) {
      const previous = this.resolved.get(id);
      if (previous?.status.state === 'pending') continue;
      const ref = record.map.sources[id]!;
      this.resolved.set(id, {
        ...previous,
        status: { file: ref.file, startLine: ref.startLine, endLine: ref.endLine, state: 'pending', message: '正在检查源码位置…' },
      });
      this.changed.fire();
    }
    const entries = Object.entries(record.map.sources);
    const next = new Map<string, Resolved>();
    for (let offset = 0; offset < entries.length; offset += BATCH) {
      const slice = entries.slice(offset, offset + BATCH);
      const settled = await Promise.all(slice.map(([id, ref]) => this.resolveOne(record, id, ref)));
      for (const [id, resolved] of settled) next.set(id, resolved);
      if (generation !== this.generation || this.disposed) return;
    }
    this.resolved = next;
    this.changed.fire();
  }

  private async resolveOne(
    record: AcceptedMap,
    id: string,
    ref: CodeMap['sources'][string],
  ): Promise<[string, Resolved]> {
    const original = { file: ref.file, startLine: ref.startLine, endLine: ref.endLine };
    try {
      const { uri, realUri } = await checkedSourceUri(record.root.uri, ref.file);
      const text = await this.documentText(uri);
      const status = resolveSourceText(ref, text);
      return [id, { status, fileKeys: new Set([uriKey(uri), uriKey(realUri)]) }];
    } catch (error) {
      if (error instanceof HostError && error.code === 'SOURCE_OUTSIDE_ROOT') {
        return [id, { status: { ...original, state: 'outside-root', message: error.message } }];
      }
      if (error instanceof HostError && error.code === 'SOURCE_NOT_FOUND') {
        return [id, { status: { ...original, state: 'missing', message: error.message } }];
      }
      this.log.appendLine(`来源 ${id} 检查失败：${errorMessage(error)}`);
      return [id, { status: { ...original, state: 'stale', message: errorMessage(error) } }];
    }
  }

  private async documentText(uri: vscode.Uri): Promise<string> {
    const key = uriKey(uri);
    const open = vscode.workspace.textDocuments.find(document => uriKey(document.uri) === key);
    if (open) return open.getText();
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder('utf-8').decode(bytes);
  }

  getStatus(id: string): SourceStatus | undefined {
    return this.resolved.get(id)?.status;
  }

  matchesEditor(id: string, document: vscode.TextDocument): boolean {
    const item = this.resolved.get(id);
    if (!item?.fileKeys) return false;
    return item.fileKeys.has(uriKey(document.uri));
  }

  statuses(): Record<string, SourceStatus> {
    const output: Record<string, SourceStatus> = {};
    for (const [id, item] of this.resolved) output[id] = item.status;
    return output;
  }

  describe(id: string): string {
    const status = this.getStatus(id);
    if (!status) return '未知来源';
    const label = SOURCE_STATE_LABELS[status.state];
    return `${status.file}:${status.startLine}${status.endLine > status.startLine ? `-${status.endLine}` : ''} · ${label}`;
  }

  dispose(): void {
    this.disposed = true;
    ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    for (const listener of this.listeners) listener.dispose();
    this.changed.dispose();
  }
}
