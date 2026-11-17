import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));

test('package.json 的 %key% 在中英文 nls 中都有定义，且没有多余或残留中文', () => {
  const manifest = JSON.stringify(read('package.json'));
  const used = new Set([...manifest.matchAll(/"%([\w.]+)%"/g)].map(match => match[1]!));
  const en = read('package.nls.json') as Record<string, string>;
  const zh = read('package.nls.zh-cn.json') as Record<string, string>;
  assert.deepEqual(read('package.nls.zh.json'), zh, '通用中文回退应与简体中文保持一致');
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

test('中英文 schema 提示独立翻译，但校验约束保持一致', () => {
  const en = read('package.nls.json') as Record<string, string>;
  const zh = read('package.nls.zh-cn.json') as Record<string, string>;
  const stripCopy = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stripCopy);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key, item]) =>
      !((key === 'title' || key === 'description') && typeof item === 'string'))
      .map(([key, item]) => [key, stripCopy(item)]));
  };
  const english = read(en['schema.codeMap.url']!);
  const chinese = read(zh['schema.codeMap.url']!);
  assert.doesNotMatch(JSON.stringify(english), /\p{Script=Han}/u);
  assert.match(JSON.stringify(chinese), /\p{Script=Han}/u);
  assert.deepEqual(stripCopy(english), stripCopy(chinese));
  assert.ok(existsSync(new URL('../README.en.md', import.meta.url)));
});
