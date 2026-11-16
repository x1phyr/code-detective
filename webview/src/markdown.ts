/**
 * 安全的轻量 Markdown 与 `file:line` 可点击源码引用渲染器。
 *
 * - 先对所有输入做严格 HTML 转义，杜绝 XSS；
 * - 支持代码块、行内代码、加粗、无序/有序列表与段落；
 * - 将 `src/foo.ts:12` 或 `src/foo.ts:12-20` 渲染为带 `data-cite-file` 属性的按钮，点击即跳转编辑器源码。
 */

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const CITE_PATTERN = /^([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8}):(\d{1,6})(?:[-–](\d{1,6}))?$/;

function renderCiteOrCode(rawCode: string): string {
  const trimmed = rawCode.trim();
  const match = CITE_PATTERN.exec(trimmed);
  if (match && !trimmed.startsWith('/') && !trimmed.includes('..')) {
    const file = escapeHtml(match[1]!);
    const start = match[2]!;
    const end = match[3] ?? start;
    const label = `${escapeHtml(match[1]!.split('/').pop() ?? match[1]!)}:${start}${match[3] ? `–${end}` : ''}`;
    return `<button type="button" class="cd-cite" data-cite-file="${file}" data-cite-start="${start}" data-cite-end="${end}" title="${file}:${start}${match[3] ? `-${end}` : ''}"><span class="codicon codicon-go-to-file" aria-hidden="true"></span>${label}</button>`;
  }
  return `<code>${escapeHtml(rawCode)}</code>`;
}

function renderInline(line: string): string {
  // Split by inline backticks first so code spans are not mangled by bold/bare-cite rules
  const parts = line.split(/(`[^`]+`)/g);
  return parts.map(part => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return renderCiteOrCode(part.slice(1, -1));
    }
    let escaped = escapeHtml(part);
    // Bold **text**
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Bare file:line references in prose
    escaped = escaped.replace(
      /(^|[\s(（])([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8}):(\d{1,6})(?:[-–](\d{1,6}))?(?=$|[\s)），。；,.;!?！？])/g,
      (_full, prefix: string, file: string, start: string, end?: string) => {
        if (file.startsWith('/') || file.includes('..')) return _full;
        const short = file.split('/').pop() ?? file;
        const rangeEnd = end ?? start;
        return `${prefix}<button type="button" class="cd-cite" data-cite-file="${file}" data-cite-start="${start}" data-cite-end="${rangeEnd}" title="${file}:${start}${end ? `-${end}` : ''}"><span class="codicon codicon-go-to-file" aria-hidden="true"></span>${short}:${start}${end ? `–${end}` : ''}</button>`;
      },
    );
    return escaped;
  }).join('');
}

export function renderMentorMarkdown(input: string | undefined): string {
  if (!input || !input.trim()) return '';
  const normalized = input.replace(/\r\n?/g, '\n');
  const blocks: string[] = [];
  const lines = normalized.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(`<pre class="cd-md-pre"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(`<li>${renderInline(lines[i]!.replace(/^\s*[-*]\s+/, ''))}</li>`);
        i += 1;
      }
      blocks.push(`<ul class="cd-md-list">${items.join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        items.push(`<li>${renderInline(lines[i]!.replace(/^\s*\d+\.\s+/, ''))}</li>`);
        i += 1;
      }
      blocks.push(`<ol class="cd-md-list">${items.join('')}</ol>`);
      continue;
    }

    // Normal paragraph
    const para: string[] = [];
    while (
      i < lines.length
      && lines[i]!.trim().length > 0
      && !lines[i]!.trimStart().startsWith('```')
      && !/^\s*[-*]\s+/.test(lines[i]!)
      && !/^\s*\d+\.\s+/.test(lines[i]!)
    ) {
      para.push(renderInline(lines[i]!));
      i += 1;
    }
    blocks.push(`<p class="cd-md-p">${para.join('<br>')}</p>`);
  }

  return blocks.join('');
}

/** Event delegation helper for `.cd-cite` buttons inside `v-html` containers. */
export function extractCitationClick(
  event: MouseEvent,
): { file: string; startLine: number; endLine: number } | undefined {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-cite-file]');
  if (!target) return undefined;
  const file = target.dataset.citeFile;
  const startLine = Number(target.dataset.citeStart);
  const endLine = Number(target.dataset.citeEnd || target.dataset.citeStart);
  if (!file || !Number.isInteger(startLine) || startLine < 1) return undefined;
  return { file, startLine, endLine: Number.isInteger(endLine) && endLine >= startLine ? endLine : startLine };
}
