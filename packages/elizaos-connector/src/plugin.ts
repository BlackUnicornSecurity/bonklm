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
import type { BonklmPluginOptions, IAgentRuntimeLike, MemoryLike, PluginLike, PluginLoadContext } from './types.js';
import { BONKLM_PLUGIN_PRIORITY } from './types.js';
import { assertCallContextRuntime } from './als-context.js';
import { installSealedWrapMemory } from './wrap-memory.js';
import { applyProbeOutcome, runStartupProbe } from './probe.js';
import { wrapSigningAction } from './tool-call-args-gate.js';
import { type ElizaMessageReceivedEvent, mapMessageReceivedToShadowLog } from './shadow-log-adapter.js';
import { warnAcknowledgeClass4RiskDeprecated } from './shadow-log-integration.js';

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

  // Safety tripwire (security audit, fetchImpl seam): `fetchImpl` is a testing /
  // refactor-safety seam for the Class-4 startup probe. If it is set in
  // production the probe talks to a custom transport instead of the system
  // `fetch`, and a buggy or copied-from-tests transport could silently report
  // "safe" and mask a real unauthenticated /memories route. Never silent —
  // mirror the prod-warning posture of `acknowledgeClass4Risk`. The seam itself
  // is preserved for legitimately constrained runtimes that opt in deliberately.
  if (productionMode && frozenOptions.fetchImpl !== undefined) {
    logger.warn(
      '[BonkLM] HIGH — `fetchImpl` is set while running in production: the Class-4 startup probe ' +
        'is using a custom transport instead of the system `fetch`, which can mask a real unauthenticated ' +
        '/memories route. Leave `fetchImpl` unset in production unless this is a deliberate, audited choice.'
    );
  }

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
          fetchImpl: frozenOptions.fetchImpl,
          logger
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

      // Story 2.4a Phase-2 step 4: shadow log auto-wire + acknowledge
      // deprecation warning.
      if (frozenOptions.shadowLog !== undefined) {
        // Emit the deprecation warning when both shadowLog AND
        // acknowledgeClass4Risk are set — the flag is no longer needed
        // once the structural defence is wired.
        if (frozenOptions.acknowledgeClass4Risk === true) {
          warnAcknowledgeClass4RiskDeprecated(logger);
        }
        // Subscribe to MESSAGE_RECEIVED so every inbound message
        // lands in the shadow log BEFORE any ElizaOS persistence
        // layer touches it. If the runtime doesn't expose `.on()`,
        // emit an INFO log so the operator knows the auto-wire was
        // a no-op and they need to manually invoke `shadowLog.append`
        // at their message-handler.
        if (typeof runtime.on === 'function') {
          const shadowLog = frozenOptions.shadowLog;
          // Iter-1 security BLOCK-Q2: default to 'unauthenticated_http'
          // so unclassified inbound messages do NOT enter the
          // corroboration set. Consumers supply a real classifier
          // to mark verified-session messages as 'authenticated'.
          const classifySourceTrust = frozenOptions.classifySourceTrust ?? (() => 'unauthenticated_http' as const);
          runtime.on('MESSAGE_RECEIVED', async (...handlerArgs: unknown[]) => {
            try {
              const event = handlerArgs[0] as Partial<ElizaMessageReceivedEvent> & {
                content?: { text?: string };
              };
              if (
                typeof event !== 'object' ||
                event === null ||
                typeof event.messageId !== 'string' ||
                typeof event.roomId !== 'string' ||
                typeof event.entityId !== 'string'
              ) {
                logger.warn('[BonkLM] MESSAGE_RECEIVED event missing required fields; skipping shadow log append', {
                  event
                });
                return;
              }
              const sourceTrust = await classifySourceTrust(runtime, event as MemoryLike);
              const input = mapMessageReceivedToShadowLog(event as ElizaMessageReceivedEvent, sourceTrust);
              await shadowLog.append(input);
            } catch (err) {
              const e = err as Error;
              logger.error('[BonkLM] CRITICAL — shadow log append failed in MESSAGE_RECEIVED handler', {
                error: e.message
              });
            }
          });
        } else {
          logger.info(
            '[BonkLM] runtime does not expose `on()` event API; shadow log auto-wire skipped. ' +
              'Consumers MUST manually invoke `shadowLog.append(...)` at their own message-handler hook BEFORE persistence.'
          );
        }
      } else if (frozenOptions.acknowledgeClass4Risk === true) {
        // No shadow log AND flag is set — accepted for backward compat
        // (acts the same as v0.4.x). Plugin continues without the
        // structural defence; operator has explicitly accepted the
        // Class-4 risk per the v0.4.x semantics.
        logger.warn(
          '[BonkLM] acknowledgeClass4Risk=true accepted (backward compat). Consider wiring a shadow log via `options.shadowLog` to close the Class-4 gap structurally; the flag is scheduled for removal in v0.6.'
        );
      } else if (frozenOptions.shadowLog === undefined && frozenOptions.runtimePort !== undefined) {
        // Iter-1 security A&D-Q7: operator configured `runtimePort`
        // (which means they intend to probe the runtime HTTP API for
        // Class-4 exposure) but DID NOT wire `options.shadowLog`. The
        // probe will detect the vulnerability but the validator will
        // fall back to `runtime.getMemories` — Class-4 attack surface
        // still wide open at validator-read time. WARN-LEVEL so the
        // operator sees the inconsistency.
        logger.warn(
          '[BonkLM] HIGH — `runtimePort` is configured (probe enabled) but `options.shadowLog` is NOT wired. ' +
            'The probe may detect Class-4 exposure but the validator will still read from `runtime.getMemories` ' +
            '— leaving the structural defence inactive. Wire a shadow log via `options.shadowLog` to close ' +
            'the Class-4 gap end-to-end.'
        );
      }

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
        shadowLogWired: frozenOptions.shadowLog !== undefined
      });
    }
  };
}
