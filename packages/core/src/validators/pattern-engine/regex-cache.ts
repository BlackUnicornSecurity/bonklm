/**
 * Pattern engine — LRU regex-compilation cache (S016-001)
 *
 * Extracted verbatim from the former monolithic `pattern-engine.ts`
 * (Tier-0 file-cap compliance, behavior-identical move — pinned by
 * `tests/validators/pattern-catalog-characterization.test.ts`).
 */
// REGEX CACHE (S016-001)
// =============================================================================

/**
 * Cache entry for compiled regex patterns.
 */
interface CacheEntry {
  pattern: RegExp;
  lastAccess: number;
}

/**
 * LRU Cache for compiled regex patterns.
 * S016-001: Prevents DoS attacks through repeated regex compilation.
 */
export class RegexCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly maxSize: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  /**
   * Get or compile a regex pattern.
   */
  get(pattern: string, flags: string = ''): RegExp {
    const key = `${flags}:${pattern}`;

    const entry = this.cache.get(key);
    if (entry) {
      entry.lastAccess = Date.now();
      this.hits++;
      return entry.pattern;
    }

    this.misses++;
    const compiled = new RegExp(pattern, flags);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      let oldestKey: string | null = null;
      let oldestTime = Number.MAX_VALUE;

      // Use Array.from to avoid downlevelIteration issues
      const entries = Array.from(this.cache.entries());
      for (const [k, v] of entries) {
        if (v.lastAccess < oldestTime) {
          oldestTime = v.lastAccess;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      pattern: compiled,
      lastAccess: Date.now()
    });

    return compiled;
  }

  /**
   * Get cache statistics.
   */
  getStats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0
    };
  }

  /**
   * Clear the cache.
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get current cache size.
   */
  size(): number {
    return this.cache.size;
  }
}

/**
 * Global regex cache instance.
 */
let globalRegexCache: RegexCache | undefined;

/**
 * Get or create the global regex cache.
 */
export function getRegexCache(maxSize = 1000): RegexCache {
  if (!globalRegexCache) {
    globalRegexCache = new RegexCache(maxSize);
  }
  return globalRegexCache;
}

/**
 * Set the global regex cache (useful for testing).
 */
export function setRegexCache(cache: RegexCache): void {
  globalRegexCache = cache;
}

/**
 * Reset the global regex cache.
 */
export function resetRegexCache(): void {
  globalRegexCache = undefined;
}
