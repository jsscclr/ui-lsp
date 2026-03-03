import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        server: resolve(__dirname, 'src/server.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        'vscode-languageserver',
        'vscode-languageserver-textdocument',
        'vscode-languageserver/node',
        'vscode-languageserver/node.js',
        'ws',
        'ts-morph',
        'yoga-layout',
        'node:child_process',
        'node:fs',
        'node:path',
        'node:http',
        'node:url',
      ],
    },
  },
  plugins: [dts({ rollupTypes: false })],
  test: {
    globals: true,
  },
});
