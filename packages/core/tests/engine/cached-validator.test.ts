/**
 * Story 2.7 — cachedValidate helper (CORE)
 * ========================================
 * Acceptance criteria (per `team/plans/2026-05-21-v0.4-v0.7-roadmap-FINAL.md`):
 *   1. `ValidatorCache` interface + `cachedValidate(...)` exported.
 *   2. Default `keyFn` uses stable hash of input + validator names.
 *   3. Optional in-memory LRU shipped (`InMemoryLRUCache`).
 *   4. Cache keys salted with engine instance ID (`createSaltedKeyFn`).
 *   5. Inngest + Trigger.dev connectors consume it (Story 2.8 / 2.9 work;
 *      API supports async cache adapter end-to-end).
 *
 * Post-3-lane-audit BLOCK closures also covered:
 *   - B-CRIT: cache + unsalted keyFn throws unless `createUnsaltedKeyFn()`
 *     is the explicit opt-out.
 *   - B2: validator.name required when caching enabled.
 *   - B3: undefined / NaN / Infinity / Map / Set / non-plain prototype
 *     all produce distinct or throwing canonical forms.
 *   - B4: cache.set throw never drops the validator result.
 *   - B5: malformed validator results are not cached.
 *   - B6: engineInstanceId regex-validated; non-hex rejected.
 *   - B7: defaultTtlMs forwarded to cache.set.
 *   - B8: ttlMs of 0 → instant expiry; negative throws.
 *   - B9: cached entry name mismatch → treated as miss.
 *   - B10: cacheNamespace mixed into hash.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Severity, RiskLevel } from '../../src/base/GuardrailResult.js';
import type { GuardrailResult } from '../../src/base/GuardrailResult.js';
import type { Validator, ValidatorInput } from '../../src/engine/GuardrailEngine.types.js';
import {
  cachedValidate,
  canonicalJSONStringify,
  createSaltedKeyFn,
  createUnsaltedKeyFn,
  DEFAULT_CACHE_NAMESPACE,
  DEFAULT_TTL_MS,
  defaultKeyFn,
  IN_MEMORY_TTL_CEILING_MS,
  InMemoryLRUCache,
  type ValidatorCache
} from '../../src/engine/cached-validator.js';
import { GuardrailEngine } from '../../src/engine/GuardrailEngine.js';

const okResult = (note: string): GuardrailResult => ({
  allowed: true,
  blocked: false,
  reason: note,
  severity: Severity.INFO,
  risk_level: RiskLevel.LOW,
  risk_score: 0,
  findings: [],
  timestamp: Date.now()
});

const blockResult = (note: string): GuardrailResult => ({
  allowed: false,
  blocked: true,
  reason: note,
  severity: Severity.BLOCKED,
  risk_level: RiskLevel.HIGH,
  risk_score: 0.95,
  findings: [],
  timestamp: Date.now()
});

function makeValidator(name: string, fn: (input: ValidatorInput) => GuardrailResult): Validator {
  return {
    name,
    validate: input => (typeof input === 'string' ? okResult('legacy string ignored') : fn(input))
  };
}

const textInput: ValidatorInput = { kind: 'text', content: 'hello world' };
const altTextInput: ValidatorInput = { kind: 'text', content: 'goodbye world' };

describe('Story 2.7 — cachedValidate surface', () => {
  describe('AC #1: exports', () => {
    it('exports all named helpers + classes', () => {
      expect(typeof cachedValidate).toBe('function');
      expect(typeof defaultKeyFn).toBe('function');
      expect(typeof createSaltedKeyFn).toBe('function');
      expect(typeof createUnsaltedKeyFn).toBe('function');
      expect(typeof InMemoryLRUCache).toBe('function');
      expect(typeof canonicalJSONStringify).toBe('function');
      expect(typeof DEFAULT_CACHE_NAMESPACE).toBe('string');
      expect(typeof DEFAULT_TTL_MS).toBe('number');
      expect(typeof IN_MEMORY_TTL_CEILING_MS).toBe('number');
    });

    it('cachedValidate runs without cache (smoke)', async () => {
      const results = await cachedValidate([makeValidator('V', () => okResult('cold'))], textInput);
      expect(results).toHaveLength(1);
      expect(results[0].fromCache).toBe(false);
    });
  });

  describe('AC #2: default keyFn = stable hash of input + validator-name', () => {
    it('same input + name → same key', async () => {
      const k1 = await defaultKeyFn(textInput, 'V');
      const k2 = await defaultKeyFn(textInput, 'V');
      expect(k1).toBe(k2);
    });

    it('different validator name → different key', async () => {
      const a = await defaultKeyFn(textInput, 'V1');
      const b = await defaultKeyFn(textInput, 'V2');
      expect(a).not.toBe(b);
    });

    it('different input content → different key', async () => {
      const a = await defaultKeyFn(textInput, 'V');
      const b = await defaultKeyFn(altTextInput, 'V');
      expect(a).not.toBe(b);
    });

    it('stable across object-key reordering', async () => {
      const a: ValidatorInput = {
        kind: 'tool_call',
        toolName: 'send',
        args: { from: 'a', to: 'b', body: 'hi' }
      };
      const b: ValidatorInput = {
        kind: 'tool_call',
        toolName: 'send',
        args: { body: 'hi', to: 'b', from: 'a' }
      };
      expect(await defaultKeyFn(a, 'V')).toBe(await defaultKeyFn(b, 'V'));
    });
  });

  describe('AC #3: InMemoryLRUCache', () => {
    let lru: InMemoryLRUCache;
    beforeEach(() => {
      lru = new InMemoryLRUCache({ maxEntries: 3 });
    });

    it('stores + retrieves entries', () => {
      lru.set('k1', okResult('a'));
      expect(lru.get('k1')?.reason).toBe('a');
    });

    it('has() reflects presence', () => {
      expect(lru.has('k1')).toBe(false);
      lru.set('k1', okResult('a'));
      expect(lru.has('k1')).toBe(true);
    });

    it('evicts the LRU entry when maxEntries exceeded', () => {
      lru.set('k1', okResult('a'));
      lru.set('k2', okResult('b'));
      lru.set('k3', okResult('c'));
      lru.get('k1'); // touch k1 → k2 becomes LRU.
      lru.set('k4', okResult('d'));
      expect(lru.has('k1')).toBe(true);
      expect(lru.has('k2')).toBe(false);
      expect(lru.has('k3')).toBe(true);
      expect(lru.has('k4')).toBe(true);
    });

    it('honours TTL when set on entry — expired entries return undefined', () => {
      vi.useFakeTimers();
      try {
        lru.set('k1', okResult('a'), 1000);
        vi.advanceTimersByTime(500);
        expect(lru.get('k1')).toBeDefined();
        vi.advanceTimersByTime(600);
        expect(lru.get('k1')).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('clear() drops all entries', () => {
      lru.set('k1', okResult('a'));
      lru.set('k2', okResult('b'));
      lru.clear();
      expect(lru.has('k1')).toBe(false);
      expect(lru.has('k2')).toBe(false);
    });

    it('B7: clamps ttlMs to maxTtlMs ceiling', () => {
      vi.useFakeTimers();
      try {
        const tight = new InMemoryLRUCache({ maxTtlMs: 1000 });
        tight.set('k1', okResult('a'), 60_000); // way over ceiling.
        vi.advanceTimersByTime(999);
        expect(tight.get('k1')).toBeDefined();
        vi.advanceTimersByTime(2); // 1001ms total → past clamped ceiling.
        expect(tight.get('k1')).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('B8: ttlMs of 0 = instant expiry on next read', () => {
      lru.set('k1', okResult('a'), 0);
      expect(lru.get('k1')).toBeUndefined();
    });

    it('B8: negative ttlMs throws', () => {
      expect(() => lru.set('k1', okResult('a'), -1)).toThrow(/ttlMs must be >= 0/);
    });
  });

  describe('AC #4: salted keyFn + engine.getInstanceId() isolation', () => {
    it('createSaltedKeyFn produces different keys for different IDs', async () => {
      const e1 = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('pass'))]
      });
      const e2 = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('pass'))]
      });
      const k1 = createSaltedKeyFn(e1.getInstanceId());
      const k2 = createSaltedKeyFn(e2.getInstanceId());
      expect(await k1(textInput, 'V')).not.toBe(await k2(textInput, 'V'));
    });

    it('engine.getInstanceId() is stable + unique per engine', () => {
      const e1 = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('p'))]
      });
      const e2 = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('p'))]
      });
      expect(e1.getInstanceId()).toBe(e1.getInstanceId());
      expect(e1.getInstanceId()).not.toBe(e2.getInstanceId());
      expect(/^[0-9a-f]{32}$/.test(e1.getInstanceId())).toBe(true);
    });

    it('two engines sharing a cache do NOT see each others entries', async () => {
      const e1 = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('e1'))]
      });
      const e2 = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('e2'))]
      });
      const cache = new InMemoryLRUCache({ maxEntries: 64 });
      const validators = [makeValidator('V', () => okResult('shared'))];
      const r1 = await cachedValidate(validators, textInput, {
        cache,
        keyFn: createSaltedKeyFn(e1.getInstanceId())
      });
      const r2 = await cachedValidate(validators, textInput, {
        cache,
        keyFn: createSaltedKeyFn(e2.getInstanceId())
      });
      expect(r1[0].fromCache).toBe(false);
      expect(r2[0].fromCache).toBe(false);
    });
  });

  describe('B-CRIT: cache + unsalted default keyFn is REFUSED at runtime', () => {
    it('throws when cache provided + no keyFn', async () => {
      const cache = new InMemoryLRUCache();
      const validators = [makeValidator('V', () => okResult('cold'))];
      await expect(cachedValidate(validators, textInput, { cache })).rejects.toThrow(
        /unsalted keyFn|createSaltedKeyFn|createUnsaltedKeyFn/
      );
    });

    it('throws when cache provided + bare default keyFn', async () => {
      const cache = new InMemoryLRUCache();
      const validators = [makeValidator('V', () => okResult('cold'))];
      await expect(cachedValidate(validators, textInput, { cache, keyFn: defaultKeyFn })).rejects.toThrow(
        /unsalted keyFn/
      );
    });

    it('accepts cache + createSaltedKeyFn', async () => {
      const e = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('p'))]
      });
      const cache = new InMemoryLRUCache();
      const validators = [makeValidator('V', () => okResult('cold'))];
      const r = await cachedValidate(validators, textInput, {
        cache,
        keyFn: createSaltedKeyFn(e.getInstanceId())
      });
      expect(r[0].fromCache).toBe(false);
    });

    it('accepts cache + createUnsaltedKeyFn() explicit opt-out', async () => {
      const cache = new InMemoryLRUCache();
      const validators = [makeValidator('V', () => okResult('cold'))];
      const r = await cachedValidate(validators, textInput, {
        cache,
        keyFn: createUnsaltedKeyFn()
      });
      expect(r[0].fromCache).toBe(false);
    });
  });

  describe('B2: validator.name required when caching', () => {
    it('throws when an anonymous validator + cache present', async () => {
      const anon: Validator = { validate: () => okResult('cold') };
      const cache = new InMemoryLRUCache();
      await expect(
        cachedValidate([anon], textInput, {
          cache,
          keyFn: createUnsaltedKeyFn()
        })
      ).rejects.toThrow(/no `name` property/);
    });

    it('does NOT throw when anonymous + no cache (caching disabled)', async () => {
      const anon: Validator = { validate: () => okResult('cold') };
      const r = await cachedValidate([anon], textInput);
      expect(r[0].fromCache).toBe(false);
    });
  });

  describe('B3: canonical serialisation hardening', () => {
    it('undefined-valued field is DISTINCT from absent field', () => {
      const a = canonicalJSONStringify({ a: undefined, b: 1 });
      const b = canonicalJSONStringify({ b: 1 });
      expect(a).not.toBe(b);
    });

    it('NaN is DISTINCT from null', () => {
      const a = canonicalJSONStringify({ x: NaN });
      const b = canonicalJSONStringify({ x: null });
      expect(a).not.toBe(b);
    });

    it('+Infinity is DISTINCT from -Infinity from null', () => {
      const pos = canonicalJSONStringify({ x: Infinity });
      const neg = canonicalJSONStringify({ x: -Infinity });
      const nil = canonicalJSONStringify({ x: null });
      expect(pos).not.toBe(neg);
      expect(pos).not.toBe(nil);
    });

    it('Map / Set / Date REJECT with a clear error', () => {
      expect(() => canonicalJSONStringify({ m: new Map() })).toThrow(/unsupported object type/);
      expect(() => canonicalJSONStringify({ s: new Set() })).toThrow(/unsupported object type/);
      expect(() => canonicalJSONStringify({ d: new Date() })).toThrow(/unsupported object type/);
    });

    it('rejects non-plain prototype chains', () => {
      class Custom {
        x = 1;
      }
      expect(() => canonicalJSONStringify({ obj: new Custom() })).toThrow(/plain objects/);
    });

    it('plain object with own properties only — accepted + sorted', () => {
      const result = canonicalJSONStringify({ z: 1, a: 2, m: 3 });
      expect(result).toBe(JSON.stringify({ a: 2, m: 3, z: 1 }));
    });
  });

  describe('B4: cache.set failure must NOT drop the validator result', () => {
    it('returns the fresh result even if cache.set throws', async () => {
      const failingCache: ValidatorCache = {
        get: () => undefined,
        set: () => {
          throw new Error('redis-down');
        }
      };
      const validators = [makeValidator('V', () => blockResult('blocked-cold'))];
      const r = await cachedValidate(validators, textInput, {
        cache: failingCache,
        keyFn: createUnsaltedKeyFn()
      });
      // BLOCK decision MUST surface even if the cache write failed.
      expect(r[0].blocked).toBe(true);
      expect(r[0].reason).toBe('blocked-cold');
      expect(r[0].fromCache).toBe(false);
    });

    it('logs a warning when cache.set throws (logger provided)', async () => {
      const warn = vi.fn();
      const failingCache: ValidatorCache = {
        get: () => undefined,
        set: () => {
          throw new Error('boom');
        }
      };
      const validators = [makeValidator('V', () => okResult('cold'))];
      await cachedValidate(validators, textInput, {
        cache: failingCache,
        keyFn: createUnsaltedKeyFn(),
        logger: { warn }
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/cache\.set failed/),
        expect.objectContaining({ validatorName: 'V' })
      );
    });
  });

  describe('B5: malformed validator results are NOT cached', () => {
    it('result missing `blocked` field is not stored', async () => {
      const malformed = {
        allowed: true,
        // blocked: missing.
        severity: Severity.INFO,
        risk_level: RiskLevel.LOW,
        risk_score: 0,
        findings: [],
        timestamp: Date.now()
      } as unknown as GuardrailResult;
      const setSpy = vi.fn();
      const cache: ValidatorCache = {
        get: () => undefined,
        set: setSpy
      };
      const validators: Validator[] = [{ name: 'V', validate: () => malformed }];
      const r = await cachedValidate(validators, textInput, {
        cache,
        keyFn: createUnsaltedKeyFn()
      });
      expect(setSpy).not.toHaveBeenCalled();
      expect(r[0].fromCache).toBe(false);
    });
  });

  describe('B6: engineInstanceId is regex-validated', () => {
    it('rejects empty string', () => {
      expect(() => createSaltedKeyFn('')).toThrow(/non-empty string/);
    });

    it('rejects non-hex form', () => {
      expect(() => createSaltedKeyFn('not-hex')).toThrow(/32 lowercase hex/);
    });

    it('rejects strings containing the separator', () => {
      // 32 hex chars + the separator → would slip past length but not regex.
      expect(() => createSaltedKeyFn('a|b'.padEnd(32, 'a'))).toThrow(/32 lowercase hex/);
    });

    it('accepts the canonical engine instance ID', () => {
      const e = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('p'))]
      });
      expect(() => createSaltedKeyFn(e.getInstanceId())).not.toThrow();
    });
  });

  describe('B7: defaultTtlMs forwarded to cache.set', () => {
    it('cache.set receives the configured TTL', async () => {
      const setSpy = vi.fn();
      const cache: ValidatorCache = {
        get: () => undefined,
        set: setSpy
      };
      const validators = [makeValidator('V', () => okResult('cold'))];
      await cachedValidate(validators, textInput, {
        cache,
        keyFn: createUnsaltedKeyFn(),
        defaultTtlMs: 5_000
      });
      expect(setSpy).toHaveBeenCalledWith(expect.any(String), expect.any(Object), 5_000);
    });

    it('blocked TTL override applied to BLOCK results', async () => {
      const setSpy = vi.fn();
      const cache: ValidatorCache = {
        get: () => undefined,
        set: setSpy
      };
      const validators = [makeValidator('V', () => blockResult('hot'))];
      await cachedValidate(validators, textInput, {
        cache,
        keyFn: createUnsaltedKeyFn(),
        defaultTtlMs: 10_000,
        blockedTtlMs: 1_000
      });
      expect(setSpy).toHaveBeenCalledWith(expect.any(String), expect.any(Object), 1_000);
    });
  });

  describe('B9: cached entry name mismatch → treated as miss', () => {
    it('renamed validator does NOT inherit prior validator-name cache entries', async () => {
      const cache = new InMemoryLRUCache({ maxEntries: 16 });
      const oldValidator = makeValidator('OldName', () => okResult('old'));
      const newValidator = makeValidator('NewName', () => okResult('new'));
      const keyFn = createUnsaltedKeyFn();

      // The cache backend would serve cross-name (no salt isolation),
      // but on read the name-mismatch guard rejects it.
      await cachedValidate([oldValidator], textInput, { cache, keyFn });
      // Use a constant keyFn so old + new validators collide on the
      // bare cache slot — only the name-mismatch guard prevents bleed.
      const collidingKeyFn = (() => {
        const fn: typeof keyFn = () => 'shared-slot';
        fn._bonklmExplicitUnsalted = true;
        return fn;
      })();
      await cachedValidate([oldValidator], textInput, {
        cache,
        keyFn: collidingKeyFn
      });
      const r = await cachedValidate([newValidator], textInput, {
        cache,
        keyFn: collidingKeyFn
      });
      // newValidator's first lookup hits the slot but storedName ===
      // 'OldName' ≠ 'NewName' → miss + cold run.
      expect(r[0].fromCache).toBe(false);
      expect(r[0].reason).toBe('new');
    });
  });

  describe('B10: cacheNamespace mixed into hash', () => {
    it('different namespaces produce different cache keys (no cross-environment bleed)', async () => {
      const validators = [makeValidator('V', () => okResult('cold'))];
      const cache = new InMemoryLRUCache({ maxEntries: 16 });

      const e = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('p'))]
      });
      await cachedValidate(validators, textInput, {
        cache,
        cacheNamespace: 'env:dev',
        keyFn: createSaltedKeyFn(e.getInstanceId())
      });
      const r = await cachedValidate(validators, textInput, {
        cache,
        cacheNamespace: 'env:prod',
        keyFn: createSaltedKeyFn(e.getInstanceId())
      });
      // Different namespace → different key → MISS → cold.
      expect(r[0].fromCache).toBe(false);
    });
  });

  describe('Cache hit + miss semantics', () => {
    it('cache HIT → validator NOT re-called; fromCache=true; provenance preserved', async () => {
      const cache = new InMemoryLRUCache({ maxEntries: 4 });
      const validate = vi.fn().mockReturnValue(blockResult('hot'));
      const validators: Validator[] = [{ name: 'V', validate }];
      const keyFn = createUnsaltedKeyFn();

      await cachedValidate(validators, textInput, { cache, keyFn });
      const r2 = await cachedValidate(validators, textInput, { cache, keyFn });
      expect(validate).toHaveBeenCalledTimes(1);
      expect(r2[0].fromCache).toBe(true);
      expect(r2[0].blocked).toBe(true);
      expect(r2[0].validatorName).toBe('V');
    });

    it('validator THROW → result not cached; subsequent call re-runs validator', async () => {
      const cache = new InMemoryLRUCache({ maxEntries: 4 });
      let calls = 0;
      const validate = vi.fn().mockImplementation(() => {
        calls += 1;
        if (calls === 1) throw new Error('cold boom');
        return okResult('warm');
      });
      const validators: Validator[] = [{ name: 'V', validate }];
      const keyFn = createUnsaltedKeyFn();
      await expect(cachedValidate(validators, textInput, { cache, keyFn })).rejects.toThrow('cold boom');
      const r2 = await cachedValidate(validators, textInput, { cache, keyFn });
      expect(validate).toHaveBeenCalledTimes(2);
      expect(r2[0].fromCache).toBe(false);
    });

    it('async Redis-style cache adapter works transparently', async () => {
      const store = new Map<string, GuardrailResult>();
      const asyncCache: ValidatorCache = {
        get: async k => store.get(k),
        set: async (k, v) => {
          store.set(k, v);
        }
      };
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const validators: Validator[] = [{ name: 'V', validate }];
      const keyFn = createUnsaltedKeyFn();
      const r1 = await cachedValidate(validators, textInput, { cache: asyncCache, keyFn });
      const r2 = await cachedValidate(validators, textInput, { cache: asyncCache, keyFn });
      expect(validate).toHaveBeenCalledTimes(1);
      expect(r1[0].fromCache).toBe(false);
      expect(r2[0].fromCache).toBe(true);
    });

    it('cache.get throw → MISS path + validator runs cold', async () => {
      const failingGetCache: ValidatorCache = {
        get: () => {
          throw new Error('redis-flap');
        },
        set: () => undefined
      };
      const warn = vi.fn();
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const validators: Validator[] = [{ name: 'V', validate }];
      const r = await cachedValidate(validators, textInput, {
        cache: failingGetCache,
        keyFn: createUnsaltedKeyFn(),
        logger: { warn }
      });
      expect(validate).toHaveBeenCalledTimes(1);
      expect(r[0].fromCache).toBe(false);
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('Backwards-compat: bare cache as 3rd arg (AC #1 literal shape)', () => {
    it('cachedValidate(validators, input, cache, keyFn) is supported via duck-typing', async () => {
      const cache = new InMemoryLRUCache({ maxEntries: 4 });
      const keyFn = createUnsaltedKeyFn();
      const validators = [makeValidator('V', () => okResult('cold'))];
      const r1 = await cachedValidate(validators, textInput, cache, keyFn);
      const r2 = await cachedValidate(validators, textInput, cache, keyFn);
      expect(r1[0].fromCache).toBe(false);
      expect(r2[0].fromCache).toBe(true);
    });
  });
});
