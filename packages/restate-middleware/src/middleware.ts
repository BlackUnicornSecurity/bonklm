/**
 * Story 4.4 START — Restate middleware
 * ======================================
 *
 * `withRestateGuardrails(handler, opts)` — wraps a Restate handler
 * function (`(ctx, input) => Promise<unknown>`) so the input is
 * validated BEFORE the handler runs. Validator decisions are routed
 * through `cachedValidate` keyed on the input so retries/replays
 * return the SAME decision without re-firing the validator.
 *
 * Sprint 20 deliverable scope: scaffold + unit tests using a mocked
 * Restate ctx. Sprint 21 finishes the full SDK integration (real
 * `ctx.run('validation', ...)` journal entry, ObjectContext support,
 * workflow context, etc.) per the roadmap split.
 *
 * **EXPERIMENTAL (Sprint 20)**: a one-time-per-process console.warn
 * fires on first call. Removed when Sprint 21 ships the full SDK
 * integration tests.
 */
import {
  cachedValidate,
  createUnsaltedKeyFn,
  InMemoryLRUCache,
  type Validator,
  type ValidatorCache,
  type ValidatorInput,
} from '@blackunicorn/bonklm';
import { adaptValidatorToUniversalInput } from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Subset of `restatedev/restate-sdk` Context that the middleware
 * relies on. Structural typing — peer-optional SDK install.
 */
export interface RestateCtxLike {
  /**
   * Restate's `ctx.run('name', fn)` records the result in the journal
   * so retries return the cached value. Optional here — when absent,
   * we call `fn()` directly (degrades to no journaling but still
   * deterministic via `cachedValidate`).
   */
  run?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}

export interface RestateMiddlewareOptions {
  /** Validators to run on the input. */
  validators: Validator[];
  /**
   * Cache for cachedValidate. Default: per-factory in-memory LRU
   * (single-host). For multi-host Restate deployments, supply a
   * Redis-style adapter.
   *
   * Sprint 20 audit closure (architect C3 + security C-2):
   * per-factory rather than module-singleton — two handlers in the
   * same process with different validator stacks no longer share
   * suppression by default.
   */
  cache?: ValidatorCache;
  /**
   * Optional per-handler journal-key suffix. When set,
   * `ctx.run('bonklm:validation:<suffix>', fn)` is used so two
   * handlers in the same workflow don't collide on Restate's
   * journal-replay logic. Sprint 20 audit security N-2 closure.
   */
  journalKeySuffix?: string;
  /** Fires on BLOCK before throw. */
  onBlock?: (event: RestateGuardrailBlockEvent) => void;
  /** Error sink for validator exceptions. */
  onError?: (err: unknown) => void;
}

export interface RestateGuardrailBlockEvent {
  reason: string;
  validatorName: string;
  category?: string;
  severity?: string;
}

export class RestateGuardrailBlockedError extends Error {
  override readonly name = 'RestateGuardrailBlockedError';
  readonly validatorName: string;
  readonly category?: string;
  readonly severity?: string;

  constructor(
    message: string,
    validatorName: string,
    extra?: { category?: string; severity?: string }
  ) {
    super(message);
    this.validatorName = validatorName;
    this.category = extra?.category;
    this.severity = extra?.severity;
  }
}

let _experimentalWarned = false;
function emitExperimentalWarnOnce(): void {
  if (_experimentalWarned) return;
  _experimentalWarned = true;
  // eslint-disable-next-line no-console
  console.warn(
    '[bonklm-restate] EXPERIMENTAL: Story 4.4 Sprint 20 scaffold. ' +
      'Full SDK integration + integration tests land Sprint 21.'
  );
}

/**
 * Wrap a Restate handler. Validates the input via cachedValidate
 * BEFORE invoking the user's handler. BLOCK throws.
 *
 * @returns a wrapped handler with the same signature.
 */
export function withRestateGuardrails<Ctx extends RestateCtxLike, In, Out>(
  handler: (ctx: Ctx, input: In) => Promise<Out>,
  options: RestateMiddlewareOptions
): (ctx: Ctx, input: In) => Promise<Out> {
  if (!options || !Array.isArray(options.validators) || options.validators.length === 0) {
    throw new TypeError(
      'withRestateGuardrails: options.validators (non-empty Validator[]) is required.'
    );
  }

  emitExperimentalWarnOnce();

  // Sprint 20 audit closure (architect C3 + security C-2): per-factory
  // cache rather than module-singleton.
  const cache = options.cache ?? new InMemoryLRUCache({ maxEntries: 1000 });

  // Sprint 20 audit closure (convergent BLOCK — all 3 lanes):
  // shared `adaptValidatorToUniversalInput` from core/connector-utils.
  // Capability-detection replaces the previous try-catch-TypeError
  // fallback which masked legitimate validator bugs.
  const adaptedValidators = options.validators.map((v) =>
    adaptValidatorToUniversalInput(v, 'withRestateGuardrails')
  );

  const journalKey = options.journalKeySuffix
    ? `bonklm:validation:${options.journalKeySuffix}`
    : 'bonklm:validation';

  return async function wrappedHandler(ctx: Ctx, input: In): Promise<Out> {
    const validatorInput = toValidatorInput(input);
    const runValidate = async () => {
      try {
        return await cachedValidate(adaptedValidators, validatorInput, {
          cache,
          keyFn: createUnsaltedKeyFn(),
        });
      } catch (err) {
        safeOnError(options, err);
        throw err;
      }
    };

    // Story 4.4 AC: when ctx.run is available, journal the validation
    // result so Restate replays return the cached decision.
    const results = ctx.run
      ? await ctx.run(journalKey, runValidate)
      : await runValidate();

    for (const result of results) {
      if (result.blocked) {
        const finding = result.findings[0];
        const event: RestateGuardrailBlockEvent = {
          reason: finding?.description ?? 'unknown',
          validatorName: result.validatorName,
          category: finding?.category,
          severity: String(result.severity),
        };
        try {
          options.onBlock?.(event);
        } catch (err) {
          safeOnError(options, err);
        }
        throw new RestateGuardrailBlockedError(
          `Restate input blocked by ${result.validatorName}: ${event.reason}`,
          result.validatorName,
          { category: event.category, severity: event.severity }
        );
      }
    }

    return handler(ctx, input);
  };
}

function toValidatorInput(input: unknown): ValidatorInput {
  if (typeof input === 'string') return { kind: 'text', content: input };
  // Sprint 20 audit closure (code-reviewer C-5 + security N-1):
  // circular-ref guard. JSON.stringify throws on circular refs;
  // previously this crashed the handler before cachedValidate ran.
  try {
    return { kind: 'text', content: JSON.stringify(input ?? '') };
  } catch {
    return { kind: 'text', content: `[unstringifiable:${typeof input}]` };
  }
}

function safeOnError(options: RestateMiddlewareOptions, err: unknown): void {
  if (!options.onError) return;
  try {
    options.onError(err);
  } catch {
    /* swallow */
  }
}
