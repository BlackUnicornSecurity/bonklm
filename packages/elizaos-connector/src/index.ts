/**
 * @blackunicorn/bonklm-elizaos
 * ===========================
 * ElizaOS connector for BonkLM — Phase-1 of Story 1.8.
 *
 * Public surface:
 *  - `bonklmPlugin(options)` — ElizaOS `Plugin` (priority 1000) that
 *    seals `runtime.createMemory`, wraps every web3-signing action's
 *    handler with `ToolCallArgsValidator` + the two-condition recipient
 *    gate, and exposes `runtime.bonklm.withCallContext` for trusted
 *    call sites.
 *  - `runDoctor(...)` and friends — `bonklm doctor` core for static
 *    deployment audit.
 *  - `installSealedWrapMemory(runtime, options)` — low-level entry
 *    point for callers wiring Construct B without the full plugin.
 *  - `withCallContext(runtime, ctx, fn)` — closure-captured source-trust
 *    context helper.
 *
 * Phase-2 / Story 2.4a (v0.5.0) backlog (NOT in Phase-1):
 *  - Construct A shadow-log read replacing the user-authored-memory
 *    bucket (closes the Class-4 PATCH-route attack window).
 *  - Runtime HTTP probe in `bonklm doctor --runtime`.
 *  - Startup-time HTTP probe in `bonklmPlugin.init()`.
 *  - Levenshtein-distance ≤ 2 typo-squat detection.
 *  - RT5 + RT6 regression-test infrastructure (need a runnable
 *    `elizaos start` harness).
 *  - 30-day-post-v0.5.0 EOL flag in `package.json.deprecated`.
 *  - Coordinated-disclosure pipeline gate.
 */
export {
  installSealedWrapMemory,
  withCallContext,
} from './wrap-memory.js';

export {
  evaluateRecipientGate,
  wrapSigningAction,
} from './tool-call-args-gate.js';

export {
  auditCharacterFile,
  auditPlugins,
  buildReport,
  runDoctor,
} from './doctor.js';

export { bonklmPlugin } from './plugin.js';

export {
  BONKLM_PLUGIN_PRIORITY,
  VERIFIED_PUBLISHER_ALLOWLIST,
} from './types.js';

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
  SourceTrust,
} from './types.js';

export { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
