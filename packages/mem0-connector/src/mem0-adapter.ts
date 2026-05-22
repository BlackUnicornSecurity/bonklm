/**
 * Story 2.5 — Mem0 adapter
 * ========================
 *
 * Maps Mem0 SDK method invocations to BonkLM surface hooks. The
 * routing follows the iter-4 security A&D + connector-style ADR
 * Mem0 worked example:
 *
 *   - `add` / `update` / `history` / `reset` → `memory_write` surface.
 *   - `search` / `get` / `getAll` → `composed_context` surface
 *     (post-call: walk the returned memories, fire validator on
 *     recalled text).
 *
 * Mem0 SDK shape (duck-typed):
 *   - `client.add(messages | text, { user_id?, infer? })` → adds a memory.
 *     When `infer: true`, Mem0 extracts memories from the input —
 *     we still validate the INPUT text, not the post-extract result
 *     (no easy way to validate after the SDK black-boxes the extraction).
 *   - `client.search(query, { user_id })` → recall.
 *   - `client.update(memory_id, data)` → update.
 *   - `client.get(memory_id)` → recall by id.
 *   - `client.getAll({ user_id })` → recall all for a user.
 *   - `client.history(memory_id)` → memory mutation history.
 *   - `client.reset()` → delete all memories.
 *
 * The adapter is STATELESS — created once per package import, reused
 * across every `wrapMem0Client` invocation. Tenant scoping happens
 * via `getTenantId(ctx)` resolved per-call.
 *
 * @package @blackunicorn/bonklm-mem0
 */
import type {
  AdapterInvocation,
  AdapterRoute,
  GetTenantId,
  MemoryAdapter,
} from '@blackunicorn/bonklm-memory-utils';
import { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Extract the validatable text from a Mem0 `add` call's args.
 *
 * Mem0 `add` accepts either:
 *   - A string: `client.add("user authored text", { user_id })`
 *   - A messages array: `client.add([{ role, content }, ...], { user_id })`
 *
 * Both forms return the same validatable text — the concatenated
 * content. We don't recurse into nested arrays here; Mem0's documented
 * shape is 1-level.
 */
function extractAddContent(args: ReadonlyArray<unknown>): string {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (Array.isArray(first)) {
    const leaves: string[] = [];
    for (const message of first) {
      if (typeof message === 'string') {
        leaves.push(message);
      } else if (message !== null && typeof message === 'object') {
        const content = (message as { content?: unknown }).content;
        if (typeof content === 'string') leaves.push(content);
      }
    }
    return leaves.join('\n');
  }
  return '';
}

/**
 * Extract the validatable text from a Mem0 `update` call's args.
 *
 * Mem0 `update(memory_id, data)` — `data` is either a string OR
 * `{ text: string, metadata?: ... }`.
 */
function extractUpdateContent(args: ReadonlyArray<unknown>): string {
  const data = args[1];
  if (typeof data === 'string') return data;
  if (data !== null && typeof data === 'object') {
    const text = (data as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '';
}

/**
 * Mem0 SDK shape for a recalled memory entry (duck-typed). The
 * adapter walks the `memory` field across each entry.
 */
interface Mem0RecallEntry {
  memory?: string;
  text?: string;
  content?: string;
}

/**
 * Mem0 recall results come in 3 shapes:
 *   - `search` / `getAll` → `Array<Entry>` or `{ results: Array<Entry> }`.
 *   - `get(memory_id)` → single `Entry` object (NOT wrapped in an array).
 *
 * Walk all three shapes. An `Entry` is `{ memory? | text? | content? }`.
 */
function extractRecallEntries(result: unknown): string[] {
  if (result === null || result === undefined) return [];
  let entries: Mem0RecallEntry[];
  if (Array.isArray(result)) {
    entries = result as Mem0RecallEntry[];
  } else if (
    typeof result === 'object' &&
    Array.isArray((result as { results?: unknown }).results)
  ) {
    entries = (result as { results: Mem0RecallEntry[] }).results;
  } else if (typeof result === 'object') {
    // Single-entry return (e.g. Mem0 `get(memory_id)`).
    entries = [result as Mem0RecallEntry];
  } else {
    return [];
  }
  return entries
    .map((e) => e?.memory ?? e?.text ?? e?.content ?? '')
    .filter((s) => typeof s === 'string' && s.length > 0);
}

/**
 * The Mem0 method names this adapter wraps. Methods NOT in this set
 * pass through unchanged.
 */
const MEM0_METHODS = new Set([
  'add',
  'update',
  'history',
  'reset',
  'search',
  'get',
  'getAll',
]);

/**
 * Iter-1 security BLOCK #3 (multi-tenant scoping leak): the Mem0 SDK
 * accepts `user_id` in the second-args options. A hostile caller
 * passing `{ user_id: 'victim' }` to `add` / `update` / `search` /
 * `getAll` would write to / read from another tenant's memory partition
 * — defeating the entire purpose of `getTenantId(ctx)`. Defence: the
 * adapter MUST overwrite `user_id` with `getTenantId(ctx)` on every
 * routed call. Mirrors the Zep `graph_id` rewrite pattern.
 *
 * We convert the module-scope `mem0Adapter` const into a
 * `buildMem0Adapter(getTenantId)` factory so the rewrite has access
 * to the tenant-id resolver. Each `wrapMem0Client` call gets its own
 * adapter instance bound to the consumer's callback.
 */

/**
 * Tenant-ID format validation — defence-in-depth against API-layer
 * injection when the tenant value flows into the Mem0 `user_id` field
 * (which is then passed to the Mem0 server). Refuses values with
 * control chars, path-traversal sequences, or unreasonable length.
 */
function assertTenantIdSafe(tenantId: unknown): asserts tenantId is string {
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new ConnectorValidationError(
      `mem0 adapter: getTenantId(ctx) returned ${typeof tenantId}; must be a non-empty string`,
      'configuration_error'
    );
  }
  if (tenantId.length > 256) {
    throw new ConnectorValidationError(
      `mem0 adapter: getTenantId(ctx) returned a value longer than 256 chars; refusing.`,
      'configuration_error'
    );
  }
  if (!/^[\w\-.:@]+$/.test(tenantId)) {
    throw new ConnectorValidationError(
      `mem0 adapter: getTenantId(ctx) returned a value containing characters outside [\\w\\-.:@]; refusing.`,
      'configuration_error'
    );
  }
}

/**
 * Rewrite Mem0 method args to overwrite `user_id` with `getTenantId(ctx)`.
 * Defeats caller-controlled user_id leak across Mem0's add / update /
 * search / getAll surfaces.
 *
 * Different Mem0 methods carry `user_id` in different argument
 * positions:
 *   - `add(messages|text, options)` → user_id in options (arg[1]).
 *   - `update(memory_id, data)` → user_id NOT applicable (memory_id
 *     scopes the write); we don't rewrite.
 *   - `search(query, options)` → user_id in options (arg[1]).
 *   - `getAll(options)` → user_id in options (arg[0]).
 *
 * We construct a NEW args array; the caller's original args are not
 * mutated. Options field is spread; non-options args pass through.
 */
function rewriteMem0UserId(
  method: string,
  args: ReadonlyArray<unknown>,
  ctx: unknown,
  getTenantId: GetTenantId
): ReadonlyArray<unknown> {
  const tenantId = getTenantId(ctx);
  assertTenantIdSafe(tenantId);

  // Map method → options-args-position. `update` is omitted (memory_id-scoped).
  const optionsPos: Record<string, number | undefined> = {
    add: 1,
    search: 1,
    getAll: 0,
  };
  const pos = optionsPos[method];
  if (pos === undefined) return args;

  const orig = args[pos];
  const newOptions =
    orig !== null && typeof orig === 'object'
      ? { ...(orig as Record<string, unknown>), user_id: tenantId }
      : { user_id: tenantId };

  const newArgs = [...args];
  newArgs[pos] = newOptions;
  return newArgs;
}

/**
 * Build a Mem0 adapter bound to a specific `getTenantId` callback.
 *
 * Module-scope `mem0Adapter` is also exported for advanced callers
 * — it uses a "throw-if-called" getTenantId placeholder so any
 * attempt to use it without rewriting falls loud. Production
 * consumers MUST use `buildMem0Adapter(getTenantId)`.
 */
export function buildMem0Adapter(getTenantId: GetTenantId): MemoryAdapter {
  return {
    vendor: 'mem0',
    methods: MEM0_METHODS,

    route(invocation: AdapterInvocation): AdapterRoute {
      const { method, args, ctx } = invocation;
      switch (method) {
        case 'add':
          return {
            surface: 'memory_write',
            writeContent: extractAddContent(args),
            // Iter-1 security BLOCK #3: overwrite user_id with
            // getTenantId(ctx) to defeat cross-tenant write leak.
            rewriteArgs: rewriteMem0UserId('add', args, ctx, getTenantId),
          };
        case 'update':
          // `update(memory_id, data)` — memory_id scopes the write,
          // no user_id in args. Validate content; no rewrite needed.
          return {
            surface: 'memory_write',
            writeContent: extractUpdateContent(args),
          };
        case 'history':
        case 'reset':
          // No INPUT to validate; no recall result. Pass-through.
          return { surface: null };
        case 'search':
          return {
            surface: null,
            rewriteArgs: rewriteMem0UserId('search', args, ctx, getTenantId),
          };
        case 'getAll':
          return {
            surface: null,
            rewriteArgs: rewriteMem0UserId('getAll', args, ctx, getTenantId),
          };
        case 'get':
          // `get(memory_id)` — memory_id scopes the read, no user_id.
          // Recall path; validated POST-call.
          return { surface: null };
        default:
          return { surface: null };
      }
    },

    async validateResult(invocation, result, helpers): Promise<void> {
      const { method } = invocation;
      if (method !== 'search' && method !== 'get' && method !== 'getAll') return;
      const entries = extractRecallEntries(result);
      if (entries.length === 0) return;
      await helpers.runComposedContextValidator(entries);
    },
  };
}

/**
 * Module-scope adapter placeholder — throws if used directly.
 * Consumers MUST use `buildMem0Adapter(getTenantId)`; the per-vendor
 * `wrapMem0Client` factory wires this automatically.
 */
export const mem0Adapter: MemoryAdapter = buildMem0Adapter(() => {
  throw new ConnectorValidationError(
    `mem0Adapter (module-scope) was invoked without a getTenantId binding. ` +
      `Use buildMem0Adapter(getTenantId) or call wrapMem0Client(client, engine, { getTenantId, ... }).`,
    'configuration_error'
  );
});
