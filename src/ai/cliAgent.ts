import { spawn } from 'node:child_process';
import { AiError, type AiCompletionRequest, type AiProvider } from './types';

export interface CliAgentOptions {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes?: number;
}

const DEFAULT_MAX_OUTPUT = 8 * 1024 * 1024;

/**
 * Runs a local CLI agent non-interactively (`claude -p`, `codex exec`, ...).
 * The prompt is written to stdin and `shell` stays disabled so user text can
 * never be interpreted as shell syntax.
 */
export class CliAgentProvider implements AiProvider {
  readonly id = 'cli';

  constructor(private readonly options: CliAgentOptions) {}

  get label(): string { return `本地 CLI（${this.options.command}）`; }

  complete({ system, user, cancel, onProgress }: AiCompletionRequest): Promise<string> {
    if (!this.options.command.trim()) {
      return Promise.reject(new AiError('AI_NOT_CONFIGURED', '没有配置本地 CLI 命令。'));
    }
    const max = this.options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(this.options.command, this.options.args, {
          cwd: this.options.cwd,
          shell: false,
          windowsHide: true,
          env: { ...process.env, NO_COLOR: '1', CI: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        reject(new AiError('AI_CLI_START', `无法启动 ${this.options.command}：${(error as Error).message}`));
        return;
      }

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        subscription.dispose();
        if (error) reject(error);
        else resolve(stdout);
      };
      const kill = (): void => {
        if (child.pid === undefined) return;
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, 2_000).unref?.();
      };

      const timer = setTimeout(() => {
        kill();
        finish(new AiError('AI_TIMEOUT', `${this.options.command} 超过 ${Math.round(this.options.timeoutMs / 1000)} 秒未完成，已终止。`));
      }, this.options.timeoutMs);
      const subscription = cancel.onCancellationRequested(() => {
        kill();
        finish(new AiError('AI_CANCELLED', 'AI 请求已取消。'));
      });

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        if (stdout.length < max) {
          stdout += chunk;
          onProgress?.(stdout);
        }
      });
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        if (stderr.length < 16_384) stderr += chunk;
      });
      child.on('error', error => {
        finish(new AiError('AI_CLI_START', `无法运行 ${this.options.command}：${error.message}`));
      });
      child.on('close', code => {
        if (settled) return;
        if (code === 0) finish();
        else finish(new AiError('AI_CLI_FAILED',
          `${this.options.command} 退出码 ${code ?? 'null'}。${stderr.trim().slice(0, 600)}`));
      });

      // The system prompt is prepended to keep single-shot CLIs stateless.
      child.stdin?.on('error', () => { /* the process may exit before reading stdin */ });
      child.stdin?.end(`${system}\n\n${user}\n`);
    });
  }
}
