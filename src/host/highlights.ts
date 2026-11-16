import * as vscode from 'vscode';
import type { CodeMap, Selection, SourceStatus, ViewState } from '../../shared/types';
import { activeFocusSelection, focusedSourceIds } from '../core/selection';
import { annotateSource } from '../core/annotations';
import { planFocusHighlight, type LineSpan } from '../core/calls';
import { isUsableSource, type AcceptedMap, type SourceService } from './sources';

export function lineSpanRange(document: vscode.TextDocument, span: LineSpan): vscode.Range | undefined {
  if (span.startLine < 1 || span.endLine < span.startLine || span.endLine > document.lineCount) return undefined;
  return new vscode.Range(span.startLine - 1, 0, span.endLine - 1, document.lineAt(span.endLine - 1).text.length);
}

export function sourceRange(document: vscode.TextDocument, status: SourceStatus): vscode.Range | undefined {
  return lineSpanRange(document, status);
}

function sliceLines(document: vscode.TextDocument, span: LineSpan): string[] {
  if (span.startLine < 1 || span.endLine < span.startLine || span.endLine > document.lineCount) return [];
  const lines: string[] = [];
  for (let line = span.startLine; line <= span.endLine; line += 1) {
    lines.push(document.lineAt(line - 1).text);
  }
  return lines;
}

/**
 * Returns the primary spotlight range to reveal and place the cursor on when navigating to a step.
 */
export function focusRevealRange(
  document: vscode.TextDocument,
  status: SourceStatus,
  map: CodeMap,
  sourceId: string,
  focus?: Selection,
): vscode.Range | undefined {
  const fallback = sourceRange(document, status);
  if (!fallback) return undefined;
  const lines = sliceLines(document, status);
  const plan = planFocusHighlight({ startLine: status.startLine, lines, map, sourceId, focus });
  return (plan.spotlightLines[0] ? lineSpanRange(document, plan.spotlightLines[0]) : undefined) ?? fallback;
}

function nonSpotlightScopeSpans(scope: LineSpan, spotlights: readonly LineSpan[]): LineSpan[] {
  const spans: LineSpan[] = [];
  let cursor = scope.startLine;
  for (const sp of spotlights) {
    if (sp.startLine > cursor) {
      spans.push({ startLine: cursor, endLine: Math.min(sp.startLine - 1, scope.endLine) });
    }
    cursor = Math.max(cursor, sp.endLine + 1);
  }
  if (cursor <= scope.endLine) {
    spans.push({ startLine: cursor, endLine: scope.endLine });
  }
  return spans;
}

/**
 * 编辑器源码装饰控制器（单焦点聚光灯）：
 * - 只高亮当前正在阅读的步骤 / 预览目标，不再给同文件其它步骤涂底色或挂行尾批注；
 * - 若旧地图或整段函数范围较大，自动收窄到底层关键调用行，只在外层函数范围留淡细左边框；
 * - 对聚光灯行内的关键函数调用标识符额外加词级高亮。
 */
export class HighlightController implements vscode.Disposable {
  /** 外层函数范围（仅在自动收窄到关键调用行时使用）：极淡左边框，不涂底色、不占概览尺。 */
  private readonly scope = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    borderWidth: '0 0 0 2px',
    borderStyle: 'solid',
    borderColor: new vscode.ThemeColor('codeDetective.mapBorder'),
  });
  /** 当前步骤聚光灯：柔和黄底 + 加粗金色左边框 + 概览尺标记。 */
  private readonly selected = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    borderWidth: '0 0 0 3px',
    borderStyle: 'solid',
    backgroundColor: new vscode.ThemeColor('codeDetective.mapBackground'),
    borderColor: new vscode.ThemeColor('codeDetective.focusBorder'),
    overviewRulerColor: new vscode.ThemeColor('codeDetective.focusBorder'),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });
  /** 聚光灯行内关键函数调用标识符的词级高亮。 */
  private readonly callToken = vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    backgroundColor: new vscode.ThemeColor('codeDetective.callBackground'),
    borderWidth: '0 0 1px 0',
    borderStyle: 'solid',
    borderColor: new vscode.ThemeColor('codeDetective.focusBorder'),
    borderRadius: '3px',
    fontWeight: '600',
  });
  /** Gray end-of-line note on the first line of the spotlighted range. */
  private readonly note = vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    after: {
      margin: '0 0 0 2.2em',
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      fontStyle: 'italic',
    },
  });
  private current?: { record: AcceptedMap; ui: ViewState };
  private touched = new Set<vscode.TextEditor>();
  private disposed = false;
  private queued = false;
  /** 侧栏或右侧地图面板至少一个正在显示时才着色；切到别的视图就收起。 */
  private visible = true;
  private readonly listener: vscode.Disposable;

  constructor(private readonly sources: SourceService) {
    this.listener = vscode.window.onDidChangeVisibleTextEditors(() => this.schedule());
  }

  update(record?: AcceptedMap, ui?: ViewState): void {
    this.current = record && ui ? { record, ui } : undefined;
    this.schedule();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
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

  /** 只清掉装饰，保留当前地图，面板再出现时恢复。 */
  private hide(): void {
    for (const editor of new Set([...this.touched, ...vscode.window.visibleTextEditors])) this.reset(editor);
    this.touched.clear();
  }

  private reset(editor: vscode.TextEditor): void {
    try {
      editor.setDecorations(this.selected, []);
      editor.setDecorations(this.scope, []);
      editor.setDecorations(this.callToken, []);
      editor.setDecorations(this.note, []);
    } catch { /* editor already closed */ }
  }

  private apply(): void {
    const current = this.current;
    if (!current?.ui.highlightEnabled || !this.visible) { this.hide(); return; }
    const { map } = current.record;
    const focus = activeFocusSelection(map, current.ui);
    const selectedIds = focusedSourceIds(map, current.ui);
    const editors = vscode.window.visibleTextEditors;

    for (const editor of editors) {
      const selectedOptions: vscode.DecorationOptions[] = [];
      const scopeOptions: vscode.DecorationOptions[] = [];
      const callOptions: vscode.DecorationOptions[] = [];
      const noteOptions: vscode.DecorationOptions[] = [];
      const seen = new Set<string>();
      const noted = new Set<number>();

      for (const id of selectedIds) {
        const status = this.sources.getStatus(id);
        if (!isUsableSource(status) || !status || !this.sources.matchesEditor(id, editor.document)) continue;
        const fullRange = sourceRange(editor.document, status);
        const key = `${status.startLine}:${status.endLine}`;
        if (!fullRange || seen.has(key)) continue;
        seen.add(key);

        const lines = sliceLines(editor.document, status);
        const plan = planFocusHighlight({
          startLine: status.startLine,
          lines,
          map,
          sourceId: id,
          focus,
        });
        const annotation = annotateSource(map, id, focus);
        const hoverMessage = annotation ? new vscode.MarkdownString(annotation.hover) : undefined;

        if (plan.scopeLines) {
          for (const scopeSpan of nonSpotlightScopeSpans(plan.scopeLines, plan.spotlightLines)) {
            const r = lineSpanRange(editor.document, scopeSpan);
            if (r) scopeOptions.push({ range: r });
          }
        }

        for (const span of plan.spotlightLines) {
          const r = lineSpanRange(editor.document, span);
          if (r) selectedOptions.push({ range: r, hoverMessage });
        }

        for (const token of plan.callTokens) {
          if (token.line < 1 || token.line > editor.document.lineCount) continue;
          const lineLen = editor.document.lineAt(token.line - 1).text.length;
          const startCol = Math.max(0, Math.min(token.startCol, lineLen));
          const endCol = Math.max(startCol, Math.min(token.endCol, lineLen));
          if (endCol > startCol) {
            callOptions.push({
              range: new vscode.Range(token.line - 1, startCol, token.line - 1, endCol),
              hoverMessage,
            });
          }
        }

        const noteZeroLine = plan.noteLine - 1;
        if (annotation && noteZeroLine >= 0 && noteZeroLine < editor.document.lineCount && !noted.has(noteZeroLine)) {
          noted.add(noteZeroLine);
          const first = editor.document.lineAt(noteZeroLine).range;
          noteOptions.push({
            range: new vscode.Range(first.end, first.end),
            renderOptions: { after: { contentText: `← ${annotation.inline}` } },
          });
        }
      }

      editor.setDecorations(this.scope, scopeOptions);
      editor.setDecorations(this.selected, selectedOptions);
      editor.setDecorations(this.callToken, callOptions);
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
    this.selected.dispose();
    this.scope.dispose();
    this.callToken.dispose();
    this.note.dispose();
  }
}
