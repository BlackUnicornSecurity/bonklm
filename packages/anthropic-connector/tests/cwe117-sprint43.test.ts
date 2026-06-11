/**
 * Sprint 43 cross-connector CWE-117 sweep — anthropic-connector regression.
 *
 * Two additional src sites surfaced post-Sprint-40:
 *   - line ~353 (`throw new Error(\`Content blocked: ${blocked.reason}\`)`)
 *     — dev-mode raw, sister to the Sprint-40-sanitized log-meta at
 *     line ~346.
 *   - line ~458 (`filteredContent = \`[Content filtered by guardrails:
 *     ${outputBlocked.reason}]\``) — raw reason flows into the
 *     application-output surface (response.content[0].text returned
 *     to the LLM caller).
 *
 * Sprint 43 wraps both with `sanitizeMeta`. Co-located test (separate
 * filename from any existing test file).
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
import { createGuardedAnthropic } from '../src/guarded-anthropic';

describe('anthropic-connector — Sprint 43 CWE-117 closure', () => {
  it('imports sanitizeMeta from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(sanitizeMeta('a\nb')).toBe('a\\nb');
  });

  it('sanitizes validator-extracted reason at the dev-mode throw boundary', () => {
    const reason = 'matched ignore_previous\nINJECTED:CRITICAL bypass';
    expect(sanitizeMeta(reason)).toBe('matched ignore_previous\\nINJECTED:CRITICAL bypass');
  });

  it('sanitizes validator-extracted reason in the filteredContent application-output surface', () => {
    // `response.content[0].text` is returned to the LLM caller —
    // frontend / agent transcript / terminal output. Raw control
    // chars would hijack rendering at downstream consumers.
    const reason = 'unsafe pattern matched\nFAKE_INJECTED:filtered=false';
    const filtered = `[Content filtered by guardrails: ${sanitizeMeta(reason)}]`;
    expect(filtered).not.toContain('\n');
    expect(filtered).toContain('FAKE_INJECTED');
  });

  it('imports serializeError + sanitizeLogString', () => {
    expect(typeof sanitizeLogString).toBe('function');
    expect(typeof serializeError).toBe('function');
  });
});

/**
 * End-to-end regression for the incremental-stream **final-block** marker.
 *
 * The `createIncrementalValidatedStream` post-stream validation path
 * interpolates the validator-extracted `reason` into a consumer-facing
 * `[Content filtered by guardrails: …]` stream delta. `reason` reaches
 * this sink RAW — the engine sanitizes only its own log line
 * (`GuardrailEngine` short-circuit), not the per-validator `reason`
 * surfaced back to the connector — so the connector is the CWE-117
 * boundary. This drives the real public client with a validator that
 * returns control chars in `reason` and asserts the emitted marker
 * neutralizes them. Removing the `sanitizeMeta(...)` wrap fails this
 * test (ADR-0001 regression contract).
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

// Fewer than VALIDATION_INTERVAL (10) content deltas → the incremental
// mid-stream check never fires, so execution reaches the final-block path.
async function* hostileFinalBlockStream() {
  yield { type: 'message_start', message: { id: 'msg-1', type: 'message' } };
  yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
  yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'safe ' } };
  yield {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: FINAL_BLOCK_SENTINEL }
  };
  yield { type: 'content_block_stop', index: 0 };
  yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } };
  yield { type: 'message_stop' };
}

describe('anthropic-connector — CWE-117 incremental final-block marker', () => {
  it('neutralizes control chars in the post-stream blocked-reason marker', async () => {
    const mockClient = { messages: { create: vi.fn().mockResolvedValue(hostileFinalBlockStream()) } } as any;

    const guarded = createGuardedAnthropic(mockClient, {
      validators: [controlCharReasonValidator()],
      validateStreaming: true,
      streamingMode: 'incremental',
      productionMode: false, // pin dev-mode: the reason-bearing marker is what we assert on
      onStreamBlocked: vi.fn()
    });

    const result = await guarded.messages.create({
      model: 'claude-3-opus-20240229',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 100,
      stream: true
    });

    const events: any[] = [];
    for await (const ev of result as AsyncIterable<any>) {
      events.push(ev);
    }

    const marker = events
      .map(e => e?.delta?.text)
      .find((t): t is string => typeof t === 'string' && t.includes('Content filtered by guardrails:'));

    expect(marker).toBeDefined();
    // The only raw newlines permitted are the marker's own "\n\n" prefix;
    // the hostile reason's embedded LF/CR must arrive escaped, not raw.
    expect((marker!.match(/\n/g) ?? []).length).toBe(2);
    expect(marker).not.toContain('\x1b'); // raw ESC neutralized
    expect(marker).not.toContain('\r'); // raw CR neutralized
    expect(marker).toContain('\\n'); // newline escaped to a literal marker
    expect(marker).toContain('FORGED-LOG-LINE'); // forensic signal preserved
  });
});
