/**
 * Sprint 43 cross-connector CWE-117 sweep — ollama-connector regression.
 *
 * Seven src sites flagged by security review HIGH #1 across chat +
 * generate paths:
 *   - input-blocked log + throw (raw reason).
 *   - chat output-blocked log + filteredContent (raw reason — flows
 *     into `response.message.content` returned to caller).
 *   - generate output-blocked log + filteredContent (raw reason —
 *     flows into `response.response` returned to caller).
 *
 * Sprint 43 sanitizes all 7 boundaries.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  RiskLevel,
  sanitizeLogString,
  sanitizeMeta,
  serializeError,
  Severity,
  type GuardrailResult
} from '@blackunicorn/bonklm';
import { createGuardedOllama } from '../src/guarded-ollama';

describe('ollama-connector — Sprint 43 CWE-117 sanitization contract', () => {
  it('imports sanitizeMeta from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(sanitizeMeta('a\nb')).toBe('a\\nb');
  });

  it('imports sanitizeLogString + serializeError', () => {
    expect(typeof sanitizeLogString).toBe('function');
    expect(typeof serializeError).toBe('function');
  });

  it('sanitizes validator-extracted reason for input/output paths', () => {
    const reason = 'matched ignore_previous\nINJECTED:CRITICAL bypass';
    expect(sanitizeMeta(reason)).toBe('matched ignore_previous\\nINJECTED:CRITICAL bypass');
  });

  it('sanitizes filteredContent embedded in application response', () => {
    // ollama's filteredContent lands in `response.message.content`
    // (chat path) or `response.response` (generate path) — application-
    // output surface returned to caller.
    const reason = 'unsafe pattern matched\nFAKE_INJECTED';
    const filtered = `[Content filtered by guardrails: ${sanitizeMeta(reason)}]`;
    expect(filtered).not.toContain('\n');
    expect(filtered).toContain('FAKE_INJECTED');
  });
});

/**
 * End-to-end regression for the incremental-stream **final-block** marker
 * across BOTH ollama paths (chat → `message.content`, generate →
 * `response`). The validator-extracted `reason` reaches this
 * consumer-facing sink RAW (the engine sanitizes only its own log line,
 * not the per-validator `reason` returned to the connector), so the
 * connector is the CWE-117 boundary. Each test drives the real public
 * client with a validator that returns control chars in `reason` and
 * asserts the emitted marker neutralizes them. Removing the
 * `sanitizeMeta(...)` wrap fails these tests (ADR-0001 regression
 * contract).
 */
const FINAL_BLOCK_SENTINEL = '__BONK_FINAL_BLOCK__';
// Real control chars: LF (newline forge), ESC (ANSI / CSI), CR.
const HOSTILE_REASON = 'matched ignore_previous\nFORGED-LOG-LINE\x1b[31mred\rcarriage';

function controlCharReasonValidator() {
  return {
    name: 'control-char-reason',
    validate(input: unknown): GuardrailResult {
      const text = typeof input === 'string' ? input : '';
      if (text.includes(FINAL_BLOCK_SENTINEL)) {
        return {
          allowed: false,
          blocked: true,
          reason: HOSTILE_REASON,
          severity: Severity.CRITICAL,
          risk_level: RiskLevel.HIGH,
          risk_score: 100,
          findings: [],
          timestamp: Date.now()
        };
      }
      return {
        allowed: true,
        blocked: false,
        severity: Severity.INFO,
        risk_level: RiskLevel.LOW,
        risk_score: 0,
        findings: [],
        timestamp: Date.now()
      };
    }
  };
}

function assertReasonNeutralized(marker: string | undefined) {
  expect(marker).toBeDefined();
  // The only raw newlines permitted are the marker's own "\n\n" prefix;
  // the hostile reason's embedded LF/CR must arrive escaped, not raw.
  expect((marker!.match(/\n/g) ?? []).length).toBe(2);
  expect(marker).not.toContain('\x1b'); // raw ESC neutralized
  expect(marker).not.toContain('\r'); // raw CR neutralized
  expect(marker).toContain('\\n'); // newline escaped to a literal marker
  expect(marker).toContain('FORGED-LOG-LINE'); // forensic signal preserved
}

// Two chunks (< VALIDATION_INTERVAL = 10) → no mid-stream incremental
// check fires, so execution reaches the final-block path.
async function* hostileChatStream() {
  yield {
    model: 'llama3.1',
    created_at: new Date(),
    message: { role: 'assistant', content: 'safe ' },
    done: false,
    done_reason: ''
  };
  yield {
    model: 'llama3.1',
    created_at: new Date(),
    message: { role: 'assistant', content: FINAL_BLOCK_SENTINEL },
    done: true,
    done_reason: 'stop'
  };
}

async function* hostileGenerateStream() {
  yield { model: 'llama3.1', created_at: new Date(), response: 'safe ', done: false, done_reason: '', context: [] };
  yield {
    model: 'llama3.1',
    created_at: new Date(),
    response: FINAL_BLOCK_SENTINEL,
    done: true,
    done_reason: 'stop',
    context: []
  };
}

describe('ollama-connector — CWE-117 incremental final-block marker', () => {
  it('neutralizes control chars in the chat post-stream blocked-reason marker', async () => {
    const mockClient = { chat: vi.fn().mockResolvedValue(hostileChatStream()), generate: vi.fn() } as any;

    const guarded = createGuardedOllama(mockClient, {
      validators: [controlCharReasonValidator()],
      validateStreaming: true,
      streamingMode: 'incremental',
      productionMode: false, // pin dev-mode: the reason-bearing marker is what we assert on
      onStreamBlocked: vi.fn()
    });

    const result = await guarded.chat({
      model: 'llama3.1',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true
    });

    const chunks: any[] = [];
    for await (const chunk of result as any) {
      chunks.push(chunk);
    }

    const marker = chunks
      .map(c => c?.message?.content)
      .find((t): t is string => typeof t === 'string' && t.includes('Content filtered by guardrails:'));

    assertReasonNeutralized(marker);
  });

  it('neutralizes control chars in the generate post-stream blocked-reason marker', async () => {
    const mockClient = { chat: vi.fn(), generate: vi.fn().mockResolvedValue(hostileGenerateStream()) } as any;

    const guarded = createGuardedOllama(mockClient, {
      validators: [controlCharReasonValidator()],
      validateStreaming: true,
      streamingMode: 'incremental',
      productionMode: false, // pin dev-mode: the reason-bearing marker is what we assert on
      onStreamBlocked: vi.fn()
    });

    const result = await guarded.generate({
      model: 'llama3.1',
      prompt: 'Hello',
      stream: true
    });

    const chunks: any[] = [];
    for await (const chunk of result as any) {
      chunks.push(chunk);
    }

    const marker = chunks
      .map(c => c?.response)
      .find((t): t is string => typeof t === 'string' && t.includes('Content filtered by guardrails:'));

    assertReasonNeutralized(marker);
  });
});
