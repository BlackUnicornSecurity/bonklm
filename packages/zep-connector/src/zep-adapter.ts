/**
 * Zep adapter
 * =======================
 *
 * Maps Zep SDK method invocations to BonkLM surface hooks. Zep's
 * client groups methods under nested namespaces (`thread.addMessages`,
 * `graph.search`, etc.); the adapter wraps the proxy at the namespace
 * level so each nested call routes through BonkLM.
 *
 * Routing follows the iter-4 security A&D + plan AC:
 *
 *   - `thread.addMessages` → `memory_write` surface.
 *   - `thread.getUserContext` → `composed_context` surface (post-call).
 *   - `graph.add` → `memory_write` surface.
 *   - `graph.search` → `composed_context` surface (post-call).
 *
 * **`graph_id` enforcement** (plan AC): consumers MUST NOT pass
 * arbitrary `graph_id` values — the connector OVERWRITES `graph_id`
 * with `getTenantId(ctx)` so a hostile caller cannot scope writes
 * to another tenant's graph. The adapter does the rewrite via
 * `rewriteArgs`.
 *
 * **`wrapZepGraphRetriever` is OUT OF SCOPE** (iter-3
 * senior-dev A&D-5 + connector-style ADR multi-surface example as
 * "illustrative — not yet implemented"). Today `wrapZepClient` ships
 * memory-surface only; graph wrappers within it remain
 * memory/composed-context flavoured under the single factory.
 *
 * Zep SDK shape (duck-typed) — Zep Cloud v3.x:
 *   - `client.thread.addMessages({ threadId, messages })` → adds messages.
 *   - `client.thread.getUserContext({ threadId, ... })` → recall summary.
 *   - `client.graph.add({ graphId, data | episodes, ... })` → graph write.
 *   - `client.graph.search({ graphId, query, limit, ... })` → graph search.
 *
 * The adapter assumes a FLATTENED client surface — `wrapZepClient`
 * applies the adapter twice (once for `thread`, once for `graph`) by
 * walking nested namespaces. See `wrap-zep-client.ts` for the
 * namespace-aware Proxy.
 *
 * @package @blackunicorn/bonklm-zep
 */
import {
  type AdapterInvocation,
  type AdapterRoute,
  assertTenantIdSafe,
  type GetTenantId,
  type MemoryAdapter
} from '@blackunicorn/bonklm-memory-utils';

/**
 * The Zep method names this adapter routes through. Methods NOT
 * in this set pass through unchanged.
 */
const ZEP_METHODS = new Set([
  // thread.*
  'addMessages',
  'getUserContext',
  // graph.*
  'add',
  'search'
]);

/**
 * Extract validatable text from a Zep `thread.addMessages` call's args.
 *
 * Zep `addMessages({ threadId, messages })` — `messages` is an array
 * of `{ role, content, ... }` objects.
 */
function extractAddMessagesContent(args: ReadonlyArray<unknown>): string {
  const params = args[0];
  if (!params || typeof params !== 'object') return '';
  const messages = (params as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return '';
  const leaves: string[] = [];
  for (const msg of messages) {
    if (typeof msg === 'string') {
      leaves.push(msg);
    } else if (msg !== null && typeof msg === 'object') {
      const content = (msg as { content?: unknown }).content;
      if (typeof content === 'string') leaves.push(content);
    }
  }
  return leaves.join('\n');
}

/**
 * Extract validatable text from a Zep `graph.add` call's args.
 *
 * Zep `graph.add({ graphId, data, episodes? })` — `data` is the raw
 * graph-write text; `episodes` is an array of `{ content, ... }`.
 */
function extractGraphAddContent(args: ReadonlyArray<unknown>): string {
  const params = args[0];
  if (!params || typeof params !== 'object') return '';
  const obj = params as { data?: unknown; episodes?: unknown };
  const leaves: string[] = [];
  if (typeof obj.data === 'string') leaves.push(obj.data);
  if (Array.isArray(obj.episodes)) {
    for (const ep of obj.episodes) {
      if (ep !== null && typeof ep === 'object') {
        const content = (ep as { content?: unknown }).content;
        if (typeof content === 'string') leaves.push(content);
      }
    }
  }
  return leaves.join('\n');
}

/**
 * Walk a Zep recall result for validatable text. Zep returns
 * differently-shaped results per method:
 *   - `getUserContext` → `{ context: string, messages?: [...] }`
 *   - `graph.search` → `{ episodes?: [...], facts?: [...], nodes?: [...] }`
 *
 * We extract text leaves from each shape.
 */
function extractRecallEntries(result: unknown): string[] {
  if (result === null || result === undefined) return [];
  const entries: string[] = [];

  const obj = result as {
    context?: unknown;
    messages?: unknown;
    episodes?: unknown;
    facts?: unknown;
    nodes?: unknown;
  };

  if (typeof obj.context === 'string') entries.push(obj.context);

  if (Array.isArray(obj.messages)) {
    for (const m of obj.messages) {
      if (typeof m === 'string') entries.push(m);
      else if (m !== null && typeof m === 'object') {
        const c = (m as { content?: unknown }).content;
        if (typeof c === 'string') entries.push(c);
      }
    }
  }
  if (Array.isArray(obj.episodes)) {
    for (const e of obj.episodes) {
      if (e !== null && typeof e === 'object') {
        const c = (e as { content?: unknown }).content;
        if (typeof c === 'string') entries.push(c);
      }
    }
  }
  if (Array.isArray(obj.facts)) {
    for (const f of obj.facts) {
      if (typeof f === 'string') entries.push(f);
      else if (f !== null && typeof f === 'object') {
        const fact = (f as { fact?: unknown }).fact;
        if (typeof fact === 'string') entries.push(fact);
      }
    }
  }
  if (Array.isArray(obj.nodes)) {
    for (const n of obj.nodes) {
      if (n !== null && typeof n === 'object') {
        const summary = (n as { summary?: unknown }).summary;
        if (typeof summary === 'string') entries.push(summary);
      }
    }
  }
  return entries.filter(s => s.length > 0);
}

// Tenant-ID format validation moved to memory-utils as a shared
// helper (cumulative-audit code-reviewer HIGH + iter-1 security A&D
// removed `:` from the allowed set).

/**
 * Rewrite `graph.*` args to enforce `graphId === getTenantId(ctx)`
 * AND neutralize other caller-controlled scoping fields.
 *
 * Defeats caller-controlled graph_id leak — a hostile caller passing:
 *   - `{ graphId: 'attacker-graph' }` — overwritten by getTenantId(ctx).
 *   - `{ graphIds: ['victim-1', 'victim-2'] }` — set to undefined
 *     (Zep multi-graph queries). Iter-1 security BLOCK #2.
 *   - `{ userId: 'victim' }` — set to undefined (some Zep methods
 *     accept userId alongside graphId for cross-scope lookups).
 *     Iter-1 security BLOCK #2.
 *
 * After this rewrite, the consumer's args carry ONLY the bonklm-
 * authorised tenant scope. Other vendor-specific scoping fields
 * are removed; consumers who need them must pass them through
 * options.getTenantId derivation, not raw args.
 */
/**
 * Cumulative-audit security BLOCK #3 (extended): Zep accepts
 * alternative scoping fields the original rewrite didn't neutralize.
 *   - `graphIds` (plural) — multi-graph queries.
 *   - `userId` — alternative user-scope.
 *   - `userIds` (plural) — multi-user queries on `graph.search`.
 *   - `sessionId` — thread session scope; if a future Zep SDK
 *     surface accepts it on graph.* methods, it would route through
 *     unwrapped without this entry.
 */
const ZEP_BYPASS_FIELDS = ['graphIds', 'userId', 'userIds', 'sessionId'] as const;

function rewriteGraphIdArgs(
  args: ReadonlyArray<unknown>,
  ctx: unknown,
  getTenantId: GetTenantId
): ReadonlyArray<unknown> {
  const params = args[0];
  if (!params || typeof params !== 'object') return args;
  const tenantId = getTenantId(ctx);
  assertTenantIdSafe(tenantId, 'zep');
  // Spread to a NEW object so we don't mutate the caller's params.
  const newParams: Record<string, unknown> = {
    ...(params as Record<string, unknown>),
    graphId: tenantId
  };
  for (const field of ZEP_BYPASS_FIELDS) {
    delete newParams[field];
  }
  return [newParams, ...args.slice(1)];
}

/**
 * Factory that builds the Zep adapter bound to a specific
 * `getTenantId` callback. The adapter calls `getTenantId` per-route
 * to scope `graph.*` writes/reads.
 */
export function buildZepAdapter(getTenantId: GetTenantId): MemoryAdapter {
  return {
    vendor: 'zep',
    methods: ZEP_METHODS,

    route(invocation: AdapterInvocation): AdapterRoute {
      const { method, args, ctx } = invocation;
      switch (method) {
        case 'addMessages':
          return {
            surface: 'memory_write',
            writeContent: extractAddMessagesContent(args)
          };
        case 'add':
          // graph.add — write content + enforce graphId scope.
          return {
            surface: 'memory_write',
            writeContent: extractGraphAddContent(args),
            rewriteArgs: rewriteGraphIdArgs(args, ctx, getTenantId)
          };
        case 'getUserContext':
          // thread.getUserContext — recall, validated POST-call.
          return { surface: null };
        case 'search':
          // graph.search — recall, validated POST-call. Still
          // enforce graphId on the input args to prevent scoped
          // recall against another tenant's graph.
          return {
            surface: null,
            rewriteArgs: rewriteGraphIdArgs(args, ctx, getTenantId)
          };
        default:
          return { surface: null };
      }
    },

    async validateResult(invocation, result, helpers): Promise<void> {
      const { method } = invocation;
      if (method !== 'getUserContext' && method !== 'search') return;
      const entries = extractRecallEntries(result);
      if (entries.length === 0) return;
      await helpers.runComposedContextValidator(entries);
    }
  };
}
