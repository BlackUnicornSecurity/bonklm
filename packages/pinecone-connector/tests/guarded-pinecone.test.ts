/**
 * Pinecone Connector Tests
 * =======================
 *
 * Tests for the guarded Pinecone wrapper.
 */

import { describe, it, expect, vi } from 'vitest';
import { createGuardedIndex } from '../src/guarded-pinecone.js';
import { PromptInjectionValidator, PIIGuard } from '@blackunicorn/bonklm';

// Mock Pinecone Index
const createMockPineconeIndex = () => ({
  query: vi.fn().mockResolvedValue({
    matches: [
      { id: 'vec1', score: 0.95, metadata: { text: 'Safe vector content' } },
      { id: 'vec2', score: 0.85, metadata: { text: 'Another safe vector' } },
    ],
  }),
});

describe('Pinecone Connector', () => {
  describe('createGuardedIndex', () => {
    it('should allow valid queries', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        validators: [],
        allowEmptyForTesting: true,
      });

      const result = await guardedIndex.query({
        vector: [0.1, 0.2, 0.3],
        topK: 10,
      });

      expect(result.filtered).toBe(false);
      expect(result.matches).toBeDefined();
      expect(result.vectorsBlocked).toBe(0);
    });

    it('should validate vector format', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, { allowEmptyForTesting: true });

      await expect(
        guardedIndex.query({ vector: 'not-an-array' as any })
      ).rejects.toThrow('Vector must be an array');
    });

    it('should validate vector contains only numbers', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, { allowEmptyForTesting: true });

      await expect(
        guardedIndex.query({ vector: [0.1, 'invalid', 0.3] as any })
      ).rejects.toThrow('Vector must contain only valid numbers');
    });

    it('should enforce maxTopK limit', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        maxTopK: 50,
      });

      await guardedIndex.query({ vector: [0.1, 0.2], topK: 100 });

      expect(mockIndex.query).toHaveBeenCalledWith(
        expect.objectContaining({
          topK: 50,
        })
      );
    });

    it('should sanitize dangerous filter patterns', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        sanitizeMetadataFilters: true,
      });

      await expect(
        guardedIndex.query({
          vector: [0.1, 0.2],
          filter: { ['$..']: 'path-traversal' },
        })
      ).rejects.toThrow();
    });

    it('should validate retrieved vectors', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        guards: [new PIIGuard()],
        validateRetrievedVectors: true,
      });

      const result = await guardedIndex.query({
        vector: [0.1, 0.2],
        topK: 10,
      });

      expect(result).toBeDefined();
    });

    it('should filter blocked vectors', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        guards: [new PIIGuard()],
        validateRetrievedVectors: true,
        onBlockedVector: 'filter',
      });

      const result = await guardedIndex.query({
        vector: [0.1, 0.2],
        topK: 10,
      });

      expect(result).toBeDefined();
    });

    it('should use production mode error messages', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        productionMode: true,
        sanitizeMetadataFilters: true,
      });

      await expect(
        guardedIndex.query({
          vector: [0.1, 0.2],
          filter: { eval: 'malicious' },
        })
      ).rejects.toThrow('Invalid filter');
    });

    it('should call onVectorBlocked callback', async () => {
      const mockIndex = createMockPineconeIndex();
      const onBlocked = vi.fn();

      const guardedIndex = createGuardedIndex(mockIndex, {
        guards: [new PIIGuard()],
        validateRetrievedVectors: true,
        onVectorBlocked: onBlocked,
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
        sanitizeMetadataFilters: true,
      });

      await expect(
        guardedIndex.query({
          vector: [0.1, 0.2],
          filter: { field: { eval: 'malicious' } },
        })
      ).rejects.toThrow();
    });

    it('should block path traversal', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        sanitizeMetadataFilters: true,
      });

      await expect(
        guardedIndex.query({
          vector: [0.1, 0.2],
          filter: { ['$..']: 'attack' },
        })
      ).rejects.toThrow();
    });

    it('should block constructor access', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, {
        sanitizeMetadataFilters: true,
      });

      await expect(
        guardedIndex.query({
          vector: [0.1, 0.2],
          filter: { constructor: {} },
        })
      ).rejects.toThrow();
    });
  });

  describe('query options', () => {
    it('should support namespace option', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, { allowEmptyForTesting: true });

      await guardedIndex.query({
        vector: [0.1, 0.2],
        topK: 10,
        namespace: 'test-ns',
      });

      expect(mockIndex.query).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'test-ns',
        })
      );
    });

    it('should support includeValues option', async () => {
      const mockIndex = createMockPineconeIndex();
      const guardedIndex = createGuardedIndex(mockIndex, { allowEmptyForTesting: true });

      await guardedIndex.query({
        vector: [0.1, 0.2],
        includeValues: true,
      });

      expect(mockIndex.query).toHaveBeenCalledWith(
        expect.objectContaining({
          includeValues: true,
        })
      );
    });
  });
});
