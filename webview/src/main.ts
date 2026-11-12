import { createApp } from 'vue';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vscode/codicons/dist/codicon.css';
import './styles.css';
import App from './App.vue';
import { createHost, hasVsCodeApi, type HostBridge } from './host';

async function mount(): Promise<void> {
  const host: HostBridge = await createHost();
  const app = createApp(App, { host });
  // 只有 `npm run dev` 的浏览器预览才需要工作台外壳，打包产物里会被移除。
  if (!hasVsCodeApi() && import.meta.env.DEV) {
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('缺少 #app 根节点。');
    const { createPreviewShell } = await import('./preview-shell');
    app.mount(createPreviewShell(root, host).mount);
    return;
  }
  app.mount('#app');
}

void mount();
