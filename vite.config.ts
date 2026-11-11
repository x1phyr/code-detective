import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'webview'),
  base: './',
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['terminal.local'],
    fs: { allow: [__dirname] },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/webview'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: path.resolve(__dirname, 'webview/src/main.ts'),
      output: {
        entryFileNames: 'index.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (asset) => asset.names?.some((name) => name.endsWith('.css')) ? 'style.css' : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
