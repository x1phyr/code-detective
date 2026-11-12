import type { HostMessage } from '../../shared/types';
import { envelope, type HostBridge } from './bridge';
import { createVsCodeHost, hasVsCodeApi } from './vscode-host';

/**
 * 浏览器预览适配器只在 `npm run dev` 下加载；生产构建会把这整段剔除，
 * 因此预览数据不会进入 VSIX。
 */
export async function createHost(): Promise<HostBridge> {
  if (hasVsCodeApi()) return createVsCodeHost();
  if (import.meta.env.DEV) {
    const { createPreviewHost } = await import('./preview');
    return createPreviewHost();
  }
  throw new Error('缺少 VS Code Webview API。');
}

export { envelope, hasVsCodeApi };
export type { HostBridge, HostMessage };
