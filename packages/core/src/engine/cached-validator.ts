/**
 * cachedValidate helper (CORE)
 * ========================================
 *
 * Memoization layer for Validator pipelines. Used by replay-capable
 * orchestration runtimes (Inngest functions, Trigger.dev tasks) so a
 * replay/retry returns the cached BLOCK/ALLOW decision without
 * re-firing the validator — preserves determinism + saves cost.
 *
 * Surface:
 *   - `ValidatorCache` — pluggable cache adapter interface (in-memory
 *     OR async Redis-style; both work without surgery).
 *   - `cachedValidate(validators, input, optionsOrCache?, keyFn?)` —
 *     runs each validator, populating the cache on success. Cache
 *     MISS = validator runs; HIT = cached result returned with
 *     `fromCache: true`.
 *   - `InMemoryLRUCache` — ships an in-process LRU with optional per-entry
 *     TTL. Safe default for single-host deployments.
 *   - `defaultKeyFn` — stable canonical-JSON hash of `(input, validatorName)`.
 *   - `createSaltedKeyFn(engineInstanceId, baseKeyFn?)` — wraps a keyFn
 *     to mix in an engine instance ID, preventing cross-instance cache
 *     poisoning when multiple engines share one cache backend.
 *   - `createUnsaltedKeyFn()` — explicit opt-out for single-engine
 *     deployments with no shared cache backend.
 *
 * Audit BLOCK closures (post-3-lane review of v1):
 *   - **B-CRIT (sec S1)**: cache + default unsalted keyFn THROWS at
 *     runtime. Consumers must explicitly pass `createSaltedKeyFn(...)`
 *     OR `createUnsaltedKeyFn()` to acknowledge cache scope.
 *   - **B2 (rev/sec)**: validator.name is REQUIRED when caching;
 *     constructor.name fallback removed (minify-safe).
 *   - **B3 (rev/sec)**: canonical serialization encodes `undefined`,
 *     `NaN`, `Map`/`Set` to distinct sentinels; rejects non-plain
 *     prototype chains (prototype-pollution-poisoned key collapse).
 *   - **B4 (rev)**: `cache.set` errors are caught + logged; the fresh
 *     validator result is ALWAYS returned. Cache-write failure must
 *     NEVER drop a BLOCK decision.
 *   - **B5 (sec)**: validator result is structurally validated before
 *     being cached (malformed result = no cache write).
 *   - **B6 (sec)**: engineInstanceId is regex-validated; separator `|`
 *     is forbidden in salt input (prefix-injection close).
 *   - **B7 (sec)**: `defaultTtlMs` + `blockedTtlMs` options; in-memory
 *     LRU enforces a hard 24-hour ceiling; Redis adapters forward TTL.
 *   - **B8 (rev)**: ttlMs of 0 = instant expiry; negative throws.
 *   - **B9 (arch)**: cache stores full `ValidatorResult` (with
 *     `validatorName` baked in); on hit, name mismatch = treated as
 *     miss + cache slot evicted (provenance integrity).
 *   - **B10 (arch)**: `cacheNamespace` option mixed into hash — defaults
 *     to BonkLM package major.minor so rolling deploys auto-invalidate.
 *
 * Failure contract: validator THROWS → result is NOT cached. Cache
 * adapter THROWS on set → validator result IS returned (cache write
 * failure is non-fatal). Cache adapter throws on get → MISS path
 * runs (failover to cold).
 *
 * Edge-runtime note: SHA-256 is computed via Web Crypto
 * (`crypto.subtle.digest`), which is universally available in
 * Node 18+, Workerd, Deno, Bun, and Vercel Edge.
 *
 * @package @blackunicorn/bonklm
 */
import type { GuardrailResult } from '../base/GuardrailResult.js';
import type { Validator, ValidatorInput, ValidatorResult } from './GuardrailEngine.types.js';

/**
 * BonkLM cache namespace baked into the default keyFn. Bumping this
 * on major/minor releases auto-invalidates shared caches across
 * rolling deploys. Consumers can override via the `cacheNamespace`
 * option (e.g. to scope per environment within one Redis cluster).
 */
export const DEFAULT_CACHE_NAMESPACE = '@blackunicorn/bonklm@0.4';

/**
 * Hard ceiling on per-entry TTL inside `InMemoryLRUCache`. Prevents
 * a low-traffic deployment from holding week-old block decisions
 * indefinitely. Redis adapters are expected to enforce their own
 * ceilings via `maxmemory-policy` / `EX` translation.
 */
export const IN_MEMORY_TTL_CEILING_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Default per-entry TTL when `cachedValidate` is invoked without an
 * explicit `defaultTtlMs`. 1 hour balances replay determinism (you
 * want the same decision for at least one orchestration window)
 * against staleness (config drift, validator updates).
 */
export const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h

/**
 * Pluggable cache adapter. Both sync (in-process) and async (Redis,
 * Inngest steps) implementations work without rewiring callers.
 *
 * Failure semantics (post-hardening):
 *   - `get` may throw → cachedValidate treats as a MISS + runs cold.
 *   - `set` may throw → cachedValidate logs (via logger if supplied)
 *     + returns the fresh validator result anyway. Cache write
 *     failure MUST NEVER drop a BLOCK decision.
 *   - `has` is OPTIONAL and NEVER called by cachedValidate; provided
 *     for adapter authors who want a cheaper presence check. `get`
 *     is the authoritative path.
 */
export interface ValidatorCache {
  get(key: string): GuardrailResult | undefined | Promise<GuardrailResult | undefined>;
  set(key: string, value: GuardrailResult, ttlMs?: number): void | Promise<void>;
  has?(key: string): boolean | Promise<boolean>;
  clear?(): void | Promise<void>;
}

/**
 * keyFn signature. Synchronous OR async.
 *
 * The keyFn carries a `_bonklmSalted` marker (set via the salted /
 * unsalted factory helpers) so `cachedValidate` can refuse to operate
 * with a cache backend + default unsalted keyFn. Consumers building
 * custom keyFns should set `(fn as KeyFn)._bonklmSalted = true` IFF
 * the function mixes an engine identifier into the key.
 */
export interface KeyFn {
  (input: ValidatorInput, validatorName: string): string | Promise<string>;
  /**
   * Internal marker — `true` if the keyFn mixes an engine identifier
   * into the key, `false` if explicitly opted out, `undefined` for
   * the bare default (treated as unsafe-with-cache by cachedValidate).
   */
  _bonklmSalted?: boolean;
  /**
   * Internal marker — `true` if the keyFn is the explicit
   * `createUnsaltedKeyFn()` opt-out (single-engine deployment).
   */
  _bonklmExplicitUnsalted?: boolean;
}

/**
 * Logger surface used internally by cachedValidate to report cache
 * adapter failures + caching-skipped events. Subset of the engine
 * `Logger` type to avoid cyclic imports.
 */
export interface CachedValidateLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * cachedValidate per-validator output. Extends ValidatorResult with a
 * `fromCache` flag so observability / OTel can distinguish hot from
 * cold paths.
 */
export interface CachedValidatorResult extends ValidatorResult {
  fromCache: boolean;
}

/**
 * Options bag for `cachedValidate`. Pass as the 3rd positional arg
 * instead of a bare cache. Backwards-compatible: a bare `ValidatorCache`
 * is detected by duck-typing and the call uses defaults.
 */
export interface CachedValidateOptions {
  cache?: ValidatorCache;
  keyFn?: KeyFn;
  /**
   * Default TTL (ms) applied to every cache.set call. Required so
   * shared caches cannot accumulate stale BLOCK decisions indefinitely.
   * Default: {@link DEFAULT_TTL_MS} (1 hour).
   *
   * Set to `Infinity` to opt out (NOT recommended for shared caches).
   */
  defaultTtlMs?: number;
  /**
   * Optional override TTL for BLOCK results. If unset, falls back to
   * `defaultTtlMs`. Allows consumers to expire BLOCKs faster than
   * ALLOWs (e.g. to recover from false-positive validators).
   */
  blockedTtlMs?: number;
  /**
   * Namespace prefix mixed into the canonical hash. Defaults to
   * {@link DEFAULT_CACHE_NAMESPACE}. Set to a custom value to scope
   * cache entries to a specific environment / deployment slot.
   */
  cacheNamespace?: string;
  /**
   * Optional logger. cachedValidate emits warnings on cache-adapter
   * failures + skipped writes (e.g. malformed validator result).
   */
  logger?: CachedValidateLogger;
}

/**
 * Run each validator against `input`, returning per-validator results.
 *
 * @example
 * ```ts
 * const cache = new InMemoryLRUCache({ maxEntries: 256 });
 * const results = await cachedValidate(validators, input, {
 *   cache,
 *   keyFn: createSaltedKeyFn(engine.getInstanceId()),
 * });
 * ```
 */
export async function cachedValidate(
  validators: Validator[],
  input: ValidatorInput,
  optionsOrCache?: CachedValidateOptions | ValidatorCache,
  legacyKeyFn?: KeyFn
): Promise<CachedValidatorResult[]> {
  const options = normaliseOptions(optionsOrCache, legacyKeyFn);
  const { cache, keyFn: resolvedKeyFn, defaultTtlMs, blockedTtlMs, cacheNamespace, logger } = options;

  // ── B2 closure: pre-flight name validation ──────────────────────
  // Cache key MUST carry a stable validator identifier. Constructor.name
  // is minify-unsafe; an Object-literal validator collides with every
  // other Object-literal validator. Refuse rather than serve cross-talk.
  if (cache !== undefined) {
    for (let i = 0; i < validators.length; i++) {
      const v = validators[i];
      const name = v.name;
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error(
          `cachedValidate: validator at index ${i} has no \`name\` property. ` +
            `A non-empty \`name\` is REQUIRED on every validator when caching ` +
            `is enabled (constructor.name is minify-unsafe and Object-literal ` +
            `validators collide).`
        );
      }
    }
  }

  // ── B-CRIT closure: refuse cache + unsalted default keyFn ───────
  if (cache !== undefined) {
    const isSalted = resolvedKeyFn._bonklmSalted === true;
    const isExplicitlyUnsalted = resolvedKeyFn._bonklmExplicitUnsalted === true;
    if (!isSalted && !isExplicitlyUnsalted) {
      throw new Error(
        'cachedValidate: a cache backend was provided with an unsalted keyFn. ' +
          'Cross-instance cache poisoning is silent when multiple engines share ' +
          'one backend. Pass `createSaltedKeyFn(engine.getInstanceId())` for ' +
          'shared backends (Redis, Inngest steps), OR explicitly pass ' +
          '`createUnsaltedKeyFn()` to acknowledge the single-engine deployment scope.'
      );
    }
  }

  const results: CachedValidatorResult[] = [];

  for (const validator of validators) {
    const name = validator.name ?? validator.constructor.name;

    if (cache === undefined) {
      // No cache wired — direct passthrough.
      const fresh = await Promise.resolve(validator.validate(input));
      results.push({ ...fresh, validatorName: name, fromCache: false });
      continue;
    }

    // B10: prefix with the configured cacheNamespace so dev/staging/
    // prod (or version-rolled deploys) cannot cross-bleed within one
    // backend. Applied OUTSIDE the keyFn so custom keyFns (incl.
    // createSaltedKeyFn) inherit the namespace automatically.
    const rawKey = await resolvedKeyFn(input, name);
    const key = `${cacheNamespace}::${rawKey}`;

    // ── Cache read (failover to cold on adapter throw). ─────────
    let cached: GuardrailResult | undefined;
    try {
      cached = await Promise.resolve(cache.get(key));
    } catch (err) {
      logger?.warn?.('cachedValidate: cache.get failed; treating as miss', {
        error: err instanceof Error ? err.message : String(err),
        // Truncated to avoid leaking the full cacheNamespace prefix
        // into downstream log aggregators (sec-audit F-2).
        key: truncateKeyForLog(key)
      });
      cached = undefined;
    }

    // ── B9 closure: provenance integrity ────────────────────────
    // The cached entry is a full ValidatorResult (validatorName baked
    // in at write time). If the stored name doesn't match the current
    // pipeline binding for this key, treat as a stale entry from a
    // renamed/reordered validator and run cold.
    if (cached !== undefined) {
      const storedName = (cached as ValidatorResult).validatorName;
      if (typeof storedName === 'string' && storedName === name) {
        results.push({ ...cached, validatorName: name, fromCache: true });
        continue;
      }
      logger?.warn?.('cachedValidate: cached entry validatorName mismatch; treating as miss', {
        expected: name,
        stored: storedName,
        key: truncateKeyForLog(key)
      });
    }

    // ── Cache miss — run validator. Throw propagates; do NOT cache. ─
    const fresh = await Promise.resolve(validator.validate(input));

    // ── B5 closure: structural validation before cache.set ──────
    if (!isWellFormedGuardrailResult(fresh)) {
      logger?.warn?.('cachedValidate: validator returned a malformed GuardrailResult; not caching', {
        validatorName: name,
        key: truncateKeyForLog(key)
      });
      results.push({ ...fresh, validatorName: name, fromCache: false });
      continue;
    }

    // Bake the validator name into the cached payload so future reads
    // can verify provenance (B9).
    const toStore: ValidatorResult = { ...fresh, validatorName: name };

    // ── B7 closure: TTL derivation ──────────────────────────────
    const ttlMs = toStore.blocked === true ? (blockedTtlMs ?? defaultTtlMs) : defaultTtlMs;

    // ── B4 closure: cache.set failure must NOT drop the result. ─
    try {
      await Promise.resolve(cache.set(key, toStore, ttlMs));
    } catch (err) {
      logger?.warn?.('cachedValidate: cache.set failed; result still returned to caller', {
        error: err instanceof Error ? err.message : String(err),
        validatorName: name,
        key: truncateKeyForLog(key)
      });
    }

    results.push({ ...fresh, validatorName: name, fromCache: false });
  }

  return results;
}

/**
 * Normalise the overloaded 3rd argument to a fully-resolved options
 * object. Detects bare `ValidatorCache` via duck-typing (`get` +
 * `set` are functions).
 */
function normaliseOptions(
  optionsOrCache: CachedValidateOptions | ValidatorCache | undefined,
  legacyKeyFn: KeyFn | undefined
): Required<Pick<CachedValidateOptions, 'keyFn' | 'cacheNamespace'>> &
  Omit<CachedValidateOptions, 'keyFn' | 'cacheNamespace'> & {
    defaultTtlMs: number;
  } {
  let cache: ValidatorCache | undefined;
  let keyFn: KeyFn | undefined;
  let defaultTtlMs: number | undefined;
  let blockedTtlMs: number | undefined;
  let cacheNamespace: string | undefined;
  let logger: CachedValidateLogger | undefined;

  if (optionsOrCache === undefined) {
    // bare (validators, input) call.
  } else if (isValidatorCache(optionsOrCache)) {
    cache = optionsOrCache;
    keyFn = legacyKeyFn;
  } else {
    cache = optionsOrCache.cache;
    keyFn = optionsOrCache.keyFn ?? legacyKeyFn;
    defaultTtlMs = optionsOrCache.defaultTtlMs;
    blockedTtlMs = optionsOrCache.blockedTtlMs;
    cacheNamespace = optionsOrCache.cacheNamespace;
    logger = optionsOrCache.logger;
  }

  const resolvedNamespace = cacheNamespace ?? DEFAULT_CACHE_NAMESPACE;
  // cacheNamespace is applied OUTSIDE the keyFn as a key prefix so
  // custom keyFns (incl. createSaltedKeyFn) inherit isolation
  // automatically. Default keyFn here is the un-namespaced primitive.
  const resolvedKeyFn: KeyFn = keyFn ?? defaultKeyFn;

  const resolvedTtl = defaultTtlMs ?? DEFAULT_TTL_MS;
  if (resolvedTtl < 0) {
    throw new Error('cachedValidate: defaultTtlMs must be >= 0');
  }
  if (blockedTtlMs !== undefined && blockedTtlMs < 0) {
    throw new Error('cachedValidate: blockedTtlMs must be >= 0');
  }

  return {
    cache,
    keyFn: resolvedKeyFn,
    defaultTtlMs: resolvedTtl,
    blockedTtlMs,
    cacheNamespace: resolvedNamespace,
    logger
  };
}

function isValidatorCache(arg: unknown): arg is ValidatorCache {
  return (
    typeof arg === 'object' &&
    arg !== null &&
    typeof (arg as ValidatorCache).get === 'function' &&
    typeof (arg as ValidatorCache).set === 'function'
  );
}

/**
 * Validate that a `GuardrailResult` carries the minimum required
 * shape before it is cached. Closes B5 (malformed-result poisoning).
 *
 * Returns a plain boolean (NOT a type predicate) so the caller's
 * `fresh` variable keeps its declared `GuardrailResult` type through
 * both branches — a `value is GuardrailResult` predicate would
 * narrow the negative branch to `never` and break the spread expr.
 */
function isWellFormedGuardrailResult(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.blocked === 'boolean' &&
    typeof v.allowed === 'boolean' &&
    typeof v.severity === 'string' &&
    typeof v.risk_level === 'string' &&
    typeof v.risk_score === 'number' &&
    Array.isArray(v.findings)
  );
}

/**
 * Default keyFn — canonical-JSON hash of `(input, validatorName)`.
 * Stable across object-key reordering. SHA-256 digest, base64-url
 * encoded.
 *
 * Note: this is the UN-NAMESPACED primitive. `cachedValidate` always
 * applies the `cacheNamespace` option as an OUTER key prefix, so the
 * default + any custom keyFn inherit namespace isolation
 * automatically. Use `createSaltedKeyFn(engine.getInstanceId())` to
 * wrap this for shared caches.
 */
export const defaultKeyFn: KeyFn = (() => {
  const fn: KeyFn = async (input, validatorName) => {
    const serialized = canonicalJSONStringify({ input, validatorName });
    return await sha256Base64Url(serialized);
  };
  fn._bonklmSalted = false;
  return fn;
})();

/**
 * Build a keyFn that mixes the engine instance ID into the cache key.
 *
 * @param engineInstanceId - 32-char lowercase hex from `engine.getInstanceId()`.
 *   Validated against `^[0-9a-f]{32}$` to close B6 (prefix-injection
 *   collision: a consumer-controlled ID containing `|` could span the
 *   salt-separator boundary).
 * @param baseKeyFn - Optional underlying keyFn. Defaults to namespaced
 *   `defaultKeyFn`.
 */
export function createSaltedKeyFn(engineInstanceId: string, baseKeyFn: KeyFn = defaultKeyFn): KeyFn {
  if (typeof engineInstanceId !== 'string' || engineInstanceId.length === 0) {
    throw new Error('createSaltedKeyFn: engineInstanceId must be a non-empty string');
  }
  // B6 closure: forbid the separator + restrict to hex form generated
  // by GuardrailEngine. Consumers passing arbitrary strings must
  // pre-sanitize (or use createUnsaltedKeyFn explicitly).
  if (!/^[0-9a-f]{32}$/.test(engineInstanceId)) {
    throw new Error(
      'createSaltedKeyFn: engineInstanceId must be 32 lowercase hex chars ' +
        '(format generated by GuardrailEngine.getInstanceId()).'
    );
  }
  const fn: KeyFn = async (input, validatorName) => {
    const base = await baseKeyFn(input, validatorName);
    return `${engineInstanceId}|${base}`;
  };
  fn._bonklmSalted = true;
  return fn;
}

/**
 * Explicit opt-out of salting. Use ONLY for single-engine deployments
 * with no shared cache backend. Documented as the unsafe path.
 *
 * Required to acknowledge the risk before `cachedValidate` accepts a
 * cache without `createSaltedKeyFn(...)`.
 */
export function createUnsaltedKeyFn(baseKeyFn: KeyFn = defaultKeyFn): KeyFn {
  const fn: KeyFn = async (input, validatorName) => {
    return await baseKeyFn(input, validatorName);
  };
  fn._bonklmSalted = false;
  fn._bonklmExplicitUnsalted = true;
  return fn;
}

// ─────────────────────────────────────────────────────────────────────
// Canonical JSON serialisation (audit-hardened).
// ─────────────────────────────────────────────────────────────────────

/** Sentinel emitted for `undefined` values. */
const SENTINEL_UNDEFINED = ' __bonklm:undefined__';
/** Sentinel emitted for `NaN`. */
const SENTINEL_NAN = ' __bonklm:NaN__';
/** Sentinel emitted for positive Infinity. */
const SENTINEL_POS_INF = ' __bonklm:+Infinity__';
/** Sentinel emitted for negative Infinity. */
const SENTINEL_NEG_INF = ' __bonklm:-Infinity__';

/**
 * Canonical JSON stringify — recursively sorts object keys so the
 * output is deterministic regardless of insertion order. Arrays are
 * NOT reordered.
 *
 * hardenings:
 *   - B3-undefined: undefined values serialise to a sentinel string
 *     (distinct from absent keys).
 *   - B3-NaN/Infinity: distinct sentinels (distinct from null).
 *   - B3-Map/Set: REJECTED (would collapse to {} otherwise).
 *   - B3-prototype: only own enumerable + non-enumerable string-keyed
 *     properties enumerated; non-Object.prototype prototypes rejected.
 */
export function canonicalJSONStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === undefined) return SENTINEL_UNDEFINED;
  if (value === null) return null;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return SENTINEL_NAN;
    if (value === Number.POSITIVE_INFINITY) return SENTINEL_POS_INF;
    if (value === Number.NEGATIVE_INFINITY) return SENTINEL_NEG_INF;
    return value;
  }
  if (typeof value === 'bigint') return ` __bonklm:bigint:${value.toString()}`;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  // Reject Map/Set/etc to prevent silent {} collapse (B3 closure).
  if (value instanceof Map || value instanceof Set || value instanceof Date) {
    throw new Error(
      `canonicalJSONStringify: unsupported object type \`${value.constructor.name}\`. ` +
        'Serialise to a plain object/array before passing to cachedValidate.'
    );
  }
  // Reject non-plain prototype chains (B3 closure — prototype-pollution).
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(
      'canonicalJSONStringify: only plain objects are supported as input ' +
        '(non-Object.prototype prototype chain detected). Serialise to a ' +
        'plain object before passing to cachedValidate.'
    );
  }
  // Use own enumerable + non-enumerable string-keyed properties.
  const sorted: Record<string, unknown> = {};
  const keys = Object.getOwnPropertyNames(value).sort();
  for (const key of keys) {
    // Skip __proto__ defensively (should be impossible on a plain object
    // but explicit is safer than implicit).
    if (key === '__proto__') continue;
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

async function sha256Base64Url(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─────────────────────────────────────────────────────────────────────
// In-memory LRU adapter.
// ─────────────────────────────────────────────────────────────────────

export interface InMemoryLRUCacheOptions {
  /** Maximum number of entries before LRU eviction. @default 256 */
  maxEntries?: number;
  /**
   * Optional hard ceiling on per-entry TTL (ms). Overrides any
   * `ttlMs` passed to `set` that exceeds it. Default: 24h
   * ({@link IN_MEMORY_TTL_CEILING_MS}). Set `Infinity` to opt out.
   */
  maxTtlMs?: number;
}

interface LRUEntry {
  value: GuardrailResult;
  expiresAt: number;
}

export class InMemoryLRUCache implements ValidatorCache {
  private readonly maxEntries: number;
  private readonly maxTtlMs: number;
  private readonly entries: Map<string, LRUEntry> = new Map();

  constructor(options: InMemoryLRUCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 256);
    this.maxTtlMs = options.maxTtlMs ?? IN_MEMORY_TTL_CEILING_MS;
  }

  get(key: string): GuardrailResult | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Touch — move to end (most-recently-used).
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /**
   * Store an entry. hardening behaviours:
   *   - B8: ttlMs of 0 = expire immediately on next read.
   *   - B8: negative ttlMs throws (use 0 for immediate expiry).
   *   - B7: ttlMs > maxTtlMs is clamped to maxTtlMs.
   */
  set(key: string, value: GuardrailResult, ttlMs?: number): void {
    let expiresAt: number;
    if (ttlMs === undefined) {
      expiresAt = Number.POSITIVE_INFINITY;
    } else if (ttlMs < 0) {
      throw new Error('InMemoryLRUCache.set: ttlMs must be >= 0');
    } else if (ttlMs === 0) {
      expiresAt = Date.now(); // already-expired sentinel.
    } else {
      const clamped = Math.min(ttlMs, this.maxTtlMs);
      expiresAt = Date.now() + clamped;
    }
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, { value, expiresAt });
    while (this.entries.size > this.maxEntries) {
      const firstKey = this.entries.keys().next().value;
      if (firstKey === undefined) break;
      this.entries.delete(firstKey);
    }
  }

  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (entry === undefined) return false;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

/**
 * Truncate a cache key for log emission. The full key contains the
 * outer `cacheNamespace::` prefix + the engineInstanceId salt + the
 * canonical hash. Logging the whole string at WARN leaks the
 * namespace (consumer-configured, may contain env/topology hints)
 * into downstream log aggregators with potentially wider read
 * access than the cache backend.
 *
 * Format: `<first-12-of-hash>...`. Length-preserving observability
 * (operators can still bucket warns by prefix) without disclosing
 * the namespace string.
 */
function truncateKeyForLog(key: string): string {
  // Pull the canonical-hash trailing segment after the LAST `::`
  // separator (the namespace prefix is `<ns>::<rawKey>`). Then
  // truncate the hash itself to 12 chars + ellipsis so observability
  // can still bucket entries without leaking the hash content.
  const lastSep = key.lastIndexOf('::');
  const tail = lastSep >= 0 ? key.slice(lastSep + 2) : key;
  return tail.length > 12 ? `${tail.slice(0, 12)}...` : tail;
}
