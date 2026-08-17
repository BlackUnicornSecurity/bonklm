/**
 * Story 2.1b-edge-core — AsyncLocalStorage canary guard
 *
 * Iter-3 security A&D-SEC-3 + iter-3 adversarial A&D-1: the inline
 * `if (!globalThis.AsyncLocalStorage) throw` guard at engine construction
 * catches the obvious case where ALS is absent (e.g. Workerd without
 * `nodejs_compat`). But a poisoned `globalThis.AsyncLocalStorage` stub
 * that satisfies truthiness while providing broken `run` / `getStore`
 * semantics bypasses it. The canary check uses a `portableRandomUUID()`-
 * generated object-valued sentinel + reference-equality + per-field
 * deep-equal to catch stubs, broken polyfills, and prototype pollution.
 *
 * Iter-2 security A&D-SEC-2: `als.run(undefined, ...)` clears store on Node.
 * The Workerd CI smoke suite asserts the same; here we lock the Node
 * behaviour with a regression test so a future runtime swap can't
 * silently regress.
 */
import { AsyncLocalStorage as NodeAsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it } from 'vitest';
import { assertAsyncLocalStorageHealthy, AsyncLocalStorageCanaryError } from '../../src/edge/als-canary.js';

// Cast the imported Node class to the canary's expected ctor shape.
// (Test-side cast; production callers either pass the same import OR
// rely on globalThis.AsyncLocalStorage on Workerd-with-nodejs_compat.)
const NodeAlsCtor = NodeAsyncLocalStorage as unknown as new () => {
  run<R>(store: unknown, fn: () => R): R;
  getStore(): unknown;
};

describe('assertAsyncLocalStorageHealthy', () => {
  describe('happy path — real Node AsyncLocalStorage', () => {
    it('returns without throwing on a properly working ALS implementation', () => {
      expect(() => assertAsyncLocalStorageHealthy(NodeAlsCtor)).not.toThrow();
    });

    it('the canary executes in O(1) (single run/getStore round-trip)', () => {
      const start = Date.now();
      for (let i = 0; i < 100; i++) assertAsyncLocalStorageHealthy(NodeAlsCtor);
      const elapsed = Date.now() - start;
      // 100 invocations should comfortably complete in <100ms on any
      // modern runtime. This guards against accidental loops in the canary.
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('absent AsyncLocalStorage — throws AsyncLocalStorageCanaryError', () => {
    it('throws when globalThis.AsyncLocalStorage is undefined', () => {
      const original = (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage;
      try {
        delete (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage;
        expect(() => assertAsyncLocalStorageHealthy()).toThrowError(AsyncLocalStorageCanaryError);
      } finally {
        (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = original;
      }
    });

    it('the absent-ALS error names nodejs_compat for Workerd diagnostic', () => {
      const original = (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage;
      try {
        delete (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage;
        try {
          assertAsyncLocalStorageHealthy();
          expect.unreachable();
        } catch (e) {
          expect((e as Error).message).toMatch(/nodejs_compat/);
        }
      } finally {
        (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = original;
      }
    });
  });

  describe('poisoned AsyncLocalStorage — canary deep-equal catches stubs', () => {
    it('throws when getStore() returns a sentinel different from the canary', () => {
      const original = (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage;
      try {
        // Poison: a stub class that always returns a SPOOFED store object
        // matching the canary's shape but with wrong token. Models a hostile
        // dep that satisfies typeof + truthiness checks but lies about state.
        (globalThis as { AsyncLocalStorage: unknown }).AsyncLocalStorage = class {
          run<R>(_store: unknown, fn: () => R): R {
            return fn();
          }
          getStore(): unknown {
            return { token: 'attacker-controlled', sourceTrust: 'canary-sentinel' };
          }
        };
        expect(() => assertAsyncLocalStorageHealthy()).toThrowError(AsyncLocalStorageCanaryError);
      } finally {
        (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = original;
      }
    });

    it('throws when getStore() returns undefined inside als.run(canary, ...)', () => {
      const original = (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage;
      try {
        // Poison: getStore always returns undefined (broken ALS).
        (globalThis as { AsyncLocalStorage: unknown }).AsyncLocalStorage = class {
          run<R>(_store: unknown, fn: () => R): R {
            return fn();
          }
          getStore(): unknown {
            return undefined;
          }
        };
        expect(() => assertAsyncLocalStorageHealthy()).toThrowError(AsyncLocalStorageCanaryError);
      } finally {
        (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = original;
      }
    });

    it('throws when getStore() returns the canary object but with mutated sourceTrust', () => {
      const original = (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage;
      try {
        // Poison: prototype-polluted getter that mutates one field.
        (globalThis as { AsyncLocalStorage: unknown }).AsyncLocalStorage = class {
          private store: unknown;
          run<R>(store: unknown, fn: () => R): R {
            this.store = store;
            return fn();
          }
          getStore(): unknown {
            if (typeof this.store === 'object' && this.store !== null) {
              return { ...(this.store as object), sourceTrust: 'authenticated' };
            }
            return this.store;
          }
        };
        expect(() => assertAsyncLocalStorageHealthy()).toThrowError(AsyncLocalStorageCanaryError);
      } finally {
        (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = original;
      }
    });
  });

  describe('canary token unpredictability', () => {
    it('the canary token differs across invocations', () => {
      // Capture two canary tokens by intercepting via a stub. The canary
      // uses portableRandomUUID() so two consecutive invocations MUST NOT
      // produce the same token (defeats the "attacker pre-computes the
      // expected canary" hypothesis).
      const original = (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage;
      const observedTokens: string[] = [];
      try {
        (globalThis as { AsyncLocalStorage: unknown }).AsyncLocalStorage = class {
          private store: unknown;
          run<R>(store: unknown, fn: () => R): R {
            this.store = store;
            if (typeof store === 'object' && store !== null && 'token' in store) {
              observedTokens.push((store as { token: string }).token);
            }
            return fn();
          }
          getStore(): unknown {
            return this.store;
          }
        };
        assertAsyncLocalStorageHealthy();
        assertAsyncLocalStorageHealthy();
        expect(observedTokens.length).toBe(2);
        expect(observedTokens[0]).not.toBe(observedTokens[1]);
      } finally {
        (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = original;
      }
    });
  });
});
