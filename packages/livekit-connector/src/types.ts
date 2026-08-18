/**
 * LiveKit Agents Connector types
 * ===========================================
 *
 * Sprint 18 3-lane hardening (architect C-4 + code-reviewer BLOCK-1):
 * structural-typing dropped in favour of real `@livekit/agents` types.
 * Connector now correctly targets v1.4.x SDK surface:
 *   - `AgentSession.on('user_input_transcribed', ...)` event listener
 *   - `AgentSession.on('function_tools_executed', ...)` event listener
 *   - `Agent.onUserTurnCompleted` override for pre-LLM validation
 *   - `Agent.ttsNode` override for pre-TTS validation
 *   - `AgentSession.interrupt({ force?: boolean })` — NO reason string param
 */
import type { AudioStreamValidator } from '@blackunicorn/bonklm/validators';

/**
 * Phase tags emitted with every `onBlock` / `onLatencyExceeded` event.
 * Exported so connector authors writing `if (err.phase === 'tool')`
 * get IDE completion.
 */
export type LiveKitGuardrailPhase = 'partial' | 'final' | 'tts' | 'tool';

/**
 * Latency-budget-exceeded telemetry event.
 */
export interface LiveKitLatencyExceededEvent {
  phase: LiveKitGuardrailPhase;
  latencyMs: number;
  budgetMs: number;
}

/**
 * Block telemetry event. Fires once per blocked turn / chunk. `reason`
 * carries the validator category + finding details — visible in
 * operator logs, do NOT include user-supplied PII.
 */
export interface LiveKitBlockEvent {
  phase: LiveKitGuardrailPhase;
  reason: string;
  category?: string;
  severity?: string;
}

/**
 * Shared config used by BOTH `BonklmAgent` (Agent subclass) and
 * `wrapLiveKitAgentSession` (event-listener wiring). Pass the SAME
 * `audioStreamValidator` instance to both so the partial automaton's
 * state flows into the final-path validateFinal call.
 *
 * **One instance per session** (Story 3.1 known-limitations §23): the
 * validator carries mutable session state. Call `validator.fork()`
 * before each session or construct fresh per session.
 */
export interface LiveKitGuardrailConfig {
  audioStreamValidator: AudioStreamValidator;
  /**
   * Partial-path latency ceiling. <100ms on M2-class
   * CPU. Default: 100.
   */
  maxPartialLatencyMs?: number;
  /**
   * Final-path latency ceiling. Default: 500.
   */
  maxFinalLatencyMs?: number;
  onLatencyExceeded?: (event: LiveKitLatencyExceededEvent) => void;
  onBlock?: (event: LiveKitBlockEvent) => void;
  /**
   * Optional error sink — invoked when an event-listener handler
   * throws asynchronously (LiveKit's TypedEventEmitter does NOT await
   * listeners, so unhandled rejections would otherwise be silently
   * dropped). Sprint 18 audit code-reviewer CONCERN-3 closure.
   */
  onError?: (err: unknown) => void;
}

/**
 * Alias kept for back-compat with the Sprint-18 pre-rewrite API.
 * @deprecated use `LiveKitGuardrailConfig`.
 */
export type LiveKitGuardrailOptions = LiveKitGuardrailConfig;
