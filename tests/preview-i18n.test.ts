import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CodeMap } from '../shared/types';
import { localizePreviewMap } from '../webview/src/preview-i18n';
import { parseMap } from '../src/core/validator';

const proseKeys = new Set(['title', 'description', 'label', 'note', 'variantLabel', 'branch', 'why', 'watch', 'skip', 'example', 'recap', 'exercise', 'question', 'answer']);

function checkEnglish(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (proseKeys.has(key) && typeof item === 'string') {
      assert.doesNotMatch(item, /\p{Script=Han}/u, `${key}: ${item}`);
    } else {
      checkEnglish(item);
    }
  }
}

for (const id of ['login-demo', 'bag-demo']) {
  test(`${id} 英文预览完整翻译文案，保留原始源码、标识与中文示例`, () => {
    const original = JSON.parse(readFileSync(new URL(`../examples/${id}/.code-detective/maps/${id}.json`, import.meta.url), 'utf8')) as CodeMap;
    const before = structuredClone(original);
    const en = localizePreviewMap(original, 'en');
    const zh = localizePreviewMap(original, 'zh-CN');
    checkEnglish(en);
    assert.deepEqual(original, before);
    assert.deepEqual(zh, before);
    for (const [sourceId, source] of Object.entries(original.sources)) {
      const translated = en.sources[sourceId]!;
      assert.equal(translated.file, source.file);
      assert.equal(translated.startLine, source.startLine);
      assert.equal(translated.endLine, source.endLine);
      assert.equal(translated.anchorText, source.anchorText);
    }
    for (const key of ['nodes', 'edges', 'walkthrough'] as const) {
      assert.deepEqual(en[key].map(item => item.id), original[key].map(item => item.id));
    }
    assert.doesNotThrow(() => parseMap(JSON.stringify(en)));
  });
}

test('预览翻译不会改写未知用户地图', () => {
  const original = { id: 'custom-guide', title: '我的项目' } as CodeMap;
  assert.deepEqual(localizePreviewMap(original, 'en'), original);
});
