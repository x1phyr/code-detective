import { spawn } from 'node:child_process';
import { AgentError, type AgentCli, type AgentReply, type AgentTurn } from './types';
import { t } from '../../../shared/i18n';

const DEFAULT_MAX_OUTPUT = 16 * 1024 * 1024;
const MAX_STDERR = 32 * 1024;

export interface AgentRunOptions extends AgentTurn {
  cli: AgentCli;
  /** Continue this session instead of starting a fresh one. */
  sessionId?: string;
  maxOutputBytes?: number;
}

export interface AgentRunResult extends AgentReply {
  /** The session id this turn used or created. */
  sessionId?: string;
}

/**
 * Runs one agent turn.
 *
 * The prompt is written to stdin and `shell` stays disabled, so a topic can
 * never be interpreted as shell syntax or CLI flags. Cancelling or timing out
 * is conveyed by killing the process tree.
 */
export function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const { cli, prompt, cwd, timeoutMs, cancel, onChunk } = options;
  const resumeArgs = options.sessionId ? cli.resumeArgs?.(options.sessionId) : undefined;
  const args = resumeArgs ?? cli.args();
  const max = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

  return new Promise<AgentRunResult>((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let child: ReturnType<typeof spawn>;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.dispose();
      if (error) {
        reject(error);
        return;
      }
      try {
        const reply = cli.parse(stdout, stderr);
        resolve({ ...reply, sessionId: reply.sessionId ?? options.sessionId });
      } catch (parseError) {
        reject(new AgentError('AI_BAD_OUTPUT', (parseError as Error).message));
      }
    };

    const kill = (): void => {
      if (child?.pid === undefined) return;
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, 2_000).unref?.();
    };

    try {
      child = spawn(args[0]!, args.slice(1), {
        cwd,
        shell: false,
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1', CI: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(new AgentError('AI_CLI_START',
        t('ai.cliStartFailed', { command: String(args[0]), error: (error as Error).message })));
      return;
    }

    const timer = setTimeout(() => {
      kill();
      finish(new AgentError('AI_TIMEOUT',
        t('ai.cliTimeout', { command: String(args[0]), seconds: Math.round(timeoutMs / 1000) })));
    }, timeoutMs);

    const subscription = cancel.onCancellationRequested(() => {
      kill();
      finish(new AgentError('AI_CANCELLED', t('ai.cancelled')));
    });

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < max) {
        stdout += chunk;
        onChunk?.(chunk);
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < MAX_STDERR) {
        stderr += chunk;
        onChunk?.(chunk);
      }
    });

    child.on('error', error => {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      finish(new AgentError(missing ? 'AI_CLI_MISSING' : 'AI_CLI_START',
        missing
          ? t('ai.cliMissing', { command: String(args[0]), agent: cli.label })
          : t('ai.cliRunFailed', { command: String(args[0]), error: error.message })));
    });
    child.on('close', code => {
      if (settled) return;
      if (code === 0) finish();
      else finish(new AgentError('AI_CLI_FAILED',
        t('ai.cliExitCode', { command: String(args[0]), code: code ?? 'null', stderr: stderr.trim().slice(0, 600) })));
    });

    // The process may exit before reading stdin; that is not an error we surface.
    child.stdin?.on('error', () => { /* ignored */ });
    child.stdin?.end(prompt);
  });
}
