/**
 * Story 2.6 — Letta adapter
 * =========================
 *
 * Letta (formerly MemGPT) maps to BonkLM's memory_write + composed_context
 * surfaces. Per the cumulative-audit security review's "Story 2.6 guidance":
 *
 *   - `agents.messages.create` (or `agents.send_message`) → memory_write.
 *   - `agents.memory.update(agentId, ...)` → memory_write.
 *   - `agents.messages.list` / `agents.archival_memory.list` → composed_context.
 *   - `agents.archival_memory.insert(agentId, ...)` → memory_write.
 *
 * **Tenant scoping (cumulative-audit security BLOCK #3 pattern)**:
 *
 *   Letta's primary scoping field is `agentId` — the first positional
 *   arg of every method under `agents.*`. The adapter REWRITES the
 *   first positional `agentId` with `getTenantId(ctx)` so a hostile
 *   caller cannot scope writes/reads to another agent.
 *
 *   Letta v1.11+ also accepts `humanId`, `personaId`, and `userId`
 *   in some method options — the adapter NEUTRALIZES these to prevent
 *   cross-scope bypass (mirrors Zep's `graphIds`/`userId` strip).
 *
 * Letta SDK shape (duck-typed, v1.11.x):
 *   - `client.agents.messages.create({ agentId, messages, ... })`
 *   - `client.agents.archival_memory.insert({ agentId, text })`
 *   - `client.agents.archival_memory.list({ agentId })`
 *   - `client.agents.messages.list({ agentId, limit, ... })`
 *
 * Each nested namespace (`agents.messages`, `agents.archival_memory`)
 * carries the wrappable methods. The `wrap-letta-client.ts` outer
 * proxy walks `client.agents.<sub>.<method>` to apply the adapter.
 *
 * @package @blackunicorn/bonklm-letta
 */
import {
  type AdapterInvocation,
  type AdapterRoute,
  assertTenantIdSafe,
  type GetTenantId,
  type MemoryAdapter
} from '@blackunicorn/bonklm-memory-utils';

/**
 * Methods this adapter routes. Mapped at the LEAF level — the outer
 * proxy iterates nested namespaces and applies this adapter to each.
 */
const LETTA_METHODS = new Set(['create', 'send_message', 'sendMessage', 'list', 'insert', 'update']);

/**
 * Letta scoping bypass fields neutralized on every rewrite. Mirrors
 * Mem0's `agent_id`/`run_id`/etc. and Zep's `graphIds`/`userId`.
 */
const LETTA_BYPASS_FIELDS = ['humanId', 'personaId', 'userId', 'organizationId'] as const;

/**
 * Extract validatable text from Letta `messages.create({ agentId, messages })`.
 */
function extractMessagesContent(args: ReadonlyArray<unknown>): string {
  const params = args[0];
  if (!params || typeof params !== 'object') return '';
  const messages = (params as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return '';
  const leaves: string[] = [];
  for (const m of messages) {
    if (typeof m === 'string') leaves.push(m);
    else if (m !== null && typeof m === 'object') {
      const c = (m as { content?: unknown; text?: unknown }).content ?? (m as { text?: unknown }).text;
      if (typeof c === 'string') leaves.push(c);
    }
  }
  return leaves.join('\n');
}

/**
 * Extract validatable text from Letta `archival_memory.insert({ agentId, text })`.
 */
function extractInsertContent(args: ReadonlyArray<unknown>): string {
  const params = args[0];
  if (!params || typeof params !== 'object') return '';
  const text = (params as { text?: unknown; content?: unknown }).text ?? (params as { content?: unknown }).content;
  return typeof text === 'string' ? text : '';
}

/**
 * Walk a Letta recall result for validatable text. Letta returns
 * `messages.list` → `{ messages: [{ role, text/content }] }` and
 * `archival_memory.list` → `{ memories: [{ text }] }`.
 */
function extractRecallEntries(result: unknown): string[] {
  if (result === null || result === undefined) return [];
  const obj = result as { messages?: unknown; memories?: unknown };
  const entries: string[] = [];
  if (Array.isArray(obj.messages)) {
    for (const m of obj.messages) {
      if (m !== null && typeof m === 'object') {
        const c = (m as { text?: unknown }).text ?? (m as { content?: unknown }).content;
        if (typeof c === 'string') entries.push(c);
      }
    }
  }
  if (Array.isArray(obj.memories)) {
    for (const m of obj.memories) {
      if (m !== null && typeof m === 'object') {
        const t = (m as { text?: unknown }).text;
        if (typeof t === 'string') entries.push(t);
      }
    }
  }
  return entries.filter(s => s.length > 0);
}

/**
 * Rewrite a Letta method's args to enforce `agentId === getTenantId(ctx)`
 * AND strip the bypass scoping fields.
 */
function rewriteAgentIdArgs(
  args: ReadonlyArray<unknown>,
  ctx: unknown,
  getTenantId: GetTenantId
): ReadonlyArray<unknown> {
  const params = args[0];
  if (!params || typeof params !== 'object') return args;
  const tenantId = getTenantId(ctx);
  assertTenantIdSafe(tenantId, 'letta');
  const newParams: Record<string, unknown> = {
    ...(params as Record<string, unknown>),
    agentId: tenantId
  };
  for (const field of LETTA_BYPASS_FIELDS) {
    delete newParams[field];
  }
  return [newParams, ...args.slice(1)];
}

/**
 * Build a Letta adapter bound to a specific `getTenantId` callback.
 */
export function buildLettaAdapter(getTenantId: GetTenantId): MemoryAdapter {
  return {
    vendor: 'letta',
    methods: LETTA_METHODS,

    route(invocation: AdapterInvocation): AdapterRoute {
      const { method, args, ctx } = invocation;
      switch (method) {
        case 'create':
        case 'send_message':
        case 'sendMessage':
          // messages.create — memory_write with tenant rewrite.
          return {
            surface: 'memory_write',
            writeContent: extractMessagesContent(args),
            rewriteArgs: rewriteAgentIdArgs(args, ctx, getTenantId)
          };
        case 'insert':
          // archival_memory.insert — memory_write with tenant rewrite.
          return {
            surface: 'memory_write',
            writeContent: extractInsertContent(args),
            rewriteArgs: rewriteAgentIdArgs(args, ctx, getTenantId)
          };
        case 'list':
          // messages.list / archival_memory.list — recall, POST-validated.
          return {
            surface: null,
            rewriteArgs: rewriteAgentIdArgs(args, ctx, getTenantId)
          };
        case 'update':
          // agent.update — config write, no content to scan; rewrite
          // tenant scope and pass through.
          return {
            surface: null,
            rewriteArgs: rewriteAgentIdArgs(args, ctx, getTenantId)
          };
        default:
          return { surface: null };
      }
    },

    async validateResult(invocation, result, helpers): Promise<void> {
      const { method } = invocation;
      if (method !== 'list') return;
      const entries = extractRecallEntries(result);
      if (entries.length === 0) return;
      await helpers.runComposedContextValidator(entries);
    }
  };
}
