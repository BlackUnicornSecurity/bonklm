/**
 * Story 1.8 — ElizaOS Plugin entry point
 * ======================================
 *
 * `bonklmPlugin(options)` returns an ElizaOS `Plugin` object the
 * consumer registers via the standard plugin-load API. On `init`:
 *   1. Installs the sealed `runtime.createMemory` wrap (Construct B).
 *   2. Iterates `runtime.actions`, identifies web3-signing actions by
 *      regex, and replaces each `handler` with the ToolCallArgsValidator
 *      + two-condition recipient gate wrap (Construct C).
 *
 * Priority `1000` — the documented maximum a non-core plugin can claim
 * — so BonkLM runs FIRST among plugins per ElizaOS load-order
 * semantics. Required for Construct B's tamper-resistance (audit-loop
 * BC3): no other plugin should have a chance to install a competing
 * `createMemory` wrap before BonkLM's seal.
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
import { installSealedWrapMemory } from './wrap-memory.js';
import { wrapSigningAction } from './tool-call-args-gate.js';

/**
 * Default action-name regex matching every web3-signing action the
 * connector wraps. See `BonklmPluginOptions.signingActionRegex` for
 * the documented list of verbs + chains.
 */
const DEFAULT_SIGNING_ACTION_REGEX =
  /^(?:TRANSFER|SEND|SWAP|PAY|BORROW|MINT|APPROVE)_(?:.*_)?(?:SOL|SOLANA|EVM|ETHEREUM|TOKEN|HYPERLIQUID|AAVE)\b/i;

export function bonklmPlugin(options: BonklmPluginOptions = {}): PluginLike {
  const logger = options.logger ?? createLogger('console');
  const regex = options.signingActionRegex ?? DEFAULT_SIGNING_ACTION_REGEX;

  return {
    name: '@blackunicorn/bonklm-elizaos',
    description:
      'BonkLM guardrails for ElizaOS: sealed wrapMemory + ToolCallArgsValidator integration.',
    priority: BONKLM_PLUGIN_PRIORITY,
    async init(context: PluginLoadContext): Promise<void> {
      const runtime: IAgentRuntimeLike = context.runtime;

      // Audit-loop BLOCK #12: `acknowledgeClass4Risk` is a Phase-2
      // option (HTTP startup probe + acknowledgement path). Phase-1
      // does not implement the probe; a user setting this to `true`
      // would have a false sense of coverage. Throw to force a revisit
      // when Phase-2 ships rather than silently accept the flag.
      if (options.acknowledgeClass4Risk === true) {
        throw new ConnectorValidationError(
          '`acknowledgeClass4Risk: true` is not yet active. Phase-2 (Story 2.4a, v0.5.0) ships the HTTP startup probe + acknowledgement path. Remove this option until then.',
          'configuration_error'
        );
      }

      // Construct B — seal wrapMemory before anything else can touch it.
      installSealedWrapMemory(runtime, options);

      // Construct C — wrap every web3-signing action's handler.
      const actions = runtime.actions ?? [];
      let wrappedCount = 0;
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        if (!action.name || !regex.test(action.name)) continue;
        actions[i] = wrapSigningAction(action, runtime, options);
        wrappedCount++;
      }
      logger.info('[BonkLM] elizaos plugin initialised', {
        wrappedSigningActions: wrappedCount,
        priority: BONKLM_PLUGIN_PRIORITY,
      });
    },
  };
}
