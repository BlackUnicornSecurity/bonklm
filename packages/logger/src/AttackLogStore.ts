/**
 * Attack Log Store - In-Memory Storage with LRU Eviction
 * =======================================================
 *
 * Thread-safe in-memory storage for attack log entries with:
 * - O(1) LRU eviction using lru-cache
 * - TTL-based automatic expiration
 * - Memory-safe with hard ceiling
 *
 * @package @blackunicorn/bonklm-logger
 */

import { LRUCache } from 'lru-cache';
import type { AttackLogEntry } from './types.js';

/**
 * Configuration options for AttackLogStore.
 */
export interface AttackLogStoreConfig {
  /** Maximum number of entries to store */
  max_logs: number;
  /** Time-to-live for entries in milliseconds */
  ttl: number;
}

/**
 * In-memory storage for attack log entries with LRU eviction.
 *
 * Features:
 * - O(1) get/set/delete operations
 * - Automatic LRU eviction when max_logs is reached
 * - TTL-based expiration (lazy eviction on access)
 * - Thread-safe for Node.js async operations
 *
 * @example
 * ```typescript
 * const store = new AttackLogStore({ max_logs: 1000, ttl: 2592000000 });
 * await store.set('key-123', entry);
 * const entry = store.get('key-123');
 * const count = store.count;
 * ```
 */
export class AttackLogStore {
  private readonly cache: LRUCache<string, AttackLogEntry>;
  private readonly maxLogs: number;
  private readonly ttl: number;

  constructor(config: AttackLogStoreConfig) {
    this.maxLogs = config.max_logs;
    this.ttl = config.ttl;

    this.cache = new LRUCache<string, AttackLogEntry>({
      max: this.maxLogs,
      ttl: this.ttl,
      // Update access time on get (for LRU tracking)
      updateAgeOnGet: true,
      // Don't allow stale values
      allowStale: false,
      // Optional disposal callback
      dispose: (_value, _key, _reason) => {
        // Entry evicted - no cleanup needed for in-memory objects
      }
    });
  }

  /**
   * Store an entry with the given key.
   * If the key exists, it is updated and moved to most-recent.
   * If at capacity, the least-recently-used entry is evicted.
   *
   * @param key - Unique identifier for the entry
   * @param entry - Attack log entry to store
   * @returns Promise that resolves when stored
   */
  async set(key: string, entry: AttackLogEntry): Promise<void> {
    // Yield to event loop for non-blocking behavior
    await Promise.resolve();
    this.cache.set(key, entry);
  }

  /**
   * Retrieve an entry by key.
   * Returns undefined if key doesn't exist or entry has expired.
   *
   * @param key - Unique identifier for the entry
   * @returns The entry if found and valid, undefined otherwise
   */
  get(key: string): AttackLogEntry | undefined {
    return this.cache.get(key);
  }

  /**
   * Check if an entry exists and is valid.
   *
   * @param key - Unique identifier for the entry
   * @returns true if entry exists and hasn't expired
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete an entry by key.
   *
   * @param key - Unique identifier for the entry
   * @returns true if entry was deleted, false if not found
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the store.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get all valid entries as an array.
   * Entries are ordered by most-recently-used first.
   *
   * @returns Array of all valid entries
   */
  getAll(): AttackLogEntry[] {
    const entries: AttackLogEntry[] = [];
    for (const [, value] of this.cache) {
      entries.push(value);
    }
    return entries;
  }

  /**
   * Get the current number of entries in the store.
   */
  get count(): number {
    return this.cache.size;
  }

  /**
   * Check if the store is at maximum capacity.
   */
  get isAtCapacity(): boolean {
    return this.cache.size >= this.maxLogs;
  }

  /**
   * Get the maximum capacity of the store.
   */
  get maxCapacity(): number {
    return this.maxLogs;
  }

  /**
   * Get the configured TTL in milliseconds.
   */
  get ttlMs(): number {
    return this.ttl;
  }

  /**
   * Get entries that are approaching TTL expiration.
   * Returns entries older than 75% of TTL.
   *
   * @param now - Current timestamp (defaults to Date.now())
   * @returns Entries approaching expiration
   */
  getEntriesApproachingTTL(now: number = Date.now()): AttackLogEntry[] {
    const ttlThreshold = this.ttl * 0.75; // 75% of TTL
    const thresholdTimestamp = now - ttlThreshold;
    const approaching: AttackLogEntry[] = [];

    for (const [, entry] of this.cache) {
      if (entry.timestamp <= thresholdTimestamp) {
        approaching.push(entry);
      }
    }

    return approaching;
  }

  /**
   * Get statistics about the store.
   */
  getStats(): {
    size: number;
    max: number;
    ttl: number;
    isAtCapacity: boolean;
    calculatedSize: number;
  } {
    return {
      size: this.cache.size,
      max: this.maxLogs,
      ttl: this.ttl,
      isAtCapacity: this.isAtCapacity,
      calculatedSize: this.cache.calculatedSize
    };
  }
}
