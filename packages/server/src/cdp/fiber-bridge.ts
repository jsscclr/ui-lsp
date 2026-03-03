import type { FiberLookupResponse } from '@ui-ls/shared';

/**
 * Builds an async JS expression for Runtime.evaluate that:
 * 1. Finds the browser URL for the target file from fiber stacks
 * 2. Fetches the Vite-served source + inline source map
 * 3. Decodes the source map to resolve original→generated line numbers
 * 4. Walks the fiber tree matching by generated line
 *
 * Supports both React 18 (_debugSource) and React 19 (_debugStack).
 * Must be called with awaitPromise: true.
 */
export function buildFiberLookupExpression(
  fileName: string,
  line: number,
  _column: number,
): string {
  const escapedFileName = fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  return `(async function() {
  var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook || !hook.getFiberRoots) {
    if (window.__UI_LS__ && window.__UI_LS__.findFiber) {
      return window.__UI_LS__.findFiber('${escapedFileName}', ${line});
    }
    return { found: false };
  }

  var targetFile = '${escapedFileName}'.replace(/\\\\\\\\/g, '/');
  var targetOrigLine = ${line}; // 0-based original line

  // --- React 18 fast path: _debugSource has direct line numbers ---
  var r18result = { found: false };
  function walkR18(fiber) {
    if (!fiber || r18result.found) return;
    if (fiber._debugSource && fiber._debugSource.lineNumber === (targetOrigLine + 1)) {
      var sf = (fiber._debugSource.fileName || '').replace(/\\\\?.*$/, '').replace(/\\\\\\\\/g, '/');
      if (sf === targetFile || sf.endsWith(targetFile) || targetFile.endsWith(sf)) {
        var el = findElement(fiber);
        if (el) r18result = buildResult(fiber, el);
      }
    }
    walkR18(fiber.child);
    if (!r18result.found) walkR18(fiber.sibling);
  }
  hook.getFiberRoots(1).forEach(function(root) { walkR18(root.current); });
  if (r18result.found) return r18result;

  // --- React 19 path: resolve via source map ---

  // Parse a stack frame URL + line:col (handles port numbers in URLs)
  function parseFrame(frame) {
    var m = frame.match(/(https?:\\/\\/\\S+?):(\\d+):(\\d+)/);
    if (!m) return null;
    return { url: m[1], line: parseInt(m[2], 10) };
  }

  // Get the first non-React stack frame from a fiber
  function getFiberFrame(fiber) {
    if (!fiber._debugStack || !fiber._debugStack.stack) return null;
    var lines = fiber._debugStack.stack.split('\\n');
    for (var i = 1; i < lines.length; i++) {
      var f = lines[i];
      if (f.indexOf('jsx-dev-runtime') !== -1 ||
          f.indexOf('react-dom') !== -1 ||
          f.indexOf('react.development') !== -1 ||
          (f.indexOf('chunk-') !== -1 && f.indexOf('react') !== -1)) continue;
      return parseFrame(f);
    }
    return null;
  }

  // Step 1: Find the browser URL for our target file by scanning fiber stacks
  var fileSuffix = targetFile.split('/').slice(-2).join('/'); // e.g. "src/App.tsx"
  var browserUrl = null;
  function findUrl(fiber) {
    if (!fiber || browserUrl) return;
    var frame = getFiberFrame(fiber);
    if (frame && frame.url.indexOf(fileSuffix) !== -1) {
      browserUrl = frame.url;
    }
    findUrl(fiber.child);
    if (!browserUrl) findUrl(fiber.sibling);
  }
  hook.getFiberRoots(1).forEach(function(root) { findUrl(root.current); });
  if (!browserUrl) return { found: false };

  // Step 2: Fetch source and decode inline source map
  var genLines = null;
  try {
    var resp = await fetch(browserUrl);
    var text = await resp.text();
    var smMatch = text.match(/\\/\\/# sourceMappingURL=data:application\\/json;base64,([^\\s]+)/);
    if (smMatch) {
      var map = JSON.parse(atob(smMatch[1]));
      genLines = resolveLines(map.mappings, targetOrigLine);
    }
  } catch(e) {}

  if (!genLines || genLines.length === 0) return { found: false };

  // Step 3: Walk fibers matching against resolved generated lines
  // Generated lines from source map are 0-based; stack trace lines are 1-based
  var targetGenLines = {};
  for (var i = 0; i < genLines.length; i++) targetGenLines[genLines[i] + 1] = true;

  var result = { found: false };
  function walkFiber(fiber) {
    if (!fiber || result.found) return;
    var frame = getFiberFrame(fiber);
    if (frame && frame.url === browserUrl && targetGenLines[frame.line]) {
      var el = findElement(fiber);
      if (el) result = buildResult(fiber, el);
    }
    walkFiber(fiber.child);
    if (!result.found) walkFiber(fiber.sibling);
  }
  hook.getFiberRoots(1).forEach(function(root) { walkFiber(root.current); });
  return result;

  // --- Helpers ---

  function findElement(fiber) {
    var node = fiber.stateNode;
    if (node instanceof HTMLElement) return node;
    var child = fiber.child;
    while (child) {
      if (child.stateNode instanceof HTMLElement) return child.stateNode;
      child = child.child;
    }
    return null;
  }

  function buildResult(fiber, element) {
    var props = {};
    var mp = fiber.memoizedProps;
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
    var name = fiber.type
      ? (typeof fiber.type === 'string' ? fiber.type : (fiber.type.displayName || fiber.type.name || 'Anonymous'))
      : 'Unknown';
    // Store element in global — DOM nodes can't be JSON-serialized (circular refs)
    window.__UI_LS_FOUND_ELEMENT__ = element;
    return { found: true, props: props, componentName: name };
  }

  // Minimal VLQ source map decoder — resolves original line to generated line(s)
  function resolveLines(mappings, origLine) {
    var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    function vlq(s) {
      var r = [], sh = 0, v = 0;
      for (var i = 0; i < s.length; i++) {
        var d = B64.indexOf(s[i]);
        if (d < 0) continue;
        v += (d & 31) << sh;
        if (d & 32) { sh += 5; continue; }
        r.push(v & 1 ? -(v >> 1) : v >> 1);
        v = 0; sh = 0;
      }
      return r;
    }
    var result = [];
    var srcIdx = 0, oLine = 0, oCol = 0;
    var lines = mappings.split(';');
    for (var g = 0; g < lines.length; g++) {
      if (!lines[g]) continue;
      var segs = lines[g].split(',');
      var gCol = 0;
      for (var s = 0; s < segs.length; s++) {
        if (!segs[s]) continue;
        var d = vlq(segs[s]);
        gCol += d[0] || 0;
        if (d.length >= 4) {
          srcIdx += d[1];
          oLine += d[2];
          oCol += d[3];
          if (srcIdx === 0 && oLine === origLine && result.indexOf(g) === -1) {
            result.push(g);
          }
        }
      }
    }
    return result;
  }
})()`;
}

/**
 * Builds a simpler expression to check if React DevTools hook is available.
 */
export function buildReactDetectionExpression(): string {
  return `!!(window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || window.__UI_LS__)`;
}

/**
 * Diagnostic: dump all _debugSource entries from the fiber tree.
 * Used for troubleshooting source mapping issues.
 */
export function buildFiberDiagnosticExpression(): string {
  return `(function() {
  var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook || !hook.getFiberRoots) return { error: 'no hook' };

  var rendererCount = hook.renderers ? hook.renderers.size : 0;
  var rootSets = [];
  for (var rid = 1; rid <= Math.max(rendererCount, 3); rid++) {
    var rs = hook.getFiberRoots(rid);
    if (rs && rs.size > 0) rootSets.push({ rendererId: rid, rootCount: rs.size });
  }

  var fibers = [];
  var sourceFibers = [];
  function walk(fiber) {
    if (!fiber || fibers.length > 50) return;
    var typeName = typeof fiber.type === 'string' ? fiber.type : (fiber.type && (fiber.type.displayName || fiber.type.name)) || null;
    var info = { type: typeName, tag: fiber.tag };

    // Collect ALL debug-related fields
    var debugKeys = Object.keys(fiber).filter(function(k) { return k.indexOf('debug') !== -1 || k.indexOf('_debug') !== -1 || k.indexOf('source') !== -1; });
    if (debugKeys.length > 0) info.debugKeys = debugKeys;
    if (fiber._debugSource) info._debugSource = fiber._debugSource;
    if (fiber._debugOwner) info.hasDebugOwner = true;
    if (fiber._debugInfo) info._debugInfo = typeof fiber._debugInfo;
    if (fiber._debugHookTypes) info._debugHookTypes = true;
    if (fiber._debugStack) info.hasDebugStack = typeof fiber._debugStack;
    if (fiber._debugTask) info.hasDebugTask = typeof fiber._debugTask;

    fibers.push(info);
    if (info._debugSource) sourceFibers.push(info);
    walk(fiber.child);
    if (!fiber.child) walk(fiber.sibling);
    else { walk(fiber.sibling); }
  }

  hook.getFiberRoots(1).forEach(function(root) { walk(root.current); });

  // Parse _debugStack to extract source locations for each fiber
  var parsedFibers = [];
  function parseStack(fiber) {
    if (!fiber || parsedFibers.length > 20) return;
    var typeName = typeof fiber.type === 'string' ? fiber.type : (fiber.type && (fiber.type.displayName || fiber.type.name)) || null;
    var entry = { type: typeName, tag: fiber.tag, source: null };
    if (fiber._debugStack && fiber._debugStack.stack) {
      var lines = fiber._debugStack.stack.split('\\n');
      for (var i = 1; i < lines.length; i++) {
        var frame = lines[i];
        if (frame.indexOf('jsx-dev-runtime') !== -1) continue;
        if (frame.indexOf('react-dom') !== -1) continue;
        if (frame.indexOf('react.development') !== -1) continue;
        if (frame.indexOf('chunk-') !== -1 && frame.indexOf('react') !== -1) continue;
        var urlMatch = frame.match(/(https?:\\/\\/[^:)\\s]+):(\\d+):(\\d+)/);
        if (urlMatch) {
          try {
            var url = new URL(urlMatch[1]);
            entry.source = { path: url.pathname, line: parseInt(urlMatch[2], 10), col: parseInt(urlMatch[3], 10) };
          } catch(e) { entry.source = { error: String(e), raw: frame }; }
          break;
        }
        entry.source = { noMatch: true, raw: frame.substring(0, 200) };
        break;
      }
    }
    parsedFibers.push(entry);
    parseStack(fiber.child);
    parseStack(fiber.sibling);
  }
  hook.getFiberRoots(1).forEach(function(root) { parseStack(root.current); });

  return {
    rendererCount: rendererCount,
    rootSets: rootSets,
    fiberCount: fibers.length,
    parsedFibers: parsedFibers
  };
})()`;
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
