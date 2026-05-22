/**
 * Story 2.4a — ElizaOS ShadowLogStorageAdapter (Drizzle/PGlite)
 * ==============================================================
 *
 * Implements the `ShadowLogStorageAdapter` interface from Story 1.3b
 * for ElizaOS deployments that use Drizzle ORM with PGlite (the
 * default ElizaOS storage backend).
 *
 * **Storage isolation contract** (plan AC + iter-1 security): the
 * shadow log table MUST live in a separate DB connection, separate
 * schema, separate auth scope from the ElizaOS public HTTP routes.
 * If the ElizaOS HTTP API exposes `/memories` reads on the main
 * connection, the shadow log table on a separately-scoped connection
 * is INVISIBLE to those routes. Connector tests confirm no public
 * HTTP route can reach the shadow log table.
 *
 * The adapter accepts a Drizzle database client OR a custom
 * `ShadowLogStorageAdapter` shape (in-memory for tests, custom for
 * advanced deployments). Production deployments pass a Drizzle client
 * configured against an ISOLATED schema/connection.
 *
 * @package @blackunicorn/bonklm-elizaos
 */
import type {
  ReadByRoomOptions,
  ShadowLogEntry,
  ShadowLogSourceTrust,
  ShadowLogStorageAdapter,
} from '@blackunicorn/bonklm';

/**
 * Duck-typed Drizzle-like database client. We don't import `drizzle-orm`
 * directly to keep this package edge-portable; consumers pass their
 * own Drizzle/PGlite/postgres client configured against the isolated
 * shadow log schema.
 *
 * Required methods:
 *   - `insert(table, values): Promise<void>`
 *   - `selectByRoom(roomId, opts): Promise<ShadowLogRow[]>`
 *   - `selectLatestHashForRoom(roomId): Promise<string | null>`
 *   - `countByRoom(roomId): Promise<number>`
 *   - `totalCount(): Promise<number>`
 *   - `deleteOldestForRoom(roomId): Promise<void>`
 *
 * Consumers wire these against Drizzle's `db.insert(shadowLogTable).values(...)`
 * etc.
 */
export interface DrizzleShadowLogClient {
  insert(values: ShadowLogEntry): Promise<void>;
  selectByRoom(roomId: string, opts?: ReadByRoomOptions): Promise<ShadowLogEntry[]>;
  selectLatestHashForRoom(roomId: string): Promise<string | null>;
  countByRoom?(roomId: string): Promise<number>;
  totalCount?(): Promise<number>;
  deleteOldestForRoom?(roomId: string): Promise<void>;
}

/**
 * Options for `createElizaOSDrizzleShadowLogStorage`.
 */
export interface DrizzleShadowLogStorageOptions {
  /** Duck-typed Drizzle client (consumer-provided). */
  client: DrizzleShadowLogClient;
  /**
   * Schema name where the shadow log table lives. Per the storage-
   * isolation contract this MUST be a separate schema from the
   * ElizaOS public schema (typically `bonklm_shadow` vs `public`).
   * Default `'bonklm_shadow'`.
   */
  schemaName?: string;
}

/**
 * Build a Drizzle-backed `ShadowLogStorageAdapter` for ElizaOS.
 *
 * The returned adapter delegates to the client's CRUD methods.
 * Production deployments wire `client` against a Drizzle instance
 * configured for an ISOLATED schema; tests can pass an in-memory
 * client implementing the same shape.
 */
export function createElizaOSDrizzleShadowLogStorage(
  options: DrizzleShadowLogStorageOptions
): ShadowLogStorageAdapter {
  const { client } = options;

  return {
    async append(entry: ShadowLogEntry): Promise<void> {
      await client.insert(entry);
    },
    async readByRoom(
      roomId: string,
      opts?: ReadByRoomOptions
    ): Promise<ShadowLogEntry[]> {
      return client.selectByRoom(roomId, opts);
    },
    async getLatestHashForRoom(roomId: string): Promise<string | null> {
      return client.selectLatestHashForRoom(roomId);
    },
    async countByRoom(roomId: string): Promise<number> {
      return (await client.countByRoom?.(roomId)) ?? 0;
    },
    async totalCount(): Promise<number> {
      return (await client.totalCount?.()) ?? 0;
    },
    async evictOldestForRoom(roomId: string): Promise<void> {
      await client.deleteOldestForRoom?.(roomId);
    },
  };
}

/**
 * Typed error class for cross-room authorization failures.
 *
 * Iter-1 security A&D #5: previously `assertRoomAccess` threw a raw
 * `Error` whose `.message` included `requestedRoomId` verbatim. A
 * naive caller doing `catch (e) { res.json({ error: e.message }) }`
 * would leak the room ID into the public response.
 *
 * `ShadowLogAuthError` carries a `.publicMessage` field (generic,
 * always safe to forward) AND a `.detailMessage` (internal, contains
 * the roomId — for logger / telemetry only).
 *
 * Connector consumers MUST forward `.publicMessage` to HTTP
 * responses, NEVER `.message` / `.detailMessage`.
 */
export class ShadowLogAuthError extends Error {
  /** Public-safe error message — always generic, no roomId. */
  public readonly publicMessage: string;
  /** Internal detail message — includes roomId for logging only. */
  public readonly detailMessage: string;
  constructor(publicMessage: string, detailMessage: string) {
    super(detailMessage);
    this.name = 'ShadowLogAuthError';
    this.publicMessage = publicMessage;
    this.detailMessage = detailMessage;
  }
}

/**
 * Cross-room authorization helper. Per the Story 1.3b contract, the
 * shadow log does NOT enforce cross-room boundaries — connectors do.
 *
 * This helper is exposed for the ElizaOS connector's `readByRoom`
 * call sites: pass the requesting session's `authenticatedRoomIds`
 * Set (built from the session's authenticated context) and the
 * `requestedRoomId`. Throws `ShadowLogAuthError` when the room is
 * not in the authorised set.
 *
 * **Iter-1 security A&D #5**: callers handling the throw MUST forward
 * `.publicMessage` to HTTP responses, NEVER `.message` (which leaks
 * the roomId for telemetry purposes).
 *
 * Usage example (inside the connector, NOT in the shadow log itself):
 *
 *   try {
 *     assertRoomAccess(session.authenticatedRoomIds, requestedRoomId);
 *     const entries = await shadowLog.readByRoom(requestedRoomId);
 *   } catch (e) {
 *     if (e instanceof ShadowLogAuthError) {
 *       res.status(403).json({ error: e.publicMessage });
 *     } else { throw e; }
 *   }
 */
export function assertRoomAccess(
  authenticatedRoomIds: Set<string> | undefined,
  requestedRoomId: string
): void {
  if (authenticatedRoomIds === undefined) {
    throw new ShadowLogAuthError(
      'Cross-room access denied; admin review required.',
      `ElizaOS shadow log: refusing readByRoom('${requestedRoomId}') — ` +
        `no authenticated room set in session context. The caller MUST validate room ` +
        `authorisation against the session BEFORE invoking shadowLog.readByRoom.`
    );
  }
  if (!authenticatedRoomIds.has(requestedRoomId)) {
    throw new ShadowLogAuthError(
      'Cross-room access denied; admin review required.',
      `ElizaOS shadow log: refusing readByRoom('${requestedRoomId}') — ` +
        `room is NOT in the authenticated session's room set. Cross-room access blocked.`
    );
  }
}

/**
 * Map an ElizaOS `EventType.MESSAGE_RECEIVED` event to a
 * `ShadowLogAppendInput`. Used by the connector's event handler
 * before any ElizaOS persistence layer touches the memory.
 *
 * The `sourceTrust` is derived from the message origin — the connector
 * passes `'authenticated'` for verified-session inbound messages,
 * `'unauthenticated_http'` for raw HTTP API POSTs (the Class-4
 * vulnerability surface), and `'agent_internal'` for tool-call /
 * action-internal writes.
 */
export interface ElizaMessageReceivedEvent {
  messageId: string;
  roomId: string;
  entityId: string;
  content: { text?: string };
}

export function mapMessageReceivedToShadowLog(
  event: ElizaMessageReceivedEvent,
  sourceTrust: ShadowLogSourceTrust
): {
  messageId: string;
  roomId: string;
  entityId: string;
  text: string;
  sourceTrust: ShadowLogSourceTrust;
} {
  return {
    messageId: event.messageId,
    roomId: event.roomId,
    entityId: event.entityId,
    text: event.content?.text ?? '',
    sourceTrust,
  };
}
