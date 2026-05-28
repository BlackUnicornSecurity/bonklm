/**
 * Sprint 22 cumulative audit closure (architect C2 + code-reviewer
 * CONCERN-4) — shared wrap-sentinel for connector double-wrap defence.
 *
 * Five consumers had been duplicating the `Symbol.for('bonklm.X.wired')`
 * + `Object.defineProperty(target, SYM, { value: true, ... })` +
 * `target[SYM] && throw` pattern verbatim (livekit-connector,
 * document-ingest×3, cloudflare-agents-connector, inference-providers).
 * Sprint 21 N2 / Sprint 22 architect C2 explicitly demanded extraction
 * once the rule-of-three was exceeded.
 *
 * Usage:
 *
 * ```ts
 * import { markWrapped, assertNotWrapped } from '@blackunicorn/bonklm/core/connector-utils';
 *
 * const SENTINEL = Symbol.for('bonklm.myconnector.wired');
 *
 * export function wrapClient<C>(client: C, opts: MyOpts): C {
 *   assertNotWrapped(client, SENTINEL, 'wrapClient');
 *   const wrapped = { ...client, ... };
 *   markWrapped(wrapped, SENTINEL);
 *   return wrapped as C;
 * }
 * ```
 *
 * Why a shared helper rather than a base-class mixin: the wrap pattern
 * applies to plain objects, class instances, AND class constructors
 * (cloudflare-agents uses it on the mixin class). A single
 * Symbol-based marker works for all three; a class-based primitive
 * doesn't.
 */

/** Marker descriptor — non-enumerable so it doesn't leak through
 * `Object.keys` / `JSON.stringify` / spread. Non-writable so an
 * attacker can't clear it before re-wrap. */
const SENTINEL_DESCRIPTOR: PropertyDescriptor = {
  value: true,
  enumerable: false,
  writable: false,
  configurable: false
};

/**
 * Throw if `target` has already been marked with `sentinel`. Idempotent
 * to call on a fresh target (no throw).
 *
 * The `label` is interpolated into the error message for ergonomic
 * stack traces — operators see which wrap function rejected the call.
 *
 * @public Sprint 26/28 v1.0-RC1 API freeze. Connector authors building
 * their own wrappers may rely on this. Symbol-based marker placement
 * is part of the freeze (consumers may inspect `target[sentinel]`).
 */
export function assertNotWrapped(target: unknown, sentinel: symbol, label: string): void {
  if (
    target !== null &&
    (typeof target === 'object' || typeof target === 'function') &&
    (target as Record<symbol, unknown>)[sentinel] === true
  ) {
    throw new Error(
      `${label}: target already wrapped by bonklm (sentinel ${String(sentinel)}). ` +
        `Wrapping twice would double-validate every call. ` +
        `Use a fresh instance per wrap or pass the wrapped instance directly.`
    );
  }
}

/**
 * Mark `target` with `sentinel`. Subsequent `assertNotWrapped(target,
 * sentinel)` calls throw.
 *
 * Safe to call on plain objects, class instances, and class
 * constructors (the marker lands on the object reference itself, not
 * on its prototype).
 *
 * @public Sprint 26/28 v1.0-RC1 API freeze. Non-enumerable,
 * non-writable, non-configurable descriptor is part of the freeze.
 */
export function markWrapped(target: unknown, sentinel: symbol): void {
  if (target === null || (typeof target !== 'object' && typeof target !== 'function')) {
    throw new TypeError(`markWrapped: target must be an object or function (got ${typeof target}).`);
  }
  Object.defineProperty(target, sentinel, SENTINEL_DESCRIPTOR);
}

/**
 * Convenience: one-call combo of `assertNotWrapped` + the
 * `markWrapped` placement. Returns `target` for fluent use.
 *
 * @public Sprint 26/28 v1.0-RC1 API freeze.
 */
export function ensureWrappedOnce<T>(target: T, sentinel: symbol, label: string): T {
  assertNotWrapped(target, sentinel, label);
  markWrapped(target as unknown as object, sentinel);
  return target;
}

/**
 * Test-only: clear the sentinel from a target so subsequent wraps
 * succeed. Useful for unit tests that re-use the same mock client
 * across `wrap...()` calls.
 *
 * Defensive: this is a HARD reset that bypasses the immutable
 * descriptor by re-defining with `configurable: true`. Operators
 * must NOT call this in production — it disables the double-wrap
 * defence.
 *
 * @internal — may change without notice in any minor/patch (v1.0-RC1
 * API freeze policy). The leading `_` prefix marks INTERNAL surface.
 */
export function _testOnlyClearSentinel(target: unknown, sentinel: symbol): void {
  if (target !== null && (typeof target === 'object' || typeof target === 'function')) {
    Object.defineProperty(target, sentinel, {
      value: false,
      enumerable: false,
      writable: true,
      configurable: true
    });
  }
}
