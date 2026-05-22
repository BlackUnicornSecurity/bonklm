/**
 * @blackunicorn/bonklm-browser-agents-core
 * ========================================
 * Shared event union + guardrail factory for browser-agent connectors.
 * Used by `@blackunicorn/bonklm-stagehand` and `@blackunicorn/bonklm-eko`.
 *
 * Public surface:
 *   - `withBrowserAgentGuardrails(client, opts)` — wrap a vendor
 *     client with a `bonklm.validateEvent` helper.
 *   - `BrowserAgentEvent` — normalised event union (act, extract,
 *     observe, agent.execute).
 *   - `BrowserAgentGuardOptions` — `{ engine, allowCuaMode?, logger? }`.
 *   - `BrowserAgentValidateResult` — `{ blocked, allowed, reason?, surface }`.
 */
export {
  withBrowserAgentGuardrails,
  type GuardedBrowserAgentClient,
} from './with-browser-agent-guardrails.js';
export { BrowserAgentGuardrailBlockedError } from './types.js';
export type {
  BrowserAgentEvent,
  BrowserAgentGuardOptions,
  BrowserAgentLogger,
  BrowserAgentValidateResult,
} from './types.js';
export {
  CUA_MODE_PATTERN,
  assertNonCuaMode,
  detectVendorMode,
  emitWarning,
  isUnsafeBinaryResult,
  normaliseActArg,
  sanitizeReasonText,
} from './shared-helpers.js';
