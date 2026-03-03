import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['iife'],
      name: '__UI_LS__',
      fileName: 'index',
    },
    minify: true,
  },
  test: {
    globals: true,
  },
});
