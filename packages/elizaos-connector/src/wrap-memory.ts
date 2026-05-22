/**
 * Story 1.8 Construct B — `runtime.bonklm.wrapMemory`
 * ===================================================
 *
 * Seals `runtime.createMemory` via `Object.defineProperty` with
 * `writable: false, configurable: false` so hostile plugins cannot
 * unwrap or re-wrap. Computes the `source` field from
 * closure-captured `runtime.bonklm.currentCallContext` (set at call
 * sites by trusted code) — Providers cannot pass `source` via
 * arguments because the wrapper IGNORES caller-supplied `source` and
 * recomputes from closure.
 *
 * Refuses Provider-source writes of `type='messages'` unless the
 * caller plugin's name passes the verified-publisher allowlist
 * exact-match check.
 *
 * Phase-1 ships exact-match allowlist; the Levenshtein-distance ≤ 2
 * typo-squat layer (audit-loop BC6) defers to Phase-2 alongside the
 * frozen-by-SHA load.
 *
 * @package @blackunicorn/bonklm-elizaos
 */
import { createLogger } from '@blackunicorn/bonklm';
import { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
import type {
  BonklmPluginOptions,
  BonklmRuntimeNamespace,
  IAgentRuntimeLike,
  MemoryLike,
  SourceTrust,
} from './types.js';
import { VERIFIED_PUBLISHER_ALLOWLIST } from './types.js';

/**
 * Wrap `runtime.createMemory` IN PLACE via sealed `Object.defineProperty`.
 *
 * Throws when:
 * - `runtime.createMemory` is already non-configurable (someone got
 *   there first — CRITICAL per audit-loop BC3 RT6).
 * - The runtime is missing required surfaces.
 *
 * @returns `void` on success. The runtime's `createMemory` is now
 *   the wrapped version; the wrap is non-removable.
 */
export function installSealedWrapMemory(
  runtime: IAgentRuntimeLike,
  options: BonklmPluginOptions
): void {
  const logger = options.logger ?? createLogger('console');
  const productionMode = options.productionMode ?? process.env.NODE_ENV === 'production';
  const original = runtime.createMemory;

  if (typeof original !== 'function') {
    throw new ConnectorValidationError(
      productionMode
        ? 'Runtime missing createMemory'
        : 'Runtime is missing createMemory — refusing to install BonkLM wrapMemory.',
      'invalid_runtime'
    );
  }

  // Audit-loop BC3 / RT6: if `createMemory` is already sealed (someone
  // else got there first), refuse to start. Two competing wraps would
  // produce a wrap-the-wrap situation where the source-spoof defence
  // is bypassed via the inner unwrap.
  const descriptor = Object.getOwnPropertyDescriptor(runtime, 'createMemory');
  if (descriptor && descriptor.configurable === false) {
    logger.error(
      '[BonkLM] CRITICAL — runtime.createMemory is already sealed (another plugin wrapped it first).'
    );
    throw new ConnectorValidationError(
      productionMode
        ? 'Runtime already wrapped'
        : 'runtime.createMemory is already sealed by another plugin. Refusing to install BonkLM wrapMemory — investigate the other wrap before retrying.',
      'invalid_runtime'
    );
  }

  // Audit-loop CRITICAL fix #1 (adversarial): the `runtime.bonklm`
  // namespace MUST be sealed too. Without this, a hostile plugin
  // loading after BonkLM can directly write:
  //   `runtime.bonklm.currentCallContext = { sourceTrust: 'authenticated',
  //    pluginName: '@elizaos/plugin-solana' }`
  // bypassing the entire closure-captured trust model. Seal the
  // namespace slot (the slot itself is non-configurable so the
  // pointer can't be replaced) while leaving the inner properties
  // mutable for legitimate `withCallContext` reads/writes.
  const existingBonklm = runtime.bonklm;
  const sealedBonklm: BonklmRuntimeNamespace = existingBonklm ?? {};
  const bonklmDescriptor = Object.getOwnPropertyDescriptor(runtime, 'bonklm');
  if (bonklmDescriptor && bonklmDescriptor.configurable === false) {
    // Same defence as for createMemory — a pre-sealed namespace means
    // another plugin got here first.
    logger.error(
      '[BonkLM] CRITICAL — runtime.bonklm is already sealed (another plugin claimed the namespace first).'
    );
    throw new ConnectorValidationError(
      productionMode
        ? 'Runtime bonklm namespace already sealed'
        : 'runtime.bonklm is already sealed by another plugin. Refusing to install BonkLM — investigate the other wrap before retrying.',
      'invalid_runtime'
    );
  }
  Object.defineProperty(runtime, 'bonklm', {
    value: sealedBonklm,
    writable: false,
    configurable: false,
    enumerable: true,
  });

  const wrapped = async function bonklmWrappedCreateMemory(
    this: unknown,
    memory: MemoryLike,
    ...rest: unknown[]
  ): Promise<unknown> {
    // Recompute the `source` field from closure-captured call context.
    // Providers writing `memory.source` directly are IGNORED — the
    // closure-captured trust value is the authoritative source.
    const ctx = runtime.bonklm?.currentCallContext;
    const computedSource: SourceTrust = ctx?.sourceTrust ?? 'agent_internal';
    const callerPluginName = ctx?.pluginName;

    // Provider-source 'messages' writes require verified-publisher
    // allowlist exact-match per audit-loop BC6.
    if (
      memory.tableName === 'messages' &&
      computedSource !== 'authenticated' &&
      computedSource !== 'agent_internal'
    ) {
      logger.warn(
        '[BonkLM] Refusing Provider-source messages write — non-authenticated source.',
        { caller: callerPluginName, source: computedSource }
      );
      options.onMemoryWriteRefused?.(
        productionMode
          ? 'memory_write_refused'
          : `Provider-source messages write refused: source=${computedSource}`
      );
      throw new ConnectorValidationError(
        productionMode
          ? 'Memory write refused'
          : `Memory write refused: source=${computedSource}, tableName=messages`,
        'validation_failed'
      );
    }
    if (
      memory.tableName === 'messages' &&
      callerPluginName !== undefined &&
      !VERIFIED_PUBLISHER_ALLOWLIST.includes(callerPluginName)
    ) {
      logger.warn(
        '[BonkLM] Refusing messages write — caller plugin not in verified-publisher allowlist.',
        { caller: callerPluginName }
      );
      options.onMemoryWriteRefused?.(
        productionMode
          ? 'memory_write_refused'
          : `Memory write refused: ${callerPluginName} not in verified-publisher allowlist`
      );
      throw new ConnectorValidationError(
        productionMode
          ? 'Memory write refused'
          : `Memory write refused: ${callerPluginName} not in verified-publisher allowlist`,
        'validation_failed'
      );
    }

    // Audit-loop BLOCK #5: stamp a closure-controlled
    // `metadata.bonklmTrust = true` marker so the recipient gate can
    // distinguish memories that flowed through THIS wrap from legacy
    // memories where `source: 'authenticated'` was set by a previous
    // plugin for unrelated semantic reasons. Providers cannot supply
    // this marker — we always overwrite it.
    const sealed: MemoryLike = {
      ...memory,
      source: computedSource,
      metadata: {
        ...(memory.metadata ?? {}),
        bonklmTrust: true,
      },
    };
    // Defer to the original implementation with the source overwritten.
    // `original` is the closure-captured non-wrapped function.
    return (original as (m: MemoryLike, ...r: unknown[]) => Promise<unknown>).call(
      runtime,
      sealed,
      ...rest
    );
  };

  // Seal the property so a hostile plugin cannot redefine it.
  Object.defineProperty(runtime, 'createMemory', {
    value: wrapped,
    writable: false,
    configurable: false,
    enumerable: true,
  });

  logger.info('[BonkLM] wrapMemory installed (sealed).');
}

/**
 * Temporarily set the per-call source-trust context for a synchronous
 * or async operation that calls `runtime.createMemory`. The wrapper
 * reads this context inside its closure; consumers MUST use this
 * helper rather than passing `source` via arguments.
 *
 * @example
 * ```ts
 * await withCallContext(runtime, { sourceTrust: 'authenticated' }, async () => {
 *   await runtime.createMemory({ tableName: 'messages', content: { text } });
 * });
 * ```
 */
export async function withCallContext<T>(
  runtime: IAgentRuntimeLike,
  context: { sourceTrust: SourceTrust; pluginName?: string },
  fn: () => Promise<T> | T
): Promise<T> {
  if (!runtime.bonklm) runtime.bonklm = {} as BonklmRuntimeNamespace;
  const previous = runtime.bonklm.currentCallContext;
  runtime.bonklm.currentCallContext = context;
  try {
    return await fn();
  } finally {
    runtime.bonklm.currentCallContext = previous;
  }
}
