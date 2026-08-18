/**
 * Tests for the shared TCP port checker.
 *
 * Service detection exercises the happy path; this suite pins the guards and
 * the two failure paths that only fire on a hung or refused connection.
 *
 * @module detection/port.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createConnection } from 'net';
import { checkPort, isValidHost, isValidPort } from './port.js';

vi.mock('net', () => ({ createConnection: vi.fn() }));

/** A socket stub whose registered handlers can be fired on demand. */
function makeSocket() {
  const handlers = new Map<string, () => void>();
  return {
    destroyed: false,
    setTimeout: vi.fn(),
    destroy: vi.fn(function (this: { destroyed: boolean }) {
      this.destroyed = true;
    }),
    on: vi.fn(function (this: unknown, event: string, cb: () => void) {
      handlers.set(event, cb);
      return this;
    }),
    fire(event: string) {
      handlers.get(event)?.();
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isValidPort', () => {
  it.each([1, 80, 6333, 65535])('accepts %i', port => {
    expect(isValidPort(port)).toBe(true);
  });

  it.each([0, -1, 65536, 1.5, Number.NaN])('rejects %s', port => {
    expect(isValidPort(port)).toBe(false);
  });
});

describe('isValidHost', () => {
  it('accepts a normal hostname', () => {
    expect(isValidHost('localhost')).toBe(true);
  });

  it('rejects an empty hostname', () => {
    expect(isValidHost('')).toBe(false);
  });

  it('rejects a hostname over the RFC 1035 length limit', () => {
    expect(isValidHost('a'.repeat(254))).toBe(false);
  });
});

describe('checkPort', () => {
  it('never opens a socket for an invalid port', async () => {
    await expect(checkPort('localhost', 0)).resolves.toBe(false);
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('never opens a socket for an invalid host', async () => {
    await expect(checkPort('', 6333)).resolves.toBe(false);
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('resolves true and destroys the socket on connect', async () => {
    const socket = makeSocket();
    vi.mocked(createConnection).mockImplementation(() => {
      queueMicrotask(() => socket.fire('connect'));
      return socket as never;
    });

    await expect(checkPort('localhost', 6333)).resolves.toBe(true);
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('resolves false and destroys the socket on error', async () => {
    const socket = makeSocket();
    vi.mocked(createConnection).mockImplementation(() => {
      queueMicrotask(() => socket.fire('error'));
      return socket as never;
    });

    await expect(checkPort('localhost', 6333)).resolves.toBe(false);
    expect(socket.destroy).toHaveBeenCalled();
  });

  it("resolves false on the socket's own timeout event", async () => {
    const socket = makeSocket();
    vi.mocked(createConnection).mockImplementation(() => {
      queueMicrotask(() => socket.fire('timeout'));
      return socket as never;
    });

    await expect(checkPort('localhost', 6333)).resolves.toBe(false);
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('leaves no pending timer after the socket timeout path', async () => {
    // `resolve` is idempotent, so a leaked wall-clock timer is invisible to a
    // result assertion — it just holds the event loop open for up to 2s per
    // probed port. Assert on the timer count instead.
    vi.useFakeTimers();
    const socket = makeSocket();
    vi.mocked(createConnection).mockImplementation(() => socket as never);

    const before = vi.getTimerCount();
    const pending = checkPort('localhost', 6333, 500);
    socket.fire('timeout');

    await expect(pending).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(before);
  });

  it('resolves false when the connection hangs past the timeout', async () => {
    vi.useFakeTimers();
    const socket = makeSocket();
    vi.mocked(createConnection).mockReturnValue(socket as never);

    const pending = checkPort('localhost', 6333, 500);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toBe(false);
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('clamps the timeout to the allowed range', async () => {
    const socket = makeSocket();
    vi.mocked(createConnection).mockImplementation(() => {
      queueMicrotask(() => socket.fire('connect'));
      return socket as never;
    });

    await checkPort('localhost', 6333, 999_999);
    expect(socket.setTimeout).toHaveBeenCalledWith(2000);

    await checkPort('localhost', 6333, 1);
    expect(socket.setTimeout).toHaveBeenCalledWith(100);
  });

  it('does not double-destroy an already destroyed socket', async () => {
    const socket = makeSocket();
    socket.destroyed = true;
    vi.mocked(createConnection).mockImplementation(() => {
      queueMicrotask(() => socket.fire('connect'));
      return socket as never;
    });

    await expect(checkPort('localhost', 6333)).resolves.toBe(true);
    expect(socket.destroy).not.toHaveBeenCalled();
  });
});
