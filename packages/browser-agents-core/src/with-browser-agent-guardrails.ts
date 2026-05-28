/**
 * @blackunicorn/bonklm-browser-agents-core — guardrail factory
 * ============================================================
 *
 * `withBrowserAgentGuardrails(client, opts)` adapts an arbitrary
 * browser-agent client (Stagehand, Eko, future entrants) by giving
 * it a `validateEvent(event)` method that maps `BrowserAgentEvent`
 * variants onto the right `ValidatorInput` surface.
 *
 * Surface mapping is locked in `types.ts` JSDoc:
 *   - `act` / `file` / `mcp.tool` → `tool_call`
 *   - `extract` → `retrieved_doc`
 *   - `observe` → `text_input`
 *   - `agent.execute` → `composed_context`
 *
 * Story 2.3 audit closures wired in:
 *   - BLOCK-3 (arch): uses `engine.validateInput(input)` so intercept
 *     callbacks + aggregateResults fire on browser-agent surfaces.
 *   - BLOCK-4 (arch): error class hoisted to this package as
 *     `BrowserAgentGuardrailBlockedError` (re-exported via `types.ts`).
 *   - BLOCK-5 (arch): `BrowserAgentEvent` extended with `file` +
 *     `mcp.tool` kinds for Story 2.4 Eko reuse.
 *   - T5 (sec HIGH): CUA opt-in warning falls back to `console.warn`
 *     when no logger supplied (no silent risk acceptance).
 *
 * @package @blackunicorn/bonklm-browser-agents-core
 */
import type { ValidatorInput } from '@blackunicorn/bonklm';
import type { BrowserAgentEvent, BrowserAgentGuardOptions, BrowserAgentValidateResult } from './types.js';

/**
 * Extended client shape returned by `withBrowserAgentGuardrails`.
 * Carries the original client's methods AND a `bonklm` helper.
 */
export type GuardedBrowserAgentClient<T> = T & {
  bonklm: {
    /**
     * Validate a normalised browser-agent event. Connector packages
     * call this at the right intercept points.
     */
    validateEvent(event: BrowserAgentEvent): Promise<BrowserAgentValidateResult>;
    /**
     * Engine instance ID — useful for OTel correlation + downstream
     * cache salting (cachedValidate / Inngest middleware).
     */
    readonly engineInstanceId: string;
  };
};

/**
 * Wrap a browser-agent client with a BonkLM event validator.
 *
 * @example
 * ```ts
 * const stagehand = new Stagehand({ env: 'BROWSERBASE' });
 * const guarded = withBrowserAgentGuardrails(stagehand, { engine });
 * const r = await guarded.bonklm.validateEvent({ kind: 'act', action: 'click', args: { selector: '#submit' } });
 * if (r.blocked) throw new Error(`Blocked: ${r.reason}`);
 * ```
 */
export function withBrowserAgentGuardrails<T extends object>(
  client: T,
  opts: BrowserAgentGuardOptions
): GuardedBrowserAgentClient<T> {
  if (opts === undefined || opts.engine === undefined) {
    throw new Error('withBrowserAgentGuardrails: `engine` is required.');
  }
  const { engine, allowCuaMode = false, logger } = opts;

  if (allowCuaMode) {
    const msg =
      '[browser-agents-core] CUA mode opted in — screenshot-based actions ' +
      'are NOT validated by BonkLM (validators inspect text + tool args only). ' +
      'Prompt-injection embedded in page pixels can bypass the pipeline.';
    if (logger !== undefined) {
      logger.warn(msg);
    } else {
      // sec-audit T5 closure: no logger MUST NOT silence a CUA opt-in
      // warning. Force the warning to a visible channel.

      console.warn(msg);
    }
  }

  const validateEvent = async (event: BrowserAgentEvent): Promise<BrowserAgentValidateResult> => {
    const { input, surface } = eventToValidatorInput(event);
    // arch-audit BLOCK-3 closure: `engine.validateInput(input)` keeps
    // the structured discriminated-union shape AND fires the engine's
    // aggregateResults + interceptCallbacks. Consumers wiring
    // `engine.onIntercept(attackLogger)` get browser-agent surface
    // hits — no observability gap.
    const engineResult = await engine.validateInput(input);
    return {
      blocked: engineResult.blocked,
      allowed: engineResult.allowed,
      reason: engineResult.blocked ? engineResult.reason : undefined,
      surface
    };
  };

  // Defensive: do not mutate the original client. Spread + augment.
  const guarded = Object.assign(Object.create(Object.getPrototypeOf(client)), client, {
    bonklm: Object.freeze({
      validateEvent,
      engineInstanceId: engine.getInstanceId()
    })
  }) as GuardedBrowserAgentClient<T>;

  return guarded;
}

/**
 * Map a `BrowserAgentEvent` onto the right `ValidatorInput`
 * discriminated-union variant + return the surface name for
 * telemetry. Locked mapping per the `types.ts` documentation.
 *
 * Stringification of non-string `extract` results is wrapped in
 * `try/catch` so a non-serializable page-controlled value (Date,
 * circular reference) maps to a synthetic representation rather
 * than throwing into the consumer's call stack (sec-audit T7 closure).
 */
function eventToValidatorInput(event: BrowserAgentEvent): {
  input: ValidatorInput;
  surface: BrowserAgentValidateResult['surface'];
} {
  switch (event.kind) {
    case 'act':
      return {
        input: {
          kind: 'tool_call',
          toolName: event.action,
          args: event.args ?? {}
        },
        surface: 'tool_call'
      };
    case 'extract':
      return {
        input: {
          kind: 'retrieved_docs',
          docs: [
            {
              content: safeStringifyExtractResult(event.result),
              metadata: { schemaPresent: event.schema !== undefined }
            }
          ]
        },
        surface: 'retrieved_doc'
      };
    case 'observe':
      return {
        input: { kind: 'text', content: event.prompt },
        surface: 'text_input'
      };
    case 'agent.execute':
      return {
        input: { kind: 'composed_context', entries: [event.task] },
        surface: 'composed_context'
      };
    case 'file':
      // High-blast-radius op flagged via toolName prefix so
      // validators can distinguish file.write vs other tool_calls.
      return {
        input: {
          kind: 'tool_call',
          toolName: `file.${event.op}`,
          args: {
            path: event.path,
            ...(event.content !== undefined ? { content: event.content } : {})
          }
        },
        surface: 'tool_call'
      };
    case 'mcp.tool':
      return {
        input: {
          kind: 'tool_call',
          toolName: `${event.server}/${event.tool}`,
          args: event.args ?? {}
        },
        surface: 'tool_call'
      };
    default: {
      // Exhaustiveness check at compile time; throws at runtime for
      // forward-compat (new event kinds added without bumping core).
      const _exhaustive: never = event;
      throw new Error(
        `withBrowserAgentGuardrails: unknown BrowserAgentEvent kind: ${
          (_exhaustive as { kind?: string }).kind ?? 'unknown'
        }`
      );
    }
  }
}

/**
 * Serialize an `extract` result for validator inspection. Page-
 * controlled `result` can be anything — Date, Map, circular ref,
 * etc. Wrap in try/catch + fall back to a synthetic sentinel so
 * the BonkLM pipeline gets a string and the consumer's call stack
 * isn't poisoned by a serialization throw (sec-audit T7 closure).
 */
function safeStringifyExtractResult(result: unknown): string {
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result);
  } catch {
    return '[bonklm: extract result not serializable — treated as opaque]';
  }
}
