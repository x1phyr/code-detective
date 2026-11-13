import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allMessages, getLocale, resolveLocale, setLocale, t, type MessageKey } from '../shared/i18n';

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!).sort();

test('语言标签归一到 zh-CN / en', () => {
  assert.equal(resolveLocale('zh-cn'), 'zh-CN');
  assert.equal(resolveLocale('zh-TW'), 'zh-CN');
  assert.equal(resolveLocale('en-US'), 'en');
  assert.equal(resolveLocale('ja'), 'en');
  assert.equal(resolveLocale(undefined), 'en');
});

test('每条文案两种语言都非空，且占位符一致', () => {
  for (const [key, message] of Object.entries(allMessages())) {
    assert.ok(message['zh-CN'].trim(), `${key} 缺少中文`);
    assert.ok(message.en.trim(), `${key} 缺少英文`);
    assert.deepEqual(placeholders(message.en), placeholders(message['zh-CN']), `${key} 占位符不一致`);
  }
});

test('英文文案里不残留中文', () => {
  for (const [key, message] of Object.entries(allMessages())) {
    assert.doesNotMatch(message.en, /[一-鿿]/, `${key} 的英文里有中文`);
  }
});

test('t() 按当前语言插值', () => {
  const keys = Object.keys(allMessages()) as MessageKey[];
  if (keys.length === 0) return;
  const previous = getLocale();
  try {
    setLocale('en');
    assert.equal(typeof t(keys[0]!), 'string');
  } finally {
    setLocale(previous);
  }
});
