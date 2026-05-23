/**
 * `@blackunicorn/bonklm-sandbox-utils` — shared validation primitives
 * for E2B / Daytona / future sandbox adapters.
 *
 * **EXPERIMENTAL (Story 3.5)**: package.json carries `experimental: true`.
 * Flag removal gated on v0.7 recall benchmark (95% on Story 3.2's
 * 50-pattern sandbox-attack-corpus, hash-pinned).
 *
 * Three primitives:
 *   - `validateCode(code, engine)` — runs `CodeInjectionValidator` over
 *     a code blob. Returns `SandboxValidationResult`.
 *   - `validatePath(path, cwd, engine)` — runs `PathTraversalValidator`.
 *   - `wrapStream(stream, engine, opts)` — wraps an output stream from a
 *     sandbox (`commands.run` stdout, `process` stream) and validates
 *     each chunk; throws on BLOCK.
 *
 * **Fail-CLOSED default** (Story 3.5 AC + security-audit GAP-7):
 * when any validator throws, times out, or returns an indeterminate
 * result, the wrapper MUST default to BLOCK. Fail-open is opt-in via
 * explicit `onSandboxError: 'allow'` config. Default `'block'`.
 *
 * **Production observability (AAD-4)**: when `onSandboxError: 'allow'`
 * AND `NODE_ENV === 'production'`, emit at WARN-severity with
 * one-time-per-wrapper-instance suppression so PagerDuty doesn't get
 * paged continuously.
 */
export {
  validateCode,
  validatePath,
  wrapStream,
  SandboxStreamBlocked,
  _resetFailOpenWarnState,
  type SandboxValidationResult,
  type SandboxValidatorOptions,
  type SandboxWrapStreamOptions,
  type OnSandboxErrorAction,
  EXPERIMENTAL_WARN_LABEL,
} from './primitives.js';
