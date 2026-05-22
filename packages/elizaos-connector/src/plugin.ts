/**
 * Story 1.8 / 2.1b-connectors — ElizaOS Plugin entry point
 * ========================================================
 *
 * `bonklmPlugin(options)` returns an ElizaOS `Plugin` object the
 * consumer registers via the standard plugin-load API. On `init`:
 *   1. `assertCallContextRuntime()` — engine-construction-time canary
 *      against absent / poisoned `AsyncLocalStorage`.
 *   2. `runStartupProbe(...)` — awaited probe of the local runtime
 *      HTTP API for Class-4 unauth /memories exposure (Phase-2).
 *   3. `installSealedWrapMemory(...)` — seals BOTH `createMemory`
 *      AND `updateMemory` in the same synchronous block (Phase-2).
 *   4. `wrapSigningAction(...)` — wraps every web3-signing action's
 *      `handler` with ToolCallArgsValidator + two-condition gate.
 *
 * Priority `1000` — the documented maximum a non-core plugin can claim
 * — so BonkLM runs FIRST among plugins per ElizaOS load-order
 * semantics (no other plugin can install a competing
 * `createMemory` / `updateMemory` wrap before BonkLM's seals).
 *
 * **Probe-await semantics (iter-2 architect BLOCK-2)**: `init()`
 * AWAITS the probe to completion before returning. Fire-and-forget
 * dispatch (`runStartupProbe(opts).catch(...)`) is PROHIBITED —
 * otherwise a Phase-2 plugin slot can load during the network wait
 * and execute against a partially-validated runtime.
 *
 * @package @blackunicorn/bonklm-elizaos
 */
import { createLogger } from '@blackunicorn/bonklm';
import { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
import type {
  BonklmPluginOptions,
  IAgentRuntimeLike,
  PluginLike,
  PluginLoadContext,
} from './types.js';
import { BONKLM_PLUGIN_PRIORITY } from './types.js';
import { assertCallContextRuntime } from './als-context.js';
import { installSealedWrapMemory } from './wrap-memory.js';
import { applyProbeOutcome, runStartupProbe } from './probe.js';
import { wrapSigningAction } from './tool-call-args-gate.js';

/**
 * Default action-name regex matching every web3-signing action the
 * connector wraps. See `BonklmPluginOptions.signingActionRegex` for
 * the documented list of verbs + chains.
 */
const DEFAULT_SIGNING_ACTION_REGEX =
  /^(?:TRANSFER|SEND|SWAP|PAY|BORROW|MINT|APPROVE)_(?:.*_)?(?:SOL|SOLANA|EVM|ETHEREUM|TOKEN|HYPERLIQUID|AAVE)\b/i;

export function bonklmPlugin(options: BonklmPluginOptions = {}): PluginLike {
  // Iter-1 security A&D-7: freeze the options object so a hostile
  // plugin loading after BonkLM cannot mutate `options.acknowledgeClass4Risk`
  // (or any other field) via a shared object reference. Defence-in-depth;
  // the realistic threat requires consumer-level error (passing the
  // same object reference to two plugins).
  const frozenOptions = Object.freeze({ ...options });
  const logger = frozenOptions.logger ?? createLogger('console');
  const regex = frozenOptions.signingActionRegex ?? DEFAULT_SIGNING_ACTION_REGEX;
  const productionMode = frozenOptions.productionMode ?? process.env.NODE_ENV === 'production';

  return {
    name: '@blackunicorn/bonklm-elizaos',
    description:
      'BonkLM guardrails for ElizaOS: sealed wrapMemory + wrapUpdateMemory + ToolCallArgsValidator + startup probe.',
    priority: BONKLM_PLUGIN_PRIORITY,
    async init(context: PluginLoadContext): Promise<void> {
      const runtime: IAgentRuntimeLike = context.runtime;

      // Phase-2 step 1: assert ALS is functional BEFORE installing
      // any seal. The seal closures read ALS via `getCallContext()`;
      // a broken ALS would silently install a defenceless wrap.
      try {
        assertCallContextRuntime();
      } catch (err) {
        const e = err as Error;
        throw new ConnectorValidationError(
          productionMode
            ? 'AsyncLocalStorage runtime invalid'
            : `BonkLM elizaos plugin refusing to start: ${e.message}`,
          'configuration_error'
        );
      }

      // Phase-2 step 2: startup probe of the local runtime HTTP API.
      // Only fires when both `agentId` and a runtime-HTTP-port
      // configuration are available. Production engines MUST configure
      // the port via options.runtimePort; if absent we skip the probe
      // and INFO-log so operators can wire it in.
      if (frozenOptions.runtimePort !== undefined && runtime.agentId !== undefined) {
        const outcome = await runStartupProbe({
          agentId: runtime.agentId,
          port: frozenOptions.runtimePort,
          acknowledgeClass4Risk: frozenOptions.acknowledgeClass4Risk === true,
          envBindings: frozenOptions.envBindings,
          logger,
        });
        // ConnectorValidationError from applyProbeOutcome (branch 1)
        // propagates up through `init()` per probe-await semantics.
        applyProbeOutcome(outcome, { logger, productionMode });
      } else {
        logger.info(
          '[BonkLM] startup probe skipped — runtimePort or agentId absent. Pass options.runtimePort + ensure runtime.agentId is set to enable the Class-4 probe.'
        );
      }

      // Phase-2 step 3: seal BOTH createMemory + updateMemory in the
      // same synchronous block. Race-resistance test asserts an
      // attacker plugin via Promise.resolve().then() cannot interleave.
      installSealedWrapMemory(runtime, frozenOptions);

      // Construct C — wrap every web3-signing action's handler.
      const actions = runtime.actions ?? [];
      let wrappedCount = 0;
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        if (!action.name || !regex.test(action.name)) continue;
        actions[i] = wrapSigningAction(action, runtime, frozenOptions);
        wrappedCount++;
      }
      logger.info('[BonkLM] elizaos plugin initialised', {
        wrappedSigningActions: wrappedCount,
        priority: BONKLM_PLUGIN_PRIORITY,
        probeRan: frozenOptions.runtimePort !== undefined,
        acknowledgedClass4Risk: frozenOptions.acknowledgeClass4Risk === true,
      });
    },
  };
}
