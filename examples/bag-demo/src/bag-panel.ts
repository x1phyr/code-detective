import { loadBag, loadFallback } from './bag-repository';
import type { BagItem } from './types';

let panel: HTMLElement | undefined;

export async function openBagPanel(): Promise<void> {
  panel = document.createElement('div');
  panel.className = 'bag-panel';
  await ensureAssets();
  await refreshList();
}

async function ensureAssets(): Promise<void> {
  // 加载图标与背景资源
}

export async function refreshList(): Promise<void> {
  const items = await readItems();
  if (!panel) return;
  panel.replaceChildren(...items.map(item => renderItem(item)));
}

async function readItems(): Promise<BagItem[]> {
  const items = await loadBag();
  if (items.length > 0) return items;
  return loadFallback();
}

function renderItem(item: BagItem): HTMLElement {
  const element = document.createElement('span');
  element.textContent = `${item.id} × ${item.count}`;
  return element;
}

export function closeBagPanel(): void {
  panel?.remove();
  panel = undefined;
}
