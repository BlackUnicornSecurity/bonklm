/**
 * @blackunicorn/bonklm-inngest
 * ============================
 * Inngest middleware that injects `ctx.bonklm.validateInput / validateOutput
 * / validateToolArgs` helpers into every function run. Each helper wraps
 * the validator pipeline in `step.run('bonklm-validate-*', ...)` so
 * Inngest's in-run replay machinery + the core cachedValidate cross-run
 * dedupe combine to return cached BLOCK/ALLOW decisions on retry/replay
 * without re-firing validators.
 *
 * Public surface:
 *   - `bonklmInngestMiddleware(options)` — InngestMiddleware factory.
 *   - `createBonklmInngestContextSurface(step, options)` — direct
 *     surface constructor; useful for test harnesses and custom
 *     middleware composition that doesn't go through v4's plugin API.
 *
 * Types:
 *   - `BonklmInngestMiddlewareOptions`
 *   - `BonklmInngestContextSurface`
 *   - `BonklmInngestValidateResult`
 *   - `StepRunner` — minimum step.run shape used by the helpers.
 */
export { bonklmInngestMiddleware, createBonklmInngestContextSurface, type StepRunner } from './bonklm-middleware.js';
export type {
  BonklmInngestContextSurface,
  BonklmInngestMiddlewareOptions,
  BonklmInngestValidateResult
} from './types.js';
