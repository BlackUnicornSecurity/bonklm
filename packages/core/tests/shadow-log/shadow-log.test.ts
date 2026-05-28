/**
 * Story 1.3b — Shadow Log primitive tests.
 */
import { describe, expect, it } from 'vitest';
import {
  createShadowLog,
  createInMemoryShadowLogStorage,
  computeContentHash,
  computeChainLinkHash,
  type ShadowLogEntry,
  type ShadowLogStorageAdapter
} from '../../src/shadow-log/index.js';
import { ConnectorValidationError } from '../../src/connector-utils/errors.js';

function makeLog(opts?: Parameters<typeof createShadowLog>[1]) {
  return createShadowLog(createInMemoryShadowLogStorage(), opts);
}

describe('shadow-log — append + readByRoom', () => {
  it('appends a genesis entry with prevEntryHash=null', async () => {
    const log = makeLog();
    const entry = await log.append({
      messageId: 'm-1',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'hello',
      sourceTrust: 'authenticated'
    });
    expect(entry.prevEntryHash).toBeNull();
    expect(entry.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.text).toBe('hello');
    expect(entry.sourceTrust).toBe('authenticated');
    expect(entry.createdAt).toBeGreaterThan(0);
  });

  it('chains entries — second entry prevEntryHash links to first', async () => {
    const log = makeLog();
    const a = await log.append({
      messageId: 'a',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'first',
      sourceTrust: 'authenticated'
    });
    const b = await log.append({
      messageId: 'b',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'second',
      sourceTrust: 'authenticated'
    });
    const expectedLink = await computeChainLinkHash(a.contentHash, a.prevEntryHash);
    expect(b.prevEntryHash).toBe(expectedLink);
  });

  it('different rooms have independent chains', async () => {
    const log = makeLog();
    const aRoom1 = await log.append({
      messageId: 'm1',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'room-1',
      sourceTrust: 'authenticated'
    });
    const aRoom2 = await log.append({
      messageId: 'm2',
      roomId: 'r-2',
      entityId: 'e-1',
      text: 'room-2',
      sourceTrust: 'authenticated'
    });
    // Both are genesis for their respective rooms.
    expect(aRoom1.prevEntryHash).toBeNull();
    expect(aRoom2.prevEntryHash).toBeNull();
  });

  it('readByRoom returns empty for unknown room', async () => {
    const log = makeLog();
    expect(await log.readByRoom('no-such-room')).toEqual([]);
  });

  it('readByRoom filters by sourceTrust', async () => {
    const log = makeLog();
    await log.append({
      messageId: 'a',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'auth',
      sourceTrust: 'authenticated'
    });
    await log.append({
      messageId: 'b',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'http',
      sourceTrust: 'unauthenticated_http'
    });
    const authOnly = await log.readByRoom('r-1', { sourceTrust: 'authenticated' });
    expect(authOnly.length).toBe(1);
    expect(authOnly[0].text).toBe('auth');
  });

  it('readByRoom respects limit', async () => {
    const log = makeLog();
    for (let i = 0; i < 5; i++) {
      await log.append({
        messageId: `m-${i}`,
        roomId: 'r-1',
        entityId: 'e-1',
        text: `msg ${i}`,
        sourceTrust: 'authenticated'
      });
    }
    expect((await log.readByRoom('r-1', { limit: 2 })).length).toBe(2);
  });
});

describe('shadow-log — verifyChain', () => {
  it('returns ok=true on intact chain', async () => {
    const log = makeLog();
    await log.append({
      messageId: 'a',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'first',
      sourceTrust: 'authenticated'
    });
    await log.append({
      messageId: 'b',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'second',
      sourceTrust: 'authenticated'
    });
    expect(await log.verifyChain('r-1')).toEqual({ ok: true });
  });

  it('returns ok=true on empty room', async () => {
    const log = makeLog();
    expect(await log.verifyChain('empty-room')).toEqual({ ok: true });
  });

  it('detects tampered contentHash via custom adapter', async () => {
    // Build a custom adapter that lets us mutate stored entries.
    const stored = new Map<string, ShadowLogEntry[]>();
    let total = 0;
    const adapter: ShadowLogStorageAdapter = {
      async append(entry) {
        let bucket = stored.get(entry.roomId);
        if (bucket === undefined) {
          bucket = [];
          stored.set(entry.roomId, bucket);
        }
        bucket.push({ ...entry });
        total++;
      },
      async readByRoom(roomId) {
        return [...(stored.get(roomId) ?? [])];
      },
      async getLatestHashForRoom(roomId) {
        const bucket = stored.get(roomId);
        return bucket && bucket.length > 0 ? bucket[bucket.length - 1].contentHash : null;
      },
      async countByRoom(roomId) {
        return stored.get(roomId)?.length ?? 0;
      },
      async totalCount() {
        return total;
      }
    };
    const log = createShadowLog(adapter);
    await log.append({
      messageId: 'a',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'first',
      sourceTrust: 'authenticated'
    });
    await log.append({
      messageId: 'b',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'second',
      sourceTrust: 'authenticated'
    });

    // Tamper the second entry's text in-place WITHOUT recomputing
    // the contentHash. verifyChain MUST detect this.
    const bucket = stored.get('r-1')!;
    bucket[1] = { ...bucket[1], text: 'ATTACKER-MUTATED' };
    const result = await log.verifyChain('r-1');
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.brokenAt).toBe(1);
    }
  });

  it('detects a missing genesis (non-null prevEntryHash on first entry)', async () => {
    const stored = new Map<string, ShadowLogEntry[]>();
    const adapter: ShadowLogStorageAdapter = {
      async append(entry) {
        let bucket = stored.get(entry.roomId);
        if (bucket === undefined) {
          bucket = [];
          stored.set(entry.roomId, bucket);
        }
        bucket.push({ ...entry });
      },
      async readByRoom(roomId) {
        return [...(stored.get(roomId) ?? [])];
      },
      async getLatestHashForRoom(roomId) {
        const bucket = stored.get(roomId);
        return bucket && bucket.length > 0 ? bucket[bucket.length - 1].contentHash : null;
      }
    };
    const log = createShadowLog(adapter);
    await log.append({
      messageId: 'a',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'first',
      sourceTrust: 'authenticated'
    });
    // Tamper genesis prevEntryHash.
    const bucket = stored.get('r-1')!;
    bucket[0] = { ...bucket[0], prevEntryHash: 'attacker-injected' };
    const result = await log.verifyChain('r-1');
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.brokenAt).toBe(0);
  });
});

describe('shadow-log — concurrent append (BLOCK #6 — per-room mutex)', () => {
  it('two concurrent appends to the same room produce a valid chain', async () => {
    const log = makeLog();
    await Promise.all([
      log.append({
        messageId: 'a',
        roomId: 'r-1',
        entityId: 'e-1',
        text: 'first',
        sourceTrust: 'authenticated'
      }),
      log.append({
        messageId: 'b',
        roomId: 'r-1',
        entityId: 'e-1',
        text: 'second',
        sourceTrust: 'authenticated'
      })
    ]);
    expect(await log.verifyChain('r-1')).toEqual({ ok: true });
  });

  it('50 concurrent appends to the same room produce a valid chain (mutex stress)', async () => {
    const log = makeLog();
    const promises = Array.from({ length: 50 }, (_, i) =>
      log.append({
        messageId: `m-${i}`,
        roomId: 'stress',
        entityId: 'e-1',
        text: `message ${i}`,
        sourceTrust: 'authenticated'
      })
    );
    await Promise.all(promises);
    expect(await log.verifyChain('stress')).toEqual({ ok: true });

    // All 50 entries persisted.
    const entries = await log.readByRoom('stress', { limit: 100 });
    expect(entries.length).toBe(50);
  });

  it('concurrent appends to DIFFERENT rooms do not block each other', async () => {
    const log = makeLog();
    // Mostly a smoke test — mutex is keyed by roomId.
    await Promise.all([
      log.append({
        messageId: 'a',
        roomId: 'r-1',
        entityId: 'e-1',
        text: '1',
        sourceTrust: 'authenticated'
      }),
      log.append({
        messageId: 'b',
        roomId: 'r-2',
        entityId: 'e-1',
        text: '2',
        sourceTrust: 'authenticated'
      })
    ]);
    expect(await log.verifyChain('r-1')).toEqual({ ok: true });
    expect(await log.verifyChain('r-2')).toEqual({ ok: true });
  });
});

describe('shadow-log — adapter-boundary contentHash re-validation (A&D #10)', () => {
  it('throws storage_integrity_failure when adapter corrupts the persisted hash', async () => {
    // Adapter that "stores" but returns a DIFFERENT hash from getLatestHashForRoom.
    const adapter: ShadowLogStorageAdapter = {
      async append() {
        // pretend to store
      },
      async readByRoom() {
        return [];
      },
      async getLatestHashForRoom() {
        return 'attacker-controlled-hash-that-does-not-match';
      }
    };
    const log = createShadowLog(adapter);
    try {
      await log.append({
        messageId: 'a',
        roomId: 'r-1',
        entityId: 'e-1',
        text: 'first',
        sourceTrust: 'authenticated'
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConnectorValidationError);
      expect((e as ConnectorValidationError).category).toBe('storage_integrity_failure');
    }
  });
});

describe('shadow-log — canonical form entityId injection defence (A&D #2)', () => {
  it('text + entityId triples with `|` characters do NOT collide', async () => {
    // Length-prefix all three fields so an attacker-controlled `|` in
    // text OR entityId cannot collide with a different triple.
    const a = await computeContentHash('a|b', 'authenticated', 'c');
    const b = await computeContentHash('a', 'authenticated', 'b|c');
    expect(a).not.toBe(b);
  });

  it('entityId boundary injection cannot collide', async () => {
    const a = await computeContentHash('hello', 'authenticated', 'evil-entity');
    const b = await computeContentHash('hello', 'authenticated', 'evil|entity');
    expect(a).not.toBe(b);
  });
});

describe('shadow-log — bounded storage policy', () => {
  it('refuses write when per-room cap exceeded under refuse-write', async () => {
    const log = makeLog({ maxEntriesPerRoom: 2, evictionPolicy: 'refuse-write' });
    await log.append({
      messageId: 'a',
      roomId: 'r-1',
      entityId: 'e-1',
      text: '1',
      sourceTrust: 'authenticated'
    });
    await log.append({
      messageId: 'b',
      roomId: 'r-1',
      entityId: 'e-1',
      text: '2',
      sourceTrust: 'authenticated'
    });
    // Third append exceeds cap.
    await expect(
      log.append({
        messageId: 'c',
        roomId: 'r-1',
        entityId: 'e-1',
        text: '3',
        sourceTrust: 'authenticated'
      })
    ).rejects.toThrow(ConnectorValidationError);
  });

  it('refuse-write throws with category=storage_full', async () => {
    const log = makeLog({ maxEntriesPerRoom: 1 });
    await log.append({
      messageId: 'a',
      roomId: 'r-1',
      entityId: 'e-1',
      text: '1',
      sourceTrust: 'authenticated'
    });
    try {
      await log.append({
        messageId: 'b',
        roomId: 'r-1',
        entityId: 'e-1',
        text: '2',
        sourceTrust: 'authenticated'
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConnectorValidationError);
      expect((e as ConnectorValidationError).category).toBe('storage_full');
    }
  });

  it('drop-oldest evicts the oldest entry in the room', async () => {
    const log = makeLog({ maxEntriesPerRoom: 2, evictionPolicy: 'drop-oldest' });
    await log.append({
      messageId: 'a',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'first',
      sourceTrust: 'authenticated'
    });
    await log.append({
      messageId: 'b',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'second',
      sourceTrust: 'authenticated'
    });
    await log.append({
      messageId: 'c',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'third',
      sourceTrust: 'authenticated'
    });
    const entries = await log.readByRoom('r-1', { limit: 10 });
    // The first ('first') was evicted; 'second' + 'third' survive.
    expect(entries.length).toBe(2);
    expect(entries.find(e => e.text === 'first')).toBeUndefined();
  });

  it('rejects invalid configuration at creation', () => {
    expect(() => createShadowLog(createInMemoryShadowLogStorage(), { maxEntriesPerRoom: 0 })).toThrow(
      ConnectorValidationError
    );
    expect(() => createShadowLog(createInMemoryShadowLogStorage(), { maxTotalEntries: 0 })).toThrow(
      ConnectorValidationError
    );
  });
});

describe('shadow-log — generic adapter contract (non-ElizaOS)', () => {
  it('a custom adapter satisfying the interface plugs in identically', async () => {
    const calls: string[] = [];
    let lastHash: string | null = null;
    const adapter: ShadowLogStorageAdapter = {
      async append(entry) {
        calls.push(`append:${entry.text}`);
        lastHash = entry.contentHash; // honour the integrity contract
      },
      async readByRoom() {
        return [];
      },
      async getLatestHashForRoom() {
        return lastHash;
      }
    };
    const log = createShadowLog(adapter);
    await log.append({
      messageId: 'a',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'custom',
      sourceTrust: 'authenticated'
    });
    expect(calls).toEqual(['append:custom']);
  });
});

describe('shadow-log — canonical hash functions (exposed for adapters)', () => {
  it('computeContentHash returns a 64-char hex digest', async () => {
    const hash = await computeContentHash('hello', 'authenticated', 'e-1');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computeContentHash is deterministic', async () => {
    const a = await computeContentHash('hello', 'authenticated', 'e-1');
    const b = await computeContentHash('hello', 'authenticated', 'e-1');
    expect(a).toBe(b);
  });

  it('computeContentHash differs for different inputs', async () => {
    const a = await computeContentHash('hello', 'authenticated', 'e-1');
    const b = await computeContentHash('hello', 'unauthenticated_http', 'e-1');
    const c = await computeContentHash('hello', 'authenticated', 'e-2');
    const d = await computeContentHash('world', 'authenticated', 'e-1');
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it('canonical encoding length-prefixes text to defeat boundary collisions', async () => {
    // Length-prefix means "x|authenticated|e-1" cannot collide with
    // a hostile text that ENDS in "|authenticated|e-1" tail.
    const honest = await computeContentHash('hello', 'authenticated', 'e-1');
    const hostile = await computeContentHash('hello|authenticated|e-1', 'something-else', 'e-2');
    expect(honest).not.toBe(hostile);
  });

  it('computeChainLinkHash includes both contentHash and prevEntryHash', async () => {
    const a = await computeChainLinkHash('abc', null);
    const b = await computeChainLinkHash('abc', 'def');
    expect(a).not.toBe(b);
  });
});

describe('shadow-log — cross-room authorization documentation (negative test)', () => {
  it('readByRoom does NOT enforce cross-room auth — caller is responsible', async () => {
    // Per the documented contract on `readByRoom`, the adapter
    // returns whatever roomId is requested. This test confirms the
    // adapter behaviour matches the doc — connectors MUST validate
    // the caller's session before invoking readByRoom.
    const log = makeLog();
    await log.append({
      messageId: 'victim-1',
      roomId: 'victim-room',
      entityId: 'victim-entity',
      text: 'private content',
      sourceTrust: 'authenticated'
    });

    // An attacker who calls readByRoom('victim-room') from any
    // session gets back the victim's entries. The shadow log is NOT
    // the authorization boundary — that's the connector's job.
    const stolen = await log.readByRoom('victim-room');
    expect(stolen.length).toBe(1);
    expect(stolen[0].text).toBe('private content');

    // This is BY DESIGN. The corresponding security guarantee is
    // documented in the ShadowLogStorageAdapter.readByRoom JSDoc.
    // Story 2.4a's ElizaOS connector enforces the cross-room
    // boundary at its call site.
  });
});
