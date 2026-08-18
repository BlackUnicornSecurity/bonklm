/**
 * guard-content derivation tests
 * ==============================
 * Unit coverage for `deriveGuardContent` — the structured-input →
 * guard-string reduction used by `GuardrailEngine.validateInput` so that
 * `Guard`-shaped checks fire on every `ValidatorInput` surface.
 */
import { describe, it, expect } from 'vitest';
import { deriveGuardContent, safeJsonStringify } from '../../src/engine/guard-content.js';
import type { ValidatorInput } from '../../src/engine/GuardrailEngine.js';

describe('deriveGuardContent', () => {
  it('passes text content through verbatim', () => {
    expect(deriveGuardContent({ kind: 'text', content: 'hello world' })).toBe('hello world');
  });

  it('passes audio_partial content through verbatim', () => {
    expect(deriveGuardContent({ kind: 'audio_partial', content: 'spoken chunk', isFinal: true })).toBe('spoken chunk');
  });

  it('joins composed_context entries with newlines', () => {
    expect(deriveGuardContent({ kind: 'composed_context', entries: ['a', 'b', 'c'] })).toBe('a\nb\nc');
  });

  it('surfaces retrieved_docs content verbatim plus JSON-encoded id/metadata', () => {
    const out = deriveGuardContent({
      kind: 'retrieved_docs',
      docs: [{ id: '1', content: 'doc-one', metadata: { source: 'x' } }, { content: 'doc-two' }]
    });
    // doc-one carries id+metadata (appended as JSON); doc-two has neither
    // (extras collapse to `{}` → content only).
    expect(out).toBe('doc-one\n{"id":"1","metadata":{"source":"x"}}\ndoc-two');
  });

  it('surfaces a credential planted in retrieved_docs metadata (not just content)', () => {
    const out = deriveGuardContent({
      kind: 'retrieved_docs',
      docs: [{ id: 'doc-1', content: 'body text', metadata: { note: 'META_TOKEN_7' } }]
    });
    expect(out).toContain('body text');
    expect(out).toContain('META_TOKEN_7');
  });

  it('keeps present-but-empty retrieved_docs metadata (only an all-absent payload collapses)', () => {
    // `metadata: {}` is distinct from absent metadata: it must still be
    // appended (it could carry nested values in a real doc), not dropped.
    expect(deriveGuardContent({ kind: 'retrieved_docs', docs: [{ content: 'c', metadata: {} }] })).toBe(
      'c\n{"metadata":{}}'
    );
  });

  it('surfaces memory_write content plus structured fields (userId / sessionId / metadata)', () => {
    expect(deriveGuardContent({ kind: 'memory_write', payload: { content: 'remember this', userId: 'u1' } })).toBe(
      'remember this\n{"userId":"u1"}'
    );
  });

  it('surfaces a credential planted in memory_write metadata (not just content)', () => {
    const out = deriveGuardContent({
      kind: 'memory_write',
      payload: { content: 'note', userId: 'USER_TOKEN_9', sessionId: 's1', metadata: { k: 'MEM_TOKEN_3' } }
    });
    expect(out).toContain('note');
    expect(out).toContain('USER_TOKEN_9');
    expect(out).toContain('MEM_TOKEN_3');
  });

  it('encodes only the present memory_write structured field (sessionId only)', () => {
    expect(deriveGuardContent({ kind: 'memory_write', payload: { content: 'note', sessionId: 'sess-1' } })).toBe(
      'note\n{"sessionId":"sess-1"}'
    );
  });

  it('returns content only when memory_write carries no structured fields', () => {
    expect(deriveGuardContent({ kind: 'memory_write', payload: { content: 'just content' } })).toBe('just content');
  });

  it('combines tool name and JSON-encoded args for tool_call', () => {
    const out = deriveGuardContent({
      kind: 'tool_call',
      toolName: 'fs.write',
      args: { path: '/tmp/x', body: 'data' }
    });
    expect(out).toBe('fs.write\n{"path":"/tmp/x","body":"data"}');
  });

  it('keeps text-bearing content unescaped so source-syntax patterns survive', () => {
    // The whole point of NOT JSON-encoding text surfaces: a quote-delimited
    // pattern must reach the guard verbatim, not as `\"`-escaped JSON.
    const line = 'api_key = "value-stays-quoted-and-unescaped"';
    expect(deriveGuardContent({ kind: 'text', content: line })).toBe(line);
    expect(deriveGuardContent({ kind: 'composed_context', entries: [line] })).toBe(line);
  });

  it('still surfaces serializable tool_call args when a sibling is circular (no guard blinding)', () => {
    // Evasion guard: an attacker shaping args must not be able to hide a
    // real secret in a serializable key by appending one circular sibling.
    const args: Record<string, unknown> = { token: 'KEEPME_TOKEN_42' };
    args.loop = args;
    const out = deriveGuardContent({ kind: 'tool_call', toolName: 'x', args });
    expect(out).toContain('KEEPME_TOKEN_42');
    expect(out).toContain('[Circular]');
  });

  it('neutralises a circular reference in tool_call args (marker, not a crash)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(deriveGuardContent({ kind: 'tool_call', toolName: 'x', args: circular })).toBe('x\n{"self":"[Circular]"}');
  });

  it('encodes BigInt in tool_call args as a decimal string', () => {
    expect(deriveGuardContent({ kind: 'tool_call', toolName: 'x', args: { n: BigInt(1) } })).toBe('x\n{"n":"1"}');
  });

  it('encodes undefined tool_call args as an empty payload (no throw)', () => {
    expect(deriveGuardContent({ kind: 'tool_call', toolName: 'x', args: undefined })).toBe('x\n');
  });

  it('returns the inert sentinel when tool_call args cannot be encoded at all (throwing getter)', () => {
    const hostile = {
      get boom(): string {
        throw new Error('nope');
      }
    };
    expect(deriveGuardContent({ kind: 'tool_call', toolName: 'x', args: hostile })).toBe(
      'x\n[bonklm: input not serializable]'
    );
  });

  it('falls back to a full JSON encode for an unknown future kind (forward-compat)', () => {
    const unknownKind = { kind: 'speculative_future', content: 'payload' } as unknown as ValidatorInput;
    expect(deriveGuardContent(unknownKind)).toBe('{"kind":"speculative_future","content":"payload"}');
  });
});

describe('safeJsonStringify', () => {
  it('encodes a plain object', () => {
    expect(safeJsonStringify({ a: 1, b: 'two' })).toBe('{"a":1,"b":"two"}');
  });

  it('neutralises a circular reference (marker) instead of dropping siblings or throwing', () => {
    const obj: Record<string, unknown> = { keep: 'VALUE_X' };
    obj.loop = obj;
    const out = safeJsonStringify(obj);
    expect(out).toContain('"keep":"VALUE_X"');
    expect(out).toContain('[Circular]');
  });

  it('encodes BigInt as its decimal string', () => {
    expect(safeJsonStringify({ n: BigInt(42) })).toBe('{"n":"42"}');
  });

  it('returns the inert sentinel when encoding genuinely throws (throwing getter)', () => {
    const hostile = {
      get boom(): string {
        throw new Error('nope');
      }
    };
    expect(safeJsonStringify(hostile)).toBe('[bonklm: input not serializable]');
  });

  it('returns an empty string for values JSON.stringify drops (undefined)', () => {
    expect(safeJsonStringify(undefined)).toBe('');
  });
});
