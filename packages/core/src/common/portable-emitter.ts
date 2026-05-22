/**
 * BonkLM — PortableEventEmitter
 * =============================
 * Story 2.1b-edge-core: replaces `node:events` imports with a tiny
 * portable emitter. Eliminates the ESM-import hazard documented in
 * `team/lessonslearned.md` (`node:events` is not always-resolvable
 * under bundlers targeting non-Node runtimes).
 *
 * API parity is intentionally minimal — `on(event, listener)`,
 * `off(event, listener)`, `emit(event, payload)`, `listenerCount(event)`,
 * `removeAllListeners(event?)`. NO `once` (consumers wrap with their
 * own once-wrapper if needed); NO `EventEmitter.defaultMaxListeners`
 * (no global state); NO error-event-rethrow magic (errors thrown by
 * listeners are surfaced via try/catch around the emit call site).
 *
 * Use this anywhere BonkLM core needs intra-module event broadcast
 * (HookSandbox, future CircuitBreaker tap, etc.). NOT a public API
 * for downstream consumers; not re-exported from `@blackunicorn/bonklm/edge`.
 *
 * @package @blackunicorn/bonklm (internal)
 */

export type PortableListener<T = unknown> = (payload: T) => void;

export class PortableEventEmitter<TEvents extends Record<string, unknown> = Record<string, unknown>> {
  private listeners: Map<keyof TEvents, Set<PortableListener>> = new Map();

  /**
   * Register a listener for `event`. Duplicate listener registrations
   * are deduplicated (Set semantics) — same function added twice fires
   * exactly once per emit.
   */
  on<E extends keyof TEvents>(event: E, listener: PortableListener<TEvents[E]>): this {
    let bucket = this.listeners.get(event);
    if (bucket === undefined) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    bucket.add(listener as PortableListener);
    return this;
  }

  /**
   * Remove `listener` from `event`. No-op if not registered.
   */
  off<E extends keyof TEvents>(event: E, listener: PortableListener<TEvents[E]>): this {
    const bucket = this.listeners.get(event);
    if (bucket !== undefined) {
      bucket.delete(listener as PortableListener);
      if (bucket.size === 0) {
        this.listeners.delete(event);
      }
    }
    return this;
  }

  /**
   * Synchronously invoke every listener registered for `event` with
   * `payload`. Listener errors are NOT rethrown — they are swallowed
   * to preserve emit-broadcast semantics (one listener throwing must
   * not prevent siblings from receiving the event). Consumers needing
   * error visibility should wrap their listener body in try/catch.
   *
   * Returns `true` when at least one listener was invoked, `false` when
   * the event had no registered listeners (mirrors Node's `EventEmitter`
   * return contract minimally).
   */
  emit<E extends keyof TEvents>(event: E, payload: TEvents[E]): boolean {
    const bucket = this.listeners.get(event);
    if (bucket === undefined || bucket.size === 0) {
      return false;
    }
    // Iterate a SNAPSHOT so a listener that calls `off` or `on` during
    // emit does not mutate the iteration (mirrors Node's snapshot
    // semantics for `emit`).
    const snapshot = Array.from(bucket);
    for (const listener of snapshot) {
      try {
        listener(payload);
      } catch {
        // Intentional swallow: emit broadcasts to all listeners; one
        // throw must not abort siblings. Loud-fail wrappers can wrap
        // their own listener body.
      }
    }
    return true;
  }

  /**
   * Return the number of registered listeners for `event`. Useful for
   * tests asserting subscription state.
   */
  listenerCount<E extends keyof TEvents>(event: E): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /**
   * Remove all listeners for `event`, or every listener across every
   * event when `event` is omitted. Mirrors Node's `removeAllListeners`
   * shape minimally.
   */
  removeAllListeners(event?: keyof TEvents): this {
    if (event === undefined) {
      this.listeners.clear();
    } else {
      this.listeners.delete(event);
    }
    return this;
  }
}
