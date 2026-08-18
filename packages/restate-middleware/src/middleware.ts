/**
 * Restate middleware
 * ======================================
 *
 * `withRestateGuardrails(handler, opts)` — wraps a Restate handler
 * function (`(ctx, input) => Promise<unknown>`) so the input is
 * validated BEFORE the handler runs. Validator decisions are routed
 * through `cachedValidate` keyed on the input so retries/replays
 * return the SAME decision without re-firing the validator.
 *
 * deliverable scope: scaffold + unit tests using a mocked
 * Restate ctx. A later phase completes the full SDK integration (real
 * `ctx.run('validation', ...)` journal entry, ObjectContext support,
 * workflow context, etc.) per the roadmap split.
 *
 * **EXPERIMENTAL**: a one-time-per-process console.warn
 * fires on first call. Removed once the full SDK
 * integration tests ship.
 */
import {
  cachedValidate,
  createUnsaltedKeyFn,
  InMemoryLRUCache,
  type Validator,
  type ValidatorCache,
  type ValidatorInput
} from '@blackunicorn/bonklm';
import { adaptValidatorToUniversalInput } from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Subset of `restatedev/restate-sdk` Context that the middleware
 * relies on. Structural typing — peer-optional SDK install.
 *
 * Extended to cover both `Context`
 * (stateless workflows / shared handlers) AND `ObjectContext`
 * (virtual-object-keyed handlers with per-key state). When
 * `objectKey` is populated, the journal-key suffix automatically
 * incorporates it so two virtual objects don't share replay cache.
 */
export interface RestateCtxLike {
  /**
   * Restate's `ctx.run('name', fn)` records the result in the journal
   * so retries return the cached value. Optional here — when absent,
   * we call `fn()` directly (degrades to no journaling but still
   * deterministic via `cachedValidate`).
   */
  run?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  /**
   * ObjectContext.key() returns the virtual object's
   * key. When present, it's mixed into the journal key so per-object
   * replay cache is isolated.
   */
  key?: () => string;
  /**
   * ObjectContext.get<T>(stateKey) for replaying
   * cached BLOCK decisions. Optional — when present, the middleware
   * also persists the decision summary under `'bonklm:last_decision'`
   * for cross-replay observability.
   */
  get?: <T>(stateKey: string) => Promise<T | null>;
  /**
   * ObjectContext.set<T>(stateKey, value) — used
   * to persist the last BLOCK decision summary when available.
   */
  set?: <T>(stateKey: string, value: T) => void | Promise<void>;
}

export interface RestateMiddlewareOptions {
  /** Validators to run on the input. */
  validators: Validator[];
  /**
   * Cache for cachedValidate. Default: per-factory in-memory LRU
   * (single-host). For multi-host Restate deployments, supply a
   * Redis-style adapter.
   *
   * Per-factory rather than module-singleton — two handlers in the
   * same process with different validator stacks no longer share
   * suppression by default.
   */
  cache?: ValidatorCache;
  /**
   * Optional per-handler journal-key suffix. When set,
   * `ctx.run('bonklm:validation:<suffix>', fn)` is used so two
   * handlers in the same workflow don't collide on Restate's
   * journal-replay logic.
   */
  journalKeySuffix?: string;
  /**
   * Override the state key used to persist the last
   * decision summary on ObjectContext. Pass `false` to disable
   * persistence entirely (recommended for high-throughput virtual
   * objects where the journal-entry growth on every ALLOW is
   * problematic). Default `'bonklm:last_decision'`.
   */
  lastDecisionStateKey?: string | false;
  /** Fires on BLOCK before throw. */
  onBlock?: (event: RestateGuardrailBlockEvent) => void;
  /** Error sink for validator exceptions. */
  onError?: (err: unknown) => void;
}

/**
 * Restate block event. Carries `kind: 'durable-exec'` + `runtime: 'restate'` so it is
 * structurally a `BonklmDurableExecBlockEvent` and operators can
 * pivot one Datadog/OTel sink on `kind` across all connectors.
 */
export interface RestateGuardrailBlockEvent {
  kind: 'durable-exec';
  runtime: 'restate';
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

  constructor(message: string, validatorName: string, extra?: { category?: string; severity?: string }) {
    super(message);
    this.validatorName = validatorName;
    this.category = extra?.category;
    this.severity = extra?.severity;
  }
}

// EXPERIMENTAL warn-once removed — full ObjectContext support
// + integration tests now ship; the banner is no longer accurate.

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
    throw new TypeError('withRestateGuardrails: options.validators (non-empty Validator[]) is required.');
  }

  // Per-factory
  // cache rather than module-singleton.
  const cache = options.cache ?? new InMemoryLRUCache({ maxEntries: 1000 });

  // Shared `adaptValidatorToUniversalInput` from core/connector-utils.
  // Capability-detection replaces the previous try-catch-TypeError
  // fallback which masked legitimate validator bugs.
  const adaptedValidators = options.validators.map(v => adaptValidatorToUniversalInput(v, 'withRestateGuardrails'));

  const baseJournalKey = options.journalKeySuffix
    ? `bonklm:validation:${options.journalKeySuffix}`
    : 'bonklm:validation';

  return async function wrappedHandler(ctx: Ctx, input: In): Promise<Out> {
    // Incorporate ObjectContext key into journal
    // key so two virtual objects don't share replay state. Falls
    // back to base key when ctx.key() is not present (Context, not
    // ObjectContext).
    // It also adds two safeguards:
    //   - errors from ctx.key() route to options.onError (previously
    //     swallowed silently → lost telemetry signal when key
    //     isolation degraded).
    //   - the raw key value is sanitized to prevent `:obj:` collision
    //     attacks (an attacker-controlled `user:obj:admin` key would
    //     compose to `bonklm:validation:obj:user:obj:admin` and
    //     potentially alias a different object's journal entry).
    const objectKey = typeof ctx.key === 'function' ? safeCallKey(ctx, options) : undefined;
    const journalKey = objectKey ? `${baseJournalKey}:obj:${sanitizeObjectKey(objectKey)}` : baseJournalKey;
    const validatorInput = toValidatorInput(input);
    const runValidate = async () => {
      try {
        return await cachedValidate(adaptedValidators, validatorInput, {
          cache,
          keyFn: createUnsaltedKeyFn()
        });
      } catch (err) {
        safeOnError(options, err);
        throw err;
      }
    };

    // when ctx.run is available, journal the validation
    // result so Restate replays return the cached decision.
    const results = ctx.run ? await ctx.run(journalKey, runValidate) : await runValidate();

    for (const result of results) {
      if (result.blocked) {
        const finding = result.findings[0];
        const event: RestateGuardrailBlockEvent = {
          kind: 'durable-exec',
          runtime: 'restate',
          reason: finding?.description ?? 'unknown',
          validatorName: result.validatorName,
          category: finding?.category,
          severity: String(result.severity)
        };
        try {
          options.onBlock?.(event);
        } catch (err) {
          safeOnError(options, err);
        }
        // Persist last-decision summary into
        // ObjectContext state so subsequent replays surface the
        // historical BLOCK without re-running validation.
        // Configurable key + opt-out.
        const stateKey = resolveLastDecisionStateKey(options);
        if (stateKey && typeof ctx.set === 'function') {
          try {
            await ctx.set(stateKey, {
              blocked: true,
              validatorName: result.validatorName,
              reason: event.reason,
              category: event.category,
              severity: event.severity,
              at: Date.now()
            });
          } catch (err) {
            safeOnError(options, err);
          }
        }
        throw new RestateGuardrailBlockedError(
          `Restate input blocked by ${result.validatorName}: ${event.reason}`,
          result.validatorName,
          { category: event.category, severity: event.severity }
        );
      }
    }

    // Persist last-decision (ALLOW) summary so
    // operator dashboards can correlate handler runs against
    // validation outcomes. Configurable +
    // opt-out via `lastDecisionStateKey: false`.
    const stateKey = resolveLastDecisionStateKey(options);
    if (stateKey && typeof ctx.set === 'function') {
      try {
        await ctx.set(stateKey, { blocked: false, at: Date.now() });
      } catch (err) {
        safeOnError(options, err);
      }
    }

    return handler(ctx, input);
  };
}

function safeCallKey(ctx: { key?: () => string }, options: RestateMiddlewareOptions): string | undefined {
  try {
    const k = ctx.key?.();
    return typeof k === 'string' && k.length > 0 ? k : undefined;
  } catch (err) {
    safeOnError(options, err);
    return undefined;
  }
}

/**
 * sanitize ObjectContext key
 * before composing the journal key. An attacker-controlled key
 * containing `:` could shadow the journal-key namespace and alias
 * journal entries across virtual objects. We percent-encode `:` so
 * the composed key remains unambiguous.
 */
function sanitizeObjectKey(key: string): string {
  // Percent-encode `:` (the namespace separator) + `%` (so we don't
  // re-encode an already-percent-encoded payload).
  return key.replaceAll('%', '%25').replaceAll(':', '%3A');
}

/**
 * Resolve the last-decision state key from options.
 * `false` → opt-out; `undefined` → default `'bonklm:last_decision'`;
 * string → caller-supplied.
 */
function resolveLastDecisionStateKey(options: RestateMiddlewareOptions): string | null {
  const cfg = options.lastDecisionStateKey;
  if (cfg === false) return null;
  if (typeof cfg === 'string' && cfg.length > 0) return cfg;
  return 'bonklm:last_decision';
}

function toValidatorInput(input: unknown): ValidatorInput {
  if (typeof input === 'string') return { kind: 'text', content: input };
  // Circular-ref guard. JSON.stringify throws on circular refs;
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
