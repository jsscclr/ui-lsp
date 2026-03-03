import type { FiberLookupResponse } from '@ui-ls/shared';

/**
 * Builds JS expressions for Runtime.evaluate that walk the React fiber tree
 * to find a component matching a given source location.
 *
 * The expression accesses __REACT_DEVTOOLS_GLOBAL_HOOK__ (injected by React),
 * walks fiber nodes matching _debugSource.fileName + lineNumber, and returns
 * the associated DOM element's objectId + memoized props.
 */
export function buildFiberLookupExpression(
  fileName: string,
  line: number,
  _column: number,
): string {
  // Escape for embedding in a JS string literal
  const escapedFileName = fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // This runs in the browser context via Runtime.evaluate
  return `(function() {
  var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook || !hook.getFiberRoots) {
    // Try the companion API if available
    if (window.__UI_LS__ && window.__UI_LS__.findFiber) {
      return window.__UI_LS__.findFiber('${escapedFileName}', ${line});
    }
    return { found: false };
  }

  var result = { found: false };

  function normalizePath(p) {
    if (!p) return '';
    // Strip webpack/vite prefixes and normalize separators
    return p.replace(/^(webpack-internal:\\/\\/\\/|\\/@fs)/, '')
            .replace(/\\?.*$/, '')
            .replace(/\\\\/g, '/');
  }

  var targetFile = normalizePath('${escapedFileName}');

  function walkFiber(fiber) {
    if (!fiber || result.found) return;

    var source = fiber._debugSource;
    if (source && source.lineNumber === ${line}) {
      var sourceFile = normalizePath(source.fileName);
      if (sourceFile === targetFile || sourceFile.endsWith(targetFile) || targetFile.endsWith(sourceFile)) {
        var stateNode = fiber.stateNode;
        // Walk up to find the nearest DOM node if this is a class/function component
        if (!stateNode || !(stateNode instanceof HTMLElement)) {
          var child = fiber.child;
          while (child) {
            if (child.stateNode instanceof HTMLElement) {
              stateNode = child.stateNode;
              break;
            }
            child = child.child;
          }
        }
        if (stateNode instanceof HTMLElement) {
          result = {
            found: true,
            element: stateNode,
            props: fiber.memoizedProps || {},
            componentName: fiber.type
              ? (typeof fiber.type === 'string' ? fiber.type : (fiber.type.displayName || fiber.type.name || 'Anonymous'))
              : 'Unknown'
          };
        }
      }
    }

    walkFiber(fiber.child);
    if (!result.found) walkFiber(fiber.sibling);
  }

  hook.getFiberRoots(1).forEach(function(root) {
    walkFiber(root.current);
  });

  // Strip the element reference for JSON serialization, keep it for objectId resolution
  if (result.found && result.element) {
    result._element = result.element;
    var props = {};
    var mp = result.props;
    if (mp && typeof mp === 'object') {
      Object.keys(mp).forEach(function(k) {
        if (k === 'children') return;
        var v = mp[k];
        if (typeof v !== 'function' && typeof v !== 'object') {
          props[k] = v;
        } else if (typeof v === 'object' && v !== null) {
          try { props[k] = JSON.parse(JSON.stringify(v)); } catch(e) { props[k] = String(v); }
        }
      });
    }
    return { found: true, props: props, componentName: result.componentName, _element: result._element };
  }

  return result;
})()`;
}

/**
 * Builds a simpler expression to check if React DevTools hook is available.
 */
export function buildReactDetectionExpression(): string {
  return `!!(window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || window.__UI_LS__)`;
}

/** Parse the by-value portion of a fiber lookup result. */
export function parseFiberLookupResult(value: unknown): Omit<FiberLookupResponse, 'objectId'> {
  if (!value || typeof value !== 'object') {
    return { found: false };
  }
  const obj = value as Record<string, unknown>;
  if (!obj.found) {
    return { found: false };
  }
  return {
    found: true,
    props: (obj.props as Record<string, unknown>) ?? {},
    componentName: (obj.componentName as string) ?? 'Unknown',
  };
}
