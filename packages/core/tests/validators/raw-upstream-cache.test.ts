/**
 * D-065 §7-step-2.b PR-A — RawUpstreamCache (ALS-scoped)
 * =====================================================
 * Covers scope activation, put/get within a scope, no-op behaviour outside a
 * scope, and isolation across sibling scopes.
 */
import { describe, it, expect } from 'vitest';
import {
  runWithRawUpstreamCache,
  putRawUpstream,
  getRawUpstream,
  rawUpstreamCacheActive
} from '../../src/validators/raw-upstream-cache.js';

describe('RawUpstreamCache — outside a scope', () => {
  it('reports inactive', () => {
    expect(rawUpstreamCacheActive()).toBe(false);
  });

  it('get returns undefined', () => {
    expect(getRawUpstream('deadbeef')).toBeUndefined();
  });

  it('put is an inert no-op (does not throw)', () => {
    expect(() => putRawUpstream('deadbeef', 'body')).not.toThrow();
    // and nothing was stored anywhere reachable
    expect(getRawUpstream('deadbeef')).toBeUndefined();
  });
});

describe('RawUpstreamCache — inside a scope', () => {
  it('reports active', () => {
    runWithRawUpstreamCache(() => {
      expect(rawUpstreamCacheActive()).toBe(true);
    });
  });

  it('round-trips a stored body', () => {
    runWithRawUpstreamCache(() => {
      putRawUpstream('hash-1', 'raw upstream body');
      expect(getRawUpstream('hash-1')).toBe('raw upstream body');
    });
  });

  it('returns undefined for an unknown hash within an active scope', () => {
    runWithRawUpstreamCache(() => {
      putRawUpstream('hash-1', 'body');
      expect(getRawUpstream('missing')).toBeUndefined();
    });
  });

  it('returns the function result', () => {
    const out = runWithRawUpstreamCache(() => 42);
    expect(out).toBe(42);
  });
});

describe('RawUpstreamCache — isolation', () => {
  it('does not leak entries across sibling scopes', () => {
    runWithRawUpstreamCache(() => {
      putRawUpstream('shared-key', 'first');
    });
    runWithRawUpstreamCache(() => {
      expect(getRawUpstream('shared-key')).toBeUndefined();
    });
  });

  it('is inactive again after a scope exits', () => {
    runWithRawUpstreamCache(() => {
      putRawUpstream('k', 'v');
    });
    expect(rawUpstreamCacheActive()).toBe(false);
  });
});

describe('RawUpstreamCache — per-scope entry cap (MAX_RAW_UPSTREAM_ENTRIES = 256)', () => {
  it('drops a new distinct key at the cap but still updates existing keys (no OOM, no throw)', () => {
    runWithRawUpstreamCache(() => {
      for (let i = 0; i < 256; i++) putRawUpstream(`h-${i}`, `body-${i}`);
      // The store is now full. A 257th DISTINCT key is dropped — a forensic
      // re-scan miss, never an unbounded grow.
      putRawUpstream('h-overflow', 'should-be-dropped');
      expect(getRawUpstream('h-overflow')).toBeUndefined();
      // An existing key still updates at the cap (size does not grow).
      putRawUpstream('h-0', 'updated');
      expect(getRawUpstream('h-0')).toBe('updated');
      // The first 256 entries remain retrievable.
      expect(getRawUpstream('h-255')).toBe('body-255');
    });
  });
});

describe('RawUpstreamCache — async propagation (the load-bearing ALS guarantee)', () => {
  it('a put inside an awaited descendant resolves via get in the same scope', async () => {
    await runWithRawUpstreamCache(async () => {
      await Promise.resolve();
      putRawUpstream('async-hash', 'async body');
      await Promise.resolve();
      expect(getRawUpstream('async-hash')).toBe('async body');
    });
  });

  it('two concurrent async scopes do not cross-contaminate the same key', async () => {
    const scopeA = runWithRawUpstreamCache(async () => {
      putRawUpstream('k', 'A');
      await new Promise(resolve => setTimeout(resolve, 5));
      return getRawUpstream('k');
    });
    const scopeB = runWithRawUpstreamCache(async () => {
      putRawUpstream('k', 'B');
      await new Promise(resolve => setTimeout(resolve, 1));
      return getRawUpstream('k');
    });
    const [a, b] = await Promise.all([scopeA, scopeB]);
    expect(a).toBe('A');
    expect(b).toBe('B');
  });
});
