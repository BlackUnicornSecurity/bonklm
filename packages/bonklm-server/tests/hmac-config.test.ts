import { describe, expect, it } from 'vitest';
import { noOpValidator } from '@blackunicorn/bonklm/testing';
import { createBonklmGuardrailServer } from '../src/index.js';
import { MAX_REPLAY_WINDOW_MS, signHmac, verifyHmacSignature } from '../src/hmac/index.js';

const SECRET = 's'.repeat(32);

describe('HMAC replay-window configuration', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5, MAX_REPLAY_WINDOW_MS + 1])(
    'rejects invalid replay window %s',
    replayWindowMs => {
      const rawBody = '{}';
      const timestamp = '1000';
      const signature = signHmac(rawBody, timestamp, SECRET);

      expect(() =>
        verifyHmacSignature({ rawBody, timestamp, signature, secret: SECRET, replayWindowMs, nowMs: () => 1000 })
      ).toThrow(/replayWindowMs.*integer.*1.*86400000/);
    }
  );

  it('rejects an invalid replay window when creating the server', async () => {
    let server: Awaited<ReturnType<typeof createBonklmGuardrailServer>> | undefined;
    let failure: unknown;
    try {
      server = await createBonklmGuardrailServer({
        validators: [noOpValidator()],
        hmacSecret: SECRET,
        replayWindowMs: Number.NaN
      });
    } catch (error) {
      failure = error;
    } finally {
      await server?.close();
    }

    expect(failure).toBeInstanceOf(RangeError);
    expect((failure as Error).message).toMatch(/replayWindowMs.*integer.*1.*86400000/);
  });
});
