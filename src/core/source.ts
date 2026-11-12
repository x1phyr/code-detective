import type { SourceRef, SourceStatus } from '../../shared/types';

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function lineMatches(lines: readonly string[], anchor: readonly string[]): number[] {
  const prefix = new Array<number>(anchor.length).fill(0);
  for (let index = 1, matched = 0; index < anchor.length; index += 1) {
    while (matched > 0 && anchor[index] !== anchor[matched]) matched = prefix[matched - 1]!;
    if (anchor[index] === anchor[matched]) matched += 1;
    prefix[index] = matched;
  }
  const starts: number[] = [];
  for (let index = 0, matched = 0; index < lines.length; index += 1) {
    while (matched > 0 && lines[index] !== anchor[matched]) matched = prefix[matched - 1]!;
    if (lines[index] === anchor[matched]) matched += 1;
    if (matched === anchor.length) {
      starts.push(index - anchor.length + 1);
      if (starts.length === 2) break;
      matched = prefix[matched - 1]!;
    }
  }
  return starts;
}

export function resolveSourceText(
  ref: SourceRef,
  text: string,
  changedWithoutAnchor = false,
): SourceStatus {
  const original = { file: ref.file, startLine: ref.startLine, endLine: ref.endLine };
  if (!Number.isSafeInteger(ref.startLine) || !Number.isSafeInteger(ref.endLine)
    || ref.startLine < 1 || ref.endLine < ref.startLine) {
    return { ...original, state: 'out-of-range', message: '来源行号无效，需要更新地图。' };
  }
  const lines = normalize(text).split('\n');
  const rangeExists = ref.endLine <= lines.length;
  if (ref.anchorText === undefined) {
    if (changedWithoutAnchor) {
      return { ...original, state: 'stale', message: '文件已变更，且没有文本锚点；请让 AI 更新地图后再精确定位。' };
    }
    if (!rangeExists) {
      return { ...original, state: 'out-of-range', message: `来源为第 ${ref.startLine}–${ref.endLine} 行，当前文件只有 ${lines.length} 行。` };
    }
    return { ...original, state: 'range-only', message: '仅按行号定位，未提供文本锚点。' };
  }
  const anchor = normalize(ref.anchorText);
  const anchorLines = anchor.split('\n');
  if (anchorLines.length !== ref.endLine - ref.startLine + 1) {
    return { ...original, state: 'stale', message: '文本锚点的行数与声明范围不同，请让 AI 更新地图。' };
  }
  if (rangeExists && lines.slice(ref.startLine - 1, ref.endLine).join('\n') === anchor) {
    return { ...original, state: 'matched' };
  }
  const matches = lineMatches(lines, anchorLines);
  if (matches.length === 1) {
    const startLine = matches[0]! + 1;
    return {
      ...original,
      startLine,
      endLine: startLine + anchorLines.length - 1,
      state: 'relocated',
      message: '位置已恢复，内容需 AI 复核。',
    };
  }
  return {
    ...original,
    state: 'stale',
    message: matches.length > 1
      ? '文本锚点存在多个完整匹配，无法确定原位置；请让 AI 更新地图。'
      : '文本锚点已改变或不存在；请让 AI 更新地图。',
  };
}
