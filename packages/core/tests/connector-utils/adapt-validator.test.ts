/**
 * adaptValidator Tests
 * ====================
 * Covers the capability-detection heuristic (static / instance / inferred),
 * the required-name guard, and the full extractStringContent branch matrix
 * — including the Sprint 20 security N-1 circular-ref sentinel (a non-
 * serializable tool_call must NOT collapse to '' and silently skip
 * validation).
 */

import { describe, it, expect, vi } from 'vitest';
import { adaptValidatorToUniversalInput, extractStringContent } from '../../src/connector-utils/adapt-validator.js';
import { createResult, Severity } from '../../src/base/GuardrailResult.js';
import type { Validator, ValidatorInput } from '../../src/engine/GuardrailEngine.types.js';

const ok = () => createResult(true, Severity.INFO);

describe('adaptValidatorToUniversalInput', () => {
  describe('name guard', () => {
    it('throws TypeError when the validator has no name', () => {
      const v = { validate: vi.fn(ok) } as unknown as Validator;
      expect(() => adaptValidatorToUniversalInput(v, 'caller')).toThrow(TypeError);
      expect(() => adaptValidatorToUniversalInput(v, 'caller')).toThrow(/missing required/);
    });

    it('throws when the name is an empty string', () => {
      const v = { name: '', validate: vi.fn(ok) } as unknown as Validator;
      expect(() => adaptValidatorToUniversalInput(v, 'myCaller')).toThrow(/myCaller/);
    });

    it('preserves the validator name on the wrapper', () => {
      const v: Validator = { name: 'keepme', validate: vi.fn(ok) };
      expect(adaptValidatorToUniversalInput(v, 'c').name).toBe('keepme');
    });
  });

  describe('capability: string (inferred default)', () => {
    it('pre-extracts envelope content and passes the STRING to the validator', async () => {
      const spy = vi.fn(ok);
      const v: Validator = { name: 'legacy', validate: spy };
      const wrapped = adaptValidatorToUniversalInput(v, 'c');

      await wrapped.validate({ kind: 'text', content: 'inner-text' });

      expect(spy).toHaveBeenCalledWith('inner-text');
    });

    it('passes a raw string straight through', async () => {
      const spy = vi.fn(ok);
      const wrapped = adaptValidatorToUniversalInput({ name: 'l', validate: spy }, 'c');
      await wrapped.validate('plain');
      expect(spy).toHaveBeenCalledWith('plain');
    });
  });

  describe('capability: envelope / both (declared)', () => {
    it('passes the envelope through unchanged when declared via static property', async () => {
      const spy = vi.fn(ok);
      class EnvelopeValidator implements Validator {
        static readonly acceptsInput = 'both' as const;
        readonly name = 'envelope-aware';
        validate = spy;
      }
      const wrapped = adaptValidatorToUniversalInput(new EnvelopeValidator(), 'c');
      const envelope: ValidatorInput = { kind: 'text', content: 'keep-envelope' };

      await wrapped.validate(envelope);

      expect(spy).toHaveBeenCalledWith(envelope);
    });

    it('honours an instance-level acceptsInput property', async () => {
      const spy = vi.fn(ok);
      const v = {
        name: 'inst',
        acceptsInput: 'envelope' as const,
        validate: spy
      } as unknown as Validator;
      const wrapped = adaptValidatorToUniversalInput(v, 'c');
      const envelope: ValidatorInput = {
        kind: 'memory_write',
        payload: { content: 'm' }
      };

      await wrapped.validate(envelope);

      expect(spy).toHaveBeenCalledWith(envelope);
    });
  });
});

describe('extractStringContent', () => {
  it('returns a raw string unchanged', () => {
    expect(extractStringContent('hi')).toBe('hi');
  });

  it('extracts text content', () => {
    expect(extractStringContent({ kind: 'text', content: 'T' })).toBe('T');
  });

  it('extracts audio_partial content', () => {
    expect(extractStringContent({ kind: 'audio_partial', content: 'A', isFinal: true })).toBe('A');
  });

  it('joins composed_context entries with a blank line', () => {
    expect(extractStringContent({ kind: 'composed_context', entries: ['one', 'two'] })).toBe('one\n\ntwo');
  });

  it('extracts memory_write payload content', () => {
    expect(extractStringContent({ kind: 'memory_write', payload: { content: 'M' } })).toBe('M');
  });

  it('joins retrieved_docs content with a blank line', () => {
    expect(
      extractStringContent({
        kind: 'retrieved_docs',
        docs: [{ content: 'd1' }, { content: 'd2' }]
      })
    ).toBe('d1\n\nd2');
  });

  it('stringifies object tool_call args', () => {
    expect(extractStringContent({ kind: 'tool_call', toolName: 't', args: { a: 1 } })).toBe('{"a":1}');
  });

  it('returns string tool_call args verbatim', () => {
    expect(extractStringContent({ kind: 'tool_call', toolName: 't', args: 'raw-args' })).toBe('raw-args');
  });

  it('emits a scan-able sentinel for circular tool_call args (security N-1)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const out = extractStringContent({
      kind: 'tool_call',
      toolName: 't',
      args: circular
    });
    // MUST NOT be empty — an empty string would skip validation entirely.
    expect(out).not.toBe('');
    expect(out).toBe('[non-serializable tool_call args]');
  });

  it('falls back to String() for an unknown envelope kind', () => {
    const weird = { kind: 'future_kind' } as unknown as ValidatorInput;
    expect(extractStringContent(weird)).toBe('[object Object]');
  });
});
