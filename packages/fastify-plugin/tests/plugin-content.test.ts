import { describe, expect, it } from 'vitest';
import { defaultResponseExtractor, extractRequestContent, isUninspectableResponsePayload } from '../src/content.js';

describe('Fastify content extraction boundary', () => {
  it('recognizes stream, async-iterable, and web response shapes', () => {
    expect(isUninspectableResponsePayload('text')).toBe(false);
    expect(isUninspectableResponsePayload(null)).toBe(false);
    expect(isUninspectableResponsePayload({ pipe() {} })).toBe(true);
    expect(isUninspectableResponsePayload({ getReader() {} })).toBe(true);
    expect(isUninspectableResponsePayload({ [Symbol.asyncIterator]() {} })).toBe(true);
    expect(isUninspectableResponsePayload({ arrayBuffer() {}, text() {}, body: {} })).toBe(true);
    expect(isUninspectableResponsePayload({ arrayBuffer() {}, text() {} })).toBe(false);
  });

  it('extracts ordinary response representations', () => {
    expect(defaultResponseExtractor('text')).toBe('text');
    expect(defaultResponseExtractor(Buffer.from('buffer'))).toBe('buffer');
    expect(defaultResponseExtractor(new Uint8Array(Buffer.from('bytes')))).toBe('bytes');
    expect(defaultResponseExtractor(null)).toBe('');
    expect(defaultResponseExtractor(undefined)).toBe('');
    expect(defaultResponseExtractor({ ok: true })).toBe('{"ok":true}');
  });

  it('fails closed on uninspectable or invalid response representations', () => {
    expect(() => defaultResponseExtractor({ pipe() {} })).toThrow(/custom responseExtractor/);
    expect(() => defaultResponseExtractor(new Uint8Array([0xff]))).toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(defaultResponseExtractor(cyclic)).toBe('[object Object]');
  });

  it('extracts request strings, bytes, primitives, objects, and empty values', () => {
    expect(extractRequestContent('text')).toBe('text');
    expect(extractRequestContent(Buffer.from('buffer'))).toBe('buffer');
    expect(extractRequestContent(new Uint8Array(Buffer.from('bytes')))).toBe('bytes');
    expect(extractRequestContent(null)).toBe('');
    expect(extractRequestContent(undefined)).toBe('');
    expect(extractRequestContent(42)).toBe('42');
    expect(extractRequestContent({ ok: true })).toBe('{"ok":true}');
  });

  it('rejects invalid or unserializable request bytes and objects', () => {
    expect(() => extractRequestContent(new Uint8Array([0xff]))).toThrow();
    expect(() => extractRequestContent({ toJSON: () => undefined })).toThrow(/could not be serialized/);
  });
});
