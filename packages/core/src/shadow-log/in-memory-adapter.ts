/**
 * Story 1.3b — In-memory ShadowLogStorageAdapter
 * ===============================================
 *
 * Default adapter shipping in core for tests + tiny deployments.
 * Stores entries in a `Map<roomId, ShadowLogEntry[]>` keyed by room;
 * each room's array preserves insertion order so `getLatestHashForRoom`
 * returns the most-recent entry's `contentHash`.
 *
 * Iter-1 architect note: this adapter is NOT durable — restart
 * loses all entries. Production deployments use the Drizzle/PGlite
 * adapter from `@blackunicorn/bonklm-elizaos` (Story 2.4a) or the
 * Cloudflare DO adapter (Story 3.8).
 *
 * @package @blackunicorn/bonklm
 */
import type { ReadByRoomOptions, ShadowLogEntry, ShadowLogSourceTrust, ShadowLogStorageAdapter } from './types.js';

/**
 * Build an in-memory shadow log storage adapter. No options today;
 * future fields (e.g. `enableExportSnapshot`) land here.
 */
export function createInMemoryShadowLogStorage(): ShadowLogStorageAdapter {
  const byRoom = new Map<string, ShadowLogEntry[]>();
  let totalCount = 0;

  return {
    async append(entry: ShadowLogEntry): Promise<void> {
      let bucket = byRoom.get(entry.roomId);
      if (bucket === undefined) {
        bucket = [];
        byRoom.set(entry.roomId, bucket);
      }
      bucket.push(entry);
      totalCount++;
    },

    async readByRoom(roomId: string, opts?: ReadByRoomOptions): Promise<ShadowLogEntry[]> {
      const bucket = byRoom.get(roomId);
      if (bucket === undefined) return [];
      const since = opts?.since ?? 0;
      const limit = opts?.limit ?? 100;
      const sourceFilter = normaliseSourceFilter(opts?.sourceTrust);

      const filtered: ShadowLogEntry[] = [];
      for (const entry of bucket) {
        if (entry.createdAt < since) continue;
        if (sourceFilter !== null && !sourceFilter.has(entry.sourceTrust)) continue;
        filtered.push(entry);
        if (filtered.length >= limit) break;
      }
      return filtered;
    },

    async getLatestHashForRoom(roomId: string): Promise<string | null> {
      const bucket = byRoom.get(roomId);
      if (bucket === undefined || bucket.length === 0) return null;
      return bucket[bucket.length - 1].contentHash;
    },

    async countByRoom(roomId: string): Promise<number> {
      return byRoom.get(roomId)?.length ?? 0;
    },

    async totalCount(): Promise<number> {
      return totalCount;
    },

    async evictOldestForRoom(roomId: string): Promise<void> {
      const bucket = byRoom.get(roomId);
      if (bucket === undefined || bucket.length === 0) return;
      bucket.shift();
      totalCount--;
    }
  };
}

function normaliseSourceFilter(
  filter: ShadowLogSourceTrust | ShadowLogSourceTrust[] | undefined
): Set<ShadowLogSourceTrust> | null {
  if (filter === undefined) return null;
  return new Set(Array.isArray(filter) ? filter : [filter]);
}
