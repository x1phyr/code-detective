/**
 * 节点与连线标签的尺寸估算。
 *
 * 布局（ELK）需要在渲染前知道每个节点有多高，连线才能准确地接到节点边上；
 * 这里用 canvas 按当前字体测量文字宽度，模拟 CSS 的换行与行数截断。
 * 节点渲染时使用同样的固定高度，保证布局与画面一致。
 */
import type { MapNode } from '../../shared/types';
import { NODE_WIDTH, type Size } from './layout';

/** 与 styles.css 中 .cd-node 的尺寸保持一致。 */
export const NODE_METRICS = {
  paddingX: 10,
  paddingY: 8,
  border: 1,
  icon: 18,
  labelFont: 13,
  labelLine: 18,
  labelLines: 2,
  descFont: 11.5,
  descLine: 16,
  descLines: 2,
  descGap: 3,
  footer: 20,
  footerGap: 6,
  edgeLabelFont: 11,
  edgeLabelLine: 16,
  edgeLabelPadding: 5,
  edgeLabelMax: 160,
} as const;

let context: CanvasRenderingContext2D | null | undefined;

function fontFamily(): string {
  if (typeof document === 'undefined') return 'sans-serif';
  return getComputedStyle(document.body).fontFamily || 'sans-serif';
}

function measure(text: string, size: number, weight = 400): number {
  if (context === undefined) context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!context) return text.length * size * 0.62;
  context.font = `${weight} ${size}px ${fontFamily()}`;
  return context.measureText(text).width;
}

/** 按 CSS 的断行方式（中文逐字、英文按词）估算行数。 */
export function lineCount(text: string, width: number, size: number, weight = 400): number {
  if (!text) return 0;
  const tokens = text.match(/[⺀-￿]|[^\s⺀-￿]+|\s+/g) ?? [];
  let lines = 1;
  let used = 0;
  for (const token of tokens) {
    const w = measure(token, size, weight);
    if (/^\s+$/.test(token)) {
      used += w;
      continue;
    }
    if (used + w > width && used > 0) {
      lines += 1;
      used = w > width ? w % width : w;
      lines += Math.floor(w / width) - (w > width && w % width === 0 ? 1 : 0);
    } else {
      used += w;
    }
  }
  return lines;
}

export interface NodeShape {
  hasIcon: boolean;
  footer: boolean;
}

export function nodeShape(node: MapNode, extras: { children: number; hidden: number; expanded: boolean; sources: number; warn: boolean }): NodeShape {
  return {
    hasIcon: node.kind === 'event' || node.kind === 'condition' || node.kind === 'exit',
    footer: extras.children > 0 || extras.hidden > 0 || extras.expanded || extras.sources > 1 || extras.warn,
  };
}

export function nodeSize(node: MapNode, shape: NodeShape): Size {
  const m = NODE_METRICS;
  const inner = NODE_WIDTH - 2 * (m.paddingX + m.border);
  const labelLines = Math.min(m.labelLines, Math.max(1, lineCount(node.label, inner - (shape.hasIcon ? m.icon : 0), m.labelFont, 600)));
  const descLines = node.description ? Math.min(m.descLines, lineCount(node.description, inner, m.descFont)) : 0;
  const height = 2 * (m.paddingY + m.border)
    + labelLines * m.labelLine
    + (descLines ? m.descGap + descLines * m.descLine : 0)
    + (shape.footer ? m.footerGap + m.footer : 0);
  return { width: NODE_WIDTH, height: Math.ceil(height) };
}

export function edgeLabelSize(text: string | undefined): Size | undefined {
  if (!text) return undefined;
  const m = NODE_METRICS;
  const width = Math.min(m.edgeLabelMax, Math.ceil(measure(text, m.edgeLabelFont)) + 2 * m.edgeLabelPadding);
  return { width, height: m.edgeLabelLine };
}
