interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

/**
 * Simple LRU cache with TTL for fiber tree lookup results.
 * Keyed by `file:line:col` strings.
 */
export class FiberCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize = 100, ttlMs = 5_000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  static makeKey(file: string, line: number, col: number): string {
    return `${file}:${line}:${col}`;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    // Move to end (most recently accessed)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
    }
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  invalidate(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
