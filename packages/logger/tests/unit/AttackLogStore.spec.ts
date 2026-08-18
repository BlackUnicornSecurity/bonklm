/**
 * AttackLogStore Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AttackLogStore } from '../../src/AttackLogStore.js';
import type { AttackLogEntry } from '../../src/types.js';

describe('AttackLogStore', () => {
  let store: AttackLogStore;

  beforeEach(() => {
    store = new AttackLogStore({
      max_logs: 10,
      ttl: 60000 // 1 minute for tests
    });
  });

  afterEach(() => {
    store.clear();
  });

  const createMockEntry = (overrides?: Partial<AttackLogEntry>): AttackLogEntry => ({
    timestamp: Date.now(),
    origin: 'test-origin',
    injection_type: 'prompt-injection',
    vector: 'direct',
    content: 'Test content',
    blocked: true,
    risk_level: 'HIGH',
    risk_score: 50,
    findings: [],
    ...overrides
  });

  describe('set and get', () => {
    it('should store and retrieve entries', async () => {
      const entry = createMockEntry();
      await store.set('key1', entry);
      const retrieved = store.get('key1');
      expect(retrieved).toEqual(entry);
    });

    it('should return undefined for non-existent keys', () => {
      const retrieved = store.get('nonexistent');
      expect(retrieved).toBeUndefined();
    });

    it('should update existing entries', async () => {
      const entry1 = createMockEntry({ risk_score: 10 });
      const entry2 = createMockEntry({ risk_score: 20 });

      await store.set('key1', entry1);
      await store.set('key1', entry2);

      const retrieved = store.get('key1');
      expect(retrieved?.risk_score).toBe(20);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entry when at capacity', async () => {
      // Fill the store to capacity
      for (let i = 0; i < 10; i++) {
        await store.set(`key${i}`, createMockEntry({ risk_score: i }));
      }

      expect(store.count).toBe(10);

      // Add one more entry
      await store.set('key10', createMockEntry({ risk_score: 10 }));

      // Should still have max_logs entries
      expect(store.count).toBe(10);

      // Oldest entry should be evicted
      expect(store.get('key0')).toBeUndefined();
    });

    it('should update access order on get', async () => {
      // Add entries
      for (let i = 0; i < 10; i++) {
        await store.set(`key${i}`, createMockEntry({ risk_score: i }));
      }

      // Access key0 to make it recently used
      store.get('key0');

      // Add new entry - key1 should be evicted (not key0)
      await store.set('key10', createMockEntry({ risk_score: 10 }));

      expect(store.get('key0')).toBeDefined();
      expect(store.get('key1')).toBeUndefined();
    });
  });

  describe('has and delete', () => {
    it('should return true for existing entries', async () => {
      await store.set('key1', createMockEntry());
      expect(store.has('key1')).toBe(true);
    });

    it('should return false for non-existent entries', () => {
      expect(store.has('nonexistent')).toBe(false);
    });

    it('should delete entries', async () => {
      await store.set('key1', createMockEntry());
      const deleted = store.delete('key1');
      expect(deleted).toBe(true);
      expect(store.has('key1')).toBe(false);
    });

    it('should return false when deleting non-existent entry', () => {
      const deleted = store.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all entries', async () => {
      await store.set('key1', createMockEntry());
      await store.set('key2', createMockEntry());
      expect(store.count).toBe(2);

      store.clear();
      expect(store.count).toBe(0);
      expect(store.get('key1')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return all entries', async () => {
      const entry1 = createMockEntry({ risk_score: 10 });
      const entry2 = createMockEntry({ risk_score: 20 });

      await store.set('key1', entry1);
      await store.set('key2', entry2);

      const all = store.getAll();
      expect(all).toHaveLength(2);
      expect(all).toContainEqual(entry1);
      expect(all).toContainEqual(entry2);
    });

    it('should return empty array when store is empty', () => {
      const all = store.getAll();
      expect(all).toEqual([]);
    });
  });

  describe('count property', () => {
    it('should return the current entry count', async () => {
      expect(store.count).toBe(0);
      await store.set('key1', createMockEntry());
      expect(store.count).toBe(1);
      await store.set('key2', createMockEntry());
      expect(store.count).toBe(2);
    });
  });

  describe('isAtCapacity property', () => {
    it('should return true when at max capacity', async () => {
      expect(store.isAtCapacity).toBe(false);

      for (let i = 0; i < 10; i++) {
        await store.set(`key${i}`, createMockEntry());
      }

      expect(store.isAtCapacity).toBe(true);
    });
  });

  describe('maxCapacity property', () => {
    it('should return the configured max logs', () => {
      expect(store.maxCapacity).toBe(10);
    });
  });

  describe('ttlMs property', () => {
    it('should return the configured TTL', () => {
      expect(store.ttlMs).toBe(60000);
    });
  });

  describe('getEntriesApproachingTTL', () => {
    it('should return entries older than 75% of TTL', async () => {
      const now = Date.now();
      const oldEntry = createMockEntry({
        timestamp: now - 50000 // 50 seconds ago (more than 75% of 60s TTL)
      });

      await store.set('old-key', oldEntry);

      const approaching = store.getEntriesApproachingTTL(now);
      expect(approaching).toHaveLength(1);
      expect(approaching[0]).toEqual(oldEntry);
    });

    it('should not return recent entries', async () => {
      const now = Date.now();
      const newEntry = createMockEntry({
        timestamp: now - 10000 // 10 seconds ago (less than 75% of 60s TTL)
      });

      await store.set('new-key', newEntry);

      const approaching = store.getEntriesApproachingTTL(now);
      expect(approaching).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return store statistics', async () => {
      await store.set('key1', createMockEntry());

      const stats = store.getStats();
      expect(stats.size).toBe(1);
      expect(stats.max).toBe(10);
      expect(stats.ttl).toBe(60000);
      expect(stats.isAtCapacity).toBe(false);
    });
  });
});
