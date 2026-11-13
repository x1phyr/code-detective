import type { SourceRef, SourceStatus } from '../../shared/types';
import { t } from '../../shared/i18n';
import { normalizeLineEndings, splitLines } from './text';

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
    return { ...original, state: 'out-of-range', message: t('core.sourceLinesInvalid') };
  }
  const lines = splitLines(text);
  const rangeExists = ref.endLine <= lines.length;
  if (ref.anchorText === undefined) {
    if (changedWithoutAnchor) {
      return { ...original, state: 'stale', message: t('core.sourceChangedNoAnchor') };
    }
    if (!rangeExists) {
      return { ...original, state: 'out-of-range', message: t('core.sourceOutOfRange', { startLine: ref.startLine, endLine: ref.endLine, lineCount: lines.length }) };
    }
    return { ...original, state: 'range-only', message: t('core.sourceRangeOnly') };
  }
  const anchor = normalizeLineEndings(ref.anchorText);
  const anchorLines = anchor.split('\n');
  if (anchorLines.length !== ref.endLine - ref.startLine + 1) {
    return { ...original, state: 'stale', message: t('core.anchorLineCountMismatch') };
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
      message: t('core.sourceRelocated'),
    };
  }
  return {
    ...original,
    state: 'stale',
    message: matches.length > 1
      ? t('core.anchorAmbiguous')
      : t('core.anchorNotFound'),
  };
}
