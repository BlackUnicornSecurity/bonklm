/**
 * Story 3.3 — `wrapLiveKitAgentSession`: wires event listeners on
 * `AgentSession` for the two AC-mandated paths that are
 * event-emitter-shaped (not Agent-override-shaped):
 *
 *   1. `user_input_transcribed` (interim transcripts) — partial-path
 *      hot validation via `AudioStreamValidator.validatePartial`;
 *      CRITICAL needle → `session.interrupt({ force: true })` BEFORE
 *      the LLM call fires. Final transcripts are NOT validated here
 *      (the final-path runs in `BonklmAgent.onUserTurnCompleted`).
 *
 *   2. `function_tools_executed` (post-execution tool args) — validates
 *      each `FunctionCall.args` blob. BLOCK throws
 *      `LiveKitGuardrailError`.
 *
 * **Post-execution caveat (security CONCERN-3)**: the
 * `function_tools_executed` event fires AFTER the tool ran. Validator
 * decisions cannot prevent the tool from executing — they only block
 * downstream agent steps. The user-supplied tool executor MUST be
 * sandboxed for true containment.
 *
 * **Double-wrap rejection (security BLOCK-1)**: re-wrapping the same
 * AgentSession orphans the prior closure's listener and produces a
 * silent bypass. We detect via a Symbol-keyed sentinel on the session
 * and throw on re-wrap.
 *
 * **Throwing onBlock does NOT skip interrupt (security BLOCK-2)**:
 * the telemetry hook is wrapped in try/catch; `interrupt({force:true})`
 * fires unconditionally on `earlyBlock`.
 */
import { voice } from '@livekit/agents';
import { AUDIO_STREAM_SURFACE, AudioStreamValidator } from '@blackunicorn/bonklm/validators';
import { assertNotWrapped, markWrapped } from '@blackunicorn/bonklm/core/connector-utils';

type AgentSession = voice.AgentSession;
const { AgentSessionEventTypes } = voice;
import type { LiveKitGuardrailConfig, LiveKitGuardrailPhase } from './types.js';
import { LiveKitGuardrailError } from './errors.js';

const DEFAULT_MAX_PARTIAL_MS = 100;
const DEFAULT_MAX_FINAL_MS = 500;
const BONKLM_WIRED_SYMBOL: unique symbol = Symbol.for('@blackunicorn/bonklm-livekit/wired');

/**
 * Wire the session-level event listeners. Returns the session for
 * fluent-chain convenience. Throws if the session was already wired.
 */
export function wrapLiveKitAgentSession<S extends AgentSession>(session: S, config: LiveKitGuardrailConfig): S {
  if (!session || typeof (session as { on?: unknown }).on !== 'function') {
    throw new TypeError('wrapLiveKitAgentSession: session must be an AgentSession instance with .on() event emitter.');
  }
  if (!config || !(config.audioStreamValidator instanceof AudioStreamValidator)) {
    throw new TypeError(
      'wrapLiveKitAgentSession: config.audioStreamValidator (AudioStreamValidator) is required. ' +
        'Pass the SAME instance you used to construct BonklmAgent so partial-path state flows into the final-path.'
    );
  }
  // Sprint 22 audit closure (architect C2 + code-reviewer C-4): use
  // shared wrap-sentinel helper from core/connector-utils. Replaces
  // the verbatim Symbol-watermark copy (was duplicated across 5
  // connector packages).
  assertNotWrapped(session, BONKLM_WIRED_SYMBOL, 'wrapLiveKitAgentSession');
  markWrapped(session, BONKLM_WIRED_SYMBOL);

  const av = config.audioStreamValidator;
  const partialBudget = config.maxPartialLatencyMs ?? DEFAULT_MAX_PARTIAL_MS;
  const finalBudget = config.maxFinalLatencyMs ?? DEFAULT_MAX_FINAL_MS;

  // -------------------------------------------------------------------------
  // user_input_transcribed
  // -------------------------------------------------------------------------
  session.on(AgentSessionEventTypes.UserInputTranscribed, event => {
    // event-listener wrapper — LiveKit's TypedEventEmitter does NOT
    // await async listeners. Route errors to config.onError so they're
    // not silently swallowed (code-reviewer CONCERN-3 closure).
    void handleUserInputTranscribed(session, event, av, config, partialBudget);
  });

  // -------------------------------------------------------------------------
  // function_tools_executed
  // -------------------------------------------------------------------------
  session.on(AgentSessionEventTypes.FunctionToolsExecuted, event => {
    void handleFunctionToolsExecuted(event, av, config, finalBudget);
  });

  return session;
}

// =============================================================================
// Handlers
// =============================================================================

async function handleUserInputTranscribed(
  session: AgentSession,
  event: { transcript?: unknown; isFinal?: unknown },
  av: AudioStreamValidator,
  config: LiveKitGuardrailConfig,
  partialBudget: number
): Promise<void> {
  try {
    if (!event || typeof event.transcript !== 'string') return;
    // Final transcripts are handled by BonklmAgent.onUserTurnCompleted.
    // Push to the validator so the AC state stays consistent across
    // chunk boundaries that arrive as separate isFinal=false events.
    if (event.isFinal === true) return;

    const start = performance.now();
    const result = av.validatePartial(event.transcript);
    reportLatency(config, 'partial', performance.now() - start, partialBudget);

    if (result.earlyBlock) {
      const cat = result.matches[0]?.pattern.category;
      const sev = result.matches[0]?.pattern.severity;
      const reason = `bonklm:${AUDIO_STREAM_SURFACE}:early_block:${cat ?? 'unknown'}`;
      // Sprint 18 security B-2 closure: telemetry MUST NOT block
      // enforcement. Call interrupt() unconditionally; onBlock's
      // exceptions are caught and routed to onError.
      try {
        config.onBlock?.({ phase: 'partial', reason, category: cat, severity: sev });
      } catch (err) {
        safeOnError(config, err);
      }
      try {
        session.interrupt({ force: true });
      } catch (err) {
        safeOnError(config, err);
      }
    }
  } catch (err) {
    safeOnError(config, err);
  }
}

async function handleFunctionToolsExecuted(
  event: { functionCalls?: Array<{ name?: string; args?: string; callId?: string }> },
  av: AudioStreamValidator,
  config: LiveKitGuardrailConfig,
  finalBudget: number
): Promise<void> {
  try {
    if (!event || !Array.isArray(event.functionCalls)) return;

    for (const call of event.functionCalls) {
      if (!call) continue;
      const argsString = typeof call.args === 'string' ? call.args : safeStringify(call.args);
      if (argsString.length === 0) continue;

      const start = performance.now();
      const transient = av.fork();
      const result = await transient.validateFinal(argsString);
      reportLatency(config, 'tool', performance.now() - start, finalBudget);

      if (result.blocked) {
        const cat = result.findings[0]?.category;
        const sev = String(result.severity);
        const reason = `bonklm:tool_call:tool_block:${call.name ?? 'unknown'}:${cat ?? 'unknown'}`;
        try {
          config.onBlock?.({ phase: 'tool', reason, category: cat, severity: sev });
        } catch (err) {
          safeOnError(config, err);
        }
        throw new LiveKitGuardrailError(reason, 'tool', { category: cat, severity: sev });
      }
    }
  } catch (err) {
    // EventEmitter.emit() does NOT await listeners, so throwing here
    // becomes an unhandledRejection. Telemetry (`onBlock`) already
    // fired BEFORE the throw inside the loop, so observability is
    // preserved. Route the error through `onError` so consumers can
    // log / alert without depending on unhandledRejection handlers.
    safeOnError(config, err);
  }
}

// =============================================================================
// Helpers
// =============================================================================

function reportLatency(
  config: LiveKitGuardrailConfig,
  phase: LiveKitGuardrailPhase,
  latencyMs: number,
  budgetMs: number
): void {
  if (latencyMs > budgetMs && config.onLatencyExceeded) {
    try {
      config.onLatencyExceeded({ phase, latencyMs, budgetMs });
    } catch (err) {
      safeOnError(config, err);
    }
  }
}

function safeOnError(config: LiveKitGuardrailConfig, err: unknown): void {
  if (!config.onError) return;
  try {
    config.onError(err);
  } catch {
    /* swallow */
  }
}

function safeStringify(args: unknown): string {
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}
