/**
 * Story 2.4a — ElizaOS shadow log integration tests.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createShadowLog,
  createInMemoryShadowLogStorage,
} from '@blackunicorn/bonklm';
import {
  assertRoomAccess,
  buildEolFindingV04,
  createElizaOSDrizzleShadowLogStorage,
  mapMessageReceivedToShadowLog,
  shadowLogIntegrityFailureMessage,
  ShadowLogAuthError,
  verifyAndReadAuthenticatedMessages,
  type DrizzleShadowLogClient,
} from '../src/index.js';

describe('mapMessageReceivedToShadowLog', () => {
  it('maps an ElizaOS MESSAGE_RECEIVED event to a ShadowLogAppendInput', () => {
    const result = mapMessageReceivedToShadowLog(
      {
        messageId: 'm-1',
        roomId: 'r-1',
        entityId: 'e-1',
        content: { text: 'hello' },
      },
      'authenticated'
    );
    expect(result).toEqual({
      messageId: 'm-1',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'hello',
      sourceTrust: 'authenticated',
    });
  });

  it('coerces missing content.text to empty string', () => {
    const result = mapMessageReceivedToShadowLog(
      {
        messageId: 'm-1',
        roomId: 'r-1',
        entityId: 'e-1',
        content: {},
      },
      'unauthenticated_http'
    );
    expect(result.text).toBe('');
  });
});

describe('assertRoomAccess — cross-room authorization', () => {
  it('throws when authenticatedRoomIds is undefined (fail closed)', () => {
    expect(() => assertRoomAccess(undefined, 'r-1')).toThrow(
      /no authenticated room set/
    );
  });

  it('throws when requestedRoomId is NOT in the authenticated set', () => {
    const allowed = new Set(['r-1', 'r-2']);
    expect(() => assertRoomAccess(allowed, 'r-victim')).toThrow(
      /NOT in the authenticated session/
    );
  });

  it('does NOT throw when the room is in the authenticated set', () => {
    const allowed = new Set(['r-1', 'r-2']);
    expect(() => assertRoomAccess(allowed, 'r-1')).not.toThrow();
  });

  it('throws ShadowLogAuthError with safe publicMessage (no roomId leak)', () => {
    try {
      assertRoomAccess(new Set(['allowed']), 'victim-room');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ShadowLogAuthError);
      const err = e as ShadowLogAuthError;
      // publicMessage MUST NOT carry the roomId — safe to forward
      // to HTTP responses without leaking the requested room.
      expect(err.publicMessage).toBe(
        'Cross-room access denied; admin review required.'
      );
      expect(err.publicMessage).not.toContain('victim-room');
      // detailMessage DOES carry the roomId — for logging only.
      expect(err.detailMessage).toContain('victim-room');
    }
  });
});

describe('verifyAndReadAuthenticatedMessages', () => {
  it('returns entries when chain is intact + room is authorised', async () => {
    const shadowLog = createShadowLog(createInMemoryShadowLogStorage());
    await shadowLog.append({
      messageId: 'a',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'user said hello',
      sourceTrust: 'authenticated',
    });
    await shadowLog.append({
      messageId: 'b',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'unauthenticated content',
      sourceTrust: 'unauthenticated_http',
    });

    const result = await verifyAndReadAuthenticatedMessages({
      shadowLog,
      roomId: 'r-1',
      authenticatedRoomIds: new Set(['r-1']),
    });
    expect(result.ok).toBe(true);
    if (result.ok === true) {
      // Default filter excludes unauthenticated_http.
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].text).toBe('user said hello');
    }
  });

  it('throws on cross-room access attempt', async () => {
    const shadowLog = createShadowLog(createInMemoryShadowLogStorage());
    await expect(
      verifyAndReadAuthenticatedMessages({
        shadowLog,
        roomId: 'r-victim',
        authenticatedRoomIds: new Set(['r-mine']),
      })
    ).rejects.toThrow();
  });

  it('returns { ok: false } on tamper detection (NOT brokenAt in public shape)', async () => {
    // Build a custom adapter we can mutate.
    const stored: Array<import('@blackunicorn/bonklm').ShadowLogEntry> = [];
    const adapter = {
      async append(entry: import('@blackunicorn/bonklm').ShadowLogEntry) {
        stored.push({ ...entry });
      },
      async readByRoom() {
        return [...stored];
      },
      async getLatestHashForRoom() {
        return stored.length > 0
          ? stored[stored.length - 1].contentHash
          : null;
      },
    };
    const shadowLog = createShadowLog(adapter);
    await shadowLog.append({
      messageId: 'a',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'first',
      sourceTrust: 'authenticated',
    });
    // Tamper.
    stored[0] = { ...stored[0], text: 'ATTACKER' };

    const tamperCallback = vi.fn();
    const result = await verifyAndReadAuthenticatedMessages({
      shadowLog,
      roomId: 'r-1',
      authenticatedRoomIds: new Set(['r-1']),
      onTamperDetected: tamperCallback,
    });

    expect(result.ok).toBe(false);
    // PUBLIC RESULT MUST NOT have brokenAt.
    expect((result as { brokenAt?: number }).brokenAt).toBeUndefined();
    // Internal callback DOES get brokenAt.
    expect(tamperCallback).toHaveBeenCalledWith({
      roomId: 'r-1',
      brokenAt: 0,
    });
  });

  it('swallows onTamperDetected callback throws (does NOT crash integrity check)', async () => {
    const stored: Array<import('@blackunicorn/bonklm').ShadowLogEntry> = [];
    const adapter = {
      async append(entry: import('@blackunicorn/bonklm').ShadowLogEntry) {
        stored.push({ ...entry });
      },
      async readByRoom() {
        return [...stored];
      },
      async getLatestHashForRoom() {
        return stored.length > 0
          ? stored[stored.length - 1].contentHash
          : null;
      },
    };
    const shadowLog = createShadowLog(adapter);
    await shadowLog.append({
      messageId: 'a',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'first',
      sourceTrust: 'authenticated',
    });
    stored[0] = { ...stored[0], text: 'ATTACKER' };

    const result = await verifyAndReadAuthenticatedMessages({
      shadowLog,
      roomId: 'r-1',
      authenticatedRoomIds: new Set(['r-1']),
      onTamperDetected: () => {
        throw new Error('callback boom');
      },
    });
    // The callback throw is swallowed; result is still { ok: false }.
    expect(result.ok).toBe(false);
  });
});

describe('shadowLogIntegrityFailureMessage', () => {
  it('returns a generic message without position info (iter-1 BLOCK-1 containment)', () => {
    const msg = shadowLogIntegrityFailureMessage();
    expect(msg).toBe('Shadow log integrity check failed; admin review required.');
    // MUST NOT contain "brokenAt" or any position info.
    expect(msg).not.toMatch(/brokenAt|position|index|\d/);
  });
});

describe('buildEolFindingV04', () => {
  it('produces a HIGH finding naming the installed version', () => {
    const finding = buildEolFindingV04('0.4.1');
    expect(finding.severity).toBe('HIGH');
    expect(finding.category).toBe('elizaos_connector_eol_v04');
    expect(finding.description).toContain('0.4.1');
    expect(finding.description).toContain('v0.5.0');
    expect(finding.description).toContain('30 days');
  });
});

describe('createElizaOSDrizzleShadowLogStorage', () => {
  it('delegates to the provided Drizzle client', async () => {
    const calls: string[] = [];
    const client: DrizzleShadowLogClient = {
      async insert(values) {
        calls.push(`insert:${values.text}`);
      },
      async selectByRoom(roomId) {
        calls.push(`selectByRoom:${roomId}`);
        return [];
      },
      async selectLatestHashForRoom(roomId) {
        calls.push(`selectLatestHashForRoom:${roomId}`);
        return null;
      },
      async countByRoom(roomId) {
        calls.push(`countByRoom:${roomId}`);
        return 0;
      },
      async totalCount() {
        calls.push('totalCount');
        return 0;
      },
      async deleteOldestForRoom(roomId) {
        calls.push(`deleteOldestForRoom:${roomId}`);
      },
    };
    const adapter = createElizaOSDrizzleShadowLogStorage({ client });

    await adapter.append({
      messageId: 'a',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'hello',
      contentHash: 'h',
      prevEntryHash: null,
      createdAt: Date.now(),
      sourceTrust: 'authenticated',
    });
    await adapter.readByRoom('r-1');
    await adapter.getLatestHashForRoom('r-1');
    await adapter.countByRoom?.('r-1');
    await adapter.totalCount?.();
    await adapter.evictOldestForRoom?.('r-1');

    expect(calls).toEqual([
      'insert:hello',
      'selectByRoom:r-1',
      'selectLatestHashForRoom:r-1',
      'countByRoom:r-1',
      'totalCount',
      'deleteOldestForRoom:r-1',
    ]);
  });

  it('with a custom client + shadow log: end-to-end intact chain', async () => {
    // In-memory client adhering to the Drizzle shape (proves the
    // interface is generic, not Drizzle-specific).
    const stored: Array<import('@blackunicorn/bonklm').ShadowLogEntry> = [];
    const client: DrizzleShadowLogClient = {
      async insert(values) {
        stored.push({ ...values });
      },
      async selectByRoom(roomId) {
        return stored.filter((e) => e.roomId === roomId);
      },
      async selectLatestHashForRoom(roomId) {
        const matching = stored.filter((e) => e.roomId === roomId);
        return matching.length > 0
          ? matching[matching.length - 1].contentHash
          : null;
      },
    };
    const adapter = createElizaOSDrizzleShadowLogStorage({ client });
    const shadowLog = createShadowLog(adapter);

    await shadowLog.append({
      messageId: 'a',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'first',
      sourceTrust: 'authenticated',
    });
    await shadowLog.append({
      messageId: 'b',
      roomId: 'r-1',
      entityId: 'e-1',
      text: 'second',
      sourceTrust: 'authenticated',
    });
    const result = await shadowLog.verifyChain('r-1');
    expect(result).toEqual({ ok: true });
  });
});
