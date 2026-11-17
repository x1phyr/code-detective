import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCallCandidates,
  extractSnippetSymbol,
  inferEnclosingSymbol,
  maskCodeLines,
  planFocusHighlight,
} from '../src/core/calls';
import type { CodeMap } from '../shared/types';

test('extractCallCandidates 识别普通调用、成员/可选链调用和 TS 泛型调用', () => {
  const lines = [
    '  await refreshList();',
    '  const cached = tokenCache.get(username);',
    '  panel?.remove();',
    '  const el = container.querySelector<HTMLElement>(".item");',
  ];
  const calls = extractCallCandidates(lines, 10);
  assert.deepEqual(
    calls.map(c => ({ line: c.line, callee: c.callee, text: lines[c.line - 10]!.slice(c.startCol, c.endCol) })),
    [
      { line: 10, callee: 'refreshList', text: 'refreshList' },
      { line: 11, callee: 'get', text: 'tokenCache.get' },
      { line: 12, callee: 'remove', text: 'panel?.remove' },
      { line: 13, callee: 'querySelector', text: 'container.querySelector' },
    ],
  );
});

test('maskCodeLines 屏蔽字符串、模板静态文本与注释，保留模板插值里的真实调用', () => {
  const lines = [
    '  const a = "fakeCall()"; // commentCall()',
    '  /* blockCall()',
    '     stillComment() */',
    '  # pythonComment()',
    '  const s = `prefix fakeTpl() ${realTpl(item.id)} suffix`;',
    '  this.#privateCall();',
  ];
  const masked = maskCodeLines(lines);
  assert.equal(masked.length, lines.length);
  lines.forEach((line, i) => assert.equal(masked[i]!.length, line.length));

  const calls = extractCallCandidates(lines, 1);
  assert.deepEqual(
    calls.map(c => ({ line: c.line, callee: c.callee })),
    [
      { line: 5, callee: 'realTpl' },
      { line: 6, callee: 'privateCall' },
    ],
  );
});

test('extractCallCandidates 排除多语言函数声明与控制关键字，但保留 .catch/.delete 方法调用', () => {
  const lines = [
    'export async function openBagPanel(): Promise<void> {',
    '  if (checkReady()) {',
    '    for (const x of listItems()) {',
    '      while (hasMore()) {',
    '        switch (getKind()) {',
    '          try { await runJob().catch(onErr); } catch (err) { logErr(err); }',
    '        }',
    '      }',
    '    }',
    '  }',
    '  cache.delete("bag");',
    '}',
    'class Demo {',
    '  async login(u: User): Promise<void> {',
    '    doAuth(u);',
    '  }',
    '  render() {',
    '    drawView();',
    '  }',
    '}',
    'def pyFn(a):',
    'fn rsFn(a)',
    'func goFn(a) {',
  ];
  const calls = extractCallCandidates(lines, 1);
  assert.deepEqual(
    calls.map(c => c.callee),
    ['checkReady', 'listItems', 'hasMore', 'getKind', 'runJob', 'catch', 'logErr', 'delete', 'doAuth', 'drawView'],
  );
});

test('planFocusHighlight 对整段函数来源只高亮指向下游步骤的关键调用，外层留范围框', () => {
  const map: CodeMap = {
    schemaVersion: 1,
    id: 'demo',
    title: 'Demo',
    sources: {
      'panel.open': { file: 'src/bag-panel.ts', startLine: 6, endLine: 11, note: '打开面板后刷新列表' },
      'panel.refresh': { file: 'src/bag-panel.ts', startLine: 17, endLine: 21 },
    },
    nodes: [
      { id: 'openBagPanel', label: '初始化面板 (openBagPanel)', sourceIds: ['panel.open'] },
      { id: 'refreshList', label: '刷新列表 (refreshList)', sourceIds: ['panel.refresh'] },
    ],
    edges: [
      { id: 'e.open-refresh', from: 'openBagPanel', to: 'refreshList', label: 'await', sourceIds: ['panel.open'] },
    ],
    walkthrough: [
      { id: 'w.open', title: '打开面板', nodeIds: ['openBagPanel'], edgeIds: ['e.open-refresh'], sourceId: 'panel.open' },
    ],
  };

  const lines = [
    'export async function openBagPanel(): Promise<void> {',
    "  panel = document.createElement('div');",
    "  panel.className = 'bag-panel';",
    '  await ensureAssets();',
    '  await refreshList();',
    '}',
  ];

  const plan = planFocusHighlight({
    startLine: 6,
    lines,
    map,
    sourceId: 'panel.open',
    focus: { kind: 'step', id: 'w.open' },
  });

  assert.deepEqual(plan.spotlightLines, [{ startLine: 10, endLine: 10 }]);
  assert.deepEqual(plan.scopeLines, { startLine: 6, endLine: 11 });
  assert.equal(plan.noteLine, 10);
  assert.deepEqual(plan.callTokens.map(t => ({ line: t.line, callee: t.callee })), [
    { line: 10, callee: 'refreshList' },
  ]);
});

test('planFocusHighlight 完整保留跨多行的关键函数调用范围', () => {
  const lines = [
    'async function requestToken(username: string, password: string): Promise<string | { reason: string }> {',
    '  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {',
    "    const response = await fetch('/api/login', {",
    "      method: 'POST',",
    '      body: JSON.stringify({ username, password }),',
    '    });',
    "    if (response.status === 401) return { reason: 'err' };",
    '  }',
    '  return { reason: "fail" };',
    '}',
  ];

  const plan = planFocusHighlight({ startLine: 20, lines });
  assert.deepEqual(plan.spotlightLines, [{ startLine: 22, endLine: 25 }]);
  assert.deepEqual(plan.scopeLines, { startLine: 20, endLine: 29 });
  assert.equal(plan.noteLine, 22);
  assert.deepEqual(plan.callTokens.map(t => ({ line: t.line, callee: t.callee })), [
    { line: 22, callee: 'fetch' },
  ]);
});

test('planFocusHighlight 对纯守卫/状态语句保持原行范围且不误标调用', () => {
  const plan = planFocusHighlight({
    startLine: 19,
    lines: ['  if (!panel) return;'],
  });
  assert.deepEqual(plan.spotlightLines, [{ startLine: 19, endLine: 19 }]);
  assert.equal(plan.scopeLines, undefined);
  assert.deepEqual(plan.callTokens, []);
  assert.equal(plan.noteLine, 19);
});

test('inferEnclosingSymbol 与 extractSnippetSymbol 准确识别类方法与独立函数名', () => {
  const fileLines = [
    'export default class ExampleSession extends BaseSession {',
    '  onConnect(url: string, params?: { [key: string]: any }): Promise<boolean> {',
    '    return this.connectToRoom(url, params);',
    '  }',
    '  onReconnect(url: string): Promise<boolean> {',
    '    const token = this.reconnectToken;',
    '    return this.reconnectWith(url, token);',
    '  }',
    '}',
    'export const helperFlow = async (id: string) => {',
    '  return id;',
    '};',
  ];

  assert.equal(inferEnclosingSymbol(fileLines, 2, 4), 'ExampleSession.onConnect');
  assert.equal(inferEnclosingSymbol(fileLines, 5, 8), 'ExampleSession.onReconnect');
  assert.equal(inferEnclosingSymbol(fileLines, 6, 7), 'ExampleSession.onReconnect');
  assert.equal(inferEnclosingSymbol(fileLines, 10, 12), 'helperFlow');

  assert.equal(
    extractSnippetSymbol('  onReconnect(url: string): Promise<boolean> {\n    return true;\n  }'),
    'onReconnect',
  );
  assert.equal(extractSnippetSymbol('  const cached = cache.get("bag");\n  if (cached) return cached;'), undefined);
});
