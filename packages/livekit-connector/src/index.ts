// SPDX-License-Identifier: Apache-2.0
/**
 * `@blackunicorn/bonklm-livekit` — LiveKit Agents (v1.x) connector for BonkLM.
 *
 * Sprint 18 (Story 3.3) post-3-lane-audit shape:
 *
 *   - `BonklmAgent` — `Agent` subclass; overrides `onUserTurnCompleted`
 *     (final-path validation) + `ttsNode` (pre-TTS echo-attack defence).
 *   - `wrapLiveKitAgentSession(session, config)` — event-listener wiring
 *     for `user_input_transcribed` (partial-path → `session.interrupt()`)
 *     and `function_tools_executed` (tool-args validation).
 *
 * Pass the SAME `audioStreamValidator` instance to both so partial-path
 * AC state flows into the final-path `validateFinal` call.
 *
 * See `README.md` for the full integration recipe.
 */
export { BonklmAgent, type BonklmAgentOptions } from './bonklm-agent.js';
export { wrapLiveKitAgentSession } from './wrap-session.js';
export { LiveKitGuardrailError } from './errors.js';
export type {
  LiveKitGuardrailConfig,
  LiveKitGuardrailOptions,
  LiveKitGuardrailPhase,
  LiveKitLatencyExceededEvent,
  LiveKitBlockEvent
} from './types.js';
