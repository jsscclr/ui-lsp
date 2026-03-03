import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'shared',
      root: './packages/shared',
      globals: true,
    },
  },
  {
    test: {
      name: 'server',
      root: './packages/server',
      globals: true,
    },
  },
  {
    test: {
      name: 'browser',
      root: './packages/browser',
      globals: true,
    },
  },
  {
    test: {
      name: 'e2e',
      root: './test',
      globals: true,
    },
  },
]);
