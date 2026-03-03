import { findFiberEntry, type FiberSourceEntry } from './fiber-walker.js';
import { installHookListener } from './hook-listener.js';

/** The latest fiber → DOM mapping, updated on every React commit. */
let currentEntries = new Map<string, FiberSourceEntry>();

const cleanup = installHookListener((entries) => {
  currentEntries = entries;
});

/**
 * Public API exposed on window.__UI_LS__ for the LSP server to call
 * via Runtime.evaluate.
 */
const api = {
  /** Find a fiber entry by source file and line number. */
  findFiber(fileName: string, line: number) {
    const entry = findFiberEntry(currentEntries, fileName, line);
    if (!entry) return { found: false as const };
    return {
      found: true as const,
      _element: entry.stateNode,
      props: entry.props,
      componentName: entry.componentName,
    };
  },

  /** Get the total number of tracked fiber entries. */
  getEntryCount() {
    return currentEntries.size;
  },

  /** Clean up the hook listener. */
  dispose() {
    cleanup();
    currentEntries.clear();
  },
};

// Expose on window for Runtime.evaluate access
(window as unknown as { __UI_LS__: typeof api }).__UI_LS__ = api;

export type { FiberSourceEntry };
export { api };
