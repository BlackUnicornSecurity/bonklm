/**
 * Story 3.5 — sandbox-utils primitives
 * ======================================
 *
 * Three primitives consumed by e2b-adapter + daytona-adapter:
 *   - validateCode
 *   - validatePath
 *   - wrapStream
 *
 * Fail-CLOSED default + one-time-per-wrapper warning suppression when
 * fail-OPEN is opted in (Story 3.5 AC + AAD-4 closure).
 */
import { CodeInjectionValidator, PathTraversalValidator } from '@blackunicorn/bonklm';

/** Default per-validator timeout. */
const DEFAULT_TIMEOUT_MS = 2000;

/** Stamped on every WARN-severity fail-open log so operators can grep. */
export const EXPERIMENTAL_WARN_LABEL = 'BONKLM_SANDBOX_EXPERIMENTAL_FAIL_OPEN';

/**
 * What to do when the validator itself throws, times out, or returns
 * an indeterminate result (e.g. E2B/Daytona API connectivity failure).
 *
 *   - `'block'` (default + Story 3.5 AC): fail-CLOSED — synthesize a
 *     BLOCK result with `reason: 'sandbox_validator_error'`.
 *   - `'allow'`: fail-OPEN — synthesize an ALLOW result. In production
 *     (NODE_ENV === 'production') this fires a WARN-severity log with
 *     one-time-per-wrapper-instance suppression (AAD-4).
 */
export type OnSandboxErrorAction = 'block' | 'allow';

export interface SandboxValidationResult {
  allowed: boolean;
  blocked: boolean;
  reason?: string;
  severity?: string;
  category?: string;
  /** `true` if this result came from the fail-CLOSED/OPEN error path. */
  validatorError?: boolean;
}

export interface SandboxValidatorOptions {
  /**
   * Per-call timeout for the validator. Default 2000ms. Exceeded →
   * routed through `onSandboxError`.
   */
  timeoutMs?: number;
  /**
   * @default 'block'
   */
  onSandboxError?: OnSandboxErrorAction;
  /**
   * NODE_ENV detection for fail-open WARN suppression. Defaults to
   * `process.env.NODE_ENV`. Tests can override.
   */
  nodeEnv?: string;
  /**
   * Logger sink for the AAD-4 WARN message. Defaults to console.warn.
   */
  warn?: (label: string, context: Record<string, unknown>) => void;
}

export interface SandboxWrapStreamOptions extends SandboxValidatorOptions {
  /** Validator chain to run over each chunk. */
  validators: Array<'code' | 'path'>;
  /** Path validator needs cwd. */
  cwd?: string;
  /** Fires on BLOCK with telemetry payload. */
  onBlock?: (event: { reason: string; category?: string; chunk: string }) => void;
  /**
   * Sprint 19 audit security C-2 closure: error sink for telemetry
   * failures. If `onBlock` throws, the error routes through this
   * callback rather than being silently swallowed.
   */
  onError?: (err: unknown) => void;
}

// =============================================================================
// Per-wrapper-instance one-time warning suppression (AAD-4)
// =============================================================================

/**
 * Sprint 19 audit closure (architect B1 + security B-1 + code-reviewer
 * BLOCK): replaced module-singleton WeakSet/WeakMap with `let`-rebound
 * Map so:
 *   (a) `_resetFailOpenWarnState` actually resets state (no longer a
 *       no-op);
 *   (b) Callers control suppression scope via the `wrapperKey` they
 *       pass in.
 *
 * The AAD-4 spec is "one-time-per-wrapper-instance" — NOT one-time-
 * per-process. The previous module-scoped `_defaultCodeWrapperKey`
 * silently merged all process-wide fail-open events into a single
 * suppression group, defeating per-call observability for an
 * adversary who could trigger many fail-open events.
 */
let _warnedWrappers: WeakSet<object> = new WeakSet();
let _warnCounters: WeakMap<object, number> = new WeakMap();

function emitFailOpenWarn(
  wrapperKey: object,
  reason: string,
  options: SandboxValidatorOptions
): void {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? '';
  if (nodeEnv !== 'production') return;

  const warn = options.warn ?? ((label, ctx) => console.warn(`[${label}]`, ctx));
  const prevCount = _warnCounters.get(wrapperKey) ?? 0;
  _warnCounters.set(wrapperKey, prevCount + 1);

  if (_warnedWrappers.has(wrapperKey)) {
    return;
  }
  _warnedWrappers.add(wrapperKey);
  warn(EXPERIMENTAL_WARN_LABEL, {
    reason,
    onSandboxError: 'allow',
    occurrenceCountSoFar: prevCount + 1,
    advice: 'Set NODE_ENV !== production OR onSandboxError: "block" to silence; this is a one-time warning per wrapperKey.',
  });
}

/**
 * Reset internal WARN suppression state. Tests + callers needing
 * global reset (rare).
 *
 * @internal — may change without notice (v1.0-RC1 API freeze
 * policy). Leading `_` prefix marks INTERNAL surface.
 */
export function _resetFailOpenWarnState(): void {
  _warnedWrappers = new WeakSet();
  _warnCounters = new WeakMap();
}

// =============================================================================
// validateCode
// =============================================================================

/**
 * Lazy default CodeInjectionValidator — instantiated once per process
 * for the standalone `validateCode` call sites. Wrappers (e2b-adapter,
 * daytona-adapter) construct their own per-wrapper validators to
 * isolate `_warnCounters` state.
 */
let _defaultCodeValidator: CodeInjectionValidator | undefined;

/**
 * Validate a code blob. Returns SandboxValidationResult — never throws
 * out of the function (errors routed through onSandboxError).
 *
 * Sprint 19 audit closure: when called without an explicit `wrapperKey`
 * in options, creates a FRESH wrapper key per call. This means every
 * standalone `validateCode` call gets its own AAD-4 WARN suppression
 * group (matching the "per-wrapper-instance" contract). Connectors
 * (e2b-adapter) explicitly pass a wrapper-scoped key so a single
 * wrapped sandbox shares suppression across its many internal calls.
 */
export async function validateCode(
  code: string,
  options: SandboxValidatorOptions & { wrapperKey?: object } = {}
): Promise<SandboxValidationResult> {
  if (!_defaultCodeValidator) _defaultCodeValidator = new CodeInjectionValidator();
  const wrapperKey = options.wrapperKey ?? {};
  return runWithFailCloseDefault(wrapperKey, options, async () => {
    const result = await _defaultCodeValidator!.validate(code);
    return {
      allowed: !result.blocked,
      blocked: result.blocked,
      reason: result.blocked ? result.findings[0]?.description : undefined,
      severity: String(result.severity),
      category: result.findings[0]?.category,
    };
  });
}

// =============================================================================
// validatePath
// =============================================================================

/**
 * Per-cwd PathTraversalValidator cache (Sprint 19 audit NIT N-1
 * closure). PathTraversal is stateless after construction; safe to
 * memoize. Bounded at 100 entries to prevent unbounded growth from
 * pathological callers.
 */
const _pathValidatorCache = new Map<string, PathTraversalValidator>();
const _MAX_PATH_VALIDATOR_CACHE = 100;

function getPathValidator(cwd: string): PathTraversalValidator {
  let v = _pathValidatorCache.get(cwd);
  if (!v) {
    if (_pathValidatorCache.size >= _MAX_PATH_VALIDATOR_CACHE) {
      // Simple FIFO eviction — first key.
      const firstKey = _pathValidatorCache.keys().next().value;
      if (firstKey !== undefined) _pathValidatorCache.delete(firstKey);
    }
    v = new PathTraversalValidator({ cwd });
    _pathValidatorCache.set(cwd, v);
  }
  return v;
}

/**
 * Validate a filesystem path against a configured cwd. Returns a
 * SandboxValidationResult.
 */
export async function validatePath(
  path: string,
  cwd: string,
  options: SandboxValidatorOptions & { wrapperKey?: object } = {}
): Promise<SandboxValidationResult> {
  const wrapperKey = options.wrapperKey ?? {};
  return runWithFailCloseDefault(wrapperKey, options, async () => {
    const validator = getPathValidator(cwd);
    const result = await validator.validate(path);
    return {
      allowed: !result.blocked,
      blocked: result.blocked,
      reason: result.blocked ? result.findings[0]?.description : undefined,
      severity: String(result.severity),
      category: result.findings[0]?.category,
    };
  });
}

// =============================================================================
// wrapStream
// =============================================================================

/**
 * Wrap an async iterable stream (sandbox stdout / file-content stream)
 * so each chunk is validated. Throws `SandboxStreamBlocked` on BLOCK.
 *
 * Generic over the chunk type — but the validator currently only
 * handles string chunks. Binary chunks pass through unchanged (the
 * validator decision is "allowed" per Sprint-3.1 audio-stream
 * precedent: we do NOT validate raw bytes).
 */
export class SandboxStreamBlocked extends Error {
  override readonly name = 'SandboxStreamBlocked';
  readonly reason: string;
  readonly category?: string;

  constructor(reason: string, category?: string) {
    super(`Sandbox stream blocked: ${reason}`);
    this.reason = reason;
    this.category = category;
  }
}

/**
 * @param input Async iterable of chunks.
 * @param options Validation + cwd config.
 * @returns Async generator of the same chunk type, with BLOCK → throw.
 */
export async function* wrapStream<T>(
  input: AsyncIterable<T>,
  options: SandboxWrapStreamOptions
): AsyncGenerator<T, void, unknown> {
  // Sprint 19 audit closures (code-reviewer BLOCK + architect B1 +
  // security B-2): ONE wrapperKey per stream call, passed into
  // validateCode/validatePath directly. Previously this method wrapped
  // an outer `runWithFailCloseDefault` around inner validateCode calls
  // that ALSO ran their own `runWithFailCloseDefault` — producing
  // double timeout races + WARN-suppression on the wrong key.
  const wrapperKey: object = {};
  const validateChunks = options.validators ?? [];
  const validatorOpts = { ...options, wrapperKey };

  for await (const chunk of input) {
    if (typeof chunk !== 'string') {
      // Binary / non-string chunks pass through unchanged (documented
      // in README — binary content is NOT validated; Story 3.1
      // audio-stream precedent).
      yield chunk;
      continue;
    }

    for (const kind of validateChunks) {
      const result =
        kind === 'code'
          ? await validateCode(chunk, validatorOpts)
          : await validatePath(chunk, options.cwd ?? '/', validatorOpts);

      if (result.blocked) {
        try {
          options.onBlock?.({
            reason: result.reason ?? 'unknown',
            category: result.category,
            chunk,
          });
        } catch (err) {
          // Sprint 19 audit security C-2 closure: route to onError if
          // configured, don't silently swallow telemetry failures.
          try {
            options.onError?.(err);
          } catch {
            /* nothing more we can do */
          }
        }
        throw new SandboxStreamBlocked(result.reason ?? 'unknown', result.category);
      }
    }
    yield chunk;
  }
}

// =============================================================================
// Fail-CLOSED / fail-OPEN core
// =============================================================================

/**
 * Runs the underlying validator with timeout. On error / timeout /
 * indeterminate result, routes through onSandboxError.
 *
 * Default behaviour: fail-CLOSED (BLOCK). Opt-in fail-OPEN via
 * `onSandboxError: 'allow'` + production WARN-once.
 */
async function runWithFailCloseDefault(
  wrapperKey: object,
  options: SandboxValidatorOptions,
  fn: () => Promise<SandboxValidationResult>
): Promise<SandboxValidationResult> {
  const action = options.onSandboxError ?? 'block';
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: NodeJS.Timeout | undefined;
  try {
    // timeoutMs === 0 → synthesize immediate timeout. setTimeout(cb, 0)
    // schedules on the timer-phase queue but microtasks (Promise
    // resolution) run first, so the race would always favour the
    // validator. Treat 0 as a deterministic "validator unavailable"
    // signal — useful for tests + for callers wanting to force the
    // fail-CLOSED path explicitly.
    if (timeout === 0) {
      throw new Error('validator_timeout');
    }
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('validator_timeout')), timeout);
    });
    return await Promise.race([fn(), timeoutPromise]);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (action === 'allow') {
      emitFailOpenWarn(wrapperKey, reason, options);
      return {
        allowed: true,
        blocked: false,
        reason: 'sandbox_validator_error_allowed',
        validatorError: true,
      };
    }
    // Default fail-CLOSED.
    return {
      allowed: false,
      blocked: true,
      reason: 'sandbox_validator_error',
      severity: 'critical',
      category: 'sandbox_validator_error',
      validatorError: true,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
