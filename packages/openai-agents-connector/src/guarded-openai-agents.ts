/**
 * OpenAI Agents SDK Guarded Wrapper
 * =================================
 *
 * Provides security guardrails for `@openai/agents ^0.11.0` consumers
 * by wrapping the four primary surfaces:
 *
 *   - `wrapAgent(agent, options)` — install BonkLM-derived input +
 *     output guardrails on an `Agent` so the agent run terminates
 *     with `InputGuardrailTripwireTriggered` / `OutputGuardrailTripwireTriggered`
 *     when validation fails.
 *
 *   - `wrapHandoff(handoff, options)` — wrap a handoff's `inputFilter`
 *     so transfer payloads carrying attacker-influenced content are
 *     scanned BEFORE the receiving agent sees them. Runs the full
 *     validator chain plus `createToolCallArgsValidator` for any
 *     embedded function-call args. Mitigates the "tool-result-as-
 *     carrier" attack class where one agent's tool output is the
 *     vehicle for an injection that crosses the handoff boundary.
 *
 *   - `wrapRealtime(session, options)` — wire BonkLM into the
 *     RealtimeSession event stream. Validates the
 *     `input_audio_transcription.completed` text (caller mic input)
 *     and installs a `RealtimeOutputGuardrail` on response deltas
 *     that scans text fragments as they arrive. Raw PCM audio frames
 *     are NOT scanned (deferred to Story 3.1 Audio Stream Validator).
 *
 * Pre-1.0 pin: peer `@openai/agents ^0.11.0` is intentionally tight.
 * Pre-1.0 SDKs change shape between minors; we re-align this file
 * (and `types.ts`) when bumping the peer.
 *
 * @package @blackunicorn/bonklm-openai-agents
 */

import {
  createLogger,
  createToolCallArgsValidator,
  GuardrailEngine,
  type Logger,
  sanitizeMeta,
  validateWithTimeoutSecure
} from '@blackunicorn/bonklm';
import { ConnectorValidationError, logValidationFailure } from '@blackunicorn/bonklm/core/connector-utils';
import type {
  AgentInputGuardrailLike,
  AgentInputGuardrailResult,
  AgentLike,
  AgentOutputGuardrailLike,
  AgentOutputGuardrailResult,
  GuardedAgentsOptions,
  HandoffLike,
  RealtimeOutputGuardrailLike,
  RealtimeSessionLike,
  ToolInputGuardrailLike,
  ToolInputGuardrailResult,
  ToolOutputGuardrailLike,
  ToolOutputGuardrailResult
} from './types.js';
import { DEFAULT_VALIDATION_TIMEOUT } from './types.js';

/**
 * Internal: extract a scannable text representation from an
 * `AgentInputGuardrailArgs.input` regardless of whether the SDK passes
 * a bare string, a `{ content }` object, or a `{ messages }` array.
 */
function inputToText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';
  const obj = input as { content?: unknown; messages?: unknown[] };
  if (typeof obj.content === 'string') return obj.content;
  if (Array.isArray(obj.messages)) {
    const parts: string[] = [];
    for (const m of obj.messages) {
      if (!m || typeof m !== 'object') continue;
      const content = (m as { content?: unknown }).content;
      if (typeof content === 'string') parts.push(content);
      else if (Array.isArray(content)) {
        for (const c of content) {
          if (c && typeof c === 'object') {
            const part = c as { type?: string; text?: string };
            if (part.type === 'text' && typeof part.text === 'string') parts.push(part.text);
          }
        }
      }
    }
    return parts.join('\n');
  }
  return '';
}

/** Internal: extract scannable text from an agent's `agentOutput`. */
function outputToText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (!output || typeof output !== 'object') return '';
  const obj = output as { content?: unknown; text?: unknown };
  if (typeof obj.text === 'string') return obj.text;
  if (typeof obj.content === 'string') return obj.content;
  return '';
}

/** Internal: serialise tool args / tool output to a scannable string. */
function payloadToText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload === null || payload === undefined) return '';
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

/**
 * Internal: timeout-wrapped engine.validate adapter, returning the
 * canonical `{ allowed, reason }` shape so callers (guardrail
 * `execute` impls below) don't repeat the validateWithTimeoutSecure
 * boilerplate.
 */
function makeValidate(engine: GuardrailEngine, timeout: number, logger: Logger, _label: string) {
  return async (content: string, context: string) => {
    const r = await validateWithTimeoutSecure({
      operation: () => engine.validate(content, context),
      timeoutMs: timeout,
      timeoutSentinel: () =>
        ({
          allowed: false,
          blocked: true,
          reason: 'Validation timeout'
        }) as { allowed: boolean; blocked: boolean; reason?: string },
      logger
    });
    return r;
  };
}

/**
 * Convert BonkLM validator chain → OpenAI Agents `defineInputGuardrail`
 * shape. The returned guardrail's `execute` validates the input and
 * sets `tripwireTriggered: true` on block so the SDK terminates the
 * agent run with `InputGuardrailTripwireTriggered`.
 */
export function defineInputGuardrail(
  engine: GuardrailEngine,
  options: GuardedAgentsOptions = {},
  name: string = 'bonklm_input'
): AgentInputGuardrailLike {
  const logger = options.logger ?? createLogger('console');
  const timeout = options.validationTimeout ?? DEFAULT_VALIDATION_TIMEOUT;
  const validate = makeValidate(engine, timeout, logger, name);
  const productionMode = options.productionMode ?? process.env.NODE_ENV === 'production';

  return {
    name,
    async execute(args): Promise<AgentInputGuardrailResult> {
      const text = inputToText(args.input);
      if (text.length === 0) return { tripwireTriggered: false };
      const r = await validate(text, 'openai_agents_input');
      if (!r.allowed) {
        logValidationFailure(logger, r.reason ?? 'Input blocked', {
          guardrail: name,
          agent: args.agent?.name
        });
        options.onInputBlocked?.(r.reason ?? 'input_blocked');
        return {
          tripwireTriggered: true,
          outputInfo: {
            reason: productionMode ? 'Input blocked' : r.reason
          }
        };
      }
      return { tripwireTriggered: false };
    }
  };
}

/**
 * Convert BonkLM validator chain → OpenAI Agents `defineOutputGuardrail`
 * shape.
 */
export function defineOutputGuardrail(
  engine: GuardrailEngine,
  options: GuardedAgentsOptions = {},
  name: string = 'bonklm_output'
): AgentOutputGuardrailLike {
  const logger = options.logger ?? createLogger('console');
  const timeout = options.validationTimeout ?? DEFAULT_VALIDATION_TIMEOUT;
  const validate = makeValidate(engine, timeout, logger, name);
  const productionMode = options.productionMode ?? process.env.NODE_ENV === 'production';

  return {
    name,
    async execute(args): Promise<AgentOutputGuardrailResult> {
      const text = outputToText(args.agentOutput);
      if (text.length === 0) return { tripwireTriggered: false };
      const r = await validate(text, 'openai_agents_output');
      if (!r.allowed) {
        logValidationFailure(logger, r.reason ?? 'Output blocked', {
          guardrail: name,
          agent: args.agent?.name
        });
        options.onOutputBlocked?.(r.reason ?? 'output_blocked');
        return {
          tripwireTriggered: true,
          outputInfo: {
            reason: productionMode ? 'Output blocked' : r.reason
          }
        };
      }
      return { tripwireTriggered: false };
    }
  };
}

/**
 * Convert BonkLM validator chain → OpenAI Agents
 * `defineToolInputGuardrail`. Scans tool-call args (both names and
 * values) via `createToolCallArgsValidator` so the per-leaf walker
 * + position-stable bypass-resistance from Story 1.1 applies.
 *
 * @param _engine Reserved for Phase-2 per-leaf engine-guard pass.
 *   Currently tool-call args validation runs via
 *   `createToolCallArgsValidator` which consumes `options.validators`
 *   directly; the engine's `guards` chain is NOT applied at the leaf
 *   level. Keep the parameter in the signature for symmetry with the
 *   other guardrail factories AND for forward-compatibility when the
 *   Phase-2 enhancement lands.
 */
export function defineToolInputGuardrail(
  _engine: GuardrailEngine,
  options: GuardedAgentsOptions = {},
  name: string = 'bonklm_tool_input'
): ToolInputGuardrailLike {
  const logger = options.logger ?? createLogger('console');
  const productionMode = options.productionMode ?? process.env.NODE_ENV === 'production';
  const validators = options.validators ?? [];
  // Build the tool-call args validator once and reuse it.
  const toolCallValidator = validators.length > 0 ? createToolCallArgsValidator({ validators }) : null;

  return {
    name,
    async execute(args): Promise<ToolInputGuardrailResult> {
      if (!toolCallValidator) return { tripwireTriggered: false };
      const r = await toolCallValidator.validate({
        kind: 'tool_call',
        toolName: args.toolName ?? '',
        args: args.toolArgs
      });
      if (r.blocked) {
        logValidationFailure(logger, r.reason ?? 'Tool input blocked', {
          guardrail: name,
          tool: args.toolName,
          agent: args.agent?.name
        });
        options.onToolBlocked?.(args.toolName ?? '', r.reason ?? 'tool_input_blocked', r);
        return {
          tripwireTriggered: true,
          outputInfo: {
            reason: productionMode ? 'Tool input blocked' : r.reason
          }
        };
      }
      return { tripwireTriggered: false };
    }
  };
}

/**
 * Convert BonkLM validator chain → OpenAI Agents
 * `defineToolOutputGuardrail`. Scans the tool's RETURN value before it
 * crosses back into the agent context (mitigates the
 * "tool-result-as-carrier" attack class).
 */
export function defineToolOutputGuardrail(
  engine: GuardrailEngine,
  options: GuardedAgentsOptions = {},
  name: string = 'bonklm_tool_output'
): ToolOutputGuardrailLike {
  const logger = options.logger ?? createLogger('console');
  const timeout = options.validationTimeout ?? DEFAULT_VALIDATION_TIMEOUT;
  const validate = makeValidate(engine, timeout, logger, name);
  const productionMode = options.productionMode ?? process.env.NODE_ENV === 'production';

  return {
    name,
    async execute(args): Promise<ToolOutputGuardrailResult> {
      const text = payloadToText(args.toolOutput);
      if (text.length === 0) return { tripwireTriggered: false };
      const r = await validate(text, 'openai_agents_tool_output');
      if (!r.allowed) {
        logValidationFailure(logger, r.reason ?? 'Tool output blocked', {
          guardrail: name,
          tool: args.toolName,
          agent: args.agent?.name
        });
        options.onToolBlocked?.(args.toolName ?? '', r.reason ?? 'tool_output_blocked', {
          allowed: false,
          blocked: true,
          reason: r.reason,
          severity: 'critical' as never,
          risk_level: 'HIGH' as never,
          risk_score: 30,
          findings: [],
          timestamp: Date.now()
        });
        // Sprint 43 CWE-117 sweep: sanitize `r.reason` in the
        // dev-mode tripwire `outputInfo.reason` field (consumer
        // may log this surface).
        return {
          tripwireTriggered: true,
          outputInfo: {
            reason: productionMode ? 'Tool output blocked' : sanitizeMeta(r.reason)
          }
        };
      }
      return { tripwireTriggered: false };
    }
  };
}

/**
 * Wrap an `Agent` instance with BonkLM input + output guardrails.
 * Per-tool input/output guardrails are also installed on every tool
 * in `agent.tools`. Uses the SDK's `.clone({ inputGuardrails,
 * outputGuardrails, tools })` pattern when available (immutable
 * update); falls back to direct array push for caller-controlled
 * mutable mocks.
 *
 * @example
 * ```ts
 * import { Agent } from '@openai/agents';
 * import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';
 * import { wrapAgent } from '@blackunicorn/bonklm-openai-agents';
 *
 * const engine = new GuardrailEngine({ validators: [new PromptInjectionValidator()] });
 * const guardedAgent = wrapAgent(
 *   new Agent({ name: 'support', instructions: '...' }),
 *   engine,
 *   { productionMode: true }
 * );
 * ```
 */
export function wrapAgent(agent: AgentLike, engine: GuardrailEngine, options: GuardedAgentsOptions = {}): AgentLike {
  const inputGuard = defineInputGuardrail(engine, options);
  const outputGuard = defineOutputGuardrail(engine, options);
  const toolInputGuard = defineToolInputGuardrail(engine, options);
  const toolOutputGuard = defineToolOutputGuardrail(engine, options);

  const nextInputGuardrails = [...(agent.inputGuardrails ?? []), inputGuard];
  const nextOutputGuardrails = [...(agent.outputGuardrails ?? []), outputGuard];

  // Per-tool guardrails: clone each tool with input + output guards
  // appended. Tool mutation uses spread so the original tool definition
  // is not modified.
  const nextTools = (agent.tools ?? []).map(tool => ({
    ...tool,
    inputGuardrails: [...(tool.inputGuardrails ?? []), toolInputGuard],
    outputGuardrails: [...(tool.outputGuardrails ?? []), toolOutputGuard]
  }));

  if (typeof agent.clone === 'function') {
    return agent.clone({
      inputGuardrails: nextInputGuardrails,
      outputGuardrails: nextOutputGuardrails,
      tools: nextTools
    });
  }
  // Fallback: return a new agent-shaped object (spread). Real SDK
  // agents always expose `.clone`; this branch supports test mocks
  // and any pre-0.11 SDK build that omits the method.
  return {
    ...agent,
    inputGuardrails: nextInputGuardrails,
    outputGuardrails: nextOutputGuardrails,
    tools: nextTools
  };
}

/**
 * Wrap a `Handoff` so transfer payloads are validated BEFORE the
 * receiving agent sees them. Mitigates the cross-agent injection
 * carrier attack: a compromised upstream agent producing a tool
 * result containing an injection payload that would normally bypass
 * the downstream agent's input guardrails (which only see the raw
 * user message, not the handoff payload).
 *
 * The wrap composes BonkLM's full validator chain PLUS
 * `createToolCallArgsValidator` so any tool-call args carried in the
 * handoff data are tree-walked.
 */
export function wrapHandoff(
  handoff: HandoffLike,
  engine: GuardrailEngine,
  options: GuardedAgentsOptions = {}
): HandoffLike {
  const logger = options.logger ?? createLogger('console');
  const timeout = options.validationTimeout ?? DEFAULT_VALIDATION_TIMEOUT;
  const validate = makeValidate(engine, timeout, logger, 'bonklm_handoff');
  const productionMode = options.productionMode ?? process.env.NODE_ENV === 'production';
  const validators = options.validators ?? [];
  const toolCallValidator = validators.length > 0 ? createToolCallArgsValidator({ validators }) : null;
  const previousFilter = handoff.inputFilter;

  return {
    ...handoff,
    async inputFilter(data: unknown): Promise<unknown> {
      // Validate any text content in the handoff data via the engine.
      const text = payloadToText(data);
      if (text.length > 0) {
        const r = await validate(text, 'openai_agents_handoff');
        if (!r.allowed) {
          logValidationFailure(logger, r.reason ?? 'Handoff blocked', {
            handoff: handoff.name,
            target: handoff.agent?.name
          });
          options.onHandoffBlocked?.(undefined, handoff.agent?.name, r.reason ?? 'handoff_blocked');
          // Sprint 43 CWE-117 sweep: sanitize `r.reason` at dev-mode
          // throw boundary.
          throw new ConnectorValidationError(
            productionMode ? 'Handoff blocked' : `Handoff blocked: ${sanitizeMeta(r.reason)}`,
            'validation_failed'
          );
        }
      }

      // Also run tool-call args validation on any embedded function-call
      // payloads — handoff data frequently carries tool outputs as
      // `{ name, args }` shapes.
      if (toolCallValidator && data && typeof data === 'object') {
        const maybeToolCall = data as { name?: unknown; args?: unknown };
        if (typeof maybeToolCall.name === 'string') {
          const r = await toolCallValidator.validate({
            kind: 'tool_call',
            toolName: maybeToolCall.name,
            args: maybeToolCall.args
          });
          if (r.blocked) {
            logValidationFailure(logger, r.reason ?? 'Handoff tool args blocked', {
              handoff: handoff.name,
              target: handoff.agent?.name,
              tool: maybeToolCall.name
            });
            options.onHandoffBlocked?.(undefined, handoff.agent?.name, r.reason ?? 'handoff_tool_blocked');
            // Sprint 43 CWE-117 sweep: sister to handoff-input-filter
            // throw above — tool-args path. Code-review BLOCK closure
            // (initial `replace_all` edit missed this site due to
            // different surrounding indentation).
            throw new ConnectorValidationError(
              productionMode ? 'Handoff blocked' : `Handoff blocked: ${sanitizeMeta(r.reason)}`,
              'validation_failed'
            );
          }
        }
      }

      // Validation passed — defer to any pre-existing `inputFilter`
      // the caller configured (or return the data unchanged).
      if (typeof previousFilter === 'function') {
        return previousFilter(data);
      }
      return data;
    }
  };
}

/**
 * Wrap a `RealtimeSession` so input audio transcriptions are
 * validated (`input_audio_transcription.completed`) and output text
 * deltas are scanned via a `RealtimeOutputGuardrail`. Raw PCM audio
 * frames are NOT inspected by this wrap — they're covered by Story
 * 3.1's `AudioStreamValidator`.
 *
 * Mutates `session.outputGuardrails` (the OpenAI Agents SDK reads
 * this array at run-time to dispatch deltas). Hooks
 * `input_audio_transcription.completed` via whichever subscribe
 * method the session exposes (`.on` or `.addEventListener`).
 */
export function wrapRealtime(
  session: RealtimeSessionLike,
  engine: GuardrailEngine,
  options: GuardedAgentsOptions = {}
): RealtimeSessionLike {
  const logger = options.logger ?? createLogger('console');
  const timeout = options.validationTimeout ?? DEFAULT_VALIDATION_TIMEOUT;
  const validateInput = makeValidate(engine, timeout, logger, 'bonklm_realtime_input');
  const validateOutput = makeValidate(engine, timeout, logger, 'bonklm_realtime_output');
  const productionMode = options.productionMode ?? process.env.NODE_ENV === 'production';

  // Output guardrail: scans response text deltas as they arrive.
  // `tripwireTriggered` terminates the response stream per SDK
  // semantics.
  const outputGuard: RealtimeOutputGuardrailLike = {
    name: 'bonklm_realtime_output',
    async execute(args): Promise<{ tripwireTriggered: boolean }> {
      const text = args.delta ?? args.transcript ?? '';
      if (text.length === 0) return { tripwireTriggered: false };
      const r = await validateOutput(text, 'openai_agents_realtime_output');
      if (!r.allowed) {
        logValidationFailure(logger, r.reason ?? 'Realtime output blocked', {
          guardrail: 'bonklm_realtime_output'
        });
        options.onOutputBlocked?.(r.reason ?? 'realtime_output_blocked');
        return { tripwireTriggered: true };
      }
      return { tripwireTriggered: false };
    }
  };
  session.outputGuardrails = [...(session.outputGuardrails ?? []), outputGuard];

  // Input guardrail: subscribe to transcription-completed events and
  // validate the transcribed text. The SDK fires this AFTER the
  // realtime audio has already been processed; if BonkLM blocks, we
  // close the session and emit the documented log entry.
  const transcriptionHandler = (payload: unknown): void => {
    void (async (): Promise<void> => {
      const transcript = (payload as { transcript?: unknown })?.transcript;
      if (typeof transcript !== 'string' || transcript.length === 0) return;
      const r = await validateInput(transcript, 'openai_agents_realtime_input');
      if (!r.allowed) {
        logValidationFailure(logger, r.reason ?? 'Realtime input blocked', {
          guardrail: 'bonklm_realtime_input'
        });
        options.onInputBlocked?.(r.reason ?? 'realtime_input_blocked');
        if (typeof session.close === 'function') {
          try {
            await session.close();
          } catch (err) {
            // Sprint 43 architect HIGH #4 closure: `err` from
            // `session.close()` can carry attacker-influenced data
            // from realtime SDK internal state. Sanitize via
            // sanitizeMeta which fail-closes hostile-toString
            // throws (Sprint 43 security MEDIUM #5).
            logger.warn?.(
              productionMode
                ? 'Realtime session close failed after block'
                : `Realtime session close failed: ${sanitizeMeta(err)}`
            );
          }
        }
      }
    })();
  };

  // Subscribe via whichever shape the session exposes. Real SDK uses
  // `.on(event, handler)`; some test mocks expose `.addEventListener`.
  if (typeof session.on === 'function') {
    session.on('input_audio_transcription.completed', transcriptionHandler);
  } else if (typeof session.addEventListener === 'function') {
    session.addEventListener('input_audio_transcription.completed', transcriptionHandler);
  }

  return session;
}
