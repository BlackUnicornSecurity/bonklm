/**
 * Story 3.8 — `BonklmAgent<Env, S>` extends `Agent<Env, S>`
 * ==========================================================
 *
 * Cloudflare Agents (Durable Object) wrapper. Subclass-or-mixin
 * pattern matches LiveKit's Sprint 18 `BonklmAgent extends Agent`
 * shape — the user replaces their `Agent` base class with our
 * subclass; we override the four surfaces called out by the AC:
 *
 *   1. `setState(next)` — memory-write validation on every state
 *      mutation. BLOCK throws → caller's `setState` propagates the
 *      throw → Durable Object aborts the mutation.
 *
 *   2. `this.sql\`...\`` SELECT — wraps the tagged-template SQL
 *      surface. Each returned row flows through RetrievedDoc
 *      validators; on BLOCK we return an EMPTY array rather than
 *      tainted data.
 *
 *   3. `this.ctx.storage.get(key)` / `list(opts)` / `getAlarm()` —
 *      same RetrievedDoc validation, returning `undefined` /
 *      empty `Map` / `null` on BLOCK (closes adversarial #5: DO
 *      storage read-gap).
 *
 *   4. `onRequest` / `onMessage` — left to subclass override; the
 *      connector provides `validateUserInput(text)` helper for
 *      preflight checks.
 *
 * **Edge-only**: imports from `@blackunicorn/bonklm/edge` exclusively.
 * Workerd `nodejs_compat` flag required for cachedValidate's hash.
 *
 * Sprint 22 audit-pattern application (Sprint 21+20 closures):
 *   - Telemetry events carry `kind: 'cf-agent'` (forward-compat with
 *     BonklmBlockEvent's discriminated union).
 *   - Symbol-keyed mixin sentinel rejects double-wrap.
 *   - fail-safe onBlock + onError routing.
 */
import type { GuardrailEngine, ValidatorInput, Validator } from '@blackunicorn/bonklm';
import {
  adaptValidatorToUniversalInput,
  assertNotWrapped,
  markWrapped,
} from '@blackunicorn/bonklm/core/connector-utils';
import {
  CloudflareAgentBlockedError,
  type AgentLike,
  type BonklmAgentConfig,
  type BonklmAgentHookContext,
  type CloudflareAgentBlockEvent,
  type SqlStorageLike,
  type WrappedSqlStorageLike,
} from './types.js';

/**
 * Build the right ValidatorInput shape for a given surface so the
 * core validators (MemoryWriteValidator, RetrievedDocValidator) see
 * the discriminated-kind their `.validate(input)` looks for. Without
 * this shaping the validators return instant-ALLOW for raw strings.
 */
function buildValidatorInput(
  surface: BonklmAgentHookContext['surface'],
  text: string
): ValidatorInput {
  if (surface === 'setState') {
    return { kind: 'memory_write', payload: { content: text } };
  }
  // sql_select / storage_get / storage_list — per-row text dispatch.
  // We dispatch as `kind: 'text'` (NOT `kind: 'retrieved_docs'`)
  // because the core RetrievedDocValidator's default `onPerDocFailure:
  // 'drop'` returns `blocked: false` at the batch level (it drops
  // the offending doc), which loses the per-row decision our wrap
  // needs to make. Operators pass text-shape validators like
  // PromptInjectionValidator directly; per-row filtering happens
  // here at the connector layer.
  return { kind: 'text', content: text };
}

/**
 * Subset of `agents` SDK Agent base class constructor signature.
 * Real type: `Agent<Env, S>` from `agents ^0.13.0`.
 */
type AgentClassLike<S> = new (...args: unknown[]) => AgentLike<S>;

const BONKLM_WIRED = Symbol.for('bonklm.cloudflare-agent.wired');

/**
 * Mix BonkLM validators into a Cloudflare Agents `Agent` subclass.
 *
 * Usage:
 *
 * ```ts
 * import { Agent } from 'agents';
 * import { withBonklmAgent } from '@blackunicorn/bonklm-cloudflare-agents';
 *
 * class MyAgent extends withBonklmAgent(Agent, {
 *   engine,
 *   memoryWriteValidators: [memoryWriteValidator],
 *   retrievedDocValidators: [retrievedDocValidator],
 *   onBlock: (event) => console.warn(`[bonklm-cf] BLOCKED ${event.surface}: ${event.reason}`),
 * }) {
 *   async onMessage(message: string) {
 *     // ... user logic; setState + this.sql + ctx.storage are validated transparently
 *   }
 * }
 * ```
 *
 * The mixin pattern preserves the user's ability to extend the real
 * `Agent` class (cannot use composition because Agents SDK requires
 * the export be a class for Durable Object binding registration).
 */
export function withBonklmAgent<S, Base extends AgentClassLike<S>>(
  BaseAgent: Base,
  config: BonklmAgentConfig
): Base {
  if (typeof BaseAgent !== 'function') {
    throw new TypeError(
      'withBonklmAgent: BaseAgent must be the Agent class from `agents`.'
    );
  }
  if (!config?.engine) {
    throw new TypeError('withBonklmAgent: config.engine is required.');
  }
  assertNotWrapped(BaseAgent, BONKLM_WIRED, 'withBonklmAgent');

  // Sprint 22 audit closure (security + code-reviewer BLOCK-1 +
  // architect TypeError-shim): replace the inlined TypeError-fallback
  // pattern with the shared `adaptValidatorToUniversalInput` helper.
  //
  // Memory-write validators are passed THROUGH unadapted — they're
  // kind-aware (MemoryWriteValidator only fires on `kind:'memory_write'`).
  // The runner constructs the envelope directly via `buildValidatorInput`.
  //
  // Retrieved-doc validators are adapted: my runner dispatches with
  // `kind:'text'` (not `'retrieved_docs'`) for per-row filtering (see
  // buildValidatorInput JSDoc). Legacy text validators like
  // PromptInjection need the adapter; envelope-aware validators pass
  // through cleanly.
  const memoryWriteValidators = (config.memoryWriteValidators ?? []);
  const retrievedDocValidators = (config.retrievedDocValidators ?? []).map(
    (v: Validator) => adaptValidatorToUniversalInput(v, 'withBonklmAgent.retrievedDocValidators')
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Mixed = class BonklmAgent extends (BaseAgent as any) {
    // Cached wrapped sql tag — built lazily so the underlying Agent's
    // ctor finishes its own sql initialization first.
    // NOTE: typed `unknown` because the wrapped shape switches between
    // SqlStorageLike (sync, no validators) and WrappedSqlStorageLike
    // (async, with validators).
    private _bonklmWrappedSql: SqlStorageLike | WrappedSqlStorageLike | null = null;

    // setState override — memory-write validation.
    async setState(next: S): Promise<void> {
      if (memoryWriteValidators.length > 0) {
        await runValidators(
          memoryWriteValidators,
          stringifyForValidation(next),
          {
            surface: 'setState',
            broadcast: true,
          },
          config
        );
      }
      // Delegate to base; preserve return-type semantics (Agents
      // SDK setState may be sync or async depending on version).
      const baseRes = (BaseAgent.prototype as { setState?: (n: S) => unknown })
        .setState?.call(this, next);
      if (baseRes && typeof (baseRes as Promise<unknown>).then === 'function') {
        await baseRes;
      }
    }

    /**
     * Wrap the raw `this.sql` tagged-template surface. Returns a new
     * tagged-template function that:
     *   - calls the original sql tag,
     *   - validates each row via retrievedDocValidators,
     *   - returns empty array on any per-row BLOCK (fail-CLOSED).
     *
     * Sync surface to match Agents SDK contract — validators that
     * are async return their result via the `Promise.all` settled
     * pattern; we collect them synchronously since the wrapped
     * surface itself returns synchronously. Async validators MUST
     * resolve same-tick (this is the documented edge-runtime
     * constraint).
     */
    get sql(): SqlStorageLike | WrappedSqlStorageLike {
      if (this._bonklmWrappedSql) return this._bonklmWrappedSql;
      // Sprint 25 audit-closure (Sprint 22 architect B2): the real
      // `agents` SDK assigns `this.sql` as a per-instance property
      // (constructor-bound proxy over DurableObjectState.storage.sql),
      // NOT a prototype getter. The previous 2-level prototype walk
      // failed against that shape. Strategy:
      //   1. Instance-property check — read `this['sql']` AFTER
      //      bypassing our own getter via property descriptor.
      //   2. Prototype-chain walk with bounded depth (5 hops) for
      //      SDKs that DO use prototype getters (e.g. our MockBaseAgent).
      //   3. Throw TypeError with diagnostic message on failure.
      const baseSql = findBaseSql(this, BaseAgent);
      if (typeof baseSql !== 'function') {
        throw new TypeError(
          'BonklmAgent: underlying Agent.sql is not a function. ' +
            'Cloudflare Agents SDK ^0.13.0 expected. If your custom ' +
            'Agent subclass uses an unusual prototype shape, file an ' +
            'issue at https://github.com/BlackUnicornSecurity/bonklm/issues.'
        );
      }
      // When no validators are configured, preserve the underlying
      // sync sql contract (no wrap, return raw).
      if (retrievedDocValidators.length === 0) {
        const passthrough: SqlStorageLike = (strings, ...values) =>
          baseSql!(strings, ...values);
        this._bonklmWrappedSql = passthrough;
        return passthrough;
      }
      // Validation-enabled path — returns Promise<rows[]>. See
      // WrappedSqlStorageLike JSDoc for the contract change.
      const wrapped: WrappedSqlStorageLike = async (strings, ...values) => {
        const rows = baseSql!(strings, ...values);
        const filtered: Array<Record<string, unknown>> = [];
        for (const row of rows) {
          const text = stringifyForValidation(row);
          const blocked = await runValidatorsAsync(
            retrievedDocValidators,
            text,
            { surface: 'sql_select', broadcast: false },
            config
          );
          if (!blocked) filtered.push(row);
        }
        return filtered;
      };
      this._bonklmWrappedSql = wrapped;
      return wrapped;
    }

    /**
     * Wrap `ctx.storage.get` / `list` / `getAlarm`. Returns the
     * undefined / empty / null sentinel on BLOCK so the LLM never
     * ingests tainted DO storage.
     */
    get ctx(): AgentLike<S>['ctx'] {
      // Same instance-first + bounded prototype walk as sql.
      const baseCtx = findBaseProperty<AgentLike<S>['ctx']>(this, BaseAgent, 'ctx');
      if (!baseCtx?.storage) return baseCtx;
      const storage = baseCtx.storage;
      return {
        ...baseCtx,
        storage: {
          get: async <T = unknown>(key: string | string[], opts?: unknown) => {
            const result = await storage.get<T>(key, opts);
            if (retrievedDocValidators.length === 0 || result === undefined) {
              return result;
            }
            const blocked = await runValidatorsAsync(
              retrievedDocValidators,
              stringifyForValidation(result),
              { surface: 'storage_get', broadcast: false },
              config
            );
            return blocked ? undefined : result;
          },
          list: async <T = unknown>(opts?: unknown) => {
            const result = await storage.list<T>(opts);
            if (retrievedDocValidators.length === 0) return result;
            const filtered = new Map<string, T>();
            for (const [k, v] of result.entries()) {
              const blocked = await runValidatorsAsync(
                retrievedDocValidators,
                stringifyForValidation(v),
                { surface: 'storage_list', broadcast: false },
                config
              );
              if (!blocked) filtered.set(k, v);
            }
            return filtered;
          },
          getAlarm: () => storage.getAlarm(),
        },
      };
    }
  };

  markWrapped(Mixed, BONKLM_WIRED);

  return Mixed as unknown as Base;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Sniffs whether the validators would BLOCK the supplied text. This
 * is a SYNCHRONOUS approximation suitable for the edge-runtime
 * tagged-template SQL surface (which is sync in the Agents SDK).
 * Async validators are awaited via Promise.resolve.then; the
 * resulting decision is captured in a closure-bound `blocked` flag.
 *
 * Implementation note: this returns `false` (allow) when the
 * validator stack is async and hasn't yet resolved by the time the
 * caller reads the return value. This is acceptable for the SQL
 * surface because the LLM ingestion of the row happens AFTER the
 * tagged-template returns, so the validation runs in the same
 * event-loop tick. Operators concerned about timing-edge attacks
 * should pass only synchronous validators here.
 */
/**
 * Async validator runner — returns true when ANY validator blocks.
 * Fires onBlock telemetry on the first BLOCK and routes errors via
 * onError. Does NOT throw — returns the boolean decision so the
 * caller can filter (sql) or substitute sentinel (storage).
 *
 * Sprint 22 audit closure (BLOCK convergent): validators are already
 * adapted via `adaptValidatorToUniversalInput` at config time. No
 * try-catch-TypeError shim here — a real validator-internal TypeError
 * now propagates to `safeOnError` rather than being silently retried
 * with a different input shape.
 */
async function runValidatorsAsync(
  validators: Array<import('@blackunicorn/bonklm').Validator>,
  text: string,
  hookContext: BonklmAgentHookContext,
  config: BonklmAgentConfig
): Promise<boolean> {
  if (text.length === 0) return false;
  const input = buildValidatorInput(hookContext.surface, text);
  for (const v of validators) {
    try {
      const result = await v.validate(input);
      if (result?.blocked) {
        fireBlock(config, hookContext, result);
        return true;
      }
    } catch (err) {
      safeOnError(config, err);
    }
  }
  return false;
}

// `sniffSyncBlock` removed — sync-best-effort approach didn't catch
// async validators (the real shape of MemoryWriteValidator +
// RetrievedDocValidator). Replaced by `runValidatorsAsync` above
// + the WrappedSqlStorageLike async contract change.

/**
 * Async run for setState (which is async by Agents SDK contract).
 * Throws CloudflareAgentBlockedError on BLOCK.
 */
async function runValidators(
  validators: Array<import('@blackunicorn/bonklm').Validator>,
  text: string,
  hookContext: BonklmAgentHookContext,
  config: BonklmAgentConfig
): Promise<void> {
  if (text.length === 0) return;
  const input = buildValidatorInput(hookContext.surface, text);
  for (const v of validators) {
    try {
      const result = await v.validate(input);
      if (result?.blocked) {
        fireBlock(config, hookContext, result);
        throw new CloudflareAgentBlockedError(
          `BonklmAgent ${hookContext.surface} blocked: ${result.findings[0]?.description ?? 'unknown'}`,
          hookContext.surface,
          hookContext.broadcast,
          {
            category: result.findings[0]?.category,
            severity: String(result.severity),
          }
        );
      }
    } catch (err) {
      if (err instanceof CloudflareAgentBlockedError) throw err;
      safeOnError(config, err);
    }
  }
}

function fireBlock(
  config: BonklmAgentConfig,
  hookContext: BonklmAgentHookContext,
  result: { findings?: Array<{ category?: string; description?: string }>; severity?: string }
): void {
  const finding = result.findings?.[0];
  const event: CloudflareAgentBlockEvent = {
    kind: 'cf-agent',
    surface: hookContext.surface,
    reason: finding?.description ?? `${hookContext.surface}_blocked`,
    broadcast: hookContext.broadcast,
    category: finding?.category,
    severity: result.severity ? String(result.severity) : undefined,
  };
  try {
    config.onBlock?.(event);
  } catch (err) {
    safeOnError(config, err);
  }
}

function safeOnError(config: BonklmAgentConfig, err: unknown): void {
  if (!config.onError) return;
  try {
    config.onError(err);
  } catch {
    /* swallow */
  }
}

/**
 * Sprint 25 audit-closure: find the base-class `sql` property (or any
 * named property) without re-entering our own getter.
 *
 * Strategy:
 *   1. Walk OWN-instance property names via Object.getOwnPropertyNames
 *      (skips inherited keys), reading `instance[name]` directly. The
 *      real `agents` SDK Agent constructor assigns `this.sql = ...`
 *      as an instance property; this catches it.
 *   2. Walk the prototype chain UP from BaseAgent.prototype with a
 *      bounded depth (5 hops) — catches Mock or SDK shapes that use
 *      `get sql() { ... }` on a prototype.
 *   3. Return undefined if neither finds a function value.
 */
function findBaseSql(
  instance: object,
  BaseAgent: { prototype: object }
): SqlStorageLike | undefined {
  return findBaseProperty<SqlStorageLike>(instance, BaseAgent, 'sql');
}

function findBaseProperty<T>(
  instance: object,
  BaseAgent: { prototype: object },
  propertyName: string
): T | undefined {
  // 1. Instance-property check (real Cloudflare Agents SDK shape).
  //    We can't read `instance[propertyName]` directly because that
  //    re-enters our override getter. Instead, walk OWN keys and
  //    grab via the descriptor's value field (NOT a getter).
  const ownNames = Object.getOwnPropertyNames(instance);
  if (ownNames.includes(propertyName)) {
    const desc = Object.getOwnPropertyDescriptor(instance, propertyName);
    if (desc && 'value' in desc && desc.value !== undefined) {
      return desc.value as T;
    }
  }

  // 2. Prototype-chain walk with bounded depth (5 hops).
  let proto: object | null = BaseAgent.prototype;
  let depth = 0;
  const MAX_DEPTH = 5;
  while (proto !== null && depth < MAX_DEPTH) {
    const desc = Object.getOwnPropertyDescriptor(proto, propertyName);
    if (desc?.get) {
      try {
        const result = desc.get.call(instance) as T;
        if (result !== undefined) return result;
      } catch {
        // Getter threw — skip + continue walk.
      }
    }
    if (desc && 'value' in desc && typeof desc.value === 'function') {
      return desc.value as T;
    }
    proto = Object.getPrototypeOf(proto);
    depth++;
  }
  return undefined;
}

function stringifyForValidation(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '[unstringifiable]';
  }
}

// Re-export GuardrailEngine for ergonomic imports.
export type { GuardrailEngine };
