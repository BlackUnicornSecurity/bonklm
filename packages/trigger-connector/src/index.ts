/**
 * @blackunicorn/bonklm-trigger
 * ============================
 * Trigger.dev v3/v4 middleware that wraps `task({...})` with BonkLM
 * security guardrails. `withBonkLM(opts)` returns `{ middleware,
 * onFailure }` ready to spread into the task factory; a CRIU-safe
 * `BonklmTriggerHandle` is stored in Trigger.dev's `locals` registry
 * + retrieved inside `run()` via `getBonklmHandle()`.
 *
 * Retries of the same run share a `cacheNamespace` derived from
 * `ctx.run.id` so cachedValidate serves the cached BLOCK/ALLOW
 * decision without re-firing the validator pipeline. Different runs
 * get distinct namespaces (no cross-run cache poisoning).
 *
 * Public surface:
 *   - `withBonkLM(options)` — factory returning `{ middleware, onFailure }`.
 *   - `createBonklmTriggerHandle({ ...options, runId })` — direct handle
 *     constructor for test harnesses + custom-middleware composition.
 *   - `getBonklmHandle(ctx?)` — locals accessor for use inside `run()`.
 *     Pass `ctx` to assert cross-task isolation (recommended).
 *
 * The raw `bonklmHandleLocalsKey` is INTENTIONALLY NOT re-exported
 * from this barrel: granting consumers raw `locals.set(...)` access
 * to the handle slot is an attractive footgun (arch X6 / sec S2 —
 * supply-chain locals-slot squatting). `getBonklmHandle()` validates
 * the handle's structural shape AND optionally its run-id tag before
 * returning it.
 *
 * Types:
 *   - `BonklmTriggerOptions`
 *   - `BonklmTriggerHandle`
 *   - `BonklmTriggerBindings`
 *   - `BonklmTriggerValidateResult`
 *   - `BonklmTriggerRunContext`
 *   - `BonklmTriggerMiddlewareParams`
 *   - `BonklmTriggerFailureParams`
 *   - `CreateBonklmTriggerHandleOptions`
 */
export {
  withBonkLM,
  createBonklmTriggerHandle,
  getBonklmHandle,
  type CreateBonklmTriggerHandleOptions,
} from './with-bonklm.js';
export type {
  BonklmTriggerBindings,
  BonklmTriggerFailureParams,
  BonklmTriggerHandle,
  BonklmTriggerMiddlewareParams,
  BonklmTriggerOptions,
  BonklmTriggerRunContext,
  BonklmTriggerValidateResult,
} from './types.js';
