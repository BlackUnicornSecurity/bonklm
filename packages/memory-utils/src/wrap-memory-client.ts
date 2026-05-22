/**
 * Story 2.5 — `wrapMemoryClient(client, options)`
 * ================================================
 *
 * Canonical generic factory for memory-vendor connectors. Per-vendor
 * convenience wrappers (`wrapMem0Client`, `wrapZepClient`,
 * `wrapLettaClient`) inject the adapter and forward the consumer's
 * options.
 *
 * Routing model:
 *   1. Consumer calls `client.add(args)` → Proxy `get` returns wrapped fn.
 *   2. Wrapped fn calls `adapter.route({ method: 'add', args, ctx })`.
 *   3. If `surface === 'memory_write'`: runs MemoryWriteValidator on
 *      `writeContent`; throws ConnectorValidationError on block.
 *   4. If `surface === 'composed_context'`: runs underlying method
 *      FIRST (to get the recall result), then calls
 *      `adapter.validateResult(...)` which walks the result + fires
 *      ComposedContextValidator on the recalled text. POST-call
 *      validation per iter-4 security A&D — recall paths validate
 *      what's RETURNED, not what's INVOKED.
 *   5. If `surface === null`: pass-through.
 *
 * Edge-native — uses ALS-managed ambient context via the engine, no
 * Node-only imports.
 *
 * @package @blackunicorn/bonklm-memory-utils
 */
import {
  assertAsyncLocalStorageHealthy,
  createComposedContextValidator,
  createMemoryWriteValidator,
  createLogger,
  type GuardrailEngine,
  type Logger,
  type Validator,
} from '@blackunicorn/bonklm';
import { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
import type {
  AdapterInvocation,
  GetTenantId,
  MemoryAdapter,
  MemorySessionContext,
  WrapMemoryClientFullOptions,
  WrapMemoryClientOptions,
} from './types.js';

/**
 * The literal sentinel value tested by `assertGetTenantIdIsCallback`.
 * Adversarial #4: a hostile consumer passing `tenantId: 'fixed-string'`
 * would scope ALL writes to a single tenant. The connector REFUSES
 * construction when `getTenantId` is not callable.
 */
function assertGetTenantIdIsCallback(getTenantId: unknown): asserts getTenantId is GetTenantId {
  if (typeof getTenantId !== 'function') {
    throw new ConnectorValidationError(
      `wrapMemoryClient: \`getTenantId\` must be a function (ctx) => string, not ${typeof getTenantId}. ` +
        `Passing a literal string would scope every memory write to a single tenant — a multi-tenant ` +
        `deployment must thread the per-call session context through a callback.`,
      'configuration_error'
    );
  }
}

/**
 * Generic memory-client wrapper. Per-vendor connectors (mem0 / zep /
 * letta) call this directly with their adapter.
 *
 * @example
 * ```ts
 * // From mem0-connector:
 * export function wrapMem0Client(client, engine, options) {
 *   return wrapMemoryClient(client, {
 *     ...options,
 *     adapter: mem0Adapter,
 *     engine,
 *   });
 * }
 * ```
 */
export function wrapMemoryClient<TClient extends object>(
  client: TClient,
  options: WrapMemoryClientFullOptions<TClient>
): TClient {
  // Adversarial #4 guard at the GENERIC factory: per-vendor
  // wrappers can also bypass-check, but enforcing here means a
  // direct `wrapMemoryClient` consumer still gets the same defence.
  assertGetTenantIdIsCallback(options.getTenantId);

  // Cumulative-audit security BLOCK #5: assert AsyncLocalStorage is
  // healthy at construction. The memory connectors don't directly
  // use ALS, but the engine's call-context propagation (Story 2.1b)
  // depends on it. We guard the canary so it only runs on edge
  // runtimes that expose `globalThis.AsyncLocalStorage` — Node consumers
  // import ALS via `node:async_hooks` directly and should call the
  // canary at engine construction instead (per Story 2.1b ADR).
  // The guard prevents this construction-time check from FAILING the
  // Node path (where globalThis.AsyncLocalStorage is undefined).
  if (typeof (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage !== 'undefined') {
    try {
      assertAsyncLocalStorageHealthy();
    } catch (err) {
      // Surface the canary failure with a memory-utils-named stack
      // so consumers know which wrapper triggered the check.
      const e = err as Error;
      throw new ConnectorValidationError(
        `wrapMemoryClient: AsyncLocalStorage health check failed at construction — ${e.message}`,
        'configuration_error'
      );
    }
  }

  // Freeze options — iter-2 security A&D: hostile shared-options-ref
  // cannot mutate `getTenantId` or callbacks after construction.
  const frozenOptions = Object.freeze({ ...options });
  const logger: Logger = frozenOptions.logger ?? createLogger('console');
  const adapter: MemoryAdapter = frozenOptions.adapter;
  const engine: GuardrailEngine = frozenOptions.engine;
  const getSessionContext = frozenOptions.getSessionContext ?? (() => undefined);

  // Resolve the validator chain ONCE at wrap time. Per the
  // connector-style ADR Mem0 worked example: caller MUST pass their
  // validators explicitly — `GuardrailEngine` does NOT expose its
  // configured validators as a public field. Empty array is rejected
  // (iter-2 adversarial B1 fail-OPEN).
  const validators: Validator[] = frozenOptions.validators ?? [];
  if (validators.length === 0) {
    throw new ConnectorValidationError(
      `wrapMemoryClient: \`options.validators\` is required and must be non-empty. ` +
        `Passing an empty array would silently fail-OPEN. Pass the same validator chain ` +
        `you used to construct the engine — typically the engine config's \`validators\` list.`,
      'configuration_error'
    );
  }

  // Build the two composite validators ONCE.
  const memoryWriteValidator = createMemoryWriteValidator({ validators });
  const composedContextValidator = createComposedContextValidator({ validators });
  // `engine` is held only for telemetry surfaces in future work;
  // current routing path uses the composite validators directly.
  void engine;

  // The proxy MUST preserve the underlying SDK's prototype chain so
  // `instanceof` keeps working at call sites (e.g. `mem0Client instanceof Memory`).
  // We default to `Object.getPrototypeOf(client)` and let the consumer
  // override via options.prototype if needed.

  return new Proxy(client, {
    get(target, propKey, receiver): unknown {
      // Symbol keys + non-string method names pass through unchanged.
      if (typeof propKey !== 'string') {
        return Reflect.get(target, propKey, receiver);
      }

      // Methods NOT in the adapter's set pass through unchanged.
      // Includes property getters (returning non-function values).
      const original = Reflect.get(target, propKey, receiver);
      if (!adapter.methods.has(propKey) || typeof original !== 'function') {
        return original;
      }

      // Wrapped method — return an async function that routes through
      // the adapter on every invocation.
      return async function bonklmWrappedMemoryMethod(
        this: unknown,
        ...args: unknown[]
      ): Promise<unknown> {
        const ctx: MemorySessionContext = getSessionContext();

        const invocation: AdapterInvocation = {
          method: propKey,
          args,
          ctx,
        };

        let route;
        try {
          route = adapter.route(invocation);
        } catch (err) {
          // Adapter routing threw — surface as configuration error
          // so consumers can distinguish from validation failures.
          const e = err as Error;
          throw new ConnectorValidationError(
            `${adapter.vendor} adapter routing failed for method \`${propKey}\`: ${e.message}`,
            'configuration_error'
          );
        }

        const effectiveArgs = route.rewriteArgs ?? args;

        if (route.surface === 'memory_write' && route.writeContent !== undefined) {
          // PRE-call validation — block the write if the content
          // trips the validator chain.
          const result = await memoryWriteValidator.validate({
            kind: 'memory_write',
            payload: { content: route.writeContent },
          });
          if (!result.allowed) {
            const reason = result.reason ?? `${adapter.vendor} ${propKey} blocked`;
            logger.warn(`[bonklm-${adapter.vendor}] ${propKey} blocked`, { reason });
            throw new ConnectorValidationError(reason, 'validation_failed');
          }
        } else if (route.surface === 'composed_context' && route.composedEntries !== undefined) {
          // PRE-call composed-context validation on INPUT entries
          // (rare — most recall paths validate post-result).
          const result = await composedContextValidator.validate({
            kind: 'composed_context',
            entries: route.composedEntries,
          });
          if (!result.allowed) {
            const reason = result.reason ?? `${adapter.vendor} ${propKey} blocked`;
            logger.warn(`[bonklm-${adapter.vendor}] ${propKey} blocked`, { reason });
            throw new ConnectorValidationError(reason, 'validation_failed');
          }
        }

        // Invoke the underlying method with effective args.
        const callResult = await (original as (...a: unknown[]) => unknown).apply(
          target,
          effectiveArgs as unknown[]
        );

        // POST-call validation hook — adapters use this to walk
        // the recall result and fire composed-context validation
        // on RETURNED text (Mem0 `search`, Zep `getUserContext`).
        if (typeof adapter.validateResult === 'function') {
          await adapter.validateResult(invocation, callResult, {
            runComposedContextValidator: async (entries: string[]) => {
              if (entries.length === 0) return;
              const result = await composedContextValidator.validate({
                kind: 'composed_context',
                entries,
              });
              if (!result.allowed) {
                const reason = result.reason ?? `${adapter.vendor} ${propKey} recall blocked`;
                logger.warn(`[bonklm-${adapter.vendor}] ${propKey} recall blocked`, {
                  reason,
                });
                throw new ConnectorValidationError(reason, 'validation_failed');
              }
            },
          });
        }

        return callResult;
      };
    },
  });
}

/**
 * Helper exposed for per-vendor wrappers to invoke the
 * `assertGetTenantIdIsCallback` check at THEIR factory boundary.
 *
 * Per-vendor wrappers should call this at construction so the throw
 * stack-trace names the vendor wrapper (e.g. `wrapMem0Client`), not
 * just `wrapMemoryClient`. Calling this is OPTIONAL — `wrapMemoryClient`
 * itself enforces the same check.
 */
export function assertGetTenantIdValid(
  getTenantId: unknown,
  vendorName: string
): asserts getTenantId is GetTenantId {
  if (typeof getTenantId !== 'function') {
    throw new ConnectorValidationError(
      `wrap${vendorName}Client: \`getTenantId\` must be a function (ctx) => string, not ${typeof getTenantId}. ` +
        `Passing a literal string would scope every memory write to a single tenant — a multi-tenant ` +
        `deployment must thread the per-call session context through a callback.`,
      'configuration_error'
    );
  }
}

/**
 * Cumulative-audit code-reviewer HIGH + iter-1 architect A&D:
 * shared tenant-ID format validation. Previously duplicated in both
 * mem0-adapter.ts AND zep-adapter.ts (security-boundary regex copies
 * are a latent divergence bug).
 *
 * Iter-1 security A&D: removed `:` from the allowed set. Colon could
 * enable URL-authority injection (`localhost:9000`-style tenant IDs)
 * if a future adapter interpolates the tenant id into a URL.
 * Legitimate composite IDs use `-` or `_` separators (`user-123`,
 * `user_123`) — both still permitted.
 *
 * Allowed: word chars (`\w` = `[A-Za-z0-9_]`), `-`, `.`, `@`.
 * Max length: 256 chars.
 */
const TENANT_ID_SAFE_PATTERN = /^[\w\-.@]+$/;
const TENANT_ID_MAX_LENGTH = 256;

export function assertTenantIdSafe(
  tenantId: unknown,
  vendorName: string
): asserts tenantId is string {
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new ConnectorValidationError(
      `${vendorName} adapter: getTenantId(ctx) returned ${typeof tenantId}; must be a non-empty string`,
      'configuration_error'
    );
  }
  if (tenantId.length > TENANT_ID_MAX_LENGTH) {
    throw new ConnectorValidationError(
      `${vendorName} adapter: getTenantId(ctx) returned a value longer than ${TENANT_ID_MAX_LENGTH} chars; refusing.`,
      'configuration_error'
    );
  }
  if (!TENANT_ID_SAFE_PATTERN.test(tenantId)) {
    throw new ConnectorValidationError(
      `${vendorName} adapter: getTenantId(ctx) returned a value containing characters outside [\\w\\-.@]; refusing. ` +
        `Composite IDs should use \`-\` or \`_\` as separators (e.g. \`user-123\`, \`tenant_admin\`).`,
      'configuration_error'
    );
  }
}

export { WrapMemoryClientOptions };
