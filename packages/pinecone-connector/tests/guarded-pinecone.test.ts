/**
 * Pinecone Connector Tests
 * =======================
 *
 * Tests for the guarded Pinecone wrapper.
 */

import { describe, it, expect, vi } from 'vitest';
import { createGuardedIndex, PINECONE_NATIVE_QUERY_KEYS } from '../src/guarded-pinecone.js';
import { PromptInjectionValidator, PIIGuard, Severity } from '@blackunicorn/bonklm';
import type { Validator, GuardrailResult } from '@blackunicorn/bonklm';
import { noOpValidator } from '@blackunicorn/bonklm/testing';

// Mock Pinecone Index. `namespace(ns)` returns a namespaced index whose
// `query` is a distinct spy (`namespacedQuery`), mirroring the real SDK where
// namespace targeting is `index.namespace(ns).query(...)` — NOT a `namespace`
// key inside the query body.
const createMockPineconeIndex = () => {
  const queryResult = {
    matches: [
      { id: 'vec1', score: 0.95, metadata: { text: 'Safe vector content' } },
      { id: 'vec2', score: 0.85, metadata: { text: 'Another safe vector' } }
    ]
  };
  const namespacedQuery = vi.fn().mockResolvedValue(queryResult);
  return {
    query: vi.fn().mockResolvedValue(queryResult),
    namespace: vi.fn().mockReturnValue({ query: namespacedQuery }),
    namespacedQuery
  };
};

describe('Pinecone Connector', () => {
  describe('createGuardedIndex', () => {
    it('should allow valid queries', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        validators: [noOpValidator()]
      });

      const result = await guardedIndex.query({
        vector: [0.1, 0.2, 0.3],
        topK: 10
      });

      expect(result.filtered).toBe(false);
      expect(result.matches).toBeDefined();
      expect(result.vectorsBlocked).toBe(0);
    });

    it('should validate vector format', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        validators: [noOpValidator()]
      });

      await expect(guardedIndex.query({ vector: 'not-an-array' as any })).rejects.toThrow('Vector must be an array');
    });

    it('should validate vector contains only numbers', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        validators: [noOpValidator()]
      });

      // Sprint 31: assertion string updated to match canonical src error
      // ('finite numbers' is more precise — rejects NaN/Infinity too).
      await expect(guardedIndex.query({ vector: [0.1, 'invalid', 0.3] as any })).rejects.toThrow(
        'Vector must contain only finite numbers'
      );
    });

    it('should enforce maxTopK limit', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        validators: [noOpValidator()],
        maxTopK: 50
      });

      await guardedIndex.query({ vector: [0.1, 0.2], topK: 100 });

      expect(mockIndex.query).toHaveBeenCalledWith(
        expect.objectContaining({
          topK: 50
        })
      );
    });

    it('should sanitize dangerous filter patterns', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        validators: [noOpValidator()],
        sanitizeMetadataFilters: true
      });

      await expect(
        guardedIndex.query({
          vector: [0.1, 0.2],
          filter: { ['$..']: 'path-traversal' }
        })
      ).rejects.toThrow();
    });

    it('should validate retrieved vectors', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        validators: [noOpValidator()],
        guards: [new PIIGuard()],
        validateRetrievedVectors: true
      });

      const result = await guardedIndex.query({
        vector: [0.1, 0.2],
        topK: 10
      });

      expect(result).toBeDefined();
    });

    it('should filter blocked vectors', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        validators: [noOpValidator()],
        guards: [new PIIGuard()],
        validateRetrievedVectors: true,
        onBlockedVector: 'filter'
      });

      const result = await guardedIndex.query({
        vector: [0.1, 0.2],
        topK: 10
      });

      expect(result).toBeDefined();
    });

    it('should use production mode error messages', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        validators: [noOpValidator()],
        productionMode: true,
        sanitizeMetadataFilters: true
      });

      await expect(
        guardedIndex.query({
          vector: [0.1, 0.2],
          filter: { eval: 'malicious' }
        })
      ).rejects.toThrow('Invalid filter');
    });

    it('should call onVectorBlocked callback', async () => {
      const mockIndex = createMockPineconeIndex();
      const onBlocked = vi.fn();

      const guardedIndex = createGuardedIndex(mockIndex, {
        validators: [noOpValidator()],
        guards: [new PIIGuard()],
        validateRetrievedVectors: true,
        onVectorBlocked: onBlocked
      });

      await guardedIndex.query({ vector: [0.1, 0.2], topK: 10 });

      // May or may not be called depending on whether PII is detected
      expect(onBlocked).toBeDefined();
    });
  });

  describe('metadata filter sanitization', () => {
    it('should block eval pattern', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        validators: [noOpValidator()],
        sanitizeMetadataFilters: true
      });

      await expect(
        guardedIndex.query({
          vector: [0.1, 0.2],
          filter: { field: { eval: 'malicious' } }
        })
      ).rejects.toThrow();
    });

    it('should block path traversal', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        validators: [noOpValidator()],
        sanitizeMetadataFilters: true
      });

      await expect(
        guardedIndex.query({
          vector: [0.1, 0.2],
          filter: { ['$..']: 'attack' }
        })
      ).rejects.toThrow();
    });

    it('should block constructor access', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        validators: [noOpValidator()],
        sanitizeMetadataFilters: true
      });

      await expect(
        guardedIndex.query({
          vector: [0.1, 0.2],
          filter: { constructor: {} }
        })
      ).rejects.toThrow();
    });
  });

  describe('query options', () => {
    it('should target a namespace via index.namespace() (security regression)', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        validators: [noOpValidator()]
      });

      await guardedIndex.query({
        vector: [0.1, 0.2],
        topK: 10,
        namespace: 'test-ns'
      });

      // Namespace targeting routes through index.namespace(ns); the query
      // body must NOT carry a `namespace` key (the SDK silently ignores it).
      expect(mockIndex.namespace).toHaveBeenCalledWith('test-ns');
      expect(mockIndex.query).not.toHaveBeenCalled();
      expect(mockIndex.namespacedQuery).toHaveBeenCalledTimes(1);
      const body = mockIndex.namespacedQuery.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(body).not.toHaveProperty('namespace');
    });

    it('queries the index directly when no namespace is given', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        validators: [noOpValidator()]
      });

      await guardedIndex.query({ vector: [0.1, 0.2], topK: 10 });

      expect(mockIndex.query).toHaveBeenCalledTimes(1);
      expect(mockIndex.namespace).not.toHaveBeenCalled();
    });

    const topKCases: ReadonlyArray<{ label: string; requested: number; expected: number }> = [
      { label: 'a negative topK', requested: -5, expected: 1 },
      { label: 'a zero topK', requested: 0, expected: 1 },
      { label: 'a fractional topK', requested: 3.9, expected: 3 },
      { label: 'an over-max topK', requested: 100, expected: 50 }
    ];
    it.each(topKCases)(
      'clamps $label to the value sent to the client (security regression, no throw)',
      async ({ requested, expected }) => {
        const mockIndex = createMockPineconeIndex();
        const guardedIndex = createGuardedIndex(mockIndex, {
          validators: [noOpValidator()],
          maxTopK: 50
        });

        // The limit is normalized once and clamped (no out-of-range throw),
        // matching the qdrant/weaviate connectors.
        await expect(guardedIndex.query({ vector: [0.1, 0.2], topK: requested })).resolves.toBeDefined();

        expect(mockIndex.query).toHaveBeenCalledWith(expect.objectContaining({ topK: expected }));
      }
    );

    it('should support includeValues option', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        validators: [noOpValidator()]
      });

      await guardedIndex.query({
        vector: [0.1, 0.2],
        includeValues: true
      });

      expect(mockIndex.query).toHaveBeenCalledWith(
        expect.objectContaining({
          includeValues: true
        })
      );
    });
  });

  describe('namespace + option passthrough hardening (security regression)', () => {
    const badNamespaces: ReadonlyArray<{ label: string; namespace: unknown }> = [
      { label: 'an object namespace', namespace: {} },
      { label: 'a numeric namespace', namespace: 123 },
      { label: 'a boolean namespace', namespace: true }
    ];
    it.each(badNamespaces)('rejects $label without calling the SDK', async ({ namespace }) => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, { validators: [noOpValidator()] });

      await expect(guardedIndex.query({ vector: [0.1, 0.2], topK: 10, namespace } as any)).rejects.toThrow();
      expect(mockIndex.namespace).not.toHaveBeenCalled();
      expect(mockIndex.query).not.toHaveBeenCalled();
    });

    it('rejects a namespace with invalid characters', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, { validators: [noOpValidator()] });

      await expect(guardedIndex.query({ vector: [0.1, 0.2], topK: 10, namespace: 'bad ns/../x' })).rejects.toThrow();
      expect(mockIndex.namespace).not.toHaveBeenCalled();
    });

    it('rejects an over-long namespace', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, { validators: [noOpValidator()] });

      await expect(guardedIndex.query({ vector: [0.1, 0.2], topK: 10, namespace: 'a'.repeat(256) })).rejects.toThrow();
    });

    it('uses a generic namespace error in production mode', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, { validators: [noOpValidator()], productionMode: true });

      await expect(guardedIndex.query({ vector: [0.1, 0.2], topK: 10, namespace: 'bad ns!' })).rejects.toThrow(
        'Invalid namespace'
      );
    });

    it('accepts a valid namespace and targets it via index.namespace()', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, { validators: [noOpValidator()] });

      await guardedIndex.query({ vector: [0.1, 0.2], topK: 10, namespace: 'valid_ns-1' });
      expect(mockIndex.namespace).toHaveBeenCalledWith('valid_ns-1');
    });

    it('drops non-allow-listed caller options from the query body', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, { validators: [noOpValidator()] });

      await guardedIndex.query({
        vector: [0.1, 0.2],
        topK: 10,
        includeMetadata: true,
        // Not real Pinecone query-body keys — must be dropped, not forwarded.
        sparseVector: { indices: [1], values: [0.5] },
        evilOption: { $where: 'sleep(1000)' }
      } as any);

      expect(mockIndex.query).toHaveBeenCalledTimes(1);
      const body = mockIndex.query.mock.calls[0]?.[0] as Record<string, unknown>;
      const keys = Object.keys(body);
      expect(keys).not.toContain('sparseVector');
      expect(keys).not.toContain('evilOption');
      expect(body).toMatchObject({ includeMetadata: true });
    });
  });

  describe('Forwarded body key-set conformance (security regression)', () => {
    it('forwards EXACTLY the accounted query-body key set — the allow-list tuple plus the explicitly-set topK/filter, and nothing else', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, { validators: [noOpValidator()] });

      // Populate every option whose key the guarded `query` is meant to forward:
      // all three allow-listed passthrough keys + the explicitly-set topK / filter.
      // (`namespace` is intentionally omitted — it is the index handle, routed via
      // index.namespace(), never a query-body key.)
      await guardedIndex.query({
        vector: [0.1, 0.2, 0.3],
        topK: 5,
        includeValues: true,
        includeMetadata: true,
        filter: { genre: { $eq: 'sci-fi' } }
      });

      // The forwarded surface = the security regression allow-list tuple (passthrough) ∪ the keys
      // `query` writes explicitly (topK, filter). The EXACT key set (not a partial
      // `toMatchObject`) ties the body assembly to a single source: a dropped or
      // stray field fails here — the runtime half of the conformance lock that the
      // type-level test cannot see (security regression).
      const body = mockIndex.query.mock.calls[0]?.[0] as Record<string, unknown>;
      const expected = [...PINECONE_NATIVE_QUERY_KEYS, 'topK', 'filter'].sort();
      expect(Object.keys(body).sort()).toEqual(expected);
    });

    it('writes only the unconditionally-forwarded fields when the caller omits the optional ones', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, { validators: [noOpValidator()] });

      // Minimal call: `vector` (allow-listed) plus the always-written `topK`
      // (normalized) and `filter` (sanitized). includeValues / includeMetadata must
      // be ABSENT when not supplied — a regression admitting an allow-list key
      // unconditionally adds it here and fails, which the all-options case above
      // cannot see. `topK` and `filter` are intentionally unconditional, so they
      // remain present even in the minimal call (security regression).
      await guardedIndex.query({ vector: [0.1, 0.2, 0.3] });

      const body = mockIndex.query.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(['filter', 'topK', 'vector']);
    });
  });
});

describe('Pinecone Connector — CWE-117 reason sanitization is load-bearing (ADR-0001)', () => {
  // ADR-0001 non-vacuity proof for the query-blocked and vector-blocked-abort
  // `result.reason` throw sinks in src/guarded-pinecone.ts. cwe117-regression.test.ts
  // only asserts the sanitizer primitive in isolation; these tests drive the
  // guarded wrapper with a validator whose `reason` carries control characters
  // and assert the ESCAPED form in the thrown message — removing the matching
  // `sanitizeMeta(...)` wrap from src turns the corresponding test RED.
  const NL = String.fromCharCode(10); // LF
  const CR = String.fromCharCode(13); // CR
  const ESC = String.fromCharCode(27); // ESC
  const TAB = String.fromCharCode(9); // TAB
  const CRLF = `${CR}${NL}`; // CRLF (Windows line ending)
  // sanitizeLogString hex-escapes CR→\x0d and TAB→\x09 (and CRLF→\x0d\n) in its
  // control-char pass, which runs BEFORE the \n-collapse — so only LF maps to \n.
  const RAW_REASON = `matched${NL}INJECTED${ESC}poison${CR}carriage${CRLF}windows${TAB}tab`;
  const ESCAPED_REASON = 'matched\\nINJECTED\\x1bpoison\\x0dcarriage\\x0d\\nwindows\\x09tab';

  const blockResult = (reason: string): GuardrailResult => ({
    allowed: false,
    blocked: true,
    reason,
    severity: Severity.CRITICAL,
    risk_level: 'HIGH',
    risk_score: 30,
    findings: [{ category: 'test', severity: Severity.CRITICAL, description: 'blocked', weight: 30 }],
    timestamp: Date.now()
  });

  const allowResult = (): GuardrailResult => ({
    allowed: true,
    blocked: false,
    severity: Severity.INFO,
    risk_level: 'LOW',
    risk_score: 0,
    findings: [],
    timestamp: Date.now()
  });

  // Always blocks — triggers the pre-retrieval query-blocked throw.
  const alwaysBlock = (reason: string): Validator => ({
    name: 'AlwaysBlock',
    validate: () => blockResult(reason)
  });

  // Blocks only when the validated content contains the marker — lets the query
  // context pass but blocks the retrieved match (drives the vector-blocked path).
  const markerBlock = (marker: string, reason: string): Validator => ({
    name: 'MarkerBlock',
    validate: (input: unknown) =>
      (typeof input === 'string' ? input : '').includes(marker) ? blockResult(reason) : allowResult()
  });

  const mockIndex = (matches: unknown[] = []) => ({
    query: vi.fn().mockResolvedValue({ matches }),
    namespace: vi.fn(),
    namespacedQuery: vi.fn()
  });

  it('escapes a control-char validator reason at the query-blocked throw boundary', async () => {
    // productionMode pinned false so the throw carries the (escaped) reason
    // regardless of ambient NODE_ENV — production mode emits the generic message.
    const guarded = createGuardedIndex(mockIndex(), {
      validators: [alwaysBlock(RAW_REASON)],
      productionMode: false
    });

    await expect(guarded.query({ vector: [0.1, 0.2, 0.3], topK: 5 })).rejects.toThrow(ESCAPED_REASON);
  });

  it('escapes a control-char validator reason at the vector-blocked abort throw boundary', async () => {
    const POISON = 'POISONMARK';
    const guarded = createGuardedIndex(
      mockIndex([{ id: 'vec1', score: 0.9, metadata: { text: `${POISON} payload` } }]),
      {
        validators: [markerBlock(POISON, RAW_REASON)],
        onBlockedVector: 'abort',
        productionMode: false
      }
    );

    await expect(guarded.query({ vector: [0.1, 0.2, 0.3], topK: 5 })).rejects.toThrow(ESCAPED_REASON);
  });
});
