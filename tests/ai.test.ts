import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { extractJson } from '../src/ai/json';
import { explorePrompt, outputContract, retryPrompt } from '../src/ai/prompt';
import { mapFromResponse } from '../src/ai/response';
import { freeMapName, sanitizeMapId } from '../src/ai/mapNaming';
import { ClaudeCli } from '../src/ai/agent/claude';
import { CodexCli } from '../src/ai/agent/codex';
import { CopilotCli } from '../src/ai/agent/copilot';
import { AgyCli } from '../src/ai/agent/agy';
import { augmentedPath, resolveExecutable } from '../src/ai/agent/env';
import { runAgent } from '../src/ai/agent/runner';
import { AgentError } from '../src/ai/agent/types';
import { createSession, agentCli, agentCatalog, AGENTS, DEFAULT_AGENT } from '../src/ai/index';
import { generateMap } from '../src/ai/mapGenerator';
import { renderMentorMarkdown } from '../webview/src/markdown';
import { getLocale, setLocale } from '../shared/i18n';
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

test('extractJson 忽略字符串里的花括号并优先选取包含地图结构的 JSON 对象', () => {
  const text = '说明 {"note": "使用 { 和 } 组成", "values": [1, 2]} 结束';
  assert.equal(extractJson(text), '{"note":"使用 { 和 } 组成","values":[1,2]}');

  const mapBody = exampleJson();
  const mixed = `先说明参数 {"foo": 1}，再输出最终地图：\n${mapBody}`;
  assert.equal(extractJson(mixed), JSON.stringify(JSON.parse(mapBody)));
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

test('prompt 让 agent 自由探索源码并仅约束 JSON 输出格式', () => {
  const prompt = explorePrompt({ rootName: 'bag-demo', topic: '背包流程', priorityFiles: ['src/a.ts'] });
  assert.match(prompt, /自由发挥/);
  assert.match(prompt, /src\/a\.ts/);
  assert.match(outputContract(), /不要加 Markdown 代码块围栏/);
  assert.match(outputContract(), /不要写 anchorText/);
  assert.doesNotMatch(outputContract(), /禁止把整个函数/);
  const previous = getLocale();
  try {
    setLocale('en');
    assert.match(outputContract(), /JSON schema contract only/);
    assert.doesNotMatch(outputContract(), /NEVER wrap an entire function/);
  } finally {
    setLocale(previous);
  }
  assert.match(retryPrompt(['/nodes/0/sourceIds：引用不存在']), /没能通过格式校验/);
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

test('Claude CLI 放开探索与子智能体工具、硬禁写工具并支持 --resume', () => {
  const cli = new ClaudeCli('claude');
  const args = cli.args();
  assert.equal(args[0], 'claude');
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('--output-format'));
  const allowed = args[args.indexOf('--allowedTools') + 1]!;
  assert.ok(allowed.includes('Read'));
  assert.ok(allowed.includes('Agent'));
  assert.ok(allowed.includes('Skill'));
  assert.equal(args[args.indexOf('--disallowedTools') + 1], 'Edit,Write,NotebookEdit');
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

test('agent 目录按 copilot -> agy -> codex -> claude 顺位排列，且默认 copilot，支持扩展自定义 agent', () => {
  assert.equal(DEFAULT_AGENT, 'copilot');
  assert.deepEqual(AGENTS.map(item => item.id), ['copilot', 'agy', 'codex', 'claude']);
  const cfg = config({
    agent: 'my-agent',
    customAgents: [{ id: 'my-agent', label: 'My Agent', command: '/bin/echo', args: ['--json'] }],
  });
  assert.deepEqual(agentCatalog(cfg).map(item => item.id), ['copilot', 'agy', 'codex', 'claude', 'my-agent']);
  assert.equal(agentCli(cfg).label, 'My Agent');
  assert.throws(() => agentCli(config({ agent: 'nope' })), /未知的 agent/);
});

test('CopilotCli 只读限制、ANSI 清理、流式增量与多格式解析', () => {
  const cli = new CopilotCli('copilot', ['--model', 'gpt-5']);
  const args = cli.args();
  assert.equal(args[0], 'copilot');
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('-s'));
  assert.ok(args.includes('--allow-all-tools'));
  assert.ok(args.includes('write'));
  assert.ok(args.includes('shell'));
  assert.deepEqual(args.slice(-2), ['--model', 'gpt-5']);
  assert.deepEqual(cli.resumeArgs('cp-1')?.slice(-2), ['--resume', 'cp-1']);

  const deltas: string[] = [];
  cli.onStreamChunk('\x1b[32m第一段内容\x1b[0m', { onDelta: d => deltas.push(d) });
  assert.deepEqual(deltas, ['第一段内容']);

  assert.deepEqual(cli.parse('\x1b[36m普通回复\x1b[0m', ''), { text: '普通回复' });
  const rawMap = '{"schemaVersion":1,"id":"demo","title":"Demo"}';
  assert.deepEqual(cli.parse(rawMap, ''), { text: rawMap });
  assert.deepEqual(
    cli.parse(JSON.stringify({ result: 'ok', session_id: 'cp-2' }), ''),
    { text: 'ok', sessionId: 'cp-2' },
  );
  assert.throws(() => cli.parse(JSON.stringify({ is_error: true, result: '未登录' }), ''), /未登录/);
});

test('AgyCli 参数、流式 step_update 解析与 --conversation 续接', () => {
  const cli = new AgyCli('agy', ['--effort', 'high']);
  const args = cli.args();
  assert.equal(args[0], 'agy');
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('--output-format'));
  assert.ok(args.includes('stream-json'));
  assert.ok(!args.includes('--disable-slash-commands'), '保留工作区 skills 与探索能力');
  assert.ok(!args.includes('--sandbox'), '不嵌套 sandbox 避免 IDE 内沙箱冲突');
  assert.deepEqual(args.slice(-2), ['--effort', 'high']);
  assert.deepEqual(cli.resumeArgs('conv-1')?.slice(-2), ['--conversation', 'conv-1']);

  const activities: string[] = [];
  const deltas: string[] = [];
  cli.onStreamLine(
    JSON.stringify({ event: 'step_update', tool_info: { name: 'read_file', arguments: { file_path: '/ws/src/app.ts' } } }),
    { onActivity: act => activities.push(`${act.kind}:${act.text}`), onDelta: d => deltas.push(d) },
  );
  cli.onStreamLine(
    JSON.stringify({ event: 'step_update', tool_info: { name: 'grep_search', input: { query: 'loginHandler' } } }),
    { onActivity: act => activities.push(`${act.kind}:${act.text}`) },
  );
  cli.onStreamLine(
    JSON.stringify({ event: 'step_update', delta: '流式片段', thinking: '分析入口调用链' }),
    { onActivity: act => activities.push(`${act.kind}:${act.text}`), onDelta: d => deltas.push(d) },
  );
  assert.deepEqual(activities, ['read:src/app.ts', 'search:loginHandler', 'think:分析入口调用链']);
  assert.deepEqual(deltas, ['流式片段']);

  const ndjson = [
    JSON.stringify({ event: 'init', conversation_id: 'conv-42' }),
    JSON.stringify({ event: 'result', result: { conversation_id: 'conv-42', status: 'SUCCESS', response: '{"ok":true}' } }),
  ].join('\n');
  assert.deepEqual(cli.parse(ndjson, ''), { text: '{"ok":true}', sessionId: 'conv-42' });

  assert.throws(
    () => cli.parse(JSON.stringify({ event: 'result', result: { status: 'ERROR', error: 'quota exceeded' } }), ''),
    /quota exceeded/,
  );
});

test('env 补充常用用户 PATH 并准确探测可执行文件', () => {
  const pathStr = augmentedPath({ PATH: '/usr/bin' }, 'darwin', '/Users/tester');
  const parts = pathStr.split(':');
  assert.equal(parts[0], '/usr/bin');
  assert.ok(parts.includes('/Users/tester/.local/bin'));
  assert.ok(parts.includes('/opt/homebrew/bin'));

  const dir = mkdtempSync(path.join(tmpdir(), 'cd-env-'));
  try {
    const bin = fakeCli(dir, 'echo ok');
    const nonExec = path.join(dir, 'plain-file');
    writeFileSync(nonExec, 'not executable', 'utf8');
    chmodSync(nonExec, 0o644);

    assert.equal(resolveExecutable('fake-agent', { PATH: dir }), bin);
    if (process.platform !== 'win32') {
      assert.equal(resolveExecutable('plain-file', { PATH: dir }), undefined);
    }
    assert.equal(resolveExecutable('definitely-missing-cli-xyz', { PATH: dir }), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('无 sessionId 的无状态 CLI 重试时会带上完整任务与输出约束', async () => {
  const seenPrompts: string[] = [];
  const good = exampleJson();
  let calls = 0;
  const statelessSession = {
    id: 'copilot',
    label: 'GitHub Copilot',
    send: async (req: { prompt: string }) => {
      calls += 1;
      seenPrompts.push(req.prompt);
      return { text: calls === 1 ? 'not valid json' : good };
    },
  };
  const result = await generateMap(statelessSession as never, {
    topic: '背包流程',
    rootName: 'bag-demo',
    priorityFiles: [],
    cwd: '/',
    timeoutMs: 5_000,
    cancel: never,
  }, { retries: 1 });
  assert.equal(result.attempts, 2);
  assert.equal(seenPrompts.length, 2);
  assert.match(seenPrompts[1]!, /背包流程/);
  assert.match(seenPrompts[1]!, /schemaVersion/);
  assert.match(seenPrompts[1]!, /没能通过.*校验/);
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

test('cli.extraArgs 追加到内置 agent 的参数之后（含 resume）', () => {
  const claude = agentCli(config({ extraArgs: ['--model', 'opus'] }));
  assert.deepEqual(claude.args().slice(-2), ['--model', 'opus']);
  assert.deepEqual(claude.resumeArgs?.('sid')?.slice(-4), ['--model', 'opus', '--resume', 'sid']);
  const codex = agentCli(config({ agent: 'codex', extraArgs: ['-m', 'gpt-5'] }));
  assert.deepEqual(codex.args().slice(-2), ['-m', 'gpt-5']);
  assert.deepEqual(codex.resumeArgs?.('tid')?.slice(-2), ['-m', 'gpt-5']);
  assert.ok(codex.args().includes('--sandbox'), 'extraArgs 不应替换只读沙箱');
});

test('cli.allowedTools 生效，允许探索/子智能体工具并过滤写与执行工具', () => {
  const tools = (allowedTools: string): string => {
    const args = agentCli(config({ allowedTools })).args();
    return args[args.indexOf('--allowedTools') + 1]!;
  };
  assert.equal(tools('Read,Grep,Agent'), 'Read,Grep,Agent');
  assert.equal(tools('Read, Bash, Edit,Write,Grep'), 'Read,Grep');
  assert.ok(tools('Bash').includes('Agent'), '全部被过滤时回落到完整只读探索工具集');
  assert.ok(tools('').includes('Agent'));
});

test('提供 readFile 时，命令行生成的地图按真实文件补锚点、保留 note 并容错', async () => {
  const reply = JSON.stringify({
    schemaVersion: 1, id: 'demo', title: 'Demo',
    sources: {
      s1: { file: 'src/a.ts', startLine: 2, endLine: 3, note: '核心逻辑' },
      far: { file: 'src/a.ts', startLine: 99, endLine: 120 },
    },
    nodes: [
      { id: 'n1', label: 'A', sourceIds: ['s1'] },
      { id: 'n1', label: '重复', sourceIds: ['s1'] },
      { id: 'n2', label: 'B', sourceIds: ['far'] },
    ],
    edges: [],
  });
  const session = { label: 'fake', send: async () => ({ text: reply }) };
  const result = await generateMap(session as never, {
    topic: 't', rootName: 'r', priorityFiles: [], cwd: '/', timeoutMs: 1_000,
    cancel: { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    readFile: async file => (file === 'src/a.ts' ? 'l1\nl2\nl3\nl4\n' : undefined),
  }, { retries: 0 });
  assert.equal(result.attempts, 1, '小错不应触发重试');
  assert.deepEqual(result.map.sources.s1, { file: 'src/a.ts', startLine: 2, endLine: 3, anchorText: 'l2\nl3', note: '核心逻辑' });
  assert.ok(!('far' in result.map.sources), '起始行越界的来源被丢弃');
  assert.deepEqual(result.map.nodes.map(node => node.id), ['n1']);
  assert.ok(result.adjustments.length > 0, '丢弃项应被报告');
});

test('ClaudeCli 与 CodexCli 实时解析工具足迹与流式文本增量', () => {
  const activities: string[] = [];
  const deltas: string[] = [];
  const claude = new ClaudeCli();
  claude.onStreamLine(
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/ws/src/auth-service.ts' } },
          { type: 'text', text: '正在梳理认证链路' },
        ],
      },
    }),
    {
      onActivity: act => activities.push(`${act.kind}:${act.text}`),
      onDelta: chunk => deltas.push(chunk),
    },
  );
  assert.deepEqual(activities, ['read:src/auth-service.ts']);
  assert.deepEqual(deltas, ['正在梳理认证链路']);

  const codexDeltas: string[] = [];
  new CodexCli().onStreamLine(
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '分析完成' } }),
    { onDelta: chunk => codexDeltas.push(chunk) },
  );
  assert.deepEqual(codexDeltas, ['分析完成']);
});

test('renderMentorMarkdown 转义恶意 HTML 并把源码坐标转为可点击引用按钮', () => {
  const html = renderMentorMarkdown('请看 `src/validate.ts:5-8` 与 <img src=x onerror=alert(1)>，还有裸引用 src/router.ts:11。');
  assert.ok(!html.includes('<img'), 'HTML 标签必须被严格转义');
  assert.match(html, /data-cite-file="src\/validate\.ts" data-cite-start="5" data-cite-end="8"/);
  assert.match(html, /data-cite-file="src\/router\.ts" data-cite-start="11" data-cite-end="11"/);
});
