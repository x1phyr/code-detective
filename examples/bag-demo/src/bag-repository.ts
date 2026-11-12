import type { BagItem } from './types';

const cache = new Map<string, BagItem[]>();

export async function loadBag(): Promise<BagItem[]> {
  const cached = cache.get('bag');
  if (cached) return cached;
  const response = await fetch('/api/bag');
  const items = (await response.json()) as BagItem[];
  cache.set('bag', items);
  return items;
}

export async function loadFallback(): Promise<BagItem[]> {
  return [];
}

export function invalidate(): void {
  cache.delete('bag');
}
