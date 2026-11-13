import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));

test('package.json 的 %key% 在中英文 nls 中都有定义，且没有多余或残留中文', () => {
  const manifest = JSON.stringify(read('package.json'));
  const used = new Set([...manifest.matchAll(/"%([\w.]+)%"/g)].map(match => match[1]!));
  const en = read('package.nls.json') as Record<string, string>;
  const zh = read('package.nls.zh-cn.json') as Record<string, string>;
  for (const key of used) {
    assert.ok(en[key], `package.nls.json 缺少 ${key}`);
    assert.ok(zh[key], `package.nls.zh-cn.json 缺少 ${key}`);
  }
  assert.deepEqual(Object.keys(en).sort(), [...used].sort(), '英文 nls 与清单引用不一致');
  assert.deepEqual(Object.keys(zh).sort(), [...used].sort(), '中文 nls 与清单引用不一致');
  for (const [key, value] of Object.entries(en)) assert.doesNotMatch(value, /[一-鿿]/, `英文 ${key} 有中文`);
  const manifestWithoutKeywords = manifest.replace(/"keywords":\[[^\]]*\]/, '');
  assert.doesNotMatch(manifestWithoutKeywords, /[一-鿿]/, 'package.json 里还有未抽取的中文');
});
