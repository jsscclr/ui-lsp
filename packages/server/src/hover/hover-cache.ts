interface CacheEntry {
  content: string;
  timestamp: number;
}

/**
 * LRU cache for formatted hover content, keyed by `file:line:col`.
 * Short TTL (5s) so content stays fresh as the user navigates.
 */
export class HoverCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize = 200, ttlMs = 5_000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  static makeKey(file: string, line: number, col: number): string {
    return `${file}:${line}:${col}`;
  }

  get(key: string): string | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.content;
  }

  set(key: string, content: string): void {
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
    }
    this.cache.set(key, { content, timestamp: Date.now() });
  }

  invalidate(): void {
    this.cache.clear();
  }
}
