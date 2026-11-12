import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { extractJson } from '../src/ai/json';
import { buildUserPrompt, failureHint, systemPrompt, withLineNumbers, schemaSummary } from '../src/ai/prompt';
import { mapFromResponse } from '../src/ai/response';
import { OpenAiCompatibleProvider } from '../src/ai/openaiCompatible';
import { CliAgentProvider } from '../src/ai/cliAgent';
import { pickModel } from '../src/ai/modelPick';
import { freeMapName, sanitizeMapId } from '../src/ai/mapNaming';
import { autoPlan } from '../src/ai/select';
import { normalizeBaseUrl, isLoopbackHost } from '../src/ai/endpoint';
import { AiError, type AiCancel } from '../src/ai/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.join(here, '..', 'examples', 'bag-demo', '.code-detective', 'maps', 'bag-demo.json');

const never: AiCancel = {
  isCancellationRequested: false,
  onCancellationRequested() { return { dispose() {} }; },
};

function exampleJson(): string {
  return readFileSync(examplePath, 'utf8');
}

test('extractJson 处理围栏、前后缀解释与无 JSON 响应', () => {
  const body = exampleJson();
  assert.equal(extractJson(`\`\`\`json\n${body}\n\`\`\``), JSON.stringify(JSON.parse(body)));
  assert.equal(extractJson(`好的，这是地图：\n${body}\n希望对你有帮助。`), JSON.stringify(JSON.parse(body)));
  assert.equal(extractJson('没有任何对象'), undefined);
  assert.equal(extractJson('{"broken": '), undefined);
});

test('extractJson 忽略字符串里的花括号', () => {
  const text = '说明 {"note": "使用 { 和 } 组成", "values": [1, 2]} 结束';
  const json = extractJson(text);
  assert.equal(json, '{"note":"使用 { 和 } 组成","values":[1,2]}');
});

test('mapFromResponse 校验通过并保留原始出处的结构', () => {
  const map = mapFromResponse(`\`\`\`json\n${exampleJson()}\n\`\`\``);
  assert.equal(map.schemaVersion, 1);
  assert.ok(map.nodes.length > 0);
});

test('mapFromResponse 在无 JSON 或校验失败时抛出 AiError', () => {
  assert.throws(() => mapFromResponse('模型拒绝了请求'), (error: unknown) =>
    error instanceof AiError && error.code === 'AI_NO_JSON');
  assert.throws(() => mapFromResponse('{ "schemaVersion": 2 }'), (error: unknown) =>
    error instanceof Error && error.message.includes('地图校验失败'));
});

test('只允许回环地址，远程服务默认被阻止', () => {
  assert.equal(isLoopbackHost(new URL('http://127.0.0.1:11434/v1')), true);
  assert.equal(isLoopbackHost(new URL('http://localhost:1234/v1')), true);
  assert.equal(isLoopbackHost(new URL('https://api.example.com/v1')), false);

  const config = { allowRemote: false };
  assert.throws(() => normalizeBaseUrl('https://api.example.com/v1', config), (error: unknown) =>
    error instanceof AiError && error.code === 'AI_REMOTE_BLOCKED');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:11434/v1/', config), 'http://127.0.0.1:11434/v1');
  assert.equal(normalizeBaseUrl('https://api.example.com/v1/', { ...config, allowRemote: true }), 'https://api.example.com/v1');
});

test('normalizeBaseUrl 拒绝非法协议与无效地址', () => {
  const config = { allowRemote: true };
  assert.throws(() => normalizeBaseUrl('ftp://127.0.0.1/v1', config), (error: unknown) =>
    error instanceof AiError && error.code === 'AI_BAD_URL');
  assert.throws(() => normalizeBaseUrl('not a url', config), (error: unknown) =>
    error instanceof AiError && error.code === 'AI_BAD_URL');
});

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}/v1`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test('OpenAI 兼容提供方解析 SSE 流并拼接内容', async () => {
  const map = exampleJson();
  const midpoint = Math.floor(map.length / 2);
  await withServer((req, res) => {
    let seen = '';
    req.on('data', chunk => { seen += String(chunk); });
    req.on('end', () => {
      assert.equal(req.method, 'POST');
      assert.ok(req.url?.endsWith('/chat/completions'));
      assert.equal(req.headers.authorization, 'Bearer secret');
      const body = JSON.parse(seen) as { messages: { role: string; content: string }[]; stream: boolean };
      assert.equal(body.stream, true);
      assert.equal(body.messages[0]?.role, 'system');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const parts = [map.slice(0, midpoint), map.slice(midpoint)];
      for (const part of parts) {
        const chunk = JSON.stringify({ choices: [{ delta: { content: part } }] });
        res.write(`data: ${chunk}\n\n`);
      }
      res.end('data: [DONE]\n\n');
    });
  }, async baseUrl => {
    const progress: string[] = [];
    const provider = new OpenAiCompatibleProvider({
      baseUrl, model: 'test-model', apiKey: 'secret', timeoutMs: 5_000,
    });
    const text = await provider.complete({
      system: 'system prompt',
      user: 'user prompt',
      cancel: never,
      onProgress: value => progress.push(value),
    });
    assert.equal(text, map);
    assert.equal(progress.length, 2);
  });
});

test('OpenAI 兼容提供方把 HTTP 错误变成可读的 AiError', async () => {
  await withServer((_req, res) => {
    res.writeHead(422, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'model not found' } }));
  }, async baseUrl => {
    const provider = new OpenAiCompatibleProvider({ baseUrl, model: 'missing', timeoutMs: 5_000 });
    await assert.rejects(
      provider.complete({ system: 's', user: 'u', cancel: never }),
      (error: unknown) => error instanceof AiError && error.code === 'AI_HTTP_ERROR'
        && error.message.includes('422') && error.message.includes('model not found'),
    );
  });
});

test('OpenAI 兼容提供方在连接失败时报 AI_UNREACHABLE', async () => {
  // Port 1 is reserved and never listens.
  const provider = new OpenAiCompatibleProvider({ baseUrl: 'http://127.0.0.1:1/v1', model: 'x', timeoutMs: 1_500 });
  await assert.rejects(
    provider.complete({ system: 's', user: 'u', cancel: never }),
    (error: unknown) => error instanceof AiError && error.code === 'AI_UNREACHABLE',
  );
});

test('OpenAI 兼容提供方的 listModels 只返回 id 列表', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'qwen2.5-coder:14b' }, { id: 'llama3.1:8b' }, { nope: true }] }));
  }, async baseUrl => {
    const provider = new OpenAiCompatibleProvider({ baseUrl, model: '', timeoutMs: 5_000 });
    assert.deepEqual(await provider.listModels(), ['qwen2.5-coder:14b', 'llama3.1:8b']);
  });
});

test('系统提示词要求纯 JSON 输出与逐字锚点', () => {
  const text = systemPrompt();
  assert.match(text, /只输出 JSON/);
  assert.match(text, /anchorText/);
  assert.match(text, /endLine - startLine \+ 1/);
  assert.match(text, /不要推测调用关系/);
});

test('buildUserPrompt 带行号前缀并遵守总字符预算', () => {
  const prompt = buildUserPrompt({
    rootName: 'demo',
    topic: '背包流程',
    files: [{ path: 'src/a.ts', content: 'const a = 1;\nconst b = 2;' }],
  });
  assert.match(prompt, /工作区根目录：demo/);
  assert.match(prompt, /用户想了解的话题：背包流程/);
  assert.match(prompt, /1\tconst a = 1;/);
  assert.match(prompt, /2\tconst b = 2;/);
  assert.match(prompt, /--- FILE: src\/a\.ts ---/);
  assert.ok(prompt.includes(schemaSummary()));
});

test('buildUserPrompt 按预算截断超长上下文', () => {
  const huge = 'x'.repeat(80_000);
  const prompt = buildUserPrompt({
    rootName: 'demo',
    topic: 't',
    files: [{ path: 'a.ts', content: huge }, { path: 'b.ts', content: huge }],
  });
  const sourceSection = prompt.slice(prompt.indexOf('--- FILE:'));
  // The total injected source is capped; the second file is included but truncated.
  assert.ok(sourceSection.length <= 120_000 + 128, `上下文过大：${sourceSection.length}`);
  assert.ok(sourceSection.includes('--- FILE: b.ts ---'));
  const secondFile = sourceSection.slice(sourceSection.indexOf('--- FILE: b.ts ---'));
  assert.ok(secondFile.length < 45_000, `第二个文件未被截断：${secondFile.length}`);
});

test('保留文本中的行号前缀换行符', () => {
  assert.equal(withLineNumbers('a\nb'), '1\ta\n2\tb');
});

test('重试提示包含错误原文与锚点提醒', () => {
  const hint = failureHint('地图校验失败 /sources/x：anchorText 行数不符');
  assert.match(hint, /没有通过校验/);
  assert.match(hint, /anchorText 行数不符/);
  assert.match(hint, /endLine - startLine \+ 1/);
});

test('端到端：本地假服务返回围栏 JSON 时可完成校验与重试', async () => {
  const map = exampleJson();
  let calls = 0;
  await withServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls += 1;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (calls === 1) {
        // First attempt is deliberately invalid so the retry path runs.
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '这不是 JSON' } }] })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '```json\n' + map + '\n```' } }] })}\n\n`);
      }
      res.end('data: [DONE]\n\n');
    });
  }, async baseUrl => {
    const { OpenAiCompatibleProvider } = await import('../src/ai/openaiCompatible');
    const { mapFromResponse } = await import('../src/ai/response');
    const { extractJson } = await import('../src/ai/json');
    const provider = new OpenAiCompatibleProvider({ baseUrl, model: 'fake', timeoutMs: 5_000 });

    const first = await provider.complete({ system: 's', user: 'u', cancel: never });
    assert.throws(() => mapFromResponse(first), (error: unknown) =>
      error instanceof AiError && error.code === 'AI_NO_JSON');

    const second = await provider.complete({ system: 's', user: 'u', cancel: never });
    const json = extractJson(second);
    assert.ok(json);
    const parsed = mapFromResponse(second);
    assert.equal(parsed.id, 'bag-demo');
    assert.equal(calls, 2);
  });
});

function tempExecutable(body: string): { path: string; cleanup(): void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'cd-cli-'));
  const file = path.join(dir, 'agent.sh');
  writeFileSync(file, body, 'utf8');
  chmodSync(file, 0o755);
  return { path: file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('CLI Agent 从 stdin 读取提示词并返回 stdout', async () => {
  const script = tempExecutable([
    '#!/bin/sh',
    'input=$(cat)',
    'echo "received ${#input} chars"',
    "cat <<'JSON'",
    exampleJson().trim(),
    'JSON',
  ].join('\n'));
  try {
    const provider = new CliAgentProvider({ command: script.path, args: [], cwd: process.cwd(), timeoutMs: 10_000 });
    const text = await provider.complete({ system: 'sys', user: 'user', cancel: never });
    assert.match(text, /received \d+ chars/);
    assert.equal(mapFromResponse(text).id, 'bag-demo');
  } finally {
    script.cleanup();
  }
});

test('CLI Agent 区分启动失败、非零退出、超时与取消', async () => {
  const missing = new CliAgentProvider({ command: '/nope/missing-binary', args: [], cwd: process.cwd(), timeoutMs: 5_000 });
  await assert.rejects(missing.complete({ system: 's', user: 'u', cancel: never }),
    (error: unknown) => error instanceof AiError && error.code === 'AI_CLI_START');

  const failing = new CliAgentProvider({ command: '/usr/bin/false', args: [], cwd: process.cwd(), timeoutMs: 5_000 });
  await assert.rejects(failing.complete({ system: 's', user: 'u', cancel: never }),
    (error: unknown) => error instanceof AiError && error.code === 'AI_CLI_FAILED');

  const slow = new CliAgentProvider({ command: '/bin/sleep', args: ['30'], cwd: process.cwd(), timeoutMs: 400 });
  const started = Date.now();
  await assert.rejects(slow.complete({ system: 's', user: 'u', cancel: never }),
    (error: unknown) => error instanceof AiError && error.code === 'AI_TIMEOUT');
  assert.ok(Date.now() - started < 5_000, '超时后应立即终止子进程');

  const listeners: (() => void)[] = [];
  let cancelled = false;
  const cancellable: AiCancel = {
    get isCancellationRequested() { return cancelled; },
    onCancellationRequested(listener: () => void) { listeners.push(listener); return { dispose() {} }; },
  };
  const long = new CliAgentProvider({ command: '/bin/sleep', args: ['30'], cwd: process.cwd(), timeoutMs: 20_000 });
  const pending = long.complete({ system: 's', user: 'u', cancel: cancellable });
  setTimeout(() => { cancelled = true; for (const listener of listeners) listener(); }, 250);
  await assert.rejects(pending, (error: unknown) => error instanceof AiError && error.code === 'AI_CANCELLED');
});

test('CLI Agent 未配置命令时直接报 AI_NOT_CONFIGURED', async () => {
  const provider = new CliAgentProvider({ command: '   ', args: [], cwd: process.cwd(), timeoutMs: 1_000 });
  await assert.rejects(provider.complete({ system: 's', user: 'u', cancel: never }),
    (error: unknown) => error instanceof AiError && error.code === 'AI_NOT_CONFIGURED');
});

test('自动探测优先选择偏代码的模型', () => {
  assert.equal(pickModel(['llama3.1:8b', 'qwen2.5-coder:14b']), 'qwen2.5-coder:14b');
  assert.equal(pickModel(['gpt-4o-mini', 'deepseek-coder-v2']), 'deepseek-coder-v2');
  assert.equal(pickModel(['gpt-4o-mini']), 'gpt-4o-mini');
  assert.equal(pickModel([]), undefined);
});

test('地图 id 会被规范化为 schema 允许的形式', () => {
  assert.equal(sanitizeMapId('Bag Demo!'), 'bag-demo');
  assert.equal(sanitizeMapId('___'), 'ai-map');
  assert.equal(sanitizeMapId(''), 'ai-map');
  assert.equal(sanitizeMapId('a'.repeat(80)).length, 48);
  assert.match(sanitizeMapId('中文标题'), /^[a-z0-9][a-z0-9-]*$/);
  assert.match(sanitizeMapId('9lives'), /^[a-z0-9][a-z0-9-]*$/);
});

test('重复生成时会同步递增 id 与文件名', async () => {
  const existing = new Set(['bag-demo', 'bag-demo-2']);
  const chosen = await freeMapName('bag-demo', async id => existing.has(id));
  assert.deepEqual(chosen, { id: 'bag-demo-3', fileName: 'bag-demo-3.json' });
});

test('没有冲突时沿用原始 id', async () => {
  const chosen = await freeMapName('bag-demo', async () => false);
  assert.deepEqual(chosen, { id: 'bag-demo', fileName: 'bag-demo.json' });
});

test('auto 回退链不会让未配置模型的地址吞掉后续通道', () => {
  assert.deepEqual(autoPlan({ model: '', cliCommand: 'claude' }), ['local-probe', 'cli', 'vscode-lm']);
  assert.deepEqual(autoPlan({ model: '', cliCommand: '  ' }), ['local-probe', 'vscode-lm']);
  assert.deepEqual(autoPlan({ model: 'qwen', cliCommand: 'claude' }),
    ['configured-openai', 'local-probe', 'cli', 'vscode-lm']);
});

test('OpenAI 兼容提供方在超时后报 AI_TIMEOUT', async () => {
  await withServer((_req, res) => {
    // Never answer: the provider must abort on its own timeout.
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
  }, async baseUrl => {
    const provider = new OpenAiCompatibleProvider({ baseUrl, model: 'slow', timeoutMs: 300 });
    const started = Date.now();
    await assert.rejects(
      provider.complete({ system: 's', user: 'u', cancel: never }),
      (error: unknown) => error instanceof AiError && error.code === 'AI_TIMEOUT',
    );
    assert.ok(Date.now() - started < 5_000, '超时后应立即中止请求');
  });
});

test('OpenAI 兼容提供方在外部取消时报 AI_CANCELLED', async () => {
  const listeners: (() => void)[] = [];
  let cancelled = false;
  const cancellable: AiCancel = {
    get isCancellationRequested() { return cancelled; },
    onCancellationRequested(listener: () => void) { listeners.push(listener); return { dispose() {} }; },
  };
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
  }, async baseUrl => {
    const provider = new OpenAiCompatibleProvider({ baseUrl, model: 'slow', timeoutMs: 30_000 });
    const pending = provider.complete({ system: 's', user: 'u', cancel: cancellable });
    setTimeout(() => { cancelled = true; for (const listener of listeners) listener(); }, 150);
    await assert.rejects(pending, (error: unknown) => error instanceof AiError && error.code === 'AI_CANCELLED');
  });
});

test('文件名冲突用尽时抛错而不是覆盖已有地图', async () => {
  await assert.rejects(
    freeMapName('bag-demo', async () => true),
    /冲突过多/,
  );
});
