/**
 * Story 1.1b — BufferedReleaseGate primitive (R2-12)
 * ==================================================
 * Standalone reusable buffer/release primitive. Holds appended chunks
 * until either (a) `minCharsBeforeRelease` is reached, (b) a sentence
 * boundary is detected (when enabled), or (c) the caller flushes.
 *
 * Will be reused by AudioStreamValidator (Story 3.1).
 */
import { describe, it, expect } from 'vitest';
import { BufferedReleaseGate } from '../../src/connector-utils/buffered-release-gate.js';

describe('BufferedReleaseGate — char threshold', () => {
  it('holds chunks until minCharsBeforeRelease is reached', () => {
    const gate = new BufferedReleaseGate({ minCharsBeforeRelease: 10 });
    gate.push('abcd');
    expect(gate.shouldRelease()).toBe(false);
    gate.push('efgh');
    expect(gate.shouldRelease()).toBe(false);
    gate.push('ijkl');
    expect(gate.shouldRelease()).toBe(true);
  });

  it('takePending returns + clears the buffer', () => {
    const gate = new BufferedReleaseGate({ minCharsBeforeRelease: 4 });
    gate.push('hello');
    expect(gate.pendingSize).toBe(5);
    expect(gate.takePending()).toBe('hello');
    expect(gate.pendingSize).toBe(0);
    expect(gate.takePending()).toBe('');
  });

  it('drop clears the buffer without returning content', () => {
    const gate = new BufferedReleaseGate({ minCharsBeforeRelease: 4 });
    gate.push('secret-content');
    expect(gate.pendingSize).toBeGreaterThan(0);
    gate.drop();
    expect(gate.pendingSize).toBe(0);
    expect(gate.takePending()).toBe('');
  });

  it('zero threshold releases immediately on every push', () => {
    const gate = new BufferedReleaseGate({ minCharsBeforeRelease: 0 });
    gate.push('x');
    expect(gate.shouldRelease()).toBe(true);
  });
});

describe('BufferedReleaseGate — Infinity threshold (full-response mode)', () => {
  it('never releases via shouldRelease when threshold is Infinity', () => {
    const gate = new BufferedReleaseGate({ minCharsBeforeRelease: Infinity });
    for (let i = 0; i < 100; i++) gate.push('x'.repeat(100));
    expect(gate.shouldRelease()).toBe(false);
    expect(gate.pendingSize).toBe(10_000);
  });

  it('takePending still drains the buffer (used by finalize)', () => {
    const gate = new BufferedReleaseGate({ minCharsBeforeRelease: Infinity });
    gate.push('full content held to the end');
    expect(gate.shouldRelease()).toBe(false);
    expect(gate.takePending()).toBe('full content held to the end');
  });
});

describe('BufferedReleaseGate — sentence boundary', () => {
  it('releases on sentence terminator past minSentenceLength', () => {
    const gate = new BufferedReleaseGate({
      minCharsBeforeRelease: 1024,
      detectSentenceBoundary: true,
      minSentenceLength: 16
    });
    gate.push('Hi there friend.');
    expect(gate.shouldRelease()).toBe(true);
  });

  it('does NOT release on a sentence terminator below minSentenceLength', () => {
    const gate = new BufferedReleaseGate({
      minCharsBeforeRelease: 1024,
      detectSentenceBoundary: true,
      minSentenceLength: 32
    });
    gate.push('Mr.');
    expect(gate.shouldRelease()).toBe(false);
  });

  it('honours detectSentenceBoundary=false', () => {
    const gate = new BufferedReleaseGate({
      minCharsBeforeRelease: 1024,
      detectSentenceBoundary: false,
      minSentenceLength: 0
    });
    gate.push('A long enough sentence ending here.');
    expect(gate.shouldRelease()).toBe(false);
  });

  it('does not release mid-sentence (no terminator)', () => {
    const gate = new BufferedReleaseGate({
      minCharsBeforeRelease: 1024,
      detectSentenceBoundary: true,
      minSentenceLength: 16
    });
    gate.push('A sentence in progress without a terminator yet');
    expect(gate.shouldRelease()).toBe(false);
  });
});
