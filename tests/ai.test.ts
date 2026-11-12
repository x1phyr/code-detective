import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { extractJson } from '../src/ai/json';
import { explorePrompt, OUTPUT_CONTRACT, retryPrompt } from '../src/ai/prompt';
import { mapFromResponse } from '../src/ai/response';
import { freeMapName, sanitizeMapId } from '../src/ai/mapNaming';
import { ClaudeCli } from '../src/ai/agent/claude';
import { CodexCli } from '../src/ai/agent/codex';
import { runAgent } from '../src/ai/agent/runner';
import { AgentError } from '../src/ai/agent/types';
import { createSession, agentCli, agentCatalog, AGENTS } from '../src/ai/index';
import { generateMap } from '../src/ai/mapGenerator';
import type { AiConfig } from '../src/ai/config';
import type { AgentCancel } from '../src/ai/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.join(here, '..', 'examples', 'bag-demo', '.code-detective', 'maps', 'bag-demo.json');

const never: AgentCancel = {
  isCancellationRequested: false,
  onCancellationRequested() { return { dispose() {} }; },
};

function exampleJson(): string {
  return readFileSync(examplePath, 'utf8');
}

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    agent: 'claude',
    command: '',
    extraArgs: [],
    customAgents: [],
    timeoutMs: 5_000,
    allowedTools: 'Read,Grep,Glob,LS',
    ...overrides,
  };
}

/** Writes a fake CLI that echoes its argv/stdin, so argv handling is testable. */
function fakeCli(dir: string, body: string): string {
  const file = path.join(dir, 'fake-agent');
  writeFileSync(file, `#!/bin/sh\n${body}\n`, 'utf8');
  chmodSync(file, 0o755);
  return file;
}

test('extractJson 处理围栏、前后缀解释与无 JSON 响应', () => {
  const text = exampleJson();
  assert.equal(extractJson(`\`\`\`json\n${text}\n\`\`\``), JSON.stringify(JSON.parse(text)));
  assert.equal(extractJson(`好的，这是地图：\n${text}\n希望对你有帮助。`), JSON.stringify(JSON.parse(text)));
  assert.equal(extractJson('没有任何对象'), undefined);
  assert.equal(extractJson('{"broken": '), undefined);
});

test('extractJson 忽略字符串里的花括号', () => {
  const text = '说明 {"note": "使用 { 和 } 组成", "values": [1, 2]} 结束';
  assert.equal(extractJson(text), '{"note":"使用 { 和 } 组成","values":[1,2]}');
});

test('mapFromResponse 校验通过并保留原始出处的结构', () => {
  const map = mapFromResponse(`\`\`\`json\n${exampleJson()}\n\`\`\``);
  assert.equal(map.schemaVersion, 1);
  assert.ok(map.nodes.length > 0);
});

test('mapFromResponse 在无 JSON 或校验失败时抛出错误', () => {
  assert.throws(() => mapFromResponse('agent 拒绝了请求'), /没有在响应中找到合法的 JSON/);
  assert.throws(() => mapFromResponse('{ "schemaVersion": 2 }'), /地图校验失败/);
});

test('prompt 要求 agent 自己读源码并只输出 JSON', () => {
  const prompt = explorePrompt({ rootName: 'bag-demo', topic: '背包流程', priorityFiles: ['src/a.ts'] });
  assert.match(prompt, /直接用你的读文件/);
  assert.match(prompt, /src\/a\.ts/);
  assert.match(OUTPUT_CONTRACT, /不要 Markdown 围栏/);
  assert.match(OUTPUT_CONTRACT, /不要写 anchorText/);
  assert.match(retryPrompt(['/nodes/0/sourceIds：引用不存在']), /没能通过校验/);
  assert.match(retryPrompt(['/nodes/0/sourceIds：引用不存在']), /sourceIds/);
});

test('Claude CLI 解析 json 信封并取出 session_id', () => {
  const cli = new ClaudeCli();
  const reply = cli.parse(JSON.stringify({ result: '{"a":1}', session_id: 'abc', is_error: false }), '');
  assert.deepEqual(reply, { text: '{"a":1}', sessionId: 'abc' });
});

test('Claude CLI 把 is_error 与不可解析输出变成错误', () => {
  const cli = new ClaudeCli();
  assert.throws(() => cli.parse(JSON.stringify({ is_error: true, result: '认证失败' }), ''), /认证失败/);
  assert.throws(() => cli.parse('not json', 'boom'), /无法解析/);
});

test('Claude CLI 使用只读工具并支持 --resume', () => {
  const cli = new ClaudeCli('claude');
  const args = cli.args();
  assert.equal(args[0], 'claude');
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('--output-format'));
  assert.ok(args.includes('Read,Grep,Glob,LS'));
  assert.deepEqual(cli.resumeArgs('sid'), [...args, '--resume', 'sid']);
});

test('Codex CLI 取最后一条 agent_message 与 thread_id', () => {
  const stdout = [
    '{"type":"thread.started","thread_id":"tid-1"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"先看看"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"a\\":1}"}}',
    '{"type":"turn.completed"}',
  ].join('\n');
  const reply = new CodexCli().parse(stdout, '');
  assert.equal(reply.text, '{"a":1}');
  assert.equal(reply.sessionId, 'tid-1');
});

test('Codex CLI 的 resume 不带 --sandbox（该子命令不接受）', () => {
  const cli = new CodexCli();
  assert.ok(cli.args().includes('--sandbox'));
  assert.ok(!cli.resumeArgs('tid').includes('--sandbox'));
  assert.deepEqual(cli.resumeArgs('tid').slice(0, 3), ['codex', 'exec', 'resume']);
});

test('agent 目录包含内置 claude / codex，并可扩展自定义 agent', () => {
  assert.deepEqual(AGENTS.map(item => item.id), ['claude', 'codex']);
  const cfg = config({
    agent: 'my-agent',
    customAgents: [{ id: 'my-agent', label: 'My Agent', command: '/bin/echo', args: ['--json'] }],
  });
  assert.deepEqual(agentCatalog(cfg).map(item => item.id), ['claude', 'codex', 'my-agent']);
  assert.equal(agentCli(cfg).label, 'My Agent');
  assert.throws(() => agentCli(config({ agent: 'nope' })), /未知的 agent/);
});

test('runAgent 通过 stdin 传提示词，绝不放进 argv', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cd-agent-'));
  try {
    // argv 与 stdin 各自输出到 JSON，便于分别断言。
    const command = fakeCli(dir, [
      'printf \'{"argv":"%s"}\' "$*"',
      'echo',
      'cat',
    ].join('\n'));
    const result = await runAgent({
      cli: {
        id: 'fake',
        label: 'Fake',
        args: () => [command],
        parse: stdout => ({ text: stdout }),
      },
      prompt: '请分析 --help 和 ; rm -rf / 也不该被解析',
      cwd: dir,
      timeoutMs: 5_000,
      cancel: never,
    });
    assert.match(result.text, /"argv":""/);
    assert.match(result.text, /请分析 --help 和 ; rm -rf \/ 也不该被解析/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runAgent 区分启动失败、非零退出、超时与取消', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cd-agent-'));
  try {
    const cli = (command: string) => ({
      id: 'fake',
      label: 'Fake',
      args: () => [command],
      parse: (stdout: string) => ({ text: stdout }),
    });
    await assert.rejects(
      runAgent({ cli: cli('/nope/missing-binary'), prompt: 'x', cwd: dir, timeoutMs: 5_000, cancel: never }),
      (error: unknown) => error instanceof AgentError && error.code === 'AI_CLI_MISSING',
    );
    await assert.rejects(
      runAgent({ cli: cli('/usr/bin/false'), prompt: 'x', cwd: dir, timeoutMs: 5_000, cancel: never }),
      (error: unknown) => error instanceof AgentError && error.code === 'AI_CLI_FAILED',
    );

    const started = Date.now();
    const sleeper = {
      id: 'fake',
      label: 'Fake',
      args: () => ['/bin/sleep', '120'],
      parse: (stdout: string) => ({ text: stdout }),
    };
    await assert.rejects(
      runAgent({ cli: sleeper, prompt: 'x', cwd: dir, timeoutMs: 500, cancel: never }),
      (error: unknown) => error instanceof AgentError && error.code === 'AI_TIMEOUT',
    );
    assert.ok(Date.now() - started < 10_000, '超时后应立即终止子进程');

    const listeners: (() => void)[] = [];
    let cancelled = false;
    const cancellable: AgentCancel = {
      get isCancellationRequested() { return cancelled; },
      onCancellationRequested(listener: () => void) { listeners.push(listener); return { dispose() {} }; },
    };
    const pending = runAgent({
      cli: sleeper, prompt: 'x', cwd: dir, timeoutMs: 60_000, cancel: cancellable,
    });
    setTimeout(() => { cancelled = true; for (const listener of listeners) listener(); }, 200);
    await assert.rejects(pending, (error: unknown) => error instanceof AgentError && error.code === 'AI_CANCELLED');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('会话在第一轮之后用 --resume 续同一 session', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cd-agent-'));
  try {
    // 第一次调用输出 session_id，第二次必须带上 --resume <id>。
    const command = fakeCli(dir, [
      'case "$*" in',
      '  *--resume*) printf \'{"result":"continued","session_id":"sid-1"}\' ;;',
      '  *) printf \'{"result":"first","session_id":"sid-1"}\' ;;',
      'esac',
    ].join('\n'));
    const cli = new ClaudeCli(command);
    const session = createSession(config({ command }));
    // 用真实 ClaudeCli 的 parse，但把可执行文件换成脚本。
    const first = await runAgent({ cli, prompt: '第一次', cwd: dir, timeoutMs: 5_000, cancel: never });
    assert.equal(first.text, 'first');
    assert.equal(first.sessionId, 'sid-1');
    const second = await runAgent({
      cli, prompt: '第二次', cwd: dir, timeoutMs: 5_000, cancel: never, sessionId: first.sessionId,
    });
    assert.equal(second.text, 'continued');
    assert.equal(second.sessionId, 'sid-1');
    assert.equal(session.label, 'Claude Code');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test('文件名冲突用尽时抛错而不是覆盖已有地图', async () => {
  await assert.rejects(freeMapName('bag-demo', async () => true), /冲突过多/);
});

test('端到端：agent 首轮给出坏地图，同一 session 的下一轮修正', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cd-agent-'));
  try {
    // 脚本用 node 生成信封，避免 shell 转义破坏 JSON。
    const bad = '{"schemaVersion":2}';
    const good = exampleJson();
    const script = path.join(dir, 'emit.cjs');
    writeFileSync(script, [
      'const { execPath } = process;',
      'const resume = process.argv.includes("--resume");',
      'const payload = { result: resume ? process.env.GOOD : process.env.BAD, session_id: "sess-1" };',
      'process.stdout.write(JSON.stringify(payload));',
    ].join('\n'));
    const command = fakeCli(dir, `BAD='${bad}' GOOD="$(cat '${path.join(dir, 'good.json')}')" exec "${process.execPath}" "${script}" "$@"`);
    writeFileSync(path.join(dir, 'good.json'), good);

    const phases: string[] = [];
    const result = await generateMap(
      createSession(config({ command })),
      {
        topic: '背包流程',
        rootName: 'bag-demo',
        priorityFiles: [],
        cwd: dir,
        timeoutMs: 20_000,
        cancel: never,
        onPhase: phase => phases.push(phase),
      },
    );
    assert.equal(result.attempts, 2, '首轮失败后应重试一次');
    assert.ok(result.map.nodes.length > 0);
    assert.ok(result.map.sources && Object.keys(result.map.sources).length > 0);
    assert.equal(phases.filter(phase => phase === 'retry').length, 1);
    assert.equal(result.sessionId, 'sess-1', '重试应留在同一个 session');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端：agent 始终返回坏地图时报 AI_INVALID_MAP', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cd-agent-'));
  try {
    const command = fakeCli(dir, 'printf \'{"result":"not json","session_id":"s"}\'');
    await assert.rejects(
      generateMap(
        createSession(config({ command })),
        {
          topic: 'x', rootName: 'r', priorityFiles: [], cwd: dir,
          timeoutMs: 10_000, cancel: never,
        },
        { retries: 0 },
      ),
      (error: unknown) => error instanceof Error && error.name === 'AiError'
        && (error as { code?: string }).code === 'AI_INVALID_MAP',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
