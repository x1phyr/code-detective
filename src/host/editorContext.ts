import * as vscode from 'vscode';
import * as path from 'node:path';
import type { EditorContextPayload, SourceStatus } from '../../shared/types';
import { matchCursorToMap } from '../core/selection';
import { assertRelativeSourcePath } from '../core/paths';
import type { AcceptedMap } from './sources';

const MAX_SELECTION_PREVIEW = 1_600;

/**
 * 监听活动编辑器与光标/选区变化，计算：
 * 1. 当前活动文件、光标行与附近函数名（用于侧栏内嵌发起框与右键带读锚点）；
 * 2. 光标命中的带读步骤 / 脉络图节点（用于柔和跟随标记“📍光标在此”，绝不强抢翻页）；
 * 3. 用户选中的代码片段（自动附带进底部向老手的追问）。
 */
export class EditorContextTracker implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private latest: EditorContextPayload = { matchedStepIds: [], matchedNodeIds: [] };
  private currentMap?: AcceptedMap;
  private getStatuses: () => Readonly<Record<string, SourceStatus>>;
  private readonly onUpdate: (payload: EditorContextPayload) => void;

  constructor(options: {
    statuses: () => Readonly<Record<string, SourceStatus>>;
    onUpdate: (payload: EditorContextPayload) => void;
  }) {
    this.getStatuses = options.statuses;
    this.onUpdate = options.onUpdate;
    if (typeof vscode.window.onDidChangeActiveTextEditor === 'function') {
      this.disposables.push(vscode.window.onDidChangeActiveTextEditor(() => this.schedule()));
    }
    if (typeof vscode.window.onDidChangeTextEditorSelection === 'function') {
      this.disposables.push(vscode.window.onDidChangeTextEditorSelection(() => this.schedule()));
    }
  }

  get state(): EditorContextPayload {
    return this.latest;
  }

  setMap(record?: AcceptedMap): void {
    this.currentMap = record;
    this.refreshNow();
  }

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.refreshNow();
    }, 120);
  }

  refreshNow(): EditorContextPayload {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      this.latest = { matchedStepIds: [], matchedNodeIds: [] };
      this.onUpdate(this.latest);
      return this.latest;
    }

    const folder = this.currentMap?.root ?? vscode.workspace.getWorkspaceFolder(editor.document.uri);
    let relativeFile: string | undefined;
    if (folder) {
      const candidate = path.relative(folder.uri.fsPath, editor.document.uri.fsPath).split(path.sep).join('/');
      if (candidate && !candidate.startsWith('..')) {
        try {
          assertRelativeSourcePath(candidate);
          relativeFile = candidate;
        } catch {
          relativeFile = undefined;
        }
      }
    }

    const cursorLine = editor.selection.active.line + 1;
    const activeSymbol = guessEnclosingSymbol(editor.document, editor.selection.active.line);
    const matched = (this.currentMap && relativeFile)
      ? matchCursorToMap(this.currentMap.map, this.getStatuses(), relativeFile, cursorLine)
      : { matchedStepIds: [], matchedNodeIds: [] };

    let selection: EditorContextPayload['selection'];
    if (relativeFile && !editor.selection.isEmpty) {
      const startLine = editor.selection.start.line + 1;
      const endLine = Math.max(startLine, editor.selection.end.character === 0 && editor.selection.end.line > editor.selection.start.line
        ? editor.selection.end.line
        : editor.selection.end.line + 1);
      const rawText = editor.document.getText(editor.selection).trim();
      if (rawText.length > 0) {
        selection = {
          file: relativeFile,
          startLine,
          endLine,
          ...(activeSymbol ? { symbol: activeSymbol } : {}),
          preview: rawText.slice(0, MAX_SELECTION_PREVIEW),
        };
      }
    }

    const next: EditorContextPayload = {
      ...(relativeFile ? { activeFile: relativeFile } : {}),
      cursorLine,
      ...(activeSymbol ? { activeSymbol } : {}),
      matchedStepIds: matched.matchedStepIds,
      matchedNodeIds: matched.matchedNodeIds,
      ...(selection ? { selection } : {}),
    };
    this.latest = next;
    this.onUpdate(next);
    return next;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const item of this.disposables) item.dispose();
  }
}

/** 轻量启发式提取光标所在或紧邻的函数/方法/类名，无需阻塞等待 LSP SymbolProvider。 */
export function guessEnclosingSymbol(document: vscode.TextDocument, zeroBasedLine: number): string | undefined {
  const patterns = [
    /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
    /(?:public|private|protected|static|async|\s)+([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::\s*[^{]+)?\{/,
    /def\s+([A-Za-z_]\w*)\s*\(/,
    /func\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)\s*\(/,
    /fn\s+([A-Za-z_]\w*)\s*[<(]/,
    /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/,
  ];
  const reserved = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'sizeof']);
  const from = Math.max(0, zeroBasedLine - 40);
  for (let i = zeroBasedLine; i >= from; i--) {
    const text = document.lineAt(i).text;
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      const name = match?.[1];
      if (name && !reserved.has(name)) return name;
    }
  }
  return undefined;
}
