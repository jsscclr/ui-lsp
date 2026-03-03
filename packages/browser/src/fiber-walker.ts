export interface FiberSourceEntry {
  sourceKey: string;
  stateNode: HTMLElement;
  props: Record<string, unknown>;
  componentName: string;
}

interface Fiber {
  type: unknown;
  stateNode: unknown;
  child: Fiber | null;
  sibling: Fiber | null;
  memoizedProps: Record<string, unknown> | null;
  _debugSource?: { fileName: string; lineNumber: number; columnNumber?: number };
}

function normalizePath(p: string): string {
  return p
    .replace(/^(webpack-internal:\/\/\/|\/@fs)/, '')
    .replace(/\?.*$/, '')
    .replace(/\\/g, '/');
}

function getComponentName(fiber: Fiber): string {
  if (!fiber.type) return 'Unknown';
  if (typeof fiber.type === 'string') return fiber.type;
  const ft = fiber.type as { displayName?: string; name?: string };
  return ft.displayName ?? ft.name ?? 'Anonymous';
}

function serializeProps(props: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key === 'children') continue;
    const val = props[key];
    if (typeof val === 'function') continue;
    if (typeof val !== 'object' || val === null) {
      result[key] = val;
    } else {
      try {
        result[key] = JSON.parse(JSON.stringify(val));
      } catch {
        result[key] = String(val);
      }
    }
  }
  return result;
}

/**
 * Walks a fiber tree and builds a map of source locations → DOM elements.
 * Key format: `normalizedFilePath:lineNumber`
 */
export function walkFiberTree(rootFiber: Fiber): Map<string, FiberSourceEntry> {
  const entries = new Map<string, FiberSourceEntry>();

  function walk(fiber: Fiber | null): void {
    if (!fiber) return;

    const source = fiber._debugSource;
    if (source?.fileName && source.lineNumber) {
      const normalizedFile = normalizePath(source.fileName);
      const key = `${normalizedFile}:${source.lineNumber}`;

      // Find the nearest DOM node
      let domNode: HTMLElement | null = null;
      if (fiber.stateNode instanceof HTMLElement) {
        domNode = fiber.stateNode;
      } else {
        // Walk children to find nearest host element
        let child = fiber.child;
        while (child) {
          if (child.stateNode instanceof HTMLElement) {
            domNode = child.stateNode;
            break;
          }
          child = child.child;
        }
      }

      if (domNode) {
        entries.set(key, {
          sourceKey: key,
          stateNode: domNode,
          props: serializeProps(fiber.memoizedProps ?? {}),
          componentName: getComponentName(fiber),
        });
      }
    }

    walk(fiber.child);
    walk(fiber.sibling);
  }

  walk(rootFiber);
  return entries;
}

/**
 * Quick lookup: find a fiber entry by file path and line number.
 */
export function findFiberEntry(
  entries: Map<string, FiberSourceEntry>,
  fileName: string,
  line: number,
): FiberSourceEntry | undefined {
  const normalizedFile = normalizePath(fileName);
  const directKey = `${normalizedFile}:${line}`;

  // Try direct match first
  const direct = entries.get(directKey);
  if (direct) return direct;

  // Try suffix match (handles different path prefixes between editor and browser)
  for (const [key, entry] of entries) {
    const keyFile = key.substring(0, key.lastIndexOf(':'));
    if (keyFile.endsWith(normalizedFile) || normalizedFile.endsWith(keyFile)) {
      const keyLine = Number(key.substring(key.lastIndexOf(':') + 1));
      if (keyLine === line) return entry;
    }
  }

  return undefined;
}
