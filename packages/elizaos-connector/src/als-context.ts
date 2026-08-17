/**
 * connectors — AsyncLocalStorage call-context isolation
 * ================================================================
 *
 * Replaces the Phase-1 `runtime.bonklm.currentCallContext` direct
 * property with `AsyncLocalStorage`-managed ambient context. Closes
 * the iteration-2 architect BLOCK-1 + adversarial audit #11
 * vulnerability where a hostile plugin assigning
 * `runtime.bonklm.currentCallContext = { sourceTrust: 'authenticated' }`
 * could spoof the wrap-memory closure's trust signal.
 *
 * After this migration:
 *   - There is no `currentCallContext` property on `runtime.bonklm` —
 *     hostile assignments become inert (the closure reads ALS, not
 *     `runtime.bonklm.currentCallContext`).
 *   - `withCallContext(runtime, ctx, fn)` becomes `als.run(ctx, fn)`
 *     internally. Call-site shape preserved for connector callers.
 *   - Concurrent `withCallContext` calls on the same runtime are
 *     correctly isolated via ALS scoping.
 *
 * Edge-compat: AsyncLocalStorage works on Node (always), Workerd
 * (with `compatibility_flags = ["nodejs_compat"]`), Deno, and Bun.
 * Engine-construction-time `assertAsyncLocalStorageHealthy()` (from
 * `@blackunicorn/bonklm`) catches absent or poisoned ALS at startup.
 *
 * @package @blackunicorn/bonklm-elizaos
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { assertAsyncLocalStorageHealthy, type GuardrailEngine } from '@blackunicorn/bonklm';
import type { IAgentRuntimeLike, SourceTrust } from './types.js';

/**
 * The per-call context the wrap-memory closure consults to compute
 * the `source` field on memory writes.
 *
 * Phase-2 (this file): stored in `AsyncLocalStorage`, never on
 * `runtime.bonklm`. Hostile plugins cannot assign into ALS from
 * outside an `als.run(...)` scope.
 */
export interface CallContext {
  sourceTrust: SourceTrust;
  pluginName?: string;
}

/**
 * Module-scope ALS instance. One per Node process (or per Workerd
 * isolate). The wrap-memory closure and the doctor probe both read
 * from this instance.
 */
const als = new AsyncLocalStorage<CallContext>();

/**
 * Engine-construction guard. Call ONCE per engine to verify the host
 * runtime ships a functional `AsyncLocalStorage`. Throws
 * `AsyncLocalStorageCanaryError` synchronously on absent / poisoned
 * implementations. Callers MUST run this before any
 * `installSealedWrapMemory` so the seal does not silently install
 * against a broken ALS.
 */
export function assertCallContextRuntime(): void {
  // Pass the explicitly-imported Node `AsyncLocalStorage` so the
  // canary asserts against the SAME class this module uses. On
  // Workerd-with-nodejs_compat the Node import resolves to the
  // Cloudflare-provided ALS; the canary verifies its behaviour.
  assertAsyncLocalStorageHealthy(AsyncLocalStorage);
}

/**
 * Run `fn` with the supplied call context in scope. Both sync and
 * async functions are supported via the same API. ALS correctly
 * propagates context across `await` boundaries, `setTimeout` /
 * `setImmediate` callbacks scheduled inside `fn`, and `Promise` chains.
 *
 * @param _runtime - The runtime — accepted for API parity with
 *   Phase-1 `withCallContext(runtime, ctx, fn)`; the runtime is NOT
 *   touched (the context lives in ALS, not on the runtime).
 * @param context - The call-context to install for the scope.
 * @param fn - The work to perform inside the context.
 */
export async function withCallContext<T>(
  _runtime: IAgentRuntimeLike,
  context: CallContext,
  fn: () => Promise<T> | T
): Promise<T> {
  return als.run(context, async () => fn());
}

/**
 * Synchronous variant for cases where the callee is known-sync. Most
 * production callers should use the async form for forward-compat.
 *
 * @internal exposed for tests.
 */
export function withCallContextSync<T>(_runtime: IAgentRuntimeLike, context: CallContext, fn: () => T): T {
  return als.run(context, fn);
}

/**
 * Read the current call context, or `undefined` if none is active.
 *
 * Wrap-memory closure consults this on every `createMemory` /
 * `updateMemory` write to compute the `source` field. Hostile plugins
 * cannot influence this value from outside an `als.run(...)` scope
 * established by trusted connector code.
 */
export function getCallContext(): CallContext | undefined {
  return als.getStore();
}

/**
 * Probe-time helper: clears the ambient call context for the duration
 * of `fn`. Used by the startup HTTP probe (iteration-2 senior-dev
 * AAD-C) to ensure ambient context from a constructor's caller does
 * NOT leak into the probe's HTTP request callback. Probes execute
 * pre-first-call, by definition outside any `withCallContext`.
 */
export async function runWithoutCallContext<T>(fn: () => Promise<T> | T): Promise<T> {
  return als.run(undefined as unknown as CallContext, async () => fn());
}

/**
 * Engine-aware helper exposed for callers wiring the connector into a
 * `GuardrailEngine`. Currently a no-op pass-through — kept on the
 * surface for v0.5+ extensions (engine-scoped ALS instances if the
 * roadmap ever needs per-engine context isolation). Today, all
 * connectors share the same module-scope ALS.
 */
export function bindEngineCallContext(_engine: GuardrailEngine): void {
  // Intentionally empty. The module-scope `als` instance is global to
  // the elizaos-connector package; engine binding is not yet needed.
  // Future v0.5+ work may add per-engine isolation here.
}
