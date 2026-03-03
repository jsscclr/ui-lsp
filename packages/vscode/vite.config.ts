import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/extension.ts'),
      formats: ['cjs'],
      fileName: 'extension',
    },
    rollupOptions: {
      external: (id) =>
        id === 'vscode' ||
        id.startsWith('vscode-languageclient') ||
        id.startsWith('node:'),
    },
  },
  test: {
    globals: true,
  },
});
