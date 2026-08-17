/**
 * RawUpstreamCache
 * ===================================================
 * An AsyncLocalStorage-scoped map from `rawBodyHash` (SHA-256 of an upstream
 * tool-result body) to the raw body itself. Net-new primitive — it does NOT
 * exist anywhere in the tree before PR-A.
 *
 * Purpose (Home E): when an agent launders a poisoned tool result through a
 * paraphrase before a `memory.write`, the laundered surface text no longer
 * matches a content pattern. The memory-write guard (PR-C) re-scans the RAW
 * upstream body looked up by `rawBodyHash` from this cache — catching the
 * chained attack the laundered text hides.
 *
 * Scoping it to the existing per-turn AsyncLocalStorage context preserves the
 * engine's stateless-per-turn semantics: the cache lives only for the duration
 * of one `runWithRawUpstreamCache` scope and is never shared across turns,
 * requests, or async contexts. Outside a scope every accessor is an inert
 * no-op (writes drop, reads return `undefined`) — never a throw, so a connector
 * that has not opted into provenance emission degrades cleanly.
 *
 * @experimental Forward contract: PR-A defines these primitives; PR-B/PR-C are
 * the first consumers. The export shape may change before the v1.0 public-surface
 * freeze — do not depend on it for stable API yet.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

type RawUpstreamStore = Map<string, string>;

const storage = new AsyncLocalStorage<RawUpstreamStore>();

/**
 * Per-scope entry ceiling. Raw upstream bodies can be large and a single turn
 * may emit many tool results; without a cap the scope's store grows unbounded
 * (security-audit finding). At the cap we DROP new distinct keys (existing keys
 * still update) — a forensic-cache miss degrades to "re-scan unavailable", never
 * a throw or an OOM. Mirrors the composed-context validator's explicit caps.
 */
const MAX_RAW_UPSTREAM_ENTRIES = 256;

/**
 * Run `fn` inside a fresh RawUpstreamCache scope. All `putRawUpstream` /
 * `getRawUpstream` calls made synchronously or in awaited descendants of `fn`
 * share the same store; nothing leaks out of the scope.
 */
export function runWithRawUpstreamCache<T>(fn: () => T): T {
  return storage.run(new Map<string, string>(), fn);
}

/**
 * Record a raw upstream body under its SHA-256 hash. No-op when called outside
 * a {@link runWithRawUpstreamCache} scope.
 */
export function putRawUpstream(rawBodyHash: string, body: string): void {
  const store = storage.getStore();
  if (!store) return;
  // Bound the per-scope store: at the ceiling, only updates to existing keys
  // are admitted; a new distinct key is dropped (re-scan-unavailable, not OOM).
  if (store.size >= MAX_RAW_UPSTREAM_ENTRIES && !store.has(rawBodyHash)) return;
  store.set(rawBodyHash, body);
}

/**
 * Look up a raw upstream body by its SHA-256 hash. Returns `undefined` when the
 * hash is unknown or when called outside a scope.
 */
export function getRawUpstream(rawBodyHash: string): string | undefined {
  return storage.getStore()?.get(rawBodyHash);
}

/** True when executing inside a {@link runWithRawUpstreamCache} scope. */
export function rawUpstreamCacheActive(): boolean {
  return storage.getStore() !== undefined;
}
