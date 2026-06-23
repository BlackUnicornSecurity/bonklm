/**
 * D-065 §7-step-2.b PR-A — Provenance contract
 * ============================================
 * Unit coverage for the provenance envelope's runtime helper. The interfaces
 * themselves are compile-time only; `hasToolResultProvenance` carries the
 * branch logic the indirect-injection / laundering guards depend on.
 */
import { describe, it, expect } from 'vitest';
import { hasToolResultProvenance, type Provenance } from '../../src/validators/provenance.js';

describe('hasToolResultProvenance', () => {
  it('returns false for absent provenance', () => {
    expect(hasToolResultProvenance(undefined)).toBe(false);
  });

  it('returns false for an empty derivation chain', () => {
    expect(hasToolResultProvenance({ derivedFrom: [] })).toBe(false);
  });

  it('returns false when malformed (derivedFrom not an array)', () => {
    expect(hasToolResultProvenance({} as unknown as Provenance)).toBe(false);
  });

  it('returns false for a null ref inside the chain', () => {
    const p = { derivedFrom: [null] } as unknown as Provenance;
    expect(hasToolResultProvenance(p)).toBe(false);
  });

  it('returns false for a chain of only user-input refs', () => {
    expect(hasToolResultProvenance({ derivedFrom: [{ source: 'user-input' }] })).toBe(false);
  });

  it('returns true for an mcp-tool-result ref', () => {
    expect(hasToolResultProvenance({ derivedFrom: [{ source: 'mcp-tool-result', tool: 'read_url' }] })).toBe(true);
  });

  it('returns true for an http-fetch ref', () => {
    expect(hasToolResultProvenance({ derivedFrom: [{ source: 'http-fetch', sourceUrl: 'https://x' }] })).toBe(true);
  });

  it('returns true for an agent-paraphrase ref', () => {
    expect(hasToolResultProvenance({ derivedFrom: [{ source: 'agent-paraphrase' }] })).toBe(true);
  });

  it('returns true when at least one ref in a mixed chain is tool-derived', () => {
    expect(
      hasToolResultProvenance({
        derivedFrom: [{ source: 'user-input' }, { source: 'mcp-tool-result' }]
      })
    ).toBe(true);
  });
});
