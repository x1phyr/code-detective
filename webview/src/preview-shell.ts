import type { HostMessage, MapSnapshot } from '../../shared/types';
import type { HostBridge } from './bridge';
import { demoSourceText } from './preview-data';
import { THEME_LABELS, currentPreviewTheme } from './preview-theme';
import './preview-shell.css';

interface SourceView {
  file: string;
  startLine: number;
  endLine: number;
}

const ACTIVITY_ITEMS = [
  { icon: 'files', title: '资源管理器', active: true },
  { icon: 'search', title: '搜索' },
  { icon: 'source-control', title: '源代码管理' },
  { icon: 'debug-alt', title: '运行和调试' },
  { icon: 'extensions', title: '扩展' },
];

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function shellHtml(): string {
  const activity = ACTIVITY_ITEMS.map(item => `
        <button class="vs-activity-item${item.active ? ' active' : ''}" title="${escapeHtml(item.title)}" aria-label="${escapeHtml(item.title)}">
          <span class="codicon codicon-${item.icon}" aria-hidden="true"></span>
        </button>`).join('');
  return `
  <div class="vs-workbench">
    <nav class="vs-activitybar" aria-label="活动栏">
      <div class="vs-activity-list">${activity}</div>
      <div class="vs-activity-list vs-activity-bottom">
        <button class="vs-activity-item" title="帐户" aria-label="帐户">
          <span class="codicon codicon-account" aria-hidden="true"></span>
        </button>
        <button class="vs-activity-item" title="管理" aria-label="管理">
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
          <span class="codicon codicon-map" aria-hidden="true"></span>
          <span>examples/bag-demo</span>
        </div>
        <div class="vs-titlebar-right">
          <button class="vs-title-button" title="切换预览主题" data-action="theme">
            <span class="codicon codicon-color-mode" aria-hidden="true"></span>
          </button>
          <button class="vs-title-button" title="拆分编辑器">
            <span class="codicon codicon-split-horizontal" aria-hidden="true"></span>
          </button>
        </div>
      </header>

      <div class="vs-editors">
        <section class="vs-group vs-group-map">
          <div class="vs-tabs">
            <div class="vs-tab active">
              <span class="codicon codicon-map" aria-hidden="true"></span>
              <span class="vs-tab-label" data-role="map-tab">代码侦探</span>
              <span class="codicon codicon-close vs-tab-close" aria-hidden="true"></span>
            </div>
            <div class="vs-tabs-actions">
              <span class="codicon codicon-split-horizontal" aria-hidden="true"></span>
              <span class="codicon codicon-ellipsis" aria-hidden="true"></span>
            </div>
          </div>
          <div class="vs-breadcrumbs">
            <span>examples</span><span class="vs-sep">›</span>
            <span>bag-demo</span><span class="vs-sep">›</span>
            <span class="vs-crumb-current">代码侦探</span>
          </div>
          <div class="vs-map-slot" data-role="map-slot"></div>
        </section>

        <section class="vs-group vs-group-source">
          <div class="vs-tabs">
            <div class="vs-tab active">
              <span class="codicon codicon-file-code" aria-hidden="true"></span>
              <span class="vs-tab-label" data-role="source-tab-label">选择源码</span>
              <span class="codicon codicon-close vs-tab-close" aria-hidden="true"></span>
            </div>
            <div class="vs-tabs-actions">
              <span class="codicon codicon-split-horizontal" aria-hidden="true"></span>
              <span class="codicon codicon-ellipsis" aria-hidden="true"></span>
            </div>
          </div>
          <div class="vs-breadcrumbs" data-role="source-breadcrumbs"></div>
          <div class="vs-code" data-role="source-code" tabindex="0">
            <p class="vs-code-empty">点击地图中的节点或源码条目，这里会显示对应的源码。</p>
          </div>
        </section>
      </div>

      <footer class="vs-statusbar">
        <div class="vs-statusbar-left">
          <span class="vs-status-item">
            <span class="codicon codicon-remote" aria-hidden="true"></span>
            浏览器预览
          </span>
          <span class="vs-status-item" data-role="status-file"></span>
        </div>
        <div class="vs-statusbar-right">
          <span class="vs-status-item" data-role="status-lines"></span>
          <span class="vs-status-item">UTF-8</span>
          <span class="vs-status-item">TypeScript</span>
          <button class="vs-status-item vs-status-button" data-action="theme" title="切换预览主题">
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
  const id = snapshot.ui.sourceId
    ?? (snapshot.ui.selection
      ? snapshot.map.nodes.find(node => node.id === snapshot.ui.selection!.id)?.sourceIds[0]
      : undefined);
  if (!id) return undefined;
  const ref = snapshot.map.sources[id];
  if (!ref) return undefined;
  const status = snapshot.statuses[id];
  return {
    file: status?.file ?? ref.file,
    startLine: status?.startLine ?? ref.startLine,
    endLine: status?.endLine ?? ref.endLine,
  };
}

function renderCode(container: HTMLElement, view: SourceView | undefined): void {
  if (!view) {
    container.innerHTML = '<p class="vs-code-empty">点击地图中的节点或源码条目，这里会显示对应的源码。</p>';
    return;
  }
  const text = demoSourceText[view.file] ?? '';
  const fragment = document.createDocumentFragment();
  text.split('\n').forEach((line, index) => {
    const number = index + 1;
    const row = document.createElement('div');
    row.className = number >= view.startLine && number <= view.endLine ? 'vs-code-line active' : 'vs-code-line';
    const gutter = document.createElement('span');
    gutter.className = 'vs-code-number';
    gutter.textContent = String(number);
    const content = document.createElement('span');
    content.className = 'vs-code-text';
    content.textContent = line.length > 0 ? line : '\u00a0';
    row.append(gutter, content);
    fragment.append(row);
  });
  container.replaceChildren(fragment);
  container.scrollTop = Math.max(0, (view.startLine - 3) * 19);
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
  /** 地图 Webview 的挂载点。 */
  mount: HTMLElement;
}

/**
 * 在浏览器预览里重建 VS Code 工作台外壳，让 Webview 处在和真实插件
 * 相同的编辑器区域中，而不是孤零零地铺满整个页面。
 */
export function createPreviewShell(root: HTMLElement, host: HostBridge): PreviewShell {
  root.innerHTML = shellHtml();
  const query = (selector: string): HTMLElement | null => root.querySelector<HTMLElement>(selector);
  const mount = query('[data-role="map-slot"]');
  if (!mount) throw new Error('预览外壳缺少地图挂载点。');

  const code = query('[data-role="source-code"]');
  const statusFile = query('[data-role="status-file"]');
  const statusLines = query('[data-role="status-lines"]');
  const statusTheme = query('[data-role="status-theme"]');
  const sourceTabLabel = query('[data-role="source-tab-label"]');
  const sourceBreadcrumbs = query('[data-role="source-breadcrumbs"]');
  const mapTabLabel = query('[data-role="map-tab"]');

  root.querySelectorAll<HTMLElement>('[data-action="theme"]').forEach(button => {
    button.addEventListener('click', () => host.post('preview.theme', {}));
  });

  const applySnapshot = (snapshot: MapSnapshot | undefined): void => {
    if (snapshot) {
      if (mapTabLabel) mapTabLabel.textContent = snapshot.map.title;
      document.title = `${snapshot.map.title} · 代码侦探`;
    }
    const view = sourceView(snapshot);
    if (code) renderCode(code, view);
    renderBreadcrumbs(sourceBreadcrumbs, view?.file);
    if (sourceTabLabel) sourceTabLabel.textContent = view?.file.split('/').pop() ?? '选择源码';
    if (statusFile) statusFile.textContent = view ? view.file : '';
    if (statusLines) statusLines.textContent = view ? `行 ${view.startLine}–${view.endLine}` : '';
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
