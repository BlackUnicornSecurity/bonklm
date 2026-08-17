/**
 * Shadow Log Primitive (Types)
 * ==========================================
 *
 * `ShadowLog` is a tamper-evident, hash-chained, append-only record
 * of inbound messages BEFORE any vendor persistence layer touches
 * them. ElizaOS uses it to close the Class-4 vulnerability
 * where an unauthenticated HTTP PATCH against the runtime's
 * `/memories` route mutates a persisted user message — the
 * `ToolCallArgsValidator` then reads attacker-controlled "user authored"
 * content from `runtime.getMemories(...)`. By writing every
 * MESSAGE_RECEIVED event to the shadow log first, the validator can
 * read from a separately-scoped, hash-chained source.
 *
 * Other consumers tracked in `docs/user/shadow-log-consumers.md`:
 * - Mem0 — additive integrity check on archival memory.
 * - Zep — same.
 * - Cloudflare DO setState — tamper-evident agent state.
 *
 * @package @blackunicorn/bonklm
 */

/**
 * Source-trust tag carried on every shadow log entry. Matches the
 * `SourceTrust` taxonomy used by the ElizaOS connector.
 */
export type ShadowLogSourceTrust = 'authenticated' | 'unauthenticated_http' | 'agent_internal';

/**
 * A single shadow log entry. Hash-chained via `prevEntryHash` so any
 * tamper to a prior entry's `contentHash` breaks the chain on
 * `verifyChain`.
 *
 * Chain link rule: `prevEntryHash === sha256(prevEntry.contentHash + (prevEntry.prevEntryHash ?? ''))`.
 */
export interface ShadowLogEntry {
  /** Message UUID (provided by caller; the shadow log does not generate). */
  messageId: string;
  /** Room UUID scoping the entry. `readByRoom` filters by this. */
  roomId: string;
  /** Authoring entity UUID. */
  entityId: string;
  /** The message text as it arrived (pre-vendor-persistence). */
  text: string;
  /** sha256 hex digest of the text + sourceTrust + entityId. */
  contentHash: string;
  /** sha256 hex digest of the previous entry in this room's chain, or null for genesis. */
  prevEntryHash: string | null;
  /** Unix ms timestamp at append time. */
  createdAt: number;
  /** Source-trust tag — drives the read-side filter in ToolCallArgsValidator. */
  sourceTrust: ShadowLogSourceTrust;
}

/**
 * Input shape for `ShadowLog.append`. The shadow log computes
 * `contentHash`, `prevEntryHash`, and `createdAt` internally —
 * callers cannot supply them. This is a security property: an
 * attacker who can call `append(...)` cannot inject a forged hash
 * chain because the implementation always recomputes from the canonical
 * `text + sourceTrust + entityId` triple.
 */
export interface ShadowLogAppendInput {
  messageId: string;
  roomId: string;
  entityId: string;
  text: string;
  sourceTrust: ShadowLogSourceTrust;
}

/**
 * Options for `readByRoom`. Defaults are documented per field.
 */
export interface ReadByRoomOptions {
  /**
   * Filter entries by source trust. When omitted, all entries are
   * returned. ElizaOS ToolCallArgsValidator passes
   * `sourceTrust: 'authenticated'` to exclude attacker-mutable
   * unauthenticated_http entries from the user-authored-message lookup.
   */
  sourceTrust?: ShadowLogSourceTrust | ShadowLogSourceTrust[];
  /**
   * Maximum entries to return. Default 100. Cap is the per-room
   * total of stored entries.
   */
  limit?: number;
  /**
   * Return entries `createdAt >= since` (Unix ms). Default 0
   * (= all entries).
   */
  since?: number;
}

/**
 * Result of `verifyChain`. When `ok: false`, `brokenAt` identifies
 * the position of the first tampered entry in the room's chain.
 *
 * **CRITICAL — `brokenAt` containment** (audit-loop BC1 + iter-1
 * security): the `brokenAt` value MUST NOT propagate to public-facing
 * HTTP responses, hook metadata, or error message text exposed to
 * external callers. Attacker observation of `brokenAt` enables
 * targeted re-injection at the exact tamper position. The connector's
 * public error string is "shadow log integrity check failed; admin
 * review required" (NO position info). `brokenAt` is consumable ONLY
 * inside the connector for CRITICAL telemetry + internal logging.
 */
export type VerifyChainResult = { ok: true } | { ok: false; brokenAt: number };

/**
 * Eviction policy when storage caps are reached.
 *
 * - `'refuse-write'`: append throws ConnectorValidationError so
 *   tampering surfaces loudly. Default — preferred for production.
 * - `'drop-oldest'`: silently evict the oldest entry in the room.
 *   Acceptable for high-throughput non-security-critical deployments.
 *
 * Iter-1 architect note: when storage refuses writes, the operator
 * sees the failure immediately. Drop-oldest is the right policy for
 * `Mem0` / `Zep` mirroring use cases where the shadow log is an
 * additive check, NOT the primary trust source.
 */
export type EvictionPolicy = 'refuse-write' | 'drop-oldest';

/**
 * Storage adapter interface. Connectors provide implementations:
 *  - In-memory (`createInMemoryShadowLogStorage()`) — ships in core.
 *  - SQLite / PGlite / Drizzle — `@blackunicorn/bonklm-elizaos`
 *    ships.
 *  - Cloudflare DO `setState`.
 *
 * **Cross-room authorization is the CALLER's responsibility**: the
 * adapter does NOT validate that the requesting session is authorised
 * to read `roomId`. The connector layer (the ElizaOS
 * connector + future consumers) MUST validate `roomId` against the
 * authenticated session context BEFORE calling
 * `adapter.readByRoom(roomId, ...)`. Adapter-level enforcement would
 * require coupling the storage layer to vendor session models — out
 * of scope for the primitive.
 */
export interface ShadowLogStorageAdapter {
  /**
   * Append an entry. Implementation MUST honour the room-scoped
   * hash chain (computed by the `ShadowLog` factory, NOT the adapter).
   * Adapter throws `Error('storage_full')` when the eviction policy
   * is `'refuse-write'` AND a cap would be exceeded.
   */
  append(entry: ShadowLogEntry): Promise<void>;
  /**
   * Read entries scoped to `roomId`. MAY return them ordered by
   * `createdAt` ascending OR returning the array as stored — the
   * `ShadowLog` facade does NOT depend on ordering for chain
   * verification (it walks `prevEntryHash` pointers).
   *
   * Returns an empty array when the room has no entries.
   */
  readByRoom(roomId: string, opts?: ReadByRoomOptions): Promise<ShadowLogEntry[]>;
  /**
   * Get the most recent entry's hash for a room. Used by `append`
   * to compute `prevEntryHash` for a new entry. Returns `null` when
   * the room has no entries (genesis).
   */
  getLatestHashForRoom(roomId: string): Promise<string | null>;
  /**
   * Optional: count entries per-room (for bounded-storage enforcement).
   * Adapters that maintain their own cap tracking can implement
   * this; the `ShadowLog` factory uses it to enforce
   * `maxEntriesPerRoom`.
   */
  countByRoom?(roomId: string): Promise<number>;
  /**
   * Optional: total entry count across all rooms (for
   * `maxTotalEntries` enforcement).
   */
  totalCount?(): Promise<number>;
  /**
   * Optional: evict the oldest entry in a room. Called by the
   * `ShadowLog` factory when `evictionPolicy === 'drop-oldest'` and a
   * cap would be exceeded. Adapters that don't implement this fall
   * back to `'refuse-write'` semantics for cap-overflow.
   */
  evictOldestForRoom?(roomId: string): Promise<void>;
}

/**
 * Public `ShadowLog` interface — returned by `createShadowLog(adapter)`.
 * Consumers (ElizaOS connector, future memory connectors)
 * interact with this; they do NOT directly touch the storage adapter.
 *
 * @public v1.0-RC1 API freeze. `append` / `readByRoom` /
 * `verifyChain` signatures + the canonical hash chain (sha256 of
 * `text + sourceTrust + entityId`, chained via prev entry hash) are
 * frozen. Storage adapters are an `@public` extension point —
 * `ShadowLogStorageAdapter` shape is part of the freeze.
 */
export interface ShadowLog {
  /**
   * Append a new entry to the shadow log. The factory computes the
   * canonical `contentHash` (sha256 of `text + sourceTrust + entityId`),
   * resolves the chain `prevEntryHash` via
   * `adapter.getLatestHashForRoom`, applies bounded-storage policy,
   * then forwards to the adapter.
   *
   * Throws `ConnectorValidationError('storage_full')` when caps are
   * reached and policy is `'refuse-write'`.
   */
  append(input: ShadowLogAppendInput): Promise<ShadowLogEntry>;
  /**
   * Read entries scoped to a room. Caller MUST have validated the
   * room's authorisation context — the shadow log does NOT enforce
   * cross-room boundaries.
   */
  readByRoom(roomId: string, opts?: ReadByRoomOptions): Promise<ShadowLogEntry[]>;
  /**
   * Verify the hash chain of all entries in a room. Returns
   * `{ ok: true }` when intact OR `{ ok: false, brokenAt: number }`
   * pointing at the first tampered position.
   *
   * `brokenAt` is INTERNAL — see the JSDoc on `VerifyChainResult`
   * for the public-facing error containment contract.
   */
  verifyChain(roomId: string): Promise<VerifyChainResult>;
}

/**
 * Options for `createShadowLog(adapter, options?)`.
 */
export interface CreateShadowLogOptions {
  /**
   * Maximum entries stored per-room. When exceeded, eviction policy
   * applies. Default 10_000.
   */
  maxEntriesPerRoom?: number;
  /**
   * Maximum total entries across all rooms. Default 1_000_000.
   */
  maxTotalEntries?: number;
  /**
   * Eviction policy when caps are reached. Default `'refuse-write'`
   * — tampering surfaces loudly. Use `'drop-oldest'` only for
   * additive-check deployments where the shadow log is not the
   * primary trust source.
   */
  evictionPolicy?: EvictionPolicy;
}
