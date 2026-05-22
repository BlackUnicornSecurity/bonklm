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

/**
 * CUA-mode detection regex. Matches `cua`, `computer-use`,
 * `computer_use`, `computeruse`. Case-insensitive.
 */
const CUA_MODE_PATTERN = /^(cua|computer[-_]?use)$/i;

/**
 * Sentinel marking that an `act` invocation already flowed through
 * the BonkLM validator at the outer-call boundary. Set on a per-call
 * basis via the second positional arg (an internal options object)
 * so monkey-patched + non-patched call paths converge cleanly.
 *
 * Why a sentinel? After Story 2.3 BLOCK-8 we monkey-patch
 * `client.act` so sub-actions (`agent.execute` planner output) ALSO
 * run through the validator. But the outer wrapper still validates
 * AT the outer call. Without a sentinel, every outer `act` validates
 * twice. The sentinel short-circuits the inner validation when the
 * outer one already happened.
 */
const ALREADY_VALIDATED_SENTINEL = Symbol('bonklm:already-validated');

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

  // B2 + sec T1 closure: read mode from BOTH the explicit options AND
  // the client's own state (structural fields `modelName`, `config.mode`).
  // Refuse if a CUA signature is detected anywhere unless allowCuaMode.
  const detectedMode = detectStagehandMode(client, stagehandConfig);
  if (
    detectedMode !== undefined &&
    CUA_MODE_PATTERN.test(detectedMode) &&
    allowCuaMode !== true
  ) {
    throw new Error(
      'wrapStagehand: Stagehand `mode: "cua"` (computer-use, screenshot-based) ' +
        'is refused by default. Screenshots are NOT inspected by BonkLM validators. ' +
        'Pass `allowCuaMode: true` to explicitly accept the bypass risk.'
    );
  }

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
  const originalAct = client.act.bind(client);
  const validatedAct = async (
    actionArg: string | { action: string; [k: string]: unknown }
  ): Promise<unknown> => {
    if (
      typeof actionArg === 'object' &&
      actionArg !== null &&
      (actionArg as { [k: symbol]: unknown })[ALREADY_VALIDATED_SENTINEL] === true
    ) {
      // Outer path already validated; just dispatch.
      return originalAct(actionArg);
    }
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

/**
 * Detect the Stagehand mode from any of its possible declaration
 * sources. Returns the first match or `undefined` if no mode field
 * is readable. Used for fail-closed CUA refusal (BLOCK-2).
 */
function detectStagehandMode(
  client: StagehandLike,
  stagehandConfig: WrapStagehandOptions['stagehandConfig']
): string | undefined {
  // 1. Explicit options first.
  if (stagehandConfig !== undefined && typeof stagehandConfig.mode === 'string') {
    return stagehandConfig.mode;
  }
  // 2. Try common client-state fields.
  const c = client as unknown as {
    config?: { mode?: unknown };
    modelName?: unknown;
    mode?: unknown;
  };
  if (c.config !== undefined && typeof c.config.mode === 'string') return c.config.mode;
  if (typeof c.modelName === 'string') return c.modelName;
  if (typeof c.mode === 'string') return c.mode;
  return undefined;
}

/**
 * Normalise the polymorphic `act` argument shape into a string +
 * optional args record so the validator surface sees a stable
 * representation.
 */
function normaliseActArg(
  action: string | { action: string; [k: string]: unknown }
): { actionString: string; args?: Record<string, unknown> } {
  if (typeof action === 'string') {
    return { actionString: action };
  }
  const { action: actionString, ...rest } = action;
  return { actionString, args: rest };
}
