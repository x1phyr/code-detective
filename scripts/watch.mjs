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
let roundErrors = [];

/**
 * 输出 `file:line:col: error: message`，匹配 tasks.json 里 problemMatcher 的 pattern，
 * 让构建失败直接出现在 Problems 面板并可点击跳转。
 */
const report = (label, errors) => {
  for (const error of errors) {
    const file = error.location?.file;
    const line = error.location?.line;
    const column = error.location?.column;
    if (file && line && column) {
      console.log(`${file}:${line}:${column}: error: ${error.text}`);
    } else {
      console.log(`${label}: error: ${error.text}`);
    }
  }
};

const begin = label => {
  pending.add(label);
  if (idle) {
    idle = false;
    console.log(BUILDING);
  }
};

const finish = (label, errors = []) => {
  pending.delete(label);
  if (errors.length > 0) {
    report(label, errors);
    roundErrors.push(label);
  }
  if (pending.size > 0 || idle) return;
  // 失败时仍然发出就绪标记，否则 F5 会一直等 build；但要先说明 dist 未更新。
  if (roundErrors.length > 0) {
    console.log(`[watch] 构建失败（${roundErrors.join(', ')}），dist 仍是上一次的产物`);
    roundErrors = [];
  }
  idle = true;
  console.log(READY);
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
        build.onEnd(result => finish('ext', result.errors));
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
  else if (event.code === 'BUNDLE_END') finish('webview');
  else if (event.code === 'ERROR') finish('webview', [event.error]);
});

await ext.watch();

process.on('SIGINT', async () => {
  await ext.dispose();
  await watcher.close();
  process.exit(0);
});
