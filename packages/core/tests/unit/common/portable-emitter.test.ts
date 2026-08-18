/**
 * PortableEventEmitter Tests
 * ==========================
 * Unit + behavioural-regression coverage for the node:events replacement.
 * Two contracts are locked here because a "cleanup" could silently break
 * them: (1) a throwing listener must NOT abort its siblings (emit swallows),
 * and (2) emit iterates a SNAPSHOT so mutating subscriptions mid-emit does
 * not change which listeners fire for that emit.
 */

import { describe, it, expect, vi } from 'vitest';
import { PortableEventEmitter } from '../../../src/common/portable-emitter.js';

interface Events extends Record<string, unknown> {
  ping: number;
  other: string;
}

describe('PortableEventEmitter', () => {
  it('delivers the payload to a registered listener', () => {
    const e = new PortableEventEmitter<Events>();
    const cb = vi.fn();
    e.on('ping', cb);
    expect(e.emit('ping', 42)).toBe(true);
    expect(cb).toHaveBeenCalledWith(42);
  });

  it('returns false when emitting to an event with no listeners', () => {
    const e = new PortableEventEmitter<Events>();
    expect(e.emit('ping', 1)).toBe(false);
  });

  it('deduplicates the same listener (Set semantics) — fires once per emit', () => {
    const e = new PortableEventEmitter<Events>();
    const cb = vi.fn();
    e.on('ping', cb).on('ping', cb);
    expect(e.listenerCount('ping')).toBe(1);
    e.emit('ping', 1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  describe('off', () => {
    it('removes a listener so it no longer fires', () => {
      const e = new PortableEventEmitter<Events>();
      const cb = vi.fn();
      e.on('ping', cb);
      e.off('ping', cb);
      expect(e.emit('ping', 1)).toBe(false);
      expect(cb).not.toHaveBeenCalled();
    });

    it('is a no-op when removing from an unknown event', () => {
      const e = new PortableEventEmitter<Events>();
      expect(() => e.off('ping', vi.fn())).not.toThrow();
    });

    it('deletes the bucket when the last listener is removed', () => {
      const e = new PortableEventEmitter<Events>();
      const cb = vi.fn();
      e.on('ping', cb);
      e.off('ping', cb);
      // Bucket gone → emit takes the "no listeners" branch.
      expect(e.emit('ping', 1)).toBe(false);
      expect(e.listenerCount('ping')).toBe(0);
    });
  });

  describe('listenerCount', () => {
    it('returns 0 for an unknown event', () => {
      const e = new PortableEventEmitter<Events>();
      expect(e.listenerCount('ping')).toBe(0);
    });

    it('counts distinct listeners', () => {
      const e = new PortableEventEmitter<Events>();
      e.on('ping', vi.fn()).on('ping', vi.fn());
      expect(e.listenerCount('ping')).toBe(2);
    });
  });

  describe('removeAllListeners', () => {
    it('clears a single event when given an argument', () => {
      const e = new PortableEventEmitter<Events>();
      e.on('ping', vi.fn());
      e.on('other', vi.fn());
      e.removeAllListeners('ping');
      expect(e.listenerCount('ping')).toBe(0);
      expect(e.listenerCount('other')).toBe(1);
    });

    it('clears every event when given no argument', () => {
      const e = new PortableEventEmitter<Events>();
      e.on('ping', vi.fn());
      e.on('other', vi.fn());
      e.removeAllListeners();
      expect(e.listenerCount('ping')).toBe(0);
      expect(e.listenerCount('other')).toBe(0);
    });
  });

  describe('behavioural contracts', () => {
    it('swallows a listener error so siblings still receive the event', () => {
      const e = new PortableEventEmitter<Events>();
      const after = vi.fn();
      e.on('ping', () => {
        throw new Error('boom');
      });
      e.on('ping', after);

      expect(() => e.emit('ping', 1)).not.toThrow();
      expect(after).toHaveBeenCalledWith(1);
      expect(e.emit('ping', 2)).toBe(true);
    });

    it('iterates a snapshot — a listener that calls off() mid-emit does not skip siblings', () => {
      const e = new PortableEventEmitter<Events>();
      const sibling = vi.fn();
      const selfRemoving = vi.fn(() => {
        e.off('ping', selfRemoving);
        e.off('ping', sibling); // remove sibling DURING emit
      });
      e.on('ping', selfRemoving);
      e.on('ping', sibling);

      e.emit('ping', 1);

      // Sibling still fired this round because emit captured a snapshot first.
      expect(sibling).toHaveBeenCalledTimes(1);
      // Next emit reflects the removals.
      expect(e.emit('ping', 2)).toBe(false);
    });

    it('does not fire a listener added during the same emit', () => {
      const e = new PortableEventEmitter<Events>();
      const lateListener = vi.fn();
      e.on('ping', () => {
        e.on('ping', lateListener);
      });

      e.emit('ping', 1);

      expect(lateListener).not.toHaveBeenCalled();
      // It fires on the next emit.
      e.emit('ping', 2);
      expect(lateListener).toHaveBeenCalledWith(2);
    });
  });

  it('chains on / off / removeAllListeners (returns this)', () => {
    const e = new PortableEventEmitter<Events>();
    const cb = vi.fn();
    expect(e.on('ping', cb)).toBe(e);
    expect(e.off('ping', cb)).toBe(e);
    expect(e.removeAllListeners()).toBe(e);
  });
});
