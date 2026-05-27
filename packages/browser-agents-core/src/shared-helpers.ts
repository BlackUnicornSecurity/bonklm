/**
 * @blackunicorn/bonklm-browser-agents-core — shared helpers
 * =========================================================
 *
 * Cross-connector helpers hoisted from per-connector wrappers (Sprint
 * 13 cumulative-audit closure). Centralises:
 *
 *   - `assertNonCuaMode` — CUA refusal preflight; SINGLE source of
 *     truth for the CUA synonym regex. Stagehand + Eko + future
 *     entrants share this so a regex update (`"computer_using"` /
 *     `"native-control"` / etc.) propagates with one PR.
 *   - `normaliseActArg` — polymorphic act-arg normalisation that
 *     was previously duplicated across Stagehand + Eko.
 *   - `isUnsafeMcpResult` — binary/async-iterable result detector
 *     hoisted from Eko so Stagehand `extract` can ALSO refuse
 *     non-text returns rather than silently `JSON.stringify`-ing
 *     a `Uint8Array` to `"{}"`.
 *   - `sanitizeReasonText` — strip non-printable chars + cap at
 *     200 chars; used by error-class constructors AND by Inngest's
 *     consumer-readable `BonklmInngestValidateResult.reason` field.
 *
 * @package @blackunicorn/bonklm-browser-agents-core
 */
import type { BrowserAgentLogger } from './types.js';

/**
 * CUA-mode detection regex. Matches `cua`, `computer-use`,
 * `computer_use`, `computeruse`. Case-insensitive.
 *
 * Single source of truth for the synonym set; per-connector code
 * MUST NOT define its own copy.
 */
export const CUA_MODE_PATTERN = /^(cua|computer[-_]?use)$/i;

/**
 * Walk the candidate sources for a vendor-SDK mode declaration and
 * return the first string match.
 *
 * @param client - The vendor SDK client (Stagehand / Eko / ...).
 * @param configOverride - Explicit `{ mode?: string }` passed via
 *   the wrapper's options bag (`stagehandConfig`, `ekoConfig`, ...).
 *
 * NOTE: per Story 2.4 audit closure B2-rev, `modelName` is NOT a
 * fallback source — it is a MODEL identifier, not a mode field.
 * Reading it caused false-positive CUA refusals when model names
 * happened to match the synonym regex (`"gpt-computer-use-preview"`).
 * Only `configOverride.mode`, `client.config.mode`, `client.mode`
 * are read.
 */
export function detectVendorMode(
  client: object,
  configOverride: { mode?: string; [k: string]: unknown } | undefined
): string | undefined {
  if (configOverride !== undefined && typeof configOverride.mode === 'string') {
    return configOverride.mode;
  }
  const c = client as { config?: { mode?: unknown }; mode?: unknown };
  if (c.config !== undefined && typeof c.config.mode === 'string') {
    return c.config.mode;
  }
  if (typeof c.mode === 'string') {
    return c.mode;
  }
  return undefined;
}

/**
 * Refuse construction when the detected mode matches the CUA synonym
 * regex AND `allowCuaMode` is not the explicit opt-in. Caller-name
 * appears in the error message for actionable diagnostics
 * (`'wrapStagehand'`, `'wrapEko'`, ...).
 *
 * @returns The detected mode string (or `undefined` if none found).
 *   Caller may discard or pass through to the underlying SDK.
 *
 * @throws Error when CUA detected + not opted in.
 */
export function assertNonCuaMode(
  callerName: string,
  client: object,
  options: {
    allowCuaMode?: boolean;
    configOverride?: { mode?: string; [k: string]: unknown };
  }
): string | undefined {
  const { allowCuaMode = false, configOverride } = options;
  const mode = detectVendorMode(client, configOverride);
  if (
    mode !== undefined &&
    CUA_MODE_PATTERN.test(mode) &&
    allowCuaMode !== true
  ) {
    throw new Error(
      `${callerName}: CUA / computer-use mode is refused by default. ` +
        'Screenshots are NOT inspected by BonkLM validators. Pass ' +
        '`allowCuaMode: true` to explicitly accept the bypass risk.'
    );
  }
  return mode;
}

/**
 * Normalise the polymorphic `act` argument shape into a string +
 * optional args record so the validator surface sees a stable
 * representation regardless of whether the SDK exposes
 * `act('click submit')` or `act({ action: 'click', selector: '#x' })`.
 *
 * Hoisted from Stagehand + Eko (rev MED-4 closure).
 */
export function normaliseActArg(
  action: string | { action: string; [k: string]: unknown }
): { actionString: string; args?: Record<string, unknown> } {
  if (typeof action === 'string') {
    return { actionString: action };
  }
  const { action: actionString, ...rest } = action;
  return { actionString, args: rest };
}

/**
 * Detect result shapes that can't be meaningfully text-validated.
 * Returns true for Buffer / Uint8Array / ArrayBuffer / async-iterable
 * / ReadableStream results. Plain objects + strings pass through.
 *
 * Used by Eko's MCP-result path (`wrapMcpInPlace`) AND Stagehand's
 * extract-result path (arch X5 closure — previously only Eko had this
 * guard; Stagehand silently `JSON.stringify`'d a `Uint8Array` to
 * `"{}"` which validators trivially accepted).
 */
export function isUnsafeBinaryResult(result: unknown): boolean {
  if (result === null || result === undefined) return false;
  if (
    typeof result === 'string' ||
    typeof result === 'number' ||
    typeof result === 'boolean'
  ) {
    return false;
  }
  if (
    typeof globalThis.Buffer !== 'undefined' &&
    globalThis.Buffer.isBuffer(result as { length: number })
  ) {
    return true;
  }
  if (result instanceof Uint8Array) return true;
  if (result instanceof ArrayBuffer) return true;
  if (
    typeof (result as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] ===
    'function'
  ) {
    return true;
  }
  return false;
}

/**
 * Sanitize a free-form `reason` string before it crosses any
 * security-relevant boundary (error message, log line, OTel span,
 * Inngest step history). Hex-escapes C0/DEL control characters
 * (including TAB), strips non-printable above 0x7E, and caps at 200
 * characters so attacker-controlled validator output cannot pollute
 * downstream observability surfaces.
 *
 * Used by `BrowserAgentGuardrailBlockedError` (base class) + the
 * Inngest result aggregator (sec CS3 closure — Inngest's
 * `BonklmInngestValidateResult.reason` was previously unsanitized).
 *
 * D-015 (Sprint 52 Day 2 Gate 5.10 audit): this is a re-export of the
 * canonical `sanitizeReasonText` from `@blackunicorn/bonklm/core/connector-utils`.
 * The previous local implementation predated B.4 (Sprint 51) and silently
 * dropped TAB (\x09) instead of hex-escaping it — reopening the TSV
 * phantom-column injection vector that B.4 closed in the canonical impl.
 * Re-exporting ensures ADR-0001 D#2 alignment with no duplication risk.
 * The canonical impl already includes the 200-char cap.
 */
export { sanitizeReasonText } from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Emit a warning via the supplied logger, falling back to
 * `console.warn` so unmissable security signals (CUA opt-in,
 * skipAgents total bypass, intercept-callback gaps) are surfaced
 * regardless of consumer wiring.
 */
export function emitWarning(
  logger: BrowserAgentLogger | undefined,
  message: string,
  meta?: Record<string, unknown>
): void {
  if (logger !== undefined) {
    // Avoid the trailing `undefined` arg — `logger.warn(msg, undefined)`
    // produces a 2-arity call that breaks consumer assertions like
    // `expect(warn).toHaveBeenCalledWith(stringMatching(...))`.
    if (meta === undefined) logger.warn(message);
    else logger.warn(message, meta);
    return;
  }
  if (meta === undefined) {
    // eslint-disable-next-line no-console
    console.warn(message);
  } else {
    // eslint-disable-next-line no-console
    console.warn(message, meta);
  }
}
