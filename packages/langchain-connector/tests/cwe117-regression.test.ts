/**
 * langchain-connector — CWE-117 sanitizer primitive contract.
 *
 * This file asserts the canonical `sanitizeMeta` / `sanitizeLogString`
 * primitives in ISOLATION (re-exported from the core barrel), plus a runId
 * log-meta primitive. The end-to-end, load-bearing proof that the connector's
 * dev-mode `Error.message` sinks (validateAndThrow + handleLLMEnd stream-final)
 * actually wrap their attacker-influenced `reason` lives in
 * `guardrails-handler.test.ts` ("CWE-117 reason sanitization is load-bearing
 * (ADR-0001)"), which drives the real callback handler and asserts the ESCAPED
 * form on the caught error message. The stream-buffer-exceeded log site is also
 * driven end-to-end below. Per ADR-0001 a test that still passes with the
 * sanitizer removed is not a regression test — see those driving blocks.
 */
import { describe, expect, it, vi } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';
import type { NewTokenIndices } from '@langchain/core/callbacks/base';
import { GuardrailsCallbackHandler } from '../src/guardrails-handler.js';

describe('langchain-connector — CWE-117 sanitizer primitive contract', () => {
  it('imports sanitizeMeta from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(sanitizeMeta('a\nb')).toBe('a\\nb');
  });

  it('imports sanitizeLogString from the core barrel', () => {
    expect(typeof sanitizeLogString).toBe('function');
  });

  it('imports serializeError from the core barrel', () => {
    expect(typeof serializeError).toBe('function');
  });

  it('end-to-end: escapes a hostile runId at the stream-buffer-exceeded log site', async () => {
    // Drive the real `handleLLMNewToken` path until the buffer-exceeded warn
    // fires, then assert the spy logger captured a sanitized runId in the meta.
    // With the wrap removed the raw runId would land in meta unchanged.
    const spyLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const handler = new GuardrailsCallbackHandler({
      validators: [
        {
          name: 'NoOp',
          validate: () => ({
            allowed: true,
            blocked: false,
            severity: 'info' as const,
            risk_level: 'low' as const,
            risk_score: 0,
            findings: [],
            timestamp: Date.now()
          })
        } as never
      ],
      logger: spyLogger,
      validateStreaming: true, // required for handleLLMNewToken to fire
      maxStreamBufferSize: 16, // tiny so a few tokens overflow
      productionMode: false
    });

    const hostileRunId = 'run-abc\nINJECTED:fake_runid_audit=PASS';
    const parentRunId = 'parent-1';
    const indices: NewTokenIndices = { prompt: 0, completion: 0 };

    let thrown: unknown = null;
    try {
      for (let i = 0; i < 10; i++) {
        await handler.handleLLMNewToken('x'.repeat(8), indices, hostileRunId, parentRunId);
      }
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);

    const bufferExceededCall = spyLogger.warn.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('Stream buffer exceeded')
    );
    expect(bufferExceededCall).toBeDefined();
    const meta = bufferExceededCall![1] as { runId?: string };
    expect(meta.runId).toBeDefined();
    expect(meta.runId).not.toContain('\n');
    expect(meta.runId).toContain('INJECTED');
  });

  it('end-to-end: escapes a zero-width U+200B in runId at the stream-buffer-exceeded log site (security regression)', async () => {
    // security regression: core `sanitizeLogString` now hex-escapes the zero-width / Unicode-
    // format class. Drive the real buffer-exceeded warn with a runId carrying
    // U+200B and assert the spy logger captured the ESCAPED form. With the core
    // format-escape pass removed, the raw zero-width char would land in the meta
    // unchanged — this test is load-bearing on the core primitive (ADR-0001).
    // The raw char is derived via String.fromCodePoint so no invisible byte is
    // embedded in the test source.
    const spyLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const handler = new GuardrailsCallbackHandler({
      validators: [
        {
          name: 'NoOp',
          validate: () => ({
            allowed: true,
            blocked: false,
            severity: 'info' as const,
            risk_level: 'low' as const,
            risk_score: 0,
            findings: [],
            timestamp: Date.now()
          })
        } as never
      ],
      logger: spyLogger,
      validateStreaming: true,
      maxStreamBufferSize: 16,
      productionMode: false
    });

    const zwsp = String.fromCodePoint(0x200b);
    const hostileRunId = `run-ad${zwsp}min:fake_runid_audit=PASS`;
    const parentRunId = 'parent-1';
    const indices: NewTokenIndices = { prompt: 0, completion: 0 };

    let thrown: unknown = null;
    try {
      for (let i = 0; i < 10; i++) {
        await handler.handleLLMNewToken('x'.repeat(8), indices, hostileRunId, parentRunId);
      }
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);

    const bufferExceededCall = spyLogger.warn.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('Stream buffer exceeded')
    );
    expect(bufferExceededCall).toBeDefined();
    const meta = bufferExceededCall![1] as { runId?: string };
    expect(meta.runId).toBeDefined();
    expect(meta.runId).not.toContain(zwsp);
    expect(meta.runId).toContain('\\u200b');
  });
});
