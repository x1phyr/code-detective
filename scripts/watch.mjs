import { context } from 'esbuild';
import { build as buildWebview } from 'vite';
import { mkdir } from 'node:fs/promises';

/**
 * 扩展宿主与 Webview 的联合 watcher。
 * `[watch] building` / `[watch] ready` 供 tasks.json 的 background problemMatcher 判断就绪。
 */
const BUILDING = '[watch] building';
const READY = '[watch] ready';

const pending = new Set();
let idle = true;
let failed = false;

const begin = label => {
  pending.add(label);
  if (idle) {
    idle = false;
    console.log(BUILDING);
  }
};

const finish = (label, ok) => {
  pending.delete(label);
  if (!ok) {
    failed = true;
    console.error(`[watch] ${label} failed`);
    return;
  }
  if (pending.size === 0 && !idle) {
    idle = true;
    console.log(READY);
  }
};

await mkdir('dist', { recursive: true });
await mkdir('artifacts', { recursive: true });

const ext = await context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  mainFields: ['module', 'main'],
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  outfile: 'dist/extension.cjs',
  sourcemap: true,
  logLevel: 'silent',
  plugins: [
    {
      name: 'watch-notify',
      setup(build) {
        build.onStart(() => begin('ext'));
        build.onEnd(result => finish('ext', result.errors.length === 0));
      },
    },
  ],
});

const webview = await buildWebview({
  configFile: 'vite.config.ts',
  build: { watch: {} },
  logLevel: 'silent',
});

const watcher = Array.isArray(webview) ? webview[0] : webview;
watcher.on('event', event => {
  if (event.code === 'BUNDLE_START') begin('webview');
  else if (event.code === 'BUNDLE_END') finish('webview', true);
  else if (event.code === 'ERROR') finish('webview', false);
});

await ext.watch();

process.on('SIGINT', async () => {
  await ext.dispose();
  await watcher.close();
  process.exit(failed ? 1 : 0);
});
