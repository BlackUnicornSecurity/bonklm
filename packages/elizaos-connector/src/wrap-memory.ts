/**
 * Story 1.8 Construct B (Phase-2) — `runtime.bonklm.wrapMemory`
 * =============================================================
 *
 * Seals BOTH `runtime.createMemory` AND `runtime.updateMemory` via
 * `Object.defineProperty` with `writable: false, configurable: false`
 * so hostile plugins cannot unwrap or re-wrap. The TWO seals execute
 * in the SAME synchronous block (no `await` between) per iteration-2
 * architect BLOCK-2 race-resistance amendment — a hostile plugin
 * loading via `Promise.resolve().then()` cannot interleave between
 * the seal calls.
 *
 * Phase-2 changes vs Phase-1:
 *
 * - **AsyncLocalStorage migration** (iter-2 architect BLOCK-1 +
 *   adversarial #11): the wrapped closures read call context via
 *   `getCallContext()` from `als-context.ts` — NOT the Phase-1
 *   `runtime.bonklm.currentCallContext` direct property. Hostile
 *   plugins assigning into `runtime.bonklm.currentCallContext`
 *   become inert because the closure no longer consults that path.
 *
 * - **`updateMemory` seal** (iter-2 architect BLOCK-2): the same
 *   seal-and-validate pattern applied to `createMemory` is now
 *   applied to `updateMemory`. Closes the Construct B refuse-write
 *   gap for the update path.
 *
 * - **Levenshtein typo-squat check** (iter-2 plan): the
 *   verified-publisher allowlist exact-match is augmented with a
 *   distance ≤ 2 check via `detectTypoSquat()`. A memory write whose
 *   caller plugin is typo-squat-similar to an allowlisted name is
 *   REFUSED with a CRITICAL diagnostic.
 *
 * @package @blackunicorn/bonklm-elizaos
 */
import { createLogger, sanitizeLogString } from '@blackunicorn/bonklm';
import { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
import { getCallContext } from './als-context.js';
import type {
  BonklmPluginOptions,
  BonklmRuntimeNamespace,
  IAgentRuntimeLike,
  MemoryLike,
  SourceTrust,
} from './types.js';
import { VERIFIED_PUBLISHER_ALLOWLIST } from './types.js';
import { detectTypoSquat } from './typo-squat.js';

/**
 * Run all the publisher-allowlist + source-trust checks against a
 * pending memory write. Returns `void` on pass; throws
 * `ConnectorValidationError` on refuse.
 *
 * Used by BOTH the `createMemory` AND `updateMemory` wrapped closures
 * so the refuse-write semantics are identical across the two paths.
 */
function assertMemoryWriteAllowed(
  memory: MemoryLike,
  computedSource: SourceTrust,
  callerPluginName: string | undefined,
  logger: ReturnType<typeof createLogger>,
  productionMode: boolean,
  onRefused: ((reason: string) => void) | undefined,
  pathLabel: 'createMemory' | 'updateMemory'
): void {
  // Provider-source 'messages' writes require authenticated OR
  // agent_internal source.
  if (
    memory.tableName === 'messages' &&
    computedSource !== 'authenticated' &&
    computedSource !== 'agent_internal'
  ) {
    logger.warn(
      `[BonkLM] Refusing ${pathLabel} 'messages' write — non-authenticated source.`,
      { caller: callerPluginName, source: computedSource }
    );
    onRefused?.(
      productionMode
        ? 'memory_write_refused'
        : `${pathLabel} 'messages' write refused: source=${computedSource}`
    );
    throw new ConnectorValidationError(
      productionMode
        ? 'Memory write refused'
        : `Memory write refused: source=${computedSource}, tableName=messages, path=${pathLabel}`,
      'validation_failed'
    );
  }

  // Caller-plugin allowlist check (exact-match + typo-squat).
  if (memory.tableName === 'messages' && callerPluginName !== undefined) {
    const typoCheck = detectTypoSquat(callerPluginName, VERIFIED_PUBLISHER_ALLOWLIST);
    if (typoCheck.exactMatch) {
      // Trusted publisher — pass.
    } else if (typoCheck.nearestTypoSquat !== undefined) {
      // Typo-squat — REFUSE with CRITICAL diagnostic. Phase-2
      // adds this layer atop the Phase-1 not-in-allowlist refuse.
      // Sprint 40 connector CWE-117 sweep: `callerPluginName` arrives
      // from the ElizaOS runtime's plugin registry; a hostile plugin
      // can register with a name containing control chars to inject
      // log lines via this CRITICAL diagnostic. Build the message
      // with sanitized fragments — `target` and `pathLabel` are
      // library-controlled but defensive sanitization is cheap.
      const safeCallerName = sanitizeLogString(String(callerPluginName ?? ''));
      const safeTarget = sanitizeLogString(String(typoCheck.nearestTypoSquat.target ?? ''));
      const safePathLabel = sanitizeLogString(String(pathLabel ?? ''));
      const typoMsg =
        `Caller plugin "${safeCallerName}" is distance-${typoCheck.nearestTypoSquat.distance} ` +
        `from verified publisher "${safeTarget}" — likely typo-squat impersonation. ` +
        `Refusing ${safePathLabel} 'messages' write.`;
      logger.error(`[BonkLM] CRITICAL — ${typoMsg}`);
      onRefused?.(
        productionMode ? 'memory_write_refused_typo_squat' : typoMsg
      );
      throw new ConnectorValidationError(
        productionMode
          ? 'Memory write refused'
          : typoMsg,
        'validation_failed'
      );
    } else {
      // Unknown publisher — refuse with informational diagnostic
      // (Phase-1 behaviour preserved).
      logger.warn(
        `[BonkLM] Refusing ${pathLabel} 'messages' write — caller plugin not in verified-publisher allowlist.`,
        { caller: callerPluginName }
      );
      onRefused?.(
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
  }
}

/**
 * Build the wrapped function body that both `createMemory` and
 * `updateMemory` share. The two seals install DIFFERENT closures
 * (each calls a different `original` function) but the validation
 * logic is identical.
 */
function buildWrappedMemoryFn(
  original: (memory: MemoryLike, ...rest: unknown[]) => Promise<unknown> | unknown,
  runtime: IAgentRuntimeLike,
  options: BonklmPluginOptions,
  pathLabel: 'createMemory' | 'updateMemory'
): (this: unknown, memory: MemoryLike, ...rest: unknown[]) => Promise<unknown> {
  const logger = options.logger ?? createLogger('console');
  const productionMode = options.productionMode ?? process.env.NODE_ENV === 'production';
  return async function bonklmWrappedMemoryFn(
    this: unknown,
    memory: MemoryLike,
    ...rest: unknown[]
  ): Promise<unknown> {
    // Phase-2: read call context from ALS (NOT runtime.bonklm).
    const ctx = getCallContext();
    const computedSource: SourceTrust = ctx?.sourceTrust ?? 'agent_internal';
    const callerPluginName = ctx?.pluginName;

    // Allowlist + typo-squat + source-trust checks (shared between
    // the two paths).
    assertMemoryWriteAllowed(
      memory,
      computedSource,
      callerPluginName,
      logger,
      productionMode,
      options.onMemoryWriteRefused,
      pathLabel
    );

    // Stamp closure-controlled trust marker so the recipient gate can
    // distinguish memories that flowed through THIS wrap from legacy
    // memories where `source: 'authenticated'` was set by a previous
    // plugin for unrelated semantic reasons.
    const sealed: MemoryLike = {
      ...memory,
      source: computedSource,
      metadata: {
        ...(memory.metadata ?? {}),
        bonklmTrust: true,
      },
    };
    return (
      original as (m: MemoryLike, ...r: unknown[]) => Promise<unknown>
    ).call(runtime, sealed, ...rest);
  };
}

/**
 * Seal `runtime.createMemory` AND `runtime.updateMemory` in the SAME
 * SYNCHRONOUS BLOCK. Both seals install BEFORE this function returns;
 * no `await` is permitted between them (iter-2 architect BLOCK-2
 * race-resistance amendment).
 *
 * Throws when:
 * - `runtime.createMemory` or `runtime.updateMemory` is already
 *   non-configurable (someone got there first — CRITICAL).
 * - The runtime is missing required surfaces.
 *
 * After this returns: hostile plugins cannot redefine either path.
 * Hostile plugins assigning into `runtime.bonklm.currentCallContext`
 * are no-ops because the wrapped closures consult ALS, not that
 * property.
 *
 * @returns `void` on success.
 */
export function installSealedWrapMemory(
  runtime: IAgentRuntimeLike,
  options: BonklmPluginOptions
): void {
  const logger = options.logger ?? createLogger('console');
  const productionMode = options.productionMode ?? process.env.NODE_ENV === 'production';
  const originalCreate = runtime.createMemory;
  const originalUpdate = (
    runtime as IAgentRuntimeLike & {
      updateMemory?: (memory: MemoryLike, ...rest: unknown[]) => Promise<unknown> | unknown;
    }
  ).updateMemory;

  if (typeof originalCreate !== 'function') {
    throw new ConnectorValidationError(
      productionMode
        ? 'Runtime missing createMemory'
        : 'Runtime is missing createMemory — refusing to install BonkLM wrapMemory.',
      'invalid_runtime'
    );
  }

  // Check pre-existing seals on BOTH methods before installing
  // either, so we either succeed for both or throw cleanly without
  // leaving a partial install.
  const createDescriptor = Object.getOwnPropertyDescriptor(runtime, 'createMemory');
  if (createDescriptor && createDescriptor.configurable === false) {
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
  if (typeof originalUpdate === 'function') {
    const updateDescriptor = Object.getOwnPropertyDescriptor(runtime, 'updateMemory');
    if (updateDescriptor && updateDescriptor.configurable === false) {
      logger.error(
        '[BonkLM] CRITICAL — runtime.updateMemory is already sealed (another plugin wrapped it first).'
      );
      throw new ConnectorValidationError(
        productionMode
          ? 'Runtime already wrapped'
          : 'runtime.updateMemory is already sealed by another plugin.',
        'invalid_runtime'
      );
    }
  }

  // Seal the `runtime.bonklm` namespace slot (Phase-1 behaviour
  // preserved). Phase-2 leaves the namespace object empty — there
  // is no more `currentCallContext` property to write; ALS is the
  // sole source of call-context now.
  const existingBonklm = runtime.bonklm;
  const sealedBonklm: BonklmRuntimeNamespace = existingBonklm ?? {};
  const bonklmDescriptor = Object.getOwnPropertyDescriptor(runtime, 'bonklm');
  if (bonklmDescriptor && bonklmDescriptor.configurable === false) {
    logger.error(
      '[BonkLM] CRITICAL — runtime.bonklm is already sealed (another plugin claimed the namespace first).'
    );
    throw new ConnectorValidationError(
      productionMode
        ? 'Runtime bonklm namespace already sealed'
        : 'runtime.bonklm is already sealed by another plugin.',
      'invalid_runtime'
    );
  }

  // ===== SYNCHRONOUS SEAL BLOCK BEGIN =====
  // No `await` between the lines below — Promise.resolve().then() race
  // attackers cannot interleave between defineProperty calls.
  //
  // Iter-1 architect BLOCK-2: wrapped in try/catch because
  // `Object.defineProperty` can throw on frozen objects, Proxy
  // revocation, or DOM-bound runtime objects. A partial install
  // (`bonklm` sealed, `createMemory` unsealed) is worse than no
  // install — the runtime would be defenceless but visibly "wrapped"
  // to consumers. Rollback is structurally impossible once `bonklm`
  // is sealed (`configurable: false`); the only safe response is to
  // throw loudly so `init()` fails loud rather than silent-half-installed.
  //
  // Iter-1 security BLOCK-8: freeze the `bonklm` namespace OBJECT (not
  // just the slot) so a hostile plugin cannot write
  // `runtime.bonklm.foo = ...` even on the empty namespace. The slot
  // value reference is non-configurable + non-writable, AND the
  // object itself is frozen.
  Object.freeze(sealedBonklm);

  try {
    Object.defineProperty(runtime, 'bonklm', {
      value: sealedBonklm,
      writable: false,
      configurable: false,
      enumerable: true,
    });

    const wrappedCreate = buildWrappedMemoryFn(
      originalCreate,
      runtime,
      options,
      'createMemory'
    );
    Object.defineProperty(runtime, 'createMemory', {
      value: wrappedCreate,
      writable: false,
      configurable: false,
      enumerable: true,
    });

    if (typeof originalUpdate === 'function') {
      const wrappedUpdate = buildWrappedMemoryFn(
        originalUpdate,
        runtime,
        options,
        'updateMemory'
      );
      Object.defineProperty(runtime, 'updateMemory', {
        value: wrappedUpdate,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    }
  } catch (err) {
    // Partial install — `bonklm` may already be sealed but
    // `createMemory` is not. Rollback is impossible. Log CRITICAL +
    // re-throw so `bonklmPlugin.init()` fails loud.
    const e = err as Error;
    logger.error(
      '[BonkLM] CRITICAL — installSealedWrapMemory threw partway through the sync seal block. ' +
        'Runtime is in an UNDEFINED state (some properties may be sealed, others not). ' +
        'init() failing loud per partial-install policy.',
      { error: e.message }
    );
    throw new ConnectorValidationError(
      productionMode
        ? 'Runtime wrap failed partway through install'
        : `installSealedWrapMemory failed mid-block: ${e.message}. Rollback is structurally impossible because runtime.bonklm may already be sealed. Engine must be reconstructed.`,
      'invalid_runtime'
    );
  }

  // ===== SYNCHRONOUS SEAL BLOCK END =====

  logger.info('[BonkLM] wrapMemory installed (sealed)', {
    sealedCreateMemory: true,
    sealedUpdateMemory: typeof originalUpdate === 'function',
  });
}

/**
 * Backwards-compat re-export. Story 1.8 Phase-1 callers used
 * `withCallContext(runtime, ctx, fn)` from this file; the
 * implementation moved to `als-context.ts` in Phase-2. We re-export
 * the new ALS-based implementation under the legacy import path so
 * existing callers continue to work unchanged.
 */
export { withCallContext, getCallContext } from './als-context.js';
