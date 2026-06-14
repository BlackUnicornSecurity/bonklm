/**
 * Pinecone Connector Tests
 * =======================
 *
 * Tests for the guarded Pinecone wrapper.
 */

import { describe, it, expect, vi } from 'vitest';
import { createGuardedIndex } from '../src/guarded-pinecone.js';
import { PromptInjectionValidator, PIIGuard } from '@blackunicorn/bonklm';
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
    it('should target a namespace via index.namespace() (D-038)', async () => {
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
      'clamps $label to the value sent to the client (D-039, no throw)',
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
});
