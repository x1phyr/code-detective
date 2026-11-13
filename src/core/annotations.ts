import type { CodeMap, Selection } from '../../shared/types';
import { t } from '../../shared/i18n';

/** End-of-line text is kept short so it never pushes the code off-screen. */
export const INLINE_NOTE_MAX = 60;

export interface SourceAnnotation {
  /** Short gray text shown at the end of the first highlighted line. */
  inline: string;
  /** Markdown shown when hovering the highlighted range. */
  hover: string;
}

function clip(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

/** Escapes Markdown so map text can't inject links or formatting into the hover. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');
}

/**
 * Builds the inline note and hover for one highlighted source.
 *
 * Prefers the source's own `note`. Older maps have no notes, so it falls back
 * to whichever node / edge of the current selection owns the source, using its
 * label and description. The hover also names the walkthrough step, if any.
 */
export function annotateSource(map: CodeMap, sourceId: string, selection?: Selection): SourceAnnotation | undefined {
  const source = Object.hasOwn(map.sources, sourceId) ? map.sources[sourceId] : undefined;
  if (!source) return undefined;

  const step = selection?.kind === 'step' ? map.walkthrough?.find(item => item.id === selection.id) : undefined;
  const nodeIds = selection?.kind === 'node' ? [selection.id] : step?.nodeIds ?? [];
  const edgeIds = selection?.kind === 'edge' ? [selection.id] : step?.edgeIds ?? [];
  const owner = map.nodes.find(node => nodeIds.includes(node.id) && node.sourceIds.includes(sourceId))
    ?? map.edges.find(edge => edgeIds.includes(edge.id) && edge.sourceIds.includes(sourceId));
  const ownerLabel = owner ? ('label' in owner && owner.label ? owner.label : '') : '';
  const ownerText = owner?.description?.trim() ?? '';

  const note = source.note?.trim();
  const inlineText = note || [ownerLabel, ownerText].filter(Boolean).join(' · ');
  if (!inlineText) return undefined;

  const stepIndex = step && map.walkthrough ? map.walkthrough.indexOf(step) : -1;
  const heading = step
    ? `**${t('core.annotationStepHeading', { index: stepIndex + 1, total: map.walkthrough!.length, title: escapeMarkdown(step.title) })}**`
    : ownerLabel ? `**${escapeMarkdown(ownerLabel)}**` : `**${t('core.annotationDefaultHeading')}**`;
  const body = [note, ownerText, step?.description?.trim()]
    .filter((text, index, all): text is string => Boolean(text) && all.indexOf(text) === index)
    .map(escapeMarkdown);
  const location = `\`${source.file.replace(/`/g, '')}:${source.startLine}-${source.endLine}\``;

  return {
    inline: clip(inlineText, INLINE_NOTE_MAX),
    hover: [heading, ...body, location].join('\n\n'),
  };
}
