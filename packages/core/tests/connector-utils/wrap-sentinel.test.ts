/**
 * wrap-sentinel Tests
 * ===================
 * Covers the shared double-wrap defence used by connector wrappers.
 * The security contract: a marked target must be REJECTED on re-wrap
 * (wrapping twice double-validates every call), the marker must be
 * non-enumerable (no leak through spread / JSON) and non-writable (an
 * attacker can't clear it by assignment before re-wrapping).
 */

import { describe, it, expect } from 'vitest';
import {
  assertNotWrapped,
  markWrapped,
  ensureWrappedOnce,
  _testOnlyClearSentinel
} from '../../src/connector-utils/wrap-sentinel.js';

const SYM = Symbol.for('bonklm.test.wired');

describe('assertNotWrapped', () => {
  it('does not throw on a fresh object', () => {
    expect(() => assertNotWrapped({}, SYM, 'wrap')).not.toThrow();
  });

  it('does not throw on a fresh function', () => {
    expect(() => assertNotWrapped(() => {}, SYM, 'wrap')).not.toThrow();
  });

  it('does not throw on null or a primitive (nothing to double-wrap)', () => {
    expect(() => assertNotWrapped(null, SYM, 'wrap')).not.toThrow();
    expect(() => assertNotWrapped('str', SYM, 'wrap')).not.toThrow();
    expect(() => assertNotWrapped(7, SYM, 'wrap')).not.toThrow();
  });

  it('throws once the target is marked, naming the label', () => {
    const target = {};
    markWrapped(target, SYM);
    expect(() => assertNotWrapped(target, SYM, 'myWrapFn')).toThrow(/myWrapFn/);
    expect(() => assertNotWrapped(target, SYM, 'myWrapFn')).toThrow(/already wrapped/);
  });

  it('throws on a marked function target', () => {
    const fn = () => {};
    markWrapped(fn, SYM);
    expect(() => assertNotWrapped(fn, SYM, 'wrap')).toThrow(/already wrapped/);
  });

  it('does not throw for a different sentinel symbol', () => {
    const target = {};
    markWrapped(target, SYM);
    const other = Symbol.for('bonklm.other.wired');
    expect(() => assertNotWrapped(target, other, 'wrap')).not.toThrow();
  });
});

describe('markWrapped', () => {
  it('places a non-enumerable marker (no leak through keys / spread / JSON)', () => {
    const target: Record<string, unknown> = { keep: 1 };
    markWrapped(target, SYM);
    expect(Object.keys(target)).toEqual(['keep']);
    expect(JSON.stringify(target)).toBe('{"keep":1}');
    expect({ ...target }[SYM as unknown as string]).toBeUndefined();
  });

  it('places a non-writable marker that cannot be cleared by assignment', () => {
    'use strict';
    const target = {} as Record<symbol, unknown>;
    markWrapped(target, SYM);
    // Non-strict assignment silently fails; the marker must survive.
    try {
      target[SYM] = false;
    } catch {
      // strict-mode TypeError is also acceptable — either way it stays true
    }
    expect(target[SYM]).toBe(true);
  });

  it('throws TypeError on null', () => {
    expect(() => markWrapped(null, SYM)).toThrow(TypeError);
  });

  it('throws TypeError on a primitive', () => {
    expect(() => markWrapped('str', SYM)).toThrow(/object or function/);
    expect(() => markWrapped(42, SYM)).toThrow(TypeError);
  });

  it('marks a function target', () => {
    const fn = () => {};
    markWrapped(fn, SYM);
    expect((fn as unknown as Record<symbol, unknown>)[SYM]).toBe(true);
  });
});

describe('ensureWrappedOnce', () => {
  it('marks and returns the target on first call', () => {
    const target = { id: 1 };
    expect(ensureWrappedOnce(target, SYM, 'wrap')).toBe(target);
  });

  it('throws on the second call (double-wrap rejected)', () => {
    const target = {};
    ensureWrappedOnce(target, SYM, 'wrap');
    expect(() => ensureWrappedOnce(target, SYM, 'wrap')).toThrow(/already wrapped/);
  });
});

describe('_testOnlyClearSentinel', () => {
  it('places a cleared (false) marker on an unmarked target, leaving it un-wrapped', () => {
    const target = {};
    _testOnlyClearSentinel(target, SYM);
    // A `false` marker is not `=== true`, so the target is still considered fresh.
    expect(() => assertNotWrapped(target, SYM, 'wrap')).not.toThrow();
    expect((target as Record<symbol, unknown>)[SYM]).toBe(false);
  });

  it('leaves the cleared marker configurable so a real wrap can follow', () => {
    const target = {};
    _testOnlyClearSentinel(target, SYM);
    // markWrapped re-defines the (now configurable) property — must not throw.
    expect(() => markWrapped(target, SYM)).not.toThrow();
    expect(() => assertNotWrapped(target, SYM, 'wrap')).toThrow(/already wrapped/);
  });

  it('cannot redefine a marker placed by markWrapped (non-configurable security descriptor)', () => {
    // CHARACTERIZATION: markWrapped uses configurable:false so an attacker
    // cannot clear the marker before re-wrapping. A consequence is that
    // _testOnlyClearSentinel cannot reset a real marker — it throws. This
    // locks the security descriptor's non-configurability; if it ever
    // regresses to configurable:true, this test flips and flags it.
    const target = {};
    markWrapped(target, SYM);
    expect(() => _testOnlyClearSentinel(target, SYM)).toThrow(/Cannot redefine property/);
  });

  it('is a no-op on a primitive or null (no throw)', () => {
    expect(() => _testOnlyClearSentinel('str', SYM)).not.toThrow();
    expect(() => _testOnlyClearSentinel(null, SYM)).not.toThrow();
  });
});
