import { createApp } from 'vue';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vscode/codicons/dist/codicon.css';
import './styles.css';
import App from './App.vue';
import { createHost, hasVsCodeApi, type HostBridge } from './host';
import { resolveLocale, setLocale, t } from '../../shared/i18n';

// 宿主把 VS Code 显示语言写在 <html lang>；浏览器预览则跟随浏览器语言（可用 ?lang=en 覆盖）。
setLocale(resolveLocale(
  new URLSearchParams(location.search).get('lang')
    ?? (hasVsCodeApi() ? document.documentElement.lang : navigator.language),
));

async function mount(): Promise<void> {
  const host: HostBridge = await createHost();
  const app = createApp(App, { host });
  // 只有 `npm run dev` 的浏览器预览才需要工作台外壳，打包产物里会被移除。
  if (!hasVsCodeApi() && import.meta.env.DEV) {
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error(t('webview.missingAppRoot'));
    const { createPreviewShell } = await import('./preview-shell');
    app.mount(createPreviewShell(root, host).mount);
    return;
  }
  app.mount('#app');
}

void mount();
