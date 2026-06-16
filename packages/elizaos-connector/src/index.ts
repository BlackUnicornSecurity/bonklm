// SPDX-License-Identifier: Apache-2.0
/**
 * @blackunicorn/bonklm-elizaos
 * ===========================
 * ElizaOS connector for BonkLM.
 *
 * Public surface (Phase-1 + Phase-2):
 *  - `bonklmPlugin(options)` — ElizaOS `Plugin` (priority 1000) that:
 *      • Asserts AsyncLocalStorage is healthy at engine construction.
 *      • Awaits the startup HTTP probe of the local runtime's
 *        /api/agents/{agentId}/memories route for Class-4 unauth
 *        exposure (Phase-2).
 *      • Seals BOTH `runtime.createMemory` AND `runtime.updateMemory`
 *        in the same synchronous block.
 *      • Wraps every web3-signing action's handler with
 *        `ToolCallArgsValidator` + the two-condition recipient gate.
 *  - `runDoctor(...)` + `runDoctorRuntime(...)` — `bonklm doctor` core
 *    and `--runtime` mode for static + runtime deployment audit.
 *  - `installSealedWrapMemory(runtime, options)` — low-level seal
 *    primitive for callers wiring Construct B without the full plugin.
 *  - `withCallContext(runtime, ctx, fn)` — ALS-managed source-trust
 *    context helper (Phase-2; runtime-property storage REMOVED).
 *  - `runStartupProbe(...)` + `applyProbeOutcome(...)` — probe primitives.
 *  - `detectTypoSquat(...)` + `levenshteinDistance(...)` — plugin-name
 *    typo-squat detection (Phase-2).
 *
 * Phase-2 (Story 2.1b-connectors) shipped at this commit:
 *  - AsyncLocalStorage migration for call-context (closes iter-2
 *    architect BLOCK-1 + adversarial #11).
 *  - `updateMemory` seal in same sync block as `createMemory`.
 *  - Startup HTTP probe with all amendments (2000ms AbortController,
 *    IPv6 fallback, ALS-clear, module-scope dedup, 4-branch outcome,
 *    probe-await semantics).
 *  - `acknowledgeClass4Risk` flag wired (Phase-1 threw on it).
 *  - Levenshtein typo-squat in doctor + Construct B refuse-write.
 *
 * Story 2.4a (Sprint 12, v0.5.0) backlog (NOT in Phase-2):
 *  - Construct A shadow-log read replacing user-authored-memory bucket.
 *  - 30-day-post-v0.5.0 EOL flag in `package.json.deprecated`.
 */
export { installSealedWrapMemory, withCallContext, getCallContext } from './wrap-memory.js';

export {
  assertCallContextRuntime,
  bindEngineCallContext,
  runWithoutCallContext,
  withCallContextSync,
  type CallContext
} from './als-context.js';

export { detectTypoSquat, detectTypoSquatBatch, levenshteinDistance, type TypoSquatResult } from './typo-squat.js';

export { runStartupProbe, applyProbeOutcome, type ProbeOutcome, type ProbeOptions } from './probe.js';

export { evaluateRecipientGate, wrapSigningAction } from './tool-call-args-gate.js';

export {
  auditCharacterFile,
  auditInstalledVersions,
  auditPlugins,
  buildReport,
  probeOutcomeToFindings,
  runDoctor,
  runDoctorRuntime
} from './doctor.js';

export { bonklmPlugin } from './plugin.js';

// Story 2.4a — Class-4 structural defence via shadow log integration.
export {
  createElizaOSDrizzleShadowLogStorage,
  assertRoomAccess,
  ShadowLogAuthError,
  mapMessageReceivedToShadowLog,
  type DrizzleShadowLogClient,
  type DrizzleShadowLogStorageOptions,
  type ElizaMessageReceivedEvent
} from './shadow-log-adapter.js';

export {
  verifyAndReadAuthenticatedMessages,
  shadowLogIntegrityFailureMessage,
  buildEolFindingV04,
  warnAcknowledgeClass4RiskDeprecated,
  type AuthenticatedMessagesResult,
  type VerifyAndReadOptions
} from './shadow-log-integration.js';

export { BONKLM_PLUGIN_PRIORITY, VERIFIED_PUBLISHER_ALLOWLIST } from './types.js';

export type {
  ActionLike,
  BonklmPluginOptions,
  BonklmRuntimeNamespace,
  DoctorFinding,
  DoctorReport,
  IAgentRuntimeLike,
  MemoryLike,
  PluginLike,
  PluginLoadContext,
  ProviderLike,
  ProviderResultLike,
  SourceTrust
} from './types.js';

export { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
