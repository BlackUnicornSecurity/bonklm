/**
 * Story 1.3b — Shadow Log factory
 * ================================
 *
 * `createShadowLog(adapter, options?)` returns a `ShadowLog` facade
 * over a storage adapter. The facade owns:
 *   - `contentHash` computation (sha256 of canonical
 *     `text + sourceTrust + entityId`).
 *   - `prevEntryHash` chain-link computation (consults the adapter).
 *   - Bounded-storage policy enforcement (per-room + total caps).
 *   - `verifyChain` walk that recomputes every entry's hash and
 *     confirms each `prevEntryHash` matches the prior entry's
 *     `contentHash + (prevEntryHash ?? '')` digest.
 *
 * Adapters carry storage only — they do NOT compute hashes or
 * enforce caps. The factory enforces these uniformly so a buggy
 * adapter cannot weaken the integrity guarantees.
 *
 * @package @blackunicorn/bonklm
 */
import { ConnectorValidationError } from '../connector-utils/errors.js';
import { sha256Hex } from './sha256.js';
import type {
  CreateShadowLogOptions,
  ReadByRoomOptions,
  ShadowLog,
  ShadowLogAppendInput,
  ShadowLogEntry,
  ShadowLogStorageAdapter,
  VerifyChainResult
} from './types.js';

const DEFAULT_MAX_ENTRIES_PER_ROOM = 10_000;
const DEFAULT_MAX_TOTAL_ENTRIES = 1_000_000;

/**
 * Compute the canonical contentHash for a shadow log entry.
 *
 * Iter-1 security A&D #2: ALL three input fields are length-prefixed
 * so an attacker who controls `text` AND `entityId` cannot craft
 * collisions across different (text, sourceTrust, entityId) triples.
 * The previous form length-prefixed only `text`, leaving the
 * sourceTrust/entityId boundary ambiguous if entityId contained `|`.
 *
 * Canonical form: `${len(text)}:${text}|${len(sourceTrust)}:${sourceTrust}|${len(entityId)}:${entityId}`
 *
 * Exported for tests; consumers should use `ShadowLog.append` which
 * applies this internally.
 */
export async function computeContentHash(text: string, sourceTrust: string, entityId: string): Promise<string> {
  const canonical =
    `${text.length}:${text}` + `|${sourceTrust.length}:${sourceTrust}` + `|${entityId.length}:${entityId}`;
  return sha256Hex(canonical);
}

/**
 * Compute the chain-link digest. Chain rule:
 *   `prevEntryHash === sha256(prevEntry.contentHash + (prevEntry.prevEntryHash ?? ''))`
 *
 * Exported for tests + verifyChain.
 */
export async function computeChainLinkHash(prevContentHash: string, prevPrevEntryHash: string | null): Promise<string> {
  return sha256Hex(prevContentHash + (prevPrevEntryHash ?? ''));
}

export function createShadowLog(adapter: ShadowLogStorageAdapter, options: CreateShadowLogOptions = {}): ShadowLog {
  const maxEntriesPerRoom = options.maxEntriesPerRoom ?? DEFAULT_MAX_ENTRIES_PER_ROOM;
  const maxTotalEntries = options.maxTotalEntries ?? DEFAULT_MAX_TOTAL_ENTRIES;
  const evictionPolicy = options.evictionPolicy ?? 'refuse-write';

  if (maxEntriesPerRoom < 1) {
    throw new ConnectorValidationError(
      `createShadowLog: maxEntriesPerRoom must be ≥ 1; received ${maxEntriesPerRoom}`,
      'configuration_error'
    );
  }
  if (maxTotalEntries < 1) {
    throw new ConnectorValidationError(
      `createShadowLog: maxTotalEntries must be ≥ 1; received ${maxTotalEntries}`,
      'configuration_error'
    );
  }

  // Iter-1 security BLOCK #6 — per-room async mutex. Two concurrent
  // `append` calls to the same room would otherwise both read the
  // same prior `contentHash`, compute the same `prevEntryHash`, and
  // produce two entries with identical chain links — silent chain
  // corruption. The lock serializes appends per room.
  const roomLocks = new Map<string, Promise<void>>();
  async function withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const prior = roomLocks.get(roomId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>(resolve => {
      release = resolve;
    });
    roomLocks.set(
      roomId,
      prior.then(() => next)
    );
    try {
      await prior;
      return await fn();
    } finally {
      release();
      // Clean up the lock when the chain is fully drained.
      if (roomLocks.get(roomId) === prior.then(() => next)) {
        roomLocks.delete(roomId);
      }
    }
  }

  return {
    async append(input: ShadowLogAppendInput): Promise<ShadowLogEntry> {
      return withRoomLock(input.roomId, async () => {
        // Compute canonical hashes BEFORE talking to the adapter so a
        // buggy adapter cannot influence the chain link.
        const contentHash = await computeContentHash(input.text, input.sourceTrust, input.entityId);

        // Read the prior entry's contentHash to derive prevEntryHash
        // for the new entry. Inside the lock these two reads are
        // serialised against other appends to the same room.
        const prevContentHash = await adapter.getLatestHashForRoom(input.roomId);

        let prevEntryHash: string | null;
        if (prevContentHash === null) {
          prevEntryHash = null; // genesis entry
        } else {
          const recent = await adapter.readByRoom(input.roomId, {
            limit: Number.MAX_SAFE_INTEGER
          });
          const matchingPrior = recent.find(e => e.contentHash === prevContentHash);
          const priorPrev = matchingPrior?.prevEntryHash ?? null;
          prevEntryHash = await computeChainLinkHash(prevContentHash, priorPrev);
        }

        const entry: ShadowLogEntry = {
          messageId: input.messageId,
          roomId: input.roomId,
          entityId: input.entityId,
          text: input.text,
          contentHash,
          prevEntryHash,
          createdAt: Date.now(),
          sourceTrust: input.sourceTrust
        };

        // Apply bounded-storage policy BEFORE the adapter write so an
        // overflowing room never gets a partial append.
        await applyBoundedStoragePolicy({
          adapter,
          roomId: input.roomId,
          maxEntriesPerRoom,
          maxTotalEntries,
          evictionPolicy
        });

        await adapter.append(entry);

        // Iter-1 security A&D #10: adapter-boundary re-validation.
        // Read back the latest hash; assert the adapter stored what we
        // sent. Catches buggy adapter implementations (schema mismatch,
        // type coercion truncation) at the source.
        const persistedHash = await adapter.getLatestHashForRoom(input.roomId);
        if (persistedHash !== contentHash) {
          throw new ConnectorValidationError(
            `Shadow log adapter integrity check failed: persisted contentHash does not match computed value. ` +
              `Adapter implementation is buggy or storage layer is corrupting writes.`,
            'storage_integrity_failure'
          );
        }

        return entry;
      });
    },

    async readByRoom(roomId: string, opts?: ReadByRoomOptions): Promise<ShadowLogEntry[]> {
      return adapter.readByRoom(roomId, opts);
    },

    async verifyChain(roomId: string): Promise<VerifyChainResult> {
      // Read ALL entries for the room. `verifyChain` is an audit
      // operation, not a hot path — we tolerate full scan.
      const entries = await adapter.readByRoom(roomId, { limit: Number.MAX_SAFE_INTEGER });
      if (entries.length === 0) return { ok: true };

      // Sort by createdAt ascending so the chain walks in insertion order.
      const ordered = [...entries].sort((a, b) => a.createdAt - b.createdAt);

      let expectedPrevContentHash: string | null = null;
      let expectedPrevPrevEntryHash: string | null = null;

      for (let i = 0; i < ordered.length; i++) {
        const entry = ordered[i];

        // 1. Verify entry's own contentHash is canonical.
        const recomputedContentHash = await computeContentHash(entry.text, entry.sourceTrust, entry.entityId);
        if (recomputedContentHash !== entry.contentHash) {
          return { ok: false, brokenAt: i };
        }

        // 2. Verify the chain link.
        if (expectedPrevContentHash === null) {
          // Genesis — prevEntryHash MUST be null.
          if (entry.prevEntryHash !== null) {
            return { ok: false, brokenAt: i };
          }
        } else {
          const expectedChainLink = await computeChainLinkHash(expectedPrevContentHash, expectedPrevPrevEntryHash);
          if (entry.prevEntryHash !== expectedChainLink) {
            return { ok: false, brokenAt: i };
          }
        }

        // Advance the rolling reference.
        expectedPrevContentHash = entry.contentHash;
        expectedPrevPrevEntryHash = entry.prevEntryHash;
      }

      return { ok: true };
    }
  };
}

/**
 * Apply bounded-storage caps. Refuse the write when the eviction
 * policy is `'refuse-write'` and a cap would be exceeded; evict the
 * oldest entry in the room (if the adapter supports it) when the
 * policy is `'drop-oldest'`.
 */
async function applyBoundedStoragePolicy(args: {
  adapter: ShadowLogStorageAdapter;
  roomId: string;
  maxEntriesPerRoom: number;
  maxTotalEntries: number;
  evictionPolicy: 'refuse-write' | 'drop-oldest';
}): Promise<void> {
  const { adapter, roomId, maxEntriesPerRoom, maxTotalEntries, evictionPolicy } = args;

  const roomCount = (await adapter.countByRoom?.(roomId)) ?? 0;
  const totalCount = (await adapter.totalCount?.()) ?? 0;

  const roomFull = roomCount >= maxEntriesPerRoom;
  const totalFull = totalCount >= maxTotalEntries;

  if (!roomFull && !totalFull) return;

  if (evictionPolicy === 'refuse-write') {
    throw new ConnectorValidationError(
      `ShadowLog storage cap reached (roomCount=${roomCount}/${maxEntriesPerRoom}, ` +
        `totalCount=${totalCount}/${maxTotalEntries}). Refusing write per policy ` +
        `'refuse-write' (use evictionPolicy: 'drop-oldest' to silently evict).`,
      'storage_full'
    );
  }

  // drop-oldest: evict from the affected room. If total is full
  // without room being full, we still evict from the requested room
  // (preserves room-affinity behaviour); total-budget enforcement is
  // best-effort with the drop-oldest policy.
  if (typeof adapter.evictOldestForRoom === 'function') {
    await adapter.evictOldestForRoom(roomId);
  } else {
    // Adapter doesn't implement eviction — fall back to refuse-write.
    throw new ConnectorValidationError(
      `ShadowLog storage cap reached and adapter does not implement evictOldestForRoom. ` +
        `Either provide an adapter with evictOldestForRoom OR use evictionPolicy: 'refuse-write'.`,
      'storage_full'
    );
  }
}
