import * as vscode from 'vscode';
import * as path from 'node:path';
import type { CodeMap } from '../../shared/types';
import { buildUserPrompt, failureHint, systemPrompt } from './prompt';
import { mapFromResponse } from './response';
import { AiError, type AiCancel, type AiProvider } from './types';

const MAX_FILE_CHARS = 24_000;
const MAX_FILES = 24;

export interface MapRequest {
  topic: string;
  root: vscode.WorkspaceFolder;
  /** Files the user explicitly selected or has open; always included first. */
  priorityFiles: string[];
  cancel: AiCancel;
  onProgress?(phase: 'running' | 'validating' | 'retry', text: string): void;
}

export interface MapResult {
  text: string;
  map: CodeMap;
  attempts: number;
}

function clampFile(text: string): string {
  if (text.length <= MAX_FILE_CHARS) return text;
  return `${text.slice(0, MAX_FILE_CHARS)}\n…（文件过长，已截断）`;
}

async function readContextFile(root: vscode.Uri, relativePath: string): Promise<string | undefined> {
  try {
    const uri = vscode.Uri.joinPath(root, ...relativePath.split('/'));
    const bytes = await vscode.workspace.fs.readFile(uri);
    return clampFile(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
  } catch {
    return undefined;
  }
}

/**
 * Chooses a bounded, deterministic set of files: the caller's priority files
 * first, then workspace files ordered by proximity to those directories.
 */
export async function collectFiles(request: MapRequest): Promise<string[]> {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const add = (value: string): void => {
    const normalized = value.split(path.sep).join('/').replace(/^\.\//, '');
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    ordered.push(normalized);
  };
  for (const file of request.priorityFiles) add(file);
  try {
    const found = await vscode.workspace.findFiles(
      new vscode.RelativePattern(request.root, '**/*.{ts,tsx,js,jsx,mjs,cjs,vue,py,go,rs,java,kt,cs,swift,rb,php,c,h,cpp,hpp}'),
      '**/{node_modules,.git,dist,out,build,coverage,vendor,target,.next,.nuxt}/**',
      MAX_FILES * 4,
    );
    const roots = new Set(request.priorityFiles.map(file => path.posix.dirname(file)));
    const scored = found.map(uri => {
      const relative = path.relative(request.root.uri.fsPath, uri.fsPath).split(path.sep).join('/');
      const dir = path.posix.dirname(relative);
      const near = roots.has(dir) ? 0 : roots.has(path.posix.dirname(dir)) ? 1 : 2;
      return { relative, near, depth: relative.split('/').length };
    }).sort((a, b) => a.near - b.near || a.depth - b.depth || a.relative.localeCompare(b.relative));
    for (const item of scored) {
      if (ordered.length >= MAX_FILES) break;
      add(item.relative);
    }
  } catch { /* workspace scan is best-effort */ }
  return ordered.slice(0, MAX_FILES);
}

/**
 * Runs the provider, extracts JSON, and validates it. On validation failure the
 * error text is fed back once, which is far more reliable than prompt tweaking.
 */
export async function generateMap(
  provider: AiProvider,
  request: MapRequest,
  options: { retries?: number } = {},
): Promise<MapResult> {
  const retries = options.retries ?? 1;
  const filePaths = await collectFiles(request);
  const loaded: { path: string; content: string }[] = [];
  for (const file of filePaths) {
    const content = await readContextFile(request.root.uri, file);
    if (content !== undefined) loaded.push({ path: file, content });
  }
  if (loaded.length === 0) {
    throw new AiError('AI_NO_CONTEXT', '没有找到可供分析的源码文件。请在编辑器中打开或选择至少一个文件。');
  }
  const system = systemPrompt();
  const user = buildUserPrompt({ rootName: request.root.name, topic: request.topic, files: loaded });
  const warnings: string[] = [];
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const phase = attempt === 0 ? 'running' : 'retry';
    request.onProgress?.(phase, '');
    const prompt = attempt === 0 ? user : `${user}\n\n${failureHint(warnings.at(-1) ?? '')}`;
    const text = await provider.complete({
      system,
      user: prompt,
      cancel: request.cancel,
      onProgress: () => request.onProgress?.(phase, ''),
    });
    request.onProgress?.('validating', '');
    try {
      return { text, map: mapFromResponse(text), attempts: attempt + 1 };
    } catch (error) {
      warnings.push((error as Error).message);
    }
  }
  throw new AiError('AI_INVALID_MAP', `AI 生成的地图未通过校验：${warnings.at(-1) ?? '未知原因'}`);
}
