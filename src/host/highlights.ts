import * as vscode from 'vscode';
import type { ViewState, SourceStatus } from '../../shared/types';
import { relatedSourceIds, sourceIdsForSelection } from '../core/selection';
import { annotateSource } from '../core/annotations';
import { isUsableSource, type AcceptedMap, type SourceService } from './sources';

export function sourceRange(document: vscode.TextDocument, status: SourceStatus): vscode.Range | undefined {
  if (status.startLine < 1 || status.endLine < status.startLine || status.endLine > document.lineCount) return undefined;
  return new vscode.Range(status.startLine - 1, 0, status.endLine - 1, document.lineAt(status.endLine - 1).text.length);
}

export class HighlightController implements vscode.Disposable {
  private readonly base = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    // 颜色取自当前主题：相关范围用“范围高亮”底色，选中范围用“查找匹配”底色 + 焦点边框。
    backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
  });
  private readonly selected = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    borderWidth: '0 0 0 3px',
    borderStyle: 'solid',
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    borderColor: new vscode.ThemeColor('focusBorder'),
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });
  /** Gray end-of-line note on the first line of each selected range. */
  private readonly note = vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    after: {
      margin: '0 0 0 2.5em',
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      fontStyle: 'italic',
    },
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
    for (const editor of new Set([...this.touched, ...vscode.window.visibleTextEditors])) this.reset(editor);
    this.touched.clear();
  }

  private reset(editor: vscode.TextEditor): void {
    try {
      editor.setDecorations(this.base, []);
      editor.setDecorations(this.selected, []);
      editor.setDecorations(this.note, []);
    } catch { /* editor already closed */ }
  }

  private apply(): void {
    const current = this.current;
    if (!current?.ui.highlightEnabled) { this.clear(); return; }
    const { map } = current.record;
    const { selection } = current.ui;
    const related = relatedSourceIds(map);
    const selected = sourceIdsForSelection(map, selection);
    const editors = vscode.window.visibleTextEditors;
    for (const editor of editors) {
      const located = (ids: string[]): { id: string; range: vscode.Range }[] => {
        const seen = new Set<string>();
        const out: { id: string; range: vscode.Range }[] = [];
        for (const id of ids) {
          const status = this.sources.getStatus(id);
          if (!isUsableSource(status) || !status || !this.sources.matchesEditor(id, editor.document)) continue;
          const range = sourceRange(editor.document, status);
          const key = `${status.startLine}:${status.endLine}`;
          if (range && !seen.has(key)) { seen.add(key); out.push({ id, range }); }
        }
        return out;
      };

      const chosen = located(selected);
      const selectedOptions: vscode.DecorationOptions[] = [];
      const noteOptions: vscode.DecorationOptions[] = [];
      for (const { id, range } of chosen) {
        const annotation = annotateSource(map, id, selection);
        const hoverMessage = annotation ? new vscode.MarkdownString(annotation.hover) : undefined;
        selectedOptions.push({ range, hoverMessage });
        if (annotation) {
          const first = editor.document.lineAt(range.start.line).range;
          noteOptions.push({ range: new vscode.Range(first.end, first.end), renderOptions: { after: { contentText: annotation.inline } } });
        }
      }
      editor.setDecorations(this.base, located(related).map(item => item.range));
      editor.setDecorations(this.selected, selectedOptions);
      editor.setDecorations(this.note, noteOptions);
      this.touched.add(editor);
    }
    for (const editor of [...this.touched]) {
      if (!editors.includes(editor)) {
        this.reset(editor);
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
    this.note.dispose();
  }
}
