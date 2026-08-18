/**
 * Seen-signature replay cache.
 * ============================
 *
 * The timestamp window alone permits replaying a captured request for
 * the whole window. This cache remembers recently accepted signatures
 * (keyed by the HMAC digest, which already binds `timestamp.rawBody`)
 * and rejects duplicates until their acceptance window closes.
 *
 * Capacity contract (security-critical): when the cache is at capacity
 * after expiry-pruning, `claim` does NOT silently evict the oldest
 * entry — eviction reopens the replay window while signatures are still
 * unexpired, which is exactly the attack this cache exists to stop.
 * It returns `'full'` instead and the caller fails closed (visible,
 * alertable) rather than silently voiding the guarantee. Size the cache
 * to `window × peak accepted requests/second` (default 100k entries
 * ≈ 12 MB covers 333 rps sustained over a 5-minute window).
 *
 * A signature is claimed at verification time, before the request's
 * outcome is known. A request that subsequently fails (415 unsupported
 * media type, malformed JSON, mapper 400) still consumes its signature:
 * releasing on failure would let anyone holding a captured signature
 * deliberately burn-and-release it and then replay it validly, which is
 * a strictly worse trade for a guardrail. Conformant clients mint a
 * fresh timestamp per attempt, so legitimate retries are unaffected.
 *
 * Per-process by design: in a multi-replica deployment each replica
 * keeps its own cache, so a replay routed to a different replica within
 * the window still succeeds. Deployments needing a cross-replica
 * guarantee inject a shared implementation via the `replayCache`
 * server option (structural `claim` interface — e.g. Redis-backed).
 *
 * Bounded: expired entries are pruned on every claim; memory stays
 * proportional to accepted traffic within one window.
 *
 * @package @blackunicorn/bonklm-server/hmac
 */

/** Default maximum number of remembered signatures. */
export const DEFAULT_REPLAY_CACHE_SIZE = 100_000;

/** Maximum configurable cache size (memory guard — 10M entries). */
export const MAX_REPLAY_CACHE_SIZE = 10_000_000;

/**
 * How far a request timestamp may sit in the FUTURE and still be
 * accepted (clock skew allowance). Lives here (not in index.ts) so the
 * replay cache can size its retention past the acceptance window
 * without an import cycle; hmac/index.ts re-exports it for API compat.
 */
export const MAX_FUTURE_SKEW_MS = 60 * 1000;

export interface ReplayCacheOptions {
  /** Maximum remembered signatures. @default 100000 */
  maxSize?: number;
  /** How long a signature stays remembered (ms). */
  windowMs: number;
  /** Injectable clock for tests. @default Date.now */
  nowMs?: () => number;
}

/** Outcome of a claim attempt. */
export type ClaimOutcome = 'first' | 'replay' | 'full';

interface CacheEntry {
  /** Absolute expiry time (ms epoch). */
  expiresAt: number;
}

export class ReplayCache {
  private readonly maxSize: number;
  private readonly windowMs: number;
  private readonly nowMs: () => number;
  private readonly entries = new Map<string, CacheEntry>();

  constructor(options: ReplayCacheOptions) {
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1) {
      throw new RangeError('ReplayCache windowMs must be a positive integer');
    }
    this.maxSize = Math.max(1, options.maxSize ?? DEFAULT_REPLAY_CACHE_SIZE);
    this.windowMs = options.windowMs;
    this.nowMs = options.nowMs ?? Date.now;
  }

  /**
   * Claim a signature. Returns `'first'` the first time the signature
   * is seen within its window (atomic against concurrent duplicates),
   * `'replay'` when it is a duplicate, and `'full'` when the cache is
   * at capacity after pruning (caller must fail closed — the entry is
   * NOT stored and nothing is evicted).
   *
   * Retention exceeds the acceptance window by the future-skew
   * allowance (see `MAX_FUTURE_SKEW_MS`), so a timestamp stamped
   * slightly in the future cannot outlive its cache entry.
   */
  claim(signature: string): ClaimOutcome {
    const skew = MAX_FUTURE_SKEW_MS;
    const now = this.nowMs();
    const existing = this.entries.get(signature);
    if (existing !== undefined) {
      if (existing.expiresAt > now) {
        // Still remembered: replay. No delete+set "refresh" — moving
        // the entry to the map tail breaks the insertion-order ==
        // expiry-order invariant pruneExpired relies on (expired
        // entries could linger behind live ones).
        return 'replay';
      }
      this.entries.delete(signature);
    }
    this.pruneExpired(now);
    if (this.entries.size >= this.maxSize) {
      // Capacity reached: never silently evict an unexpired signature.
      return 'full';
    }
    // +1ms: the acceptance window is inclusive (age === windowMs still
    // accepted) while expiry uses strict >, so an entry expiring
    // exactly at the acceptance edge would otherwise be forgotten 1ms
    // early.
    this.entries.set(signature, { expiresAt: now + this.windowMs + skew + 1 });
    return 'first';
  }

  /** Drop entries whose window has elapsed. */
  private pruneExpired(now: number): void {
    if (this.entries.size === 0) return;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
      else break;
    }
  }

  /** Number of remembered signatures (test/telemetry hook). */
  get size(): number {
    return this.entries.size;
  }
}
