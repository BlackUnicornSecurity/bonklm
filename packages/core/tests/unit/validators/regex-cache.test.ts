/**
 * Regex Cache Tests (S016-001)
 * =============================
 * Tests for the LRU regex cache implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { RegexCache, getRegexCache, setRegexCache, resetRegexCache } from '../../../src/validators/pattern-engine.js';

describe('RegexCache (S016-001)', () => {
  let cache: RegexCache;

  beforeEach(() => {
    cache = new RegexCache(10);
    resetRegexCache();
  });

  afterEach(() => {
    resetRegexCache();
  });

  describe('Cache Hit/Miss Behavior', () => {
    it('should return cached regex on subsequent calls', () => {
      const pattern1 = cache.get('\\d+', 'g');
      const pattern2 = cache.get('\\d+', 'g');

      expect(pattern1).toBe(pattern2);
      expect(cache.getStats().hits).toBe(1);
      expect(cache.getStats().misses).toBe(1);
    });

    it('should differentiate between patterns with different flags', () => {
      const pattern1 = cache.get('\\d+', 'g');
      const pattern2 = cache.get('\\d+', 'gi');
      const pattern3 = cache.get('\\d+', 'g');

      expect(pattern1).not.toBe(pattern2);
      expect(pattern1).toBe(pattern3);
      expect(cache.getStats().hits).toBe(1);
      expect(cache.getStats().misses).toBe(2);
    });

    it('should track hit rate correctly', () => {
      cache.get('\\d+', 'g');
      cache.get('\\d+', 'g');
      cache.get('\\w+', 'g');
      cache.get('\\w+', 'g');

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(0.5);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict oldest entry when at capacity', () => {
      const maxSize = 3;
      const smallCache = new RegexCache(maxSize);

      smallCache.get('pattern1', '');
      smallCache.get('pattern2', '');
      smallCache.get('pattern3', '');

      expect(smallCache.size()).toBe(maxSize);

      // This should evict pattern1
      smallCache.get('pattern4', '');

      expect(smallCache.size()).toBe(maxSize);
      expect(smallCache.getStats().misses).toBe(4);

      // pattern1 should be a cache miss now
      smallCache.get('pattern1', '');
      expect(smallCache.getStats().misses).toBe(5);
    });

    it('should update access time on cache hit', async () => {
      const maxSize = 3;
      const smallCache = new RegexCache(maxSize);

      smallCache.get('pattern1', '');
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 2));
      smallCache.get('pattern2', '');
      await new Promise(resolve => setTimeout(resolve, 2));
      smallCache.get('pattern3', '');

      // Access pattern1 to update its access time
      await new Promise(resolve => setTimeout(resolve, 2));
      smallCache.get('pattern1', '');

      // Add pattern4 - pattern2 should be evicted (oldest access time)
      await new Promise(resolve => setTimeout(resolve, 2));
      smallCache.get('pattern4', '');

      expect(smallCache.size()).toBe(maxSize);
      expect(smallCache.getStats().misses).toBe(4);

      // pattern1 should still be cached
      smallCache.get('pattern1', '');
      expect(smallCache.getStats().hits).toBe(2);
    });
  });

  describe('Cache Statistics', () => {
    it('should return accurate statistics', () => {
      cache.get('\\d+', 'g');
      cache.get('\\d+', 'g');
      cache.get('\\w+', 'i');

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
      expect(stats.size).toBe(2);
      expect(stats.hitRate).toBeCloseTo(0.333, 1);
    });

    it('should handle empty cache statistics', () => {
      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('Cache Management', () => {
    it('should clear all cached entries', () => {
      cache.get('\\d+', 'g');
      cache.get('\\w+', 'i');

      expect(cache.size()).toBe(2);

      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.getStats().hits).toBe(0);
      expect(cache.getStats().misses).toBe(0);
    });

    it('should return current cache size', () => {
      expect(cache.size()).toBe(0);

      cache.get('\\d+', 'g');
      expect(cache.size()).toBe(1);

      cache.get('\\w+', 'i');
      expect(cache.size()).toBe(2);
    });
  });

  describe('Regex Functionality', () => {
    it('should produce working regex patterns', () => {
      const pattern = cache.get('\\d+', 'g');
      const matches = 'test123abc456'.match(pattern);

      expect(matches).toEqual(['123', '456']);
    });

    it('should handle complex patterns', () => {
      const pattern = cache.get('(?:step|rule|instruction)\\s*\\d+', 'gi');
      const matches = 'Follow step1, step2, and rule3'.match(pattern);

      expect(matches).toEqual(['step1', 'step2', 'rule3']);
    });

    it('should handle patterns with special characters', () => {
      const pattern = cache.get('^\\s*[-*•]\\s+', 'gm');
      const matches = '* Item 1\n- Item 2\n• Item 3'.match(pattern);

      expect(matches).toEqual(['* ', '- ', '• ']);
    });
  });

  describe('Global Regex Cache (S016-001)', () => {
    afterEach(() => {
      resetRegexCache();
    });

    it('should return singleton instance', () => {
      const cache1 = getRegexCache();
      const cache2 = getRegexCache();

      expect(cache1).toBe(cache2);
    });

    it('should allow custom cache instance', () => {
      const customCache = new RegexCache(5);
      setRegexCache(customCache);

      const retrieved = getRegexCache();
      expect(retrieved).toBe(customCache);
      expect(retrieved.getStats().misses).toBe(0);
    });

    it('should reset to new instance after reset', () => {
      const cache1 = getRegexCache();
      cache1.get('\\d+', 'g');

      resetRegexCache();

      const cache2 = getRegexCache();
      expect(cache2).not.toBe(cache1);
      expect(cache2.getStats().hits).toBe(0);
      expect(cache2.getStats().misses).toBe(0);
    });
  });
});
