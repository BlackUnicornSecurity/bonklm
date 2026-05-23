/**
 * @blackunicorn/bonklm-stagehand — wrapStagehand
 * ==============================================
 *
 * Wraps a Stagehand client so every AI-driven call (`act`, `extract`,
 * `observe`, `agent.execute`) flows through the BonkLM validator
 * pipeline before reaching the page (or after, for `extract` where
 * the page content is the untrusted input).
 *
 * Surface mapping (locked via browser-agents-core ADR):
 *   - `act(action)` → `tool_call` surface; validated BEFORE dispatch.
 *   - `extract(opts)` → `retrieved_doc` surface; validated AFTER the
 *     extract returns (page content is the untrusted source).
 *   - `observe(prompt)` → `text_input` surface; validated BEFORE
 *     dispatch.
 *   - `agent.execute(task)` → `composed_context` surface; validated
 *     BEFORE the multi-step planner kicks off.
 *
 * Story 2.3 audit closures:
 *   - B2 (arch + sec T1): CUA-mode preflight is fail-closed — reads
 *     mode from `client.modelName` / `client.config.mode` if
 *     `options.stagehandConfig` is not supplied, AND refuses
 *     construction when ambiguous (no way to confirm non-CUA mode)
 *     unless `allowCuaMode: true` is the explicit opt-in.
 *   - B6 (rev HIGH): `agent` wrapping uses prototype-preserving
 *     `Object.create(Object.getPrototypeOf(originalAgent))` so
 *     class methods beyond `execute` survive the wrap.
 *   - B7 (rev HIGH + sec T7): `extract` SDK call wrapped in try/catch;
 *     thrown errors with embedded page content are validated as
 *     `retrieved_doc` before re-throwing. Serialization failures map
 *     to a synthetic BLOCK rather than escaping to the consumer.
 *   - B8 (sec CRITICAL T4): `client.act` is REPLACED on the original
 *     client so `agent.execute` sub-actions (which invoke
 *     `this.client.act` internally via the planner) ALSO flow through
 *     the validator pipeline. Closes the planner-bypass vector.
 *   - B10 (sec T6): error reason sanitization done inside the base
 *     `BrowserAgentGuardrailBlockedError` class (hoisted to
 *     browser-agents-core).
 *   - B11 (sec T9): CUA mode detection regex matches `cua` /
 *     `computer-use` / `computeruse` / `computer_use` variants.
 *
 * @package @blackunicorn/bonklm-stagehand
 */
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  BrowserAgentGuardrailBlockedError,
  assertNonCuaMode,
  isUnsafeBinaryResult,
  normaliseActArg,
  withBrowserAgentGuardrails,
  type BrowserAgentValidateResult,
} from '@blackunicorn/bonklm-browser-agents-core';
import type { StagehandLike, WrapStagehandOptions } from './types.js';

/**
 * Per-Stagehand BLOCKED error. Extends the shared
 * `BrowserAgentGuardrailBlockedError` base so consumers can catch
 * either the connector-specific OR the cross-connector type.
 */
export class StagehandGuardrailBlockedError extends BrowserAgentGuardrailBlockedError {
  declare readonly action: 'act' | 'extract' | 'observe' | 'agent.execute';

  constructor(
    action: StagehandGuardrailBlockedError['action'],
    surface: BrowserAgentValidateResult['surface'],
    reason: string | undefined
  ) {
    super('stagehand', action, surface, reason);
    this.name = 'StagehandGuardrailBlockedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Note: Sprint-13 cumulative-audit rev HIGH-1 removed an unused
// ALREADY_VALIDATED_SENTINEL here for parity with the Eko connector.
// The sentinel was never written onto any args object, so the guard
// at the start of `validatedAct` could not fire — it was dead code.
// The current architecture (single replaced `client.act` reference
// used by both direct callers + the Stagehand planner's sub-actions)
// means re-entry isn't a real path, so the sentinel was unnecessary.
//
// Note: CUA_MODE_PATTERN + detectStagehandMode + normaliseActArg
// + isUnsafeBinaryResult were ALL hoisted to
// `@blackunicorn/bonklm-browser-agents-core` (sprint-13 audit arch X4,
// X5 + rev MED-4 closures). The connector now imports them.

/**
 * Wrap a Stagehand client. Returns the SAME client surface (typed
 * as `T`) with the four AI-driven methods intercepted.
 *
 * @param client - The vendor SDK client to wrap.
 * @param engine - BonkLM engine.
 * @param options - Optional config. `allowCuaMode` defaults `false`.
 *
 * @example
 * ```ts
 * import { Stagehand } from '@browserbasehq/stagehand';
 * import { wrapStagehand, StagehandGuardrailBlockedError } from '@blackunicorn/bonklm-stagehand';
 *
 * const stagehand = await new Stagehand({ env: 'BROWSERBASE' }).init();
 * const guarded = wrapStagehand(stagehand, engine);
 * try {
 *   await guarded.act('click the submit button');
 * } catch (err) {
 *   if (err instanceof StagehandGuardrailBlockedError) { ... }
 * }
 * ```
 */
export function wrapStagehand<T extends StagehandLike>(
  client: T,
  engine: GuardrailEngine,
  options: WrapStagehandOptions = {}
): T {
  if (client === null || typeof client !== 'object') {
    throw new Error('wrapStagehand: client must be a non-null object.');
  }
  if (engine === undefined || typeof engine.validate !== 'function') {
    throw new Error('wrapStagehand: engine must be a GuardrailEngine instance.');
  }

  const { allowCuaMode = false, logger, stagehandConfig } = options;

  // B2 closure via shared helper: refuse CUA mode by default. Reads
  // `stagehandConfig.mode` → `client.config.mode` → `client.mode`.
  // Sprint-13 cumulative-audit sec CS2: REMOVED `modelName` from
  // the fallback chain — it's a model identifier, not a mode field
  // (false-positive risk for names like `"gpt-computer-use"`).
  assertNonCuaMode('wrapStagehand', client, {
    allowCuaMode,
    configOverride: stagehandConfig,
  });

  const guarded = withBrowserAgentGuardrails(client as object, {
    engine,
    allowCuaMode,
    logger,
  });

  // ── B8 closure (sec T4 CRITICAL): monkey-patch the original `act` ─
  // so that downstream invocations (e.g. agent.execute → planner →
  // this.stagehand.act) ALSO flow through the validator. Without
  // this, sub-actions bypass tool_call validation entirely. Document
  // the mutation loudly — this IS mutating the consumer's client by
  // design (the security goal supersedes the immutability principle).
  //
  // **Construction-order doc (Sprint 13 carry-over rev A&D-2)**:
  // `wrapStagehand` MUST be called BEFORE the Stagehand planner starts
  // (or before any caller captures a reference to `client.act` /
  // `client.extract` / `client.agent`). After this function returns,
  // the methods on the consumer's `client` instance are REPLACED in
  // place. Any code holding a captured `client.act` reference from
  // BEFORE this call bypasses validation entirely.
  //
  // **Runtime-registration limitation**: methods added to the client
  // AFTER `wrapStagehand` returns (e.g. plugin extensions that
  // attach new actions) are NOT wrapped. The connector intercepts
  // the four primary surfaces (`act`, `extract`, `observe`, `agent`)
  // discovered at wrap time only.
  //
  // **Hybrid client dual-wrap warning**: a consumer who calls
  // `wrapStagehand(client, ...)` twice with different engines silently
  // overwrites the first wrap's monkey-patches; the second engine's
  // validator stack alone is enforced. Wrap exactly once per client
  // lifetime.
  const originalAct = client.act.bind(client);
  const validatedAct = async (
    actionArg: string | { action: string; [k: string]: unknown }
  ): Promise<unknown> => {
    const { actionString, args } = normaliseActArg(actionArg);
    const r = await (
      guarded as { bonklm: { validateEvent: typeof guarded.bonklm.validateEvent } }
    ).bonklm.validateEvent({ kind: 'act', action: actionString, args });
    if (r.blocked) {
      throw new StagehandGuardrailBlockedError('act', r.surface, r.reason);
    }
    return originalAct(actionArg);
  };
  // Replace BOTH the original client's act (so sub-actions go through)
  // AND the guarded copy's act (so direct calls are the same path).
  (client as { act: T['act'] }).act = validatedAct as T['act'];
  (guarded as unknown as { act: T['act'] }).act = validatedAct as T['act'];

  // ── extract (B7 closure): wrap SDK call in try/catch; validate
  // thrown error text as retrieved_doc (the error MAY contain
  // page-derived content). Serialization-throw inside our validator
  // path is contained by the core helper's safeStringifyExtractResult.
  const originalExtract = client.extract.bind(client);
  const validatedExtract = async <U = unknown>(
    opts: string | { instruction: string; schema?: unknown; [k: string]: unknown }
  ): Promise<U> => {
    const schema =
      typeof opts === 'object' && opts !== null && 'schema' in opts
        ? (opts as { schema?: unknown }).schema
        : undefined;
    let result: U;
    try {
      result = (await originalExtract(opts as never)) as U;
    } catch (sdkErr) {
      // (See B7 closure below for SDK-error path.)
      // The error may contain page-derived text — validate it as a
      // retrieved_doc before re-throwing.
      const errText = sdkErr instanceof Error ? sdkErr.message : String(sdkErr);
      try {
        const r = await (
          guarded as {
            bonklm: { validateEvent: typeof guarded.bonklm.validateEvent };
          }
        ).bonklm.validateEvent({ kind: 'extract', schema, result: errText });
        if (r.blocked) {
          throw new StagehandGuardrailBlockedError('extract', r.surface, r.reason);
        }
      } catch (validatorErr) {
        if (validatorErr instanceof StagehandGuardrailBlockedError) {
          throw validatorErr;
        }
        // Validator pipeline itself failed (e.g. core threw). Rethrow
        // the ORIGINAL SDK error rather than the validator error so
        // consumer debugging context is preserved.
      }
      throw sdkErr;
    }

    // Sprint-13 cumulative-audit arch X5 closure: binary /
    // async-iterable extract results bypass text-based validators
    // (they JSON.stringify to `"{}"` or similar — meaningless
    // content for downstream pattern matching). Refuse explicitly.
    if (isUnsafeBinaryResult(result)) {
      throw new StagehandGuardrailBlockedError(
        'extract',
        'retrieved_doc',
        'binary or streaming extract result cannot be inspected — BonkLM ' +
          'validators are text-only. Convert to UTF-8 upstream.'
      );
    }

    const r = await (
      guarded as { bonklm: { validateEvent: typeof guarded.bonklm.validateEvent } }
    ).bonklm.validateEvent({ kind: 'extract', schema, result });
    if (r.blocked) {
      throw new StagehandGuardrailBlockedError('extract', r.surface, r.reason);
    }
    return result;
  };
  (client as { extract: T['extract'] }).extract = validatedExtract as T['extract'];
  (guarded as unknown as { extract: T['extract'] }).extract = validatedExtract as T['extract'];

  // ── observe (validates the prompt BEFORE dispatch). ────────────
  const originalObserve = client.observe.bind(client);
  const validatedObserve = async (
    opts: string | { instruction: string; [k: string]: unknown }
  ): Promise<unknown> => {
    const prompt = typeof opts === 'string' ? opts : opts.instruction;
    const r = await (
      guarded as { bonklm: { validateEvent: typeof guarded.bonklm.validateEvent } }
    ).bonklm.validateEvent({ kind: 'observe', prompt });
    if (r.blocked) {
      throw new StagehandGuardrailBlockedError('observe', r.surface, r.reason);
    }
    return originalObserve(opts);
  };
  (client as { observe: T['observe'] }).observe = validatedObserve as T['observe'];
  (guarded as unknown as { observe: T['observe'] }).observe = validatedObserve as T['observe'];

  // ── agent.execute (B6 closure): preserve the original agent's
  // prototype chain so class methods beyond `execute` survive.
  if (client.agent !== undefined) {
    const originalAgent = client.agent;
    const originalExecute = originalAgent.execute.bind(originalAgent);
    const wrappedAgent = Object.create(Object.getPrototypeOf(originalAgent));
    Object.assign(wrappedAgent, originalAgent);
    wrappedAgent.execute = async (
      taskOpt: string | { task: string; [k: string]: unknown }
    ): Promise<unknown> => {
      const task = typeof taskOpt === 'string' ? taskOpt : taskOpt.task;
      const r = await (
        guarded as { bonklm: { validateEvent: typeof guarded.bonklm.validateEvent } }
      ).bonklm.validateEvent({ kind: 'agent.execute', task });
      if (r.blocked) {
        throw new StagehandGuardrailBlockedError('agent.execute', r.surface, r.reason);
      }
      return originalExecute(taskOpt);
    };
    (client as { agent: typeof wrappedAgent }).agent = wrappedAgent;
    (guarded as unknown as { agent: typeof wrappedAgent }).agent = wrappedAgent;
  }

  return guarded as unknown as T;
}

// (detectStagehandMode + normaliseActArg removed — hoisted to
// `@blackunicorn/bonklm-browser-agents-core` as `detectVendorMode`
// + `normaliseActArg`. See `shared-helpers.ts` for the single
// source of truth.)
