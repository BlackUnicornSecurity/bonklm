/**
 * `@blackunicorn/bonklm-restate` — Restate SDK middleware for BonkLM.
 *
 * Story 4.4 START (Sprint 20). Sprint 21 finishes — adds the
 * complete Restate ctx integration (`ctx.run('validation', ...)`
 * journal entry), CHANGELOG, full README. This Sprint 20 deliverable
 * scaffolds the wrapper + reuses `cachedValidate` for idempotent
 * validation across Restate's durable-execution retries.
 *
 * **Why cachedValidate** (Story 4.4 AC): Restate replays a handler on
 * retry. Without caching, the validator re-runs and may produce a
 * different decision (network-dependent LLM-backed validators, time-
 * based thresholds, etc.). Routing through `cachedValidate` keyed on
 * the input gives Restate a deterministic ALLOW/BLOCK boundary that
 * survives replay.
 */
export {
  withRestateGuardrails,
  RestateGuardrailBlockedError,
  type RestateMiddlewareOptions,
  type RestateGuardrailBlockEvent,
} from './middleware.js';
