import type { LiveKitGuardrailPhase } from './types.js';

/**
 * Thrown by `BonklmAgent` (onUserTurnCompleted, ttsNode) and
 * `wrapLiveKitAgentSession` (function_tools_executed handler) when
 * a heavy-path validator decides to BLOCK.
 *
 * **Throw semantics under LiveKit `Agent` overrides**: AgentSession
 * treats a thrown error from `onUserTurnCompleted` / `ttsNode` /
 * event-listener as a turn-abort signal. Caller's `onBlock` callback
 * fires BEFORE the throw so telemetry lands even if the SDK swallows
 * the rejection.
 */
export class LiveKitGuardrailError extends Error {
  override readonly name = 'LiveKitGuardrailError';
  readonly phase: LiveKitGuardrailPhase;
  readonly category?: string;
  readonly severity?: string;

  constructor(message: string, phase: LiveKitGuardrailPhase, extra?: { category?: string; severity?: string }) {
    super(message);
    this.phase = phase;
    this.category = extra?.category;
    this.severity = extra?.severity;
  }
}
