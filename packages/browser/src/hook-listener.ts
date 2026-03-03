import { walkFiberTree, type FiberSourceEntry } from './fiber-walker.js';

interface ReactDevToolsHook {
  getFiberRoots: (rendererID: number) => Set<{ current: unknown }>;
  onCommitFiberRoot: unknown;
  renderers: Map<number, unknown>;
}

type CommitCallback = (entries: Map<string, FiberSourceEntry>) => void;

/**
 * Subscribes to React's onCommitFiberRoot to rebuild the fiber → DOM mapping
 * on every React commit. This keeps the mapping fresh as components re-render.
 */
export function installHookListener(onUpdate: CommitCallback): () => void {
  const hook = (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: ReactDevToolsHook })
    .__REACT_DEVTOOLS_GLOBAL_HOOK__;

  if (!hook) {
    console.warn('[ui-ls] React DevTools hook not found');
    return () => {};
  }

  // Patch onCommitFiberRoot to intercept commits
  const originalOnCommitFiberRoot = hook.onCommitFiberRoot;

  hook.onCommitFiberRoot = function (
    rendererID: number,
    fiberRoot: { current: unknown },
    ...rest: unknown[]
  ) {
    // Call original if it's a function (DevTools may have set one)
    if (typeof originalOnCommitFiberRoot === 'function') {
      (originalOnCommitFiberRoot as Function)(rendererID, fiberRoot, ...rest);
    }

    // Rebuild our mapping
    try {
      const entries = walkFiberTree(fiberRoot.current as Parameters<typeof walkFiberTree>[0]);
      onUpdate(entries);
    } catch (err) {
      console.error('[ui-ls] Error walking fiber tree:', err);
    }
  };

  // Do an initial walk of existing roots
  for (const [rendererID] of hook.renderers) {
    const roots = hook.getFiberRoots(rendererID);
    for (const root of roots) {
      try {
        const entries = walkFiberTree(root.current as Parameters<typeof walkFiberTree>[0]);
        onUpdate(entries);
      } catch (err) {
        console.error('[ui-ls] Error in initial fiber walk:', err);
      }
    }
  }

  // Return cleanup function
  return () => {
    hook.onCommitFiberRoot = originalOnCommitFiberRoot;
  };
}
