/**
 * mastra — reduced-content telemetry (follow-up to security regression)
 * ===================================================================
 * The `tool_result` indirect-injection arm only scans the text the reducer
 * surfaces. A non-text content part (an `image_url`, or an unrecognized part
 * `type`) is reduced to a placeholder or dropped, so that channel rides through
 * UNSCANNED. PR #146 established the principle "never a silent pass": an
 * uninspectable channel must emit operator telemetry. These tests prove the
 * mastra reducer tallies the dropped channels and the guardrail emits the
 * #146-style `warn` — with the attacker-controlled kind label CWE-117-sanitized
 * (ADR-0001). Removing the `emitReducedContentTelemetry` call turns the
 * guardrail tests red; removing `sanitizeLogString` turns the escaping test red.
 */
import { describe, it, expect, vi } from 'vitest';
import { createGuardedMastra, type MastraMessage, type MastraContentPart, type MastraToolCall } from '../src/index.js';
import { messagesToText, messagesToTextWithTelemetry } from '../src/messages-to-text.js';
import { noOpValidator } from '@blackunicorn/bonklm/testing';
import type { Logger } from '@blackunicorn/bonklm';

const TELEMETRY_MSG =
  '[Mastra Guardrails] Message content part(s) reduced to placeholder or dropped; channel passed unscanned';
const TOOL_CALL: MastraToolCall = { id: 't1', name: 'read_file' };

const NL = String.fromCharCode(10); // LF
const ESC = String.fromCharCode(27); // ESC

const createSpyLogger = (): Logger =>
  ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) as unknown as Logger;

const findWarn = (logger: Logger, message: string): Record<string, unknown> | undefined =>
  (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(call => call[0] === message)?.[1] as
    | Record<string, unknown>
    | undefined;

// Build an unrecognized-type part — the declared union is not enforced on the
// untyped JSON an agent SDK hands the connector.
const unknownPart = (type: string): MastraContentPart => ({ type }) as unknown as MastraContentPart;

describe('mastra messagesToTextWithTelemetry — reduced-channel tally', () => {
  it('text-only content reduces nothing', () => {
    const { text, tally } = messagesToTextWithTelemetry([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]);
    expect(text).toBe('hello');
    expect(tally.reducedCount).toBe(0);
    expect(tally.reducedKinds).toEqual([]);
  });

  it('tallies an image_url part as a reduced channel (placeholder surfaced)', () => {
    const { text, tally } = messagesToTextWithTelemetry([
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x/y.png' } }] }
    ]);
    expect(text).toBe('[Image]');
    expect(tally.reducedCount).toBe(1);
    expect(tally.reducedKinds).toEqual(['image_url']);
  });

  it('tallies an unrecognized content-part type as a dropped channel (label = raw type)', () => {
    const { text, tally } = messagesToTextWithTelemetry([{ role: 'tool', content: [unknownPart('x-custom-blob')] }]);
    expect(text).toBe(''); // dropped to empty — nothing scannable surfaced
    expect(tally.reducedCount).toBe(1);
    expect(tally.reducedKinds).toEqual(['x-custom-blob']);
  });

  it('labels a non-string/empty part type as "unknown"', () => {
    const { tally } = messagesToTextWithTelemetry([{ role: 'tool', content: [unknownPart('')] }]);
    expect(tally.reducedKinds).toEqual(['unknown']);
  });

  it('counts every reduced part but de-duplicates kinds', () => {
    const { tally } = messagesToTextWithTelemetry([
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'a' } },
          { type: 'image_url', image_url: { url: 'b' } }
        ]
      }
    ]);
    expect(tally.reducedCount).toBe(2);
    expect(tally.reducedKinds).toEqual(['image_url']);
  });

  it('propagates a nested reduced kind out of a structured tool_result', () => {
    const { tally } = messagesToTextWithTelemetry([
      {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolResult: { toolUseId: 't1', content: [{ type: 'image_url', image_url: { url: 'a' } }] }
          }
        ]
      }
    ]);
    expect(tally.reducedCount).toBe(1);
    expect(tally.reducedKinds).toEqual(['image_url']);
  });

  it('keeps messagesToText output byte-identical to the reducer text view', () => {
    const messages: MastraMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'image_url', image_url: { url: 'x' } }
        ]
      }
    ];
    expect(messagesToText(messages)).toBe('hi\n[Image]');
    expect(messagesToText(messages)).toBe(messagesToTextWithTelemetry(messages).text);
  });
});

// Branch coverage for the reducer paths the telemetry refactor rewrote — text
// output stays identical to the pre-telemetry behaviour, and none of these
// reduce a real channel (so the tally stays empty).
describe('mastra reducer — non-telemetry branch parity', () => {
  it('handles a message with no content', () => {
    const { text, tally } = messagesToTextWithTelemetry([{ role: 'user', content: undefined as unknown as string }]);
    expect(text).toBe('');
    expect(tally.reducedCount).toBe(0);
  });

  it('stringifies a non-string / non-array content value', () => {
    const { text, tally } = messagesToTextWithTelemetry([{ role: 'user', content: 42 as unknown as string }]);
    expect(text).toBe('42');
    expect(tally.reducedCount).toBe(0);
  });

  it('treats a text part with no text as empty (not a reduced channel)', () => {
    const { text, tally } = messagesToTextWithTelemetry([{ role: 'user', content: [{ type: 'text' }] }]);
    expect(text).toBe('');
    expect(tally.reducedCount).toBe(0);
  });

  it('serializes a tool_use part and falls back to [unparseable] on a non-serializable input', () => {
    const okInput = messagesToTextWithTelemetry([
      { role: 'assistant', content: [{ type: 'tool_use', toolUse: { id: '1', name: 'search', input: { q: 'x' } } }] }
    ]);
    expect(okInput.text).toBe('Tool: search\nInput: {"q":"x"}');

    const badInput = messagesToTextWithTelemetry([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', toolUse: { id: '1', name: 'search', input: { big: BigInt(1) } } }]
      }
    ]);
    expect(badInput.text).toBe('Tool: search\nInput: [unparseable]');
    expect(badInput.tally.reducedCount).toBe(0);
  });

  it('surfaces a string tool_result and an error tool_result without reducing a channel', () => {
    const str = messagesToTextWithTelemetry([
      { role: 'tool', content: [{ type: 'tool_result', toolResult: { toolUseId: 't1', content: 'done' } }] }
    ]);
    expect(str.text).toBe('Tool Result: done');

    const err = messagesToTextWithTelemetry([
      { role: 'tool', content: [{ type: 'tool_result', toolResult: { toolUseId: 't1', isError: true } }] }
    ]);
    expect(err.text).toBe('Tool Error');

    const empty = messagesToTextWithTelemetry([
      { role: 'tool', content: [{ type: 'tool_result', toolResult: { toolUseId: 't1' } }] }
    ]);
    expect(empty.text).toBe('');
    expect(empty.tally.reducedCount).toBe(0);
  });
});

describe('mastra guardrail — reduced-content telemetry sink', () => {
  it('emits a warn when validateToolResult drops a structured channel (regression: silent pass closed)', async () => {
    const logger = createSpyLogger();
    const guardrails = createGuardedMastra({ validators: [noOpValidator()], logger });
    const msg: MastraMessage = {
      role: 'tool',
      content: [{ type: 'image_url', image_url: { url: 'https://x/y.png' } }]
    };

    const res = await guardrails.validateToolResult(msg, TOOL_CALL);

    expect(res.allowed).toBe(true); // '[Image]' is benign — the point is the SIGNAL, not a block
    const meta = findWarn(logger, TELEMETRY_MSG);
    expect(meta).toBeDefined();
    expect(meta?.surface).toBe('tool_result');
    expect(meta?.reducedCount).toBe(1);
    expect(meta?.reducedKinds).toEqual(['image_url']);
  });

  it('CWE-117: sanitizes an attacker-controlled content-part type in the telemetry meta (ADR-0001)', async () => {
    const logger = createSpyLogger();
    const guardrails = createGuardedMastra({ validators: [noOpValidator()], logger });
    const evilType = `x-evil${NL}INJECTED${ESC}tail`;
    const msg: MastraMessage = { role: 'tool', content: [unknownPart(evilType)] };

    await guardrails.validateToolResult(msg, TOOL_CALL);

    const meta = findWarn(logger, TELEMETRY_MSG);
    expect(meta).toBeDefined();
    const kinds = meta?.reducedKinds as string[];
    expect(kinds[0]).toContain('INJECTED');
    expect(kinds[0]).not.toContain(NL); // raw LF must be escaped
    expect(kinds[0]).not.toContain(ESC); // raw ESC must be escaped
    // Pin the positive escaped form (LF → literal \n marker, ESC → \x1b hex) so a
    // sanitizer that DELETED the control chars rather than escaping them still fails.
    expect(kinds[0]).toBe('x-evil\\nINJECTED\\x1btail');
  });

  it('does NOT warn for a benign all-text tool result', async () => {
    const logger = createSpyLogger();
    const guardrails = createGuardedMastra({ validators: [noOpValidator()], logger });
    await guardrails.validateToolResult('Quarterly revenue rose 4%. No action required.', TOOL_CALL);
    expect(findWarn(logger, TELEMETRY_MSG)).toBeUndefined();
  });

  it('emits a warn on the input path with the input surface label', async () => {
    const logger = createSpyLogger();
    const guardrails = createGuardedMastra({ validators: [noOpValidator()], logger });
    await guardrails.beforeAgentExecution([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'image_url', image_url: { url: 'x' } }
        ]
      }
    ]);
    const meta = findWarn(logger, TELEMETRY_MSG);
    expect(meta?.surface).toBe('input');
    expect(meta?.reducedKinds).toEqual(['image_url']);
  });
});
