import type { HostMessage, MapSnapshot } from '../../shared/types';
import { planFocusHighlight, type CallTokenSpan, type FocusHighlightPlan } from '../../src/core/calls';
import { activeFocusSelection, sourceIdsForSelection } from '../../src/core/selection';
import { splitLines } from '../../src/core/text';
import type { HostBridge } from './bridge';
import { PREVIEW_BUNDLES } from './preview-data';
import { THEME_LABELS, currentPreviewTheme } from './preview-theme';
import { t } from '../../shared/i18n';
import './preview-shell.css';

interface SourceView {
  key: string;
  file: string;
  startLine: number;
  endLine: number;
  note?: string;
  highlightEnabled: boolean;
  plan?: FocusHighlightPlan;
}

const activityItems = (): { icon: string; title: string; active?: boolean }[] => [
  { icon: 'compass', title: t('webview.shellAppName'), active: true },
  { icon: 'files', title: t('webview.shellExplorer') },
  { icon: 'search', title: t('webview.shellSearch') },
  { icon: 'source-control', title: t('webview.shellSourceControl') },
  { icon: 'extensions', title: t('webview.shellExtensions') },
];

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function shellHtml(): string {
  const activity = activityItems().map(item => `
        <button class="vs-activity-item${item.active ? ' active' : ''}" title="${escapeHtml(item.title)}" aria-label="${escapeHtml(item.title)}">
          <span class="codicon codicon-${item.icon}" aria-hidden="true"></span>
        </button>`).join('');
  return `
  <div class="vs-workbench">
    <nav class="vs-activitybar" aria-label="${escapeHtml(t('webview.shellActivityBar'))}">
      <div class="vs-activity-list">${activity}</div>
      <div class="vs-activity-list vs-activity-bottom">
        <button class="vs-activity-item" title="${escapeHtml(t('webview.shellAccounts'))}" aria-label="${escapeHtml(t('webview.shellAccounts'))}">
          <span class="codicon codicon-account" aria-hidden="true"></span>
        </button>
        <button class="vs-activity-item" title="${escapeHtml(t('webview.shellManage'))}" aria-label="${escapeHtml(t('webview.shellManage'))}">
          <span class="codicon codicon-settings-gear" aria-hidden="true"></span>
        </button>
      </div>
    </nav>
    <div class="vs-main">
      <header class="vs-titlebar">
        <div class="vs-titlebar-left">
          <span class="vs-light close"></span>
          <span class="vs-light minimize"></span>
          <span class="vs-light maximize"></span>
        </div>
        <div class="vs-commandcenter">
          <span class="codicon codicon-compass" aria-hidden="true"></span>
          <span data-role="workspace-title">examples/login-demo</span>
        </div>
        <div class="vs-titlebar-right">
          <button class="vs-title-button" title="${escapeHtml(t('webview.shellToggleTheme'))}" data-action="theme">
            <span class="codicon codicon-color-mode" aria-hidden="true"></span>
          </button>
          <button class="vs-title-button" title="${escapeHtml(t('webview.shellSplitEditor'))}">
            <span class="codicon codicon-split-horizontal" aria-hidden="true"></span>
          </button>
        </div>
      </header>

      <div class="vs-editors">
        <section class="vs-group vs-group-map">
          <div class="vs-tabs">
            <div class="vs-tab active">
              <span class="codicon codicon-compass" aria-hidden="true"></span>
              <span class="vs-tab-label" data-role="map-tab">${escapeHtml(t('webview.shellAppName'))}</span>
            </div>
          </div>
          <div class="vs-map-slot" data-role="map-slot"></div>
        </section>

        <section class="vs-group vs-group-source">
          <div class="vs-tabs">
            <div class="vs-tab active">
              <span class="codicon codicon-file-code" aria-hidden="true"></span>
              <span class="vs-tab-label" data-role="source-tab-label">${escapeHtml(t('webview.shellPickSource'))}</span>
              <span class="codicon codicon-close vs-tab-close" aria-hidden="true"></span>
            </div>
            <div class="vs-tabs-actions">
              <span class="codicon codicon-split-horizontal" aria-hidden="true"></span>
              <span class="codicon codicon-ellipsis" aria-hidden="true"></span>
            </div>
          </div>
          <div class="vs-breadcrumbs" data-role="source-breadcrumbs"></div>
          <div class="vs-code" data-role="source-code" tabindex="0">
            <p class="vs-code-empty">${escapeHtml(t('webview.shellCodeEmpty'))}</p>
          </div>
        </section>
      </div>

      <footer class="vs-statusbar">
        <div class="vs-statusbar-left">
          <span class="vs-status-item">
            <span class="codicon codicon-remote" aria-hidden="true"></span>
            ${escapeHtml(t('webview.shellBrowserPreview'))}
          </span>
          <span class="vs-status-item" data-role="status-file"></span>
        </div>
        <div class="vs-statusbar-right">
          <span class="vs-status-item" data-role="status-lines"></span>
          <span class="vs-status-item">UTF-8</span>
          <span class="vs-status-item">TypeScript</span>
          <button class="vs-status-item vs-status-button" data-action="theme" title="${escapeHtml(t('webview.shellToggleTheme'))}">
            <span class="codicon codicon-color-mode" aria-hidden="true"></span>
            <span data-role="status-theme">${THEME_LABELS[currentPreviewTheme()]}</span>
          </button>
        </div>
      </footer>
    </div>
  </div>`;
}

function sourceView(snapshot: MapSnapshot | undefined): SourceView | undefined {
  if (!snapshot) return undefined;
  const focus = activeFocusSelection(snapshot.map, snapshot.ui);
  const focusSourceIds = focus ? sourceIdsForSelection(snapshot.map, focus) : [];
  const id = snapshot.ui.sourceId && snapshot.map.sources[snapshot.ui.sourceId]
    ? snapshot.ui.sourceId
    : focusSourceIds[0];
  if (!id) return undefined;
  const ref = snapshot.map.sources[id];
  if (!ref) return undefined;
  const status = snapshot.statuses[id];
  const file = status?.file ?? ref.file;
  const startLine = status?.startLine ?? ref.startLine;
  const endLine = status?.endLine ?? ref.endLine;
  const fileLines = splitLines(sourceTextFor(snapshot.key, file));
  const slice = startLine >= 1 && endLine >= startLine
    ? fileLines.slice(startLine - 1, endLine)
    : [];
  const plan = slice.length > 0
    ? planFocusHighlight({
      startLine,
      lines: slice,
      map: snapshot.map,
      sourceId: id,
      focus,
    })
    : undefined;
  return {
    key: snapshot.key,
    file,
    startLine,
    endLine,
    note: ref.note,
    highlightEnabled: snapshot.ui.highlightEnabled,
    plan,
  };
}

function sourceTextFor(key: string, file: string): string {
  const bundle = PREVIEW_BUNDLES.find(item => item.key === key);
  return bundle?.sources[file] ?? '';
}

function appendLineContent(container: HTMLElement, line: string, tokens: readonly CallTokenSpan[]): void {
  if (line.length === 0) {
    container.textContent = '\u00a0';
    return;
  }
  if (tokens.length === 0) {
    container.textContent = line;
    return;
  }
  const sorted = [...tokens].sort((a, b) => a.startCol - b.startCol);
  let cursor = 0;
  for (const token of sorted) {
    const start = Math.max(cursor, Math.min(token.startCol, line.length));
    const end = Math.max(start, Math.min(token.endCol, line.length));
    if (end <= start) continue;
    if (start > cursor) {
      container.append(document.createTextNode(line.slice(cursor, start)));
    }
    const mark = document.createElement('mark');
    mark.className = 'vs-code-call';
    mark.textContent = line.slice(start, end);
    container.append(mark);
    cursor = end;
  }
  if (cursor < line.length) {
    container.append(document.createTextNode(line.slice(cursor)));
  }
}

function renderCode(container: HTMLElement, view: SourceView | undefined, host: HostBridge): void {
  if (!view) {
    container.innerHTML = `<p class="vs-code-empty">${escapeHtml(t('webview.shellCodeEmpty'))}</p>`;
    return;
  }
  const text = sourceTextFor(view.key, view.file);
  const plan = view.highlightEnabled ? view.plan : undefined;
  const tokensByLine = new Map<number, CallTokenSpan[]>();
  if (plan) {
    for (const token of plan.callTokens) {
      const list = tokensByLine.get(token.line) ?? [];
      list.push(token);
      tokensByLine.set(token.line, list);
    }
  }
  const fragment = document.createDocumentFragment();
  splitLines(text).forEach((line, index) => {
    const number = index + 1;
    const isActive = plan
      ? plan.spotlightLines.some(span => number >= span.startLine && number <= span.endLine)
      : view.highlightEnabled && number >= view.startLine && number <= view.endLine;
    const isScope = !isActive && Boolean(plan?.scopeLines && number >= plan.scopeLines.startLine && number <= plan.scopeLines.endLine);
    const row = document.createElement('div');
    row.className = isActive ? 'vs-code-line active' : isScope ? 'vs-code-line scope' : 'vs-code-line';
    row.addEventListener('click', () => {
      host.post('preview.cursor', { file: view.file, line: number });
    });
    const gutter = document.createElement('span');
    gutter.className = 'vs-code-number';
    gutter.textContent = String(number);
    const content = document.createElement('span');
    content.className = 'vs-code-text';
    appendLineContent(content, line, isActive ? (tokensByLine.get(number) ?? []) : []);
    row.append(gutter, content);
    const noteLine = plan?.noteLine ?? view.startLine;
    if (isActive && number === noteLine && view.note) {
      const note = document.createElement('span');
      note.className = 'vs-code-note';
      note.textContent = `  ← ${view.note}`;
      row.append(note);
    }
    fragment.append(row);
  });
  container.replaceChildren(fragment);
  const scrollTarget = plan?.noteLine ?? view.startLine;
  container.scrollTop = Math.max(0, (scrollTarget - 3) * 19);
}

function renderBreadcrumbs(container: HTMLElement | null, file: string | undefined): void {
  if (!container) return;
  if (!file) {
    container.replaceChildren();
    return;
  }
  const parts = file.split('/');
  container.innerHTML = parts
    .map((part, index) => index === parts.length - 1
      ? `<span class="vs-crumb-current">${escapeHtml(part)}</span>`
      : `<span>${escapeHtml(part)}</span>`)
    .join('<span class="vs-sep">›</span>');
}

export interface PreviewShell {
  mount: HTMLElement;
}

export function createPreviewShell(root: HTMLElement, host: HostBridge): PreviewShell {
  root.innerHTML = shellHtml();
  const query = (selector: string): HTMLElement | null => root.querySelector<HTMLElement>(selector);
  const mount = query('[data-role="map-slot"]');
  if (!mount) throw new Error(t('webview.shellMountMissing'));

  const code = query('[data-role="source-code"]');
  const statusFile = query('[data-role="status-file"]');
  const statusLines = query('[data-role="status-lines"]');
  const statusTheme = query('[data-role="status-theme"]');
  const sourceTabLabel = query('[data-role="source-tab-label"]');
  const sourceBreadcrumbs = query('[data-role="source-breadcrumbs"]');
  const mapTabLabel = query('[data-role="map-tab"]');
  const workspaceTitle = query('[data-role="workspace-title"]');

  root.querySelectorAll<HTMLElement>('[data-action="theme"]').forEach(button => {
    button.addEventListener('click', () => host.post('preview.theme', {}));
  });

  const applySnapshot = (snapshot: MapSnapshot | undefined): void => {
    if (snapshot) {
      if (mapTabLabel) mapTabLabel.textContent = `${t('webview.shellAppName')} · ${snapshot.map.title}`;
      if (workspaceTitle) workspaceTitle.textContent = `examples/${snapshot.map.id}`;
      document.title = t('webview.shellDocTitle', { title: snapshot.map.title });
    }
    const view = sourceView(snapshot);
    if (code) renderCode(code, view, host);
    renderBreadcrumbs(sourceBreadcrumbs, view?.file);
    if (sourceTabLabel) sourceTabLabel.textContent = view?.file.split('/').pop() ?? t('webview.shellPickSource');
    if (statusFile) statusFile.textContent = view ? view.file : '';
    if (statusLines) statusLines.textContent = view ? t('webview.shellLines', { start: view.startLine, end: view.endLine }) : '';
  };

  host.onMessage((message: HostMessage) => {
    if (message.type === 'theme') {
      if (statusTheme) {
        statusTheme.textContent = THEME_LABELS[message.payload.kind as keyof typeof THEME_LABELS]
          ?? message.payload.kind;
      }
      return;
    }
    if (message.type === 'initialize') {
      applySnapshot(message.payload.current);
      return;
    }
    if (message.type === 'snapshot') applySnapshot(message.payload.snapshot);
  });

  return { mount };
}
