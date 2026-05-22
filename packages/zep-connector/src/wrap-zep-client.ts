/**
 * Story 2.5 — `wrapZepClient(client, engine, options)`
 * =====================================================
 *
 * Per-vendor convenience wrapper over `wrapMemoryClient` from
 * `@blackunicorn/bonklm-memory-utils`. Follows the canonical
 * `wrap<Vendor>Client(client, engine, options?)` shape (ADR shape #2).
 *
 * Zep's client uses NESTED namespaces (`client.thread.addMessages`,
 * `client.graph.search`) — `wrapMemoryClient` wraps a flat proxy, so
 * this factory builds a top-level proxy that intercepts `.thread`
 * and `.graph` accesses and returns inner-wrapped sub-proxies.
 *
 * **`wrapZepGraphRetriever` is OUT OF SCOPE** for Story 2.5 (iter-3
 * senior-dev A&D-5). `wrapZepClient` wraps BOTH thread + graph under
 * one factory with two surface hooks; a future story can ship a
 * separate `wrapZepGraphRetriever` retrieved-docs factory if/when
 * the graph-as-retrieved-docs pattern lands. The connector-style
 * ADR marks that as illustrative-only.
 *
 * @example
 * ```ts
 * import { ZepClient } from '@getzep/zep-cloud';
 * import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';
 * import { wrapZepClient } from '@blackunicorn/bonklm-zep';
 *
 * const validators = [new PromptInjectionValidator()];
 * const engine = new GuardrailEngine({ validators });
 * const client = new ZepClient({ apiKey: process.env.ZEP_API_KEY });
 *
 * const guarded = wrapZepClient(client, engine, {
 *   getTenantId: (ctx) => ctx.userId,
 *   getSessionContext: () => requestLocal.get('session'),
 *   validators,
 * });
 *
 * await guarded.thread.addMessages({ threadId: 't-1', messages: [...] });
 * await guarded.graph.search({ graphId: 'IGNORED', query: '...' });
 * //                                        ^^^^^^^ overwritten with getTenantId(ctx)
 * ```
 *
 * @package @blackunicorn/bonklm-zep
 */
import {
  assertGetTenantIdValid,
  wrapMemoryClient,
  type WrapMemoryClientOptions,
} from '@blackunicorn/bonklm-memory-utils';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
import { buildZepAdapter } from './zep-adapter.js';

/**
 * Zep top-level namespace allowlist. The outer proxy intercepts these
 * with bonklm wrapping; other top-level property accesses pass through
 * unmodified ONLY for known-safe non-callable fields (apiKey config,
 * etc.). Future Zep SDK additions (e.g. `client.users`, `client.messages`)
 * MUST be added here AND to the adapter's method routing — otherwise
 * the proxy raises a configuration_error rather than silently letting
 * an unwrapped namespace through.
 *
 * Iter-1 security BLOCK #10.
 */
const ZEP_WRAPPED_NAMESPACES = new Set(['thread', 'graph']);

/**
 * Known-safe top-level property accesses that pass through without
 * wrapping. These are non-method properties (config getters etc.).
 * Hostile reads of these are not a multi-tenant concern.
 */
const ZEP_PASSTHROUGH_PROPS = new Set([
  // Built-in JS host props always pass through.
  'constructor',
  'then',
  'catch',
  'finally',
  'toJSON',
  'toString',
  'valueOf',
  // Symbol-keyed properties handled via the typeof check.
  // Configuration-like fields (read-only on most Zep SDK builds):
  'apiKey',
  'baseUrl',
  'options',
  'config',
]);

/**
 * Zep client shape (duck-typed) — `thread` + `graph` nested namespaces
 * each carry the validated methods.
 */
interface ZepClientLike {
  thread?: object;
  graph?: object;
}

/**
 * Wrap a Zep client with BonkLM memory + composed-context validation.
 *
 * Canonical-shape factory per the connector-style ADR (shape #2).
 *
 * @param client - The Zep client instance (`new ZepClient(...)`).
 * @param engine - The BonkLM engine that owns the validator chain.
 * @param options - Memory-utils options (`getTenantId` is REQUIRED).
 */
export function wrapZepClient<TClient extends ZepClientLike>(
  client: TClient,
  engine: GuardrailEngine,
  options: WrapMemoryClientOptions
): TClient {
  assertGetTenantIdValid(options.getTenantId, 'Zep');

  const adapter = buildZepAdapter(options.getTenantId);

  // Iter-1 code-reviewer HIGH (Item 6): cache wrapped namespaces by
  // (propKey, raw) tuple so a stale wrapper isn't returned if the
  // SDK reassigns the namespace reference (lazy-init, re-auth, etc.).
  interface NamespaceCacheEntry {
    raw: object;
    wrapped: object;
  }
  const wrappedNamespaces = new Map<string, NamespaceCacheEntry>();
  const wrapNamespace = (raw: object): object =>
    wrapMemoryClient(raw, {
      ...options,
      adapter,
      engine,
    });

  return new Proxy(client, {
    get(target, propKey, receiver): unknown {
      // Symbol-keyed properties always pass through.
      if (typeof propKey !== 'string') {
        return Reflect.get(target, propKey, receiver);
      }

      // Iter-1 security BLOCK #10: outer-proxy fail-closed on unknown
      // top-level namespaces. The allowlist of WRAPPED namespaces +
      // PASSTHROUGH props is explicit; anything else producing a
      // function (callable namespace) throws ConnectorValidationError
      // so a future Zep SDK adding `.users` doesn't silently bypass
      // multi-tenant scoping.

      if (ZEP_WRAPPED_NAMESPACES.has(propKey)) {
        const raw = Reflect.get(target, propKey, receiver);
        if (raw === null || raw === undefined || typeof raw !== 'object') {
          return raw;
        }
        const cached = wrappedNamespaces.get(propKey);
        if (cached !== undefined && cached.raw === raw) {
          return cached.wrapped;
        }
        // Either no cache entry OR the underlying namespace reference
        // changed (SDK lazy-init / reassignment). Re-wrap.
        const wrapped = wrapNamespace(raw);
        wrappedNamespaces.set(propKey, { raw, wrapped });
        return wrapped;
      }

      if (ZEP_PASSTHROUGH_PROPS.has(propKey)) {
        return Reflect.get(target, propKey, receiver);
      }

      const raw = Reflect.get(target, propKey, receiver);
      if (typeof raw === 'function') {
        // Unknown callable top-level namespace — fail closed.
        throw new ConnectorValidationError(
          `wrapZepClient: top-level property \`${propKey}\` is a function but is not in the ` +
            `wrapped-namespace allowlist (${[...ZEP_WRAPPED_NAMESPACES].join(', ')}). ` +
            `This is likely a Zep SDK addition that needs BonkLM coverage. ` +
            `Either add \`${propKey}\` to ZEP_WRAPPED_NAMESPACES + the Zep adapter, OR ` +
            `add it to ZEP_PASSTHROUGH_PROPS if it does NOT mutate scoped data.`,
          'configuration_error'
        );
      }
      // Non-callable unknown property — pass through (e.g. raw config getter).
      return raw;
    },
  });
}
