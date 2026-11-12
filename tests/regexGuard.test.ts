import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_QUERY_LENGTH, unsafeRegex } from '../src/host/regexGuard';

test('拒绝典型的回溯爆炸正则与反向引用', () => {
  for (const pattern of ['(a+)+$', '(a|a)*', '(x+x+)+y', '(\\w+\\s?)*$', '(.*)\\1', 'a'.repeat(MAX_QUERY_LENGTH + 1)]) {
    assert.equal(unsafeRegex(pattern), true, pattern);
  }
});

test('放行常见的代码搜索正则', () => {
  for (const pattern of ['function\\s+\\w+\\(', 'export (class|function)', 'handle(Click|Tap)', '\\bonBag\\w*', '(a){2,}', 'foo\\(bar\\)+']) {
    assert.equal(unsafeRegex(pattern), false, pattern);
  }
});
