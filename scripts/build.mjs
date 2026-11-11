import { build as buildExtension } from 'esbuild';
import { build as buildWebview } from 'vite';
import { mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await mkdir('artifacts', { recursive: true });
await buildExtension({
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
});
await buildWebview({ configFile: 'vite.config.ts' });
