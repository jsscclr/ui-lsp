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
      external: ['vscode', 'vscode-languageclient', 'vscode-languageclient/node', 'node:path'],
    },
  },
  test: {
    globals: true,
  },
});
