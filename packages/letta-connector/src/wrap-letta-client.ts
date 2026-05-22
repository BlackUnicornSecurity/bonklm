/**
 * Story 2.6 — `wrapLettaClient(client, engine, options)`
 * =======================================================
 *
 * Per-vendor convenience wrapper following the canonical
 * `wrap<Vendor>Client(client, engine, options?)` shape (ADR shape #2).
 *
 * Letta uses NESTED namespaces: `client.agents.messages.create`,
 * `client.agents.archival_memory.list`, etc. The outer proxy
 * intercepts `.agents` accesses and returns a sub-proxy that
 * intercepts the leaf namespaces (`messages`, `archival_memory`,
 * `tools`, `core_memory`), each of which is wrapped via
 * `wrapMemoryClient` with the Letta adapter.
 *
 * Fail-closed semantics (mirroring Zep): unknown top-level namespaces
 * on `client` OR unknown sub-namespaces on `client.agents` THROW a
 * `ConnectorValidationError` so a future Letta SDK addition cannot
 * silently bypass tenant scoping.
 *
 * @example
 * ```ts
 * import { LettaClient } from '@letta-ai/letta-client';
 * import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';
 * import { wrapLettaClient } from '@blackunicorn/bonklm-letta';
 *
 * const validators = [new PromptInjectionValidator()];
 * const engine = new GuardrailEngine({ validators });
 * const client = new LettaClient({ baseUrl: '...' });
 *
 * const guarded = wrapLettaClient(client, engine, {
 *   getTenantId: (ctx) => ctx.agentId,
 *   getSessionContext: () => requestLocal.get('session'),
 *   validators,
 * });
 *
 * await guarded.agents.messages.create({
 *   agentId: 'IGNORED', // overwritten with getTenantId(ctx)
 *   messages: [{ role: 'user', content: 'hello' }],
 * });
 * ```
 *
 * @package @blackunicorn/bonklm-letta
 */
import {
  assertGetTenantIdValid,
  wrapMemoryClient,
  type WrapMemoryClientOptions,
} from '@blackunicorn/bonklm-memory-utils';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
import { buildLettaAdapter } from './letta-adapter.js';

/** Letta top-level namespace allowlist. */
const LETTA_WRAPPED_TOP_NAMESPACES = new Set(['agents']);

/** Letta sub-namespaces under `client.agents.*` that the adapter routes. */
const LETTA_AGENTS_SUB_NAMESPACES = new Set([
  'messages',
  'archival_memory',
  'archivalMemory',
  'core_memory',
  'coreMemory',
]);

/** Known-safe top-level properties that pass through unwrapped. */
const LETTA_PASSTHROUGH_PROPS = new Set([
  'constructor',
  'then',
  'catch',
  'finally',
  'toJSON',
  'toString',
  'valueOf',
  'apiKey',
  'baseUrl',
  'options',
  'config',
]);

/**
 * Wrap a Letta client with BonkLM memory + composed-context validation.
 */
export function wrapLettaClient<TClient extends object>(
  client: TClient,
  engine: GuardrailEngine,
  options: WrapMemoryClientOptions
): TClient {
  assertGetTenantIdValid(options.getTenantId, 'Letta');

  const adapter = buildLettaAdapter(options.getTenantId);

  // Cache wrapped sub-namespaces by (sub-name, raw) — re-wrap on
  // namespace reassignment (mirrors Zep's fix for the stale-wrapper bug).
  interface CacheEntry {
    raw: object;
    wrapped: object;
  }
  const subNamespaceCache = new Map<string, CacheEntry>();

  const wrapLeafNamespace = (raw: object): object =>
    wrapMemoryClient(raw, {
      ...options,
      adapter,
      engine,
    });

  /**
   * Build the `.agents` sub-proxy. Each access of
   * `client.agents.<sub>` returns the wrapped sub-namespace
   * (`messages` → wrapped, `archival_memory` → wrapped, etc.).
   * Unknown sub-namespaces fail closed.
   */
  const buildAgentsProxy = (rawAgents: object): object =>
    new Proxy(rawAgents, {
      get(target, propKey, receiver): unknown {
        if (typeof propKey !== 'string') {
          return Reflect.get(target, propKey, receiver);
        }
        if (LETTA_AGENTS_SUB_NAMESPACES.has(propKey)) {
          const raw = Reflect.get(target, propKey, receiver);
          if (raw === null || raw === undefined || typeof raw !== 'object') {
            return raw;
          }
          const cacheKey = `agents.${propKey}`;
          const cached = subNamespaceCache.get(cacheKey);
          if (cached !== undefined && cached.raw === raw) {
            return cached.wrapped;
          }
          const wrapped = wrapLeafNamespace(raw);
          subNamespaceCache.set(cacheKey, { raw, wrapped });
          return wrapped;
        }
        if (LETTA_PASSTHROUGH_PROPS.has(propKey)) {
          return Reflect.get(target, propKey, receiver);
        }
        const raw = Reflect.get(target, propKey, receiver);
        if (typeof raw === 'function') {
          throw new ConnectorValidationError(
            `wrapLettaClient: \`client.agents.${propKey}\` is a function but is not in the ` +
              `agents sub-namespace allowlist (${[...LETTA_AGENTS_SUB_NAMESPACES].join(', ')}). ` +
              `This is likely a Letta SDK addition that needs BonkLM coverage. Add \`${propKey}\` ` +
              `to LETTA_AGENTS_SUB_NAMESPACES + the Letta adapter, OR add it to ` +
              `LETTA_PASSTHROUGH_PROPS if it does NOT mutate scoped data.`,
            'configuration_error'
          );
        }
        return raw;
      },
    });

  // Outer proxy — intercept `.agents` accesses.
  const agentsCache: { raw?: object; wrapped?: object } = {};
  return new Proxy(client, {
    get(target, propKey, receiver): unknown {
      if (typeof propKey !== 'string') {
        return Reflect.get(target, propKey, receiver);
      }
      if (LETTA_WRAPPED_TOP_NAMESPACES.has(propKey)) {
        const raw = Reflect.get(target, propKey, receiver);
        if (raw === null || raw === undefined || typeof raw !== 'object') {
          return raw;
        }
        if (agentsCache.raw === raw && agentsCache.wrapped !== undefined) {
          return agentsCache.wrapped;
        }
        const wrapped = buildAgentsProxy(raw);
        agentsCache.raw = raw;
        agentsCache.wrapped = wrapped;
        return wrapped;
      }
      if (LETTA_PASSTHROUGH_PROPS.has(propKey)) {
        return Reflect.get(target, propKey, receiver);
      }
      const raw = Reflect.get(target, propKey, receiver);
      if (typeof raw === 'function') {
        throw new ConnectorValidationError(
          `wrapLettaClient: top-level property \`${propKey}\` is a function but is not in the ` +
            `wrapped-namespace allowlist (${[...LETTA_WRAPPED_TOP_NAMESPACES].join(', ')}). ` +
            `Add \`${propKey}\` to LETTA_WRAPPED_TOP_NAMESPACES + the Letta adapter, OR add it ` +
            `to LETTA_PASSTHROUGH_PROPS if it does NOT mutate scoped data.`,
          'configuration_error'
        );
      }
      return raw;
    },
  });
}
