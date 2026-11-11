import * as vscode from 'vscode';
import type { ViewState, SourceStatus } from '../../shared/types';
import { relatedSourceIds, sourceIdsForSelection } from '../core/selection';
import { isUsableSource, type AcceptedMap, type SourceService } from './sources';

export function sourceRange(document: vscode.TextDocument, status: SourceStatus): vscode.Range | undefined {
  if (status.startLine < 1 || status.endLine < status.startLine || status.endLine > document.lineCount) return undefined;
  return new vscode.Range(status.startLine - 1, 0, status.endLine - 1, document.lineAt(status.endLine - 1).text.length);
}

export class HighlightController implements vscode.Disposable {
  private readonly base = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    light: { backgroundColor: 'rgba(45,117,183,0.07)' },
    dark: { backgroundColor: 'rgba(77,170,248,0.075)' },
  });
  private readonly selected = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    borderWidth: '0 0 0 3px',
    borderStyle: 'solid',
    light: { backgroundColor: 'rgba(181,112,18,0.16)', borderColor: '#a96a12' },
    dark: { backgroundColor: 'rgba(232,177,90,0.21)', borderColor: '#e8b15a' },
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });
  private current?: { record: AcceptedMap; ui: ViewState };
  private touched = new Set<vscode.TextEditor>();
  private disposed = false;
  private queued = false;
  private readonly listener: vscode.Disposable;

  constructor(private readonly sources: SourceService) {
    this.listener = vscode.window.onDidChangeVisibleTextEditors(() => this.schedule());
  }

  update(record?: AcceptedMap, ui?: ViewState): void {
    this.current = record && ui ? { record, ui } : undefined;
    this.schedule();
  }

  schedule(): void {
    if (this.queued || this.disposed) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; if (!this.disposed) this.apply(); });
  }

  clear(): void {
    this.current = undefined;
    for (const editor of new Set([...this.touched, ...vscode.window.visibleTextEditors])) {
      try { editor.setDecorations(this.base, []); editor.setDecorations(this.selected, []); } catch {}
    }
    this.touched.clear();
  }

  private apply(): void {
    const current = this.current;
    if (!current?.ui.highlightEnabled) { this.clear(); return; }
    const related = relatedSourceIds(current.record.map);
    const selected = sourceIdsForSelection(current.record.map, current.ui.selection);
    const editors = vscode.window.visibleTextEditors;
    for (const editor of editors) {
      const getRanges = (ids: string[]): vscode.Range[] => {
        const seen = new Set<string>();
        const ranges: vscode.Range[] = [];
        for (const id of ids) {
          const status = this.sources.getStatus(id);
          if (!isUsableSource(status) || !status || !this.sources.matchesEditor(id, editor.document)) continue;
          const range = sourceRange(editor.document, status);
          const key = `${status.startLine}:${status.endLine}`;
          if (range && !seen.has(key)) { seen.add(key); ranges.push(range); }
        }
        return ranges;
      };
      editor.setDecorations(this.base, getRanges(related));
      editor.setDecorations(this.selected, getRanges(selected));
      this.touched.add(editor);
    }
    for (const editor of [...this.touched]) {
      if (!editors.includes(editor)) {
        try { editor.setDecorations(this.base, []); editor.setDecorations(this.selected, []); } catch {}
        this.touched.delete(editor);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    this.listener.dispose();
    this.base.dispose();
    this.selected.dispose();
  }
}
