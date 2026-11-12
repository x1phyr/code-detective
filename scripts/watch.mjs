import { context } from 'esbuild';
import { build as buildWebview } from 'vite';
import { mkdir } from 'node:fs/promises';

/**
 * 调试用的增量构建。
 *
 * 就绪判断完全依赖两个工具自己打印的日志，不自定义任何标记：
 *   esbuild → `[watch] build finished, watching for changes...` / `[watch] build finished`
 *   vite    → `build started...` / `built in <n>ms.`
 *
 * 两条流写入同一终端时是交错的，单独用一个 matcher 无法区分谁完成了。
 * 因此拆成两个任务（`npm: watch:ext` / `npm: watch:webview`），
 * 各自用原生标记做 background，由 launch.json 的 dependsOn 并行等待。
 */
const target = process.argv[2];

await mkdir('dist', { recursive: true });
await mkdir('artifacts', { recursive: true });

if (target === 'webview') {
  const built = await buildWebview({
    configFile: 'vite.config.ts',
    build: { watch: {} },
    logLevel: 'info',
  });
  const watcher = Array.isArray(built) ? built[0] : built;
  const stop = async () => {
    await watcher.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} else {
  const ctx = await context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    platform: 'node',
    mainFields: ['module', 'main'],
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
    outfile: 'dist/extension.cjs',
    sourcemap: true,
    logLevel: 'info',
    color: false,
  });
  await ctx.watch();
  const stop = async () => {
    await ctx.dispose();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
