import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import type { ViewState } from '../../shared/types';

export class SessionStore {
  private pending = new Map<string, ViewState>();
  private cache = new Map<string, ViewState>();
  private timer?: ReturnType<typeof setTimeout>;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly state: vscode.Memento) {}

  private key(mapKey: string): string {
    return `codeDetective.view.${createHash('sha256').update(mapKey).digest('hex')}`;
  }

  get(mapKey: string): Partial<ViewState> | undefined {
    return this.cache.get(mapKey) ?? this.state.get<Partial<ViewState>>(this.key(mapKey));
  }

  current(): string | undefined { return this.state.get<string>('codeDetective.currentMap'); }

  setCurrent(mapKey: string | undefined): void {
    this.writes = this.writes.catch(() => undefined).then(async () => {
      await this.state.update('codeDetective.currentMap', mapKey);
    });
  }

  save(mapKey: string, value: ViewState): void {
    const snapshot = structuredClone(value);
    this.cache.set(mapKey, snapshot);
    this.pending.set(mapKey, snapshot);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush().catch(() => undefined); }, 180);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const entries = [...this.pending];
    this.pending.clear();
    this.writes = this.writes.catch(() => undefined).then(async () => {
      for (const [key, value] of entries) await this.state.update(this.key(key), value);
    });
    await this.writes;
  }
}
