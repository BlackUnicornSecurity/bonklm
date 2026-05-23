/**
 * Sprint 14 cumulative-audit code-review PB-6 closure:
 * `sanitizeReasonText` was historically only exported from
 * `@blackunicorn/bonklm-browser-agents-core`. Multiple non-browser
 * connectors (Inngest, Trigger.dev) needed it to defang
 * attacker-controlled validator output before it reached
 * observability sinks — pulling a browser-named package into
 * server-side workspaces was a misleading dependency tree.
 *
 * The canonical home is now this module
 * (`@blackunicorn/bonklm/core/connector-utils`). The browser-agents-core
 * export remains for back-compat; new connectors should import from
 * the core subpath.
 *
 * Edge-safe: pure string operation, no Node-only globals.
 *
 * @package @blackunicorn/bonklm/core/connector-utils
 */

/**
 * Strip non-printable / control characters from a free-form `reason`
 * string and cap at 200 characters. Use BEFORE any attacker-influenced
 * string crosses a security-relevant boundary (error message, log
 * line, OTel span, durable-task history, dashboard run-status field).
 *
 * Returns `undefined` for non-string / empty / fully-stripped input
 * so consumers can drop the field rather than emit an empty value.
 *
 * @example
 * ```ts
 * const ctlChars = '\x1b[31mEVIL\x1b[0m';
 * sanitizeReasonText(ctlChars); // → '[31mEVIL[0m' (with ANSI escapes stripped)
 *
 * sanitizeReasonText('Blocked: ' + attackerControlledReason);
 * // → '<sanitized first 200 printable-ASCII chars>'
 * ```
 *
 * Used by:
 *   - `BrowserAgentGuardrailBlockedError` (browser-agents-core base)
 *   - `bonklmInngestMiddleware` validateInput/Output/ToolArgs reason
 *   - `withBonkLM` onFailure log emission
 *   - `createGuardedLanceTable` write-block error messages
 *     (Sprint 14 cumulative sec cross-S1 closure)
 *   - `createGuardedNamespace` write-block error messages
 *     (Sprint 14 cumulative sec cross-S1 closure)
 */
export function sanitizeReasonText(
  reason: string | undefined
): string | undefined {
  if (typeof reason !== 'string') return undefined;
  if (reason.length === 0) return undefined;
  // eslint-disable-next-line no-control-regex
  const stripped = reason.replace(/[^\x20-\x7E]/g, '').slice(0, 200);
  return stripped.length > 0 ? stripped : undefined;
}
