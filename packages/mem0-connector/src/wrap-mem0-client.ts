/**
 * Story 2.5 — `wrapMem0Client(client, engine, options)`
 * ======================================================
 *
 * Per-vendor convenience wrapper over `wrapMemoryClient` from
 * `@blackunicorn/bonklm-memory-utils`. Follows the canonical
 * `wrap<Vendor>Client(client, engine, options?)` shape from the
 * connector-style ADR (shape #2).
 *
 * Routes Mem0's `add` / `update` / `history` / `reset` → `memory_write`
 * surface; `search` / `get` / `getAll` → `composed_context` surface
 * (post-call recall validation).
 *
 * @example
 * ```ts
 * import { Memory } from 'mem0ai';
 * import { GuardrailEngine, PromptInjectionValidator, SecretGuard } from '@blackunicorn/bonklm';
 * import { wrapMem0Client } from '@blackunicorn/bonklm-mem0';
 *
 * const validators = [new PromptInjectionValidator(), new SecretGuard()];
 * const engine = new GuardrailEngine({ validators });
 * const client = new Memory();
 *
 * const guarded = wrapMem0Client(client, engine, {
 *   getTenantId: (ctx) => ctx.userId,
 *   getSessionContext: () => requestLocal.get('session'),
 *   validators,
 * });
 *
 * await guarded.add('user authored content', { user_id: 'u-1' });
 * await guarded.search('what did I say earlier?', { user_id: 'u-1' });
 * ```
 *
 * @package @blackunicorn/bonklm-mem0
 */
import {
  assertGetTenantIdValid,
  wrapMemoryClient,
  type WrapMemoryClientOptions
} from '@blackunicorn/bonklm-memory-utils';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import { buildMem0Adapter } from './mem0-adapter.js';

/**
 * Wrap a Mem0 client with BonkLM memory + composed-context validation.
 *
 * Canonical-shape factory per the connector-style ADR (shape #2):
 *   - Client FIRST positional arg.
 *   - Engine SECOND positional arg.
 *   - Options THIRD positional arg (optional).
 *
 * @param client - The Mem0 client instance (typically `new Memory()`).
 * @param engine - The BonkLM engine that owns the validator chain.
 * @param options - Memory-utils options (`getTenantId` is REQUIRED).
 */
export function wrapMem0Client<TClient extends object>(
  client: TClient,
  engine: GuardrailEngine,
  options: WrapMemoryClientOptions
): TClient {
  // Vendor-named throw stack trace (per per-vendor convenience
  // wrapper recommendation in `wrap-memory-client.ts`).
  assertGetTenantIdValid(options.getTenantId, 'Mem0');

  // Iter-1 security BLOCK #3: build a per-call adapter bound to the
  // consumer's getTenantId callback so the adapter can rewrite
  // user_id on every Mem0 method invocation.
  const adapter = buildMem0Adapter(options.getTenantId);

  return wrapMemoryClient<TClient>(client, {
    ...options,
    adapter,
    engine
  });
}
