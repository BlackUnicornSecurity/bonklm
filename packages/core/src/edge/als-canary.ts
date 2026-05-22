/**
 * BonkLM — AsyncLocalStorage canary guard
 * =======================================
 * Story 2.1b-edge-core (iter-3 security A&D-SEC-3 + iter-3 adversarial
 * A&D-1).
 *
 * Two layers of defence against a non-functional ALS implementation:
 *
 * 1. **Presence guard** — `globalThis.AsyncLocalStorage` truthiness.
 *    Catches the obvious case where ALS is absent (e.g. Workerd without
 *    `compatibility_flags = ["nodejs_compat"]`).
 *
 * 2. **Canary deep-equal** — runs `als.run(canary, () => getStore())`
 *    with an OBJECT-VALUED sentinel (NOT a primitive) and asserts:
 *      a. reference equality (`getStore() === canary`),
 *      b. per-field deep-equal on `token` and `sourceTrust`.
 *    Catches stubs, broken polyfills, and prototype-pollution that
 *    spoof one field while satisfying typeof / truthiness.
 *
 * The canary's `token` is `portableRandomUUID()` — different on every
 * invocation — so an attacker cannot pre-compute the expected sentinel
 * value. (Security goal is tamper-detection, NOT cryptographic
 * randomness; the Math.random fallback in `portableRandomUUID` is
 * acceptable for this purpose.)
 *
 * Engine construction MUST call this guard ONCE before installing any
 * call-context-aware hook (ElizaOS `withCallContext`, future
 * `surface: 'tool_call'` propagation). Failure throws
 * `AsyncLocalStorageCanaryError` synchronously — no further engine
 * initialisation occurs.
 *
 * @package @blackunicorn/bonklm
 */

import { portableRandomUUID } from '../common/edge-codec.js';

/**
 * Distinct error class so consumers can `catch` the canary failure
 * separately from generic engine-construction errors and surface a
 * runtime-misconfiguration finding to their operators.
 */
export class AsyncLocalStorageCanaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AsyncLocalStorageCanaryError';
  }
}

/**
 * Asserts that an `AsyncLocalStorage` constructor is present AND functional.
 *
 * Runtime detection:
 * - **Node**: `AsyncLocalStorage` lives on `node:async_hooks`, NOT on
 *   `globalThis`. Node consumers (engine construction path) pass the
 *   explicitly-imported class as the `AlsCtor` parameter.
 * - **Workerd with `nodejs_compat`**: Cloudflare exposes
 *   `AsyncLocalStorage` on `globalThis`. Edge consumers can omit the
 *   parameter and the canary picks it up via the default expression.
 * - **Deno / Bun**: Both expose `AsyncLocalStorage` on `globalThis`
 *   when running in Node-compat mode (default for Deno >=1.40, Bun >=1.0).
 *
 * Failure modes:
 * - **No ALS anywhere**: throws — "add `nodejs_compat` to wrangler.toml".
 * - **Poisoned ALS stub**: throws — canary deep-equal mismatch.
 *
 * Cost: one `als.run` + one `getStore` per invocation. Negligible
 * (<1ms on modern runtimes). Call ONCE per engine construction.
 *
 * @param AlsCtor - The `AsyncLocalStorage` constructor. Defaults to
 *   `globalThis.AsyncLocalStorage` (edge path). Node callers MUST pass
 *   the explicitly-imported class from `node:async_hooks`.
 * @throws {AsyncLocalStorageCanaryError} when ALS is absent or non-functional.
 */
export function assertAsyncLocalStorageHealthy(
  AlsCtor: (new () => AsyncLocalStorageLike) | undefined = (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage as
    | (new () => AsyncLocalStorageLike)
    | undefined
): void {
  // Layer 1 — presence guard.

  if (typeof AlsCtor !== 'function') {
    throw new AsyncLocalStorageCanaryError(
      'globalThis.AsyncLocalStorage is not available in this runtime. ' +
        'On Cloudflare Workers / Workerd, add `compatibility_flags = ' +
        '["nodejs_compat"]` and a recent `compatibility_date` to your ' +
        'wrangler.toml. See docs/user/migration/edge-string-handlers.md' +
        '#cloudflare-workers-required-setup for the canonical config.'
    );
  }

  // Layer 2 — canary deep-equal.
  // Object-valued sentinel with a unique token so an attacker who has
  // observed prior canaries cannot pre-compute the expected value.
  const canary = {
    token: portableRandomUUID(),
    sourceTrust: 'canary-sentinel' as const,
  };

  let observed: unknown;
  let als: AsyncLocalStorageLike;
  try {
    als = new AlsCtor();
  } catch (e) {
    throw new AsyncLocalStorageCanaryError(
      `AsyncLocalStorage construction failed: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }

  try {
    als.run(canary, () => {
      observed = als.getStore();
    });
  } catch (e) {
    throw new AsyncLocalStorageCanaryError(
      `AsyncLocalStorage.run/getStore threw: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }

  // Reference equality — catches stubs that return a SPOOFED object
  // matching the canary's SHAPE but with different identity.
  if (observed !== canary) {
    throw new AsyncLocalStorageCanaryError(
      'AsyncLocalStorage canary failed: getStore() returned a different ' +
        'reference than als.run() stored. Likely causes: a polyfill that ' +
        'shallow-clones the store, a poisoned globalThis.AsyncLocalStorage ' +
        'stub, or a prototype-pollution attack.'
    );
  }

  // Per-field deep-equal — catches prototype-mutated getters that
  // return the canary reference but lie about its content (e.g. spoof
  // sourceTrust to "authenticated").
  const obs = observed as { token?: unknown; sourceTrust?: unknown } | null;
  if (
    obs === null ||
    typeof obs !== 'object' ||
    obs.token !== canary.token ||
    obs.sourceTrust !== canary.sourceTrust
  ) {
    throw new AsyncLocalStorageCanaryError(
      'AsyncLocalStorage canary failed: getStore() returned an object ' +
        'whose token/sourceTrust fields did not match the canary. Likely ' +
        'a prototype-polluted getter or a malicious dep mutating the ' +
        'ALS store between run() and getStore().'
    );
  }
}

/**
 * Minimal AsyncLocalStorage shape — avoids importing `node:async_hooks`
 * statically so this file is edge-portable (it executes the runtime's
 * own ALS via `globalThis.AsyncLocalStorage`).
 */
interface AsyncLocalStorageLike {
  run<R>(store: unknown, fn: () => R): R;
  getStore(): unknown;
}
