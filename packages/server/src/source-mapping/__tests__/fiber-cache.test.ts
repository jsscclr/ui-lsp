import { describe, it, expect, vi } from 'vitest';
import { FiberCache } from '../fiber-cache.js';

describe('FiberCache', () => {
  it('stores and retrieves values', () => {
    const cache = new FiberCache<string>();
    cache.set('a:1:0', 'hello');
    expect(cache.get('a:1:0')).toBe('hello');
  });

  it('returns undefined for missing keys', () => {
    const cache = new FiberCache<string>();
    expect(cache.get('missing')).toBeUndefined();
  });

  it('evicts expired entries', () => {
    vi.useFakeTimers();
    try {
      const cache = new FiberCache<string>(100, 50); // 50ms TTL
      cache.set('a:1:0', 'hello');
      expect(cache.get('a:1:0')).toBe('hello');

      vi.advanceTimersByTime(100);
      expect(cache.get('a:1:0')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts oldest when at capacity', () => {
    const cache = new FiberCache<string>(2, 60_000);
    cache.set('a', 'first');
    cache.set('b', 'second');
    cache.set('c', 'third'); // should evict 'a'

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('second');
    expect(cache.get('c')).toBe('third');
  });

  it('makes a correct key from file:line:col', () => {
    expect(FiberCache.makeKey('/src/App.tsx', 10, 5)).toBe('/src/App.tsx:10:5');
  });

  it('invalidates all entries', () => {
    const cache = new FiberCache<string>();
    cache.set('a', 'hello');
    cache.set('b', 'world');
    cache.invalidate();
    expect(cache.size).toBe(0);
  });
});
