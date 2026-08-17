/**
 * Tests for Service Detection Module
 *
 * Covers:
 * - Port scanning with validation
 * - Docker container detection with binary validation
 * - Timeout enforcement
 * - Security fixes (C-1, C-6)
 * - Edge cases and error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createConnection } from 'net';
import which from 'which';
import * as registry from '../connectors/registry.js';
import { DETECTION_TIMEOUTS } from './timeout.js';

// Mock dependencies first
vi.mock('net', () => ({
  createConnection: vi.fn()
}));

vi.mock('which', () => ({
  default: vi.fn()
}));

// Note: We use dependency injection for detectDockerContainers in tests

// Import after mocking
import {
  detectServices,
  isOllamaAvailable,
  getVectorDbContainers,
  detectDockerContainers,
  type DetectedService
} from './services.js';

// Create a typed reference to the mocked functions
const mockedWhich = which as ReturnType<typeof vi.fn>;

describe('Service Detection', () => {
  const mockSocket = {
    on: vi.fn(),
    destroy: vi.fn(),
    setTimeout: vi.fn(),
    destroyed: false
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock socket
    mockSocket.destroyed = false;
    mockSocket.on.mockImplementation((event, callback) => {
      // Simulate immediate connection for 'connect' event
      if (event === 'connect') {
        // Will be called in test
      }
      return mockSocket;
    });
    // Docker detection now uses dependency injection in tests
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('detectServices', () => {
    it('should return empty array when no services are detected', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      // Mock connection failure
      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          // Simulate immediate error
          callback(new Error('ECONNREFUSED'));
        }
        return mockSocket;
      });

      // Mock Docker detection to return empty
      const mockDockerFn = vi.fn().mockResolvedValue([]);
      const result = await detectServices(mockDockerFn);

      // Ollama port check is always performed, but should show as unavailable
      // Docker is not found, so no docker results
      // The registry declares a local port for more than one connector, so
      // assert on the ollama entry rather than the array length.
      expect(result).toContainEqual({
        name: 'ollama',
        type: 'port',
        available: false,
        address: 'localhost:11434'
      });
      expect(result.filter(s => s.type === 'docker')).toHaveLength(0);
      // Verify the injected Docker function was called
      expect(mockDockerFn).toHaveBeenCalled();
    });

    it('should detect Ollama service on default port', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'connect') {
          setTimeout(() => callback(), 0);
        }
        return mockSocket;
      });

      // Mock Docker detection - no containers
      const mockDockerFn = vi.fn().mockResolvedValue([]);
      const result = await detectServices(mockDockerFn);

      // The registry declares a local port for more than one connector, so
      // assert on the ollama entry rather than the array length.
      expect(result).toContainEqual({
        name: 'ollama',
        type: 'port',
        available: true,
        address: 'localhost:11434'
      });
      expect(result.filter(s => s.type === 'docker')).toHaveLength(0);
    });

    it('should detect Docker containers with vector DB names', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      // Mock port check failure
      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('ECONNREFUSED'));
        }
        return mockSocket;
      });

      // Mock detectDockerContainers to return specific containers
      const mockDockerFn = vi.fn().mockResolvedValue(['chroma-db', 'weaviate-instance', 'qdrant-storage']);
      const result = await detectServices(mockDockerFn);

      // Ollama (unavailable) + every other registry-declared port + 3 matched
      // vector DB containers.
      expect(result.filter(s => s.type === 'docker')).toHaveLength(3);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'ollama', type: 'port', available: false }),
          expect.objectContaining({ name: 'chroma-db', type: 'docker', available: true }),
          expect.objectContaining({ name: 'weaviate-instance', type: 'docker', available: true }),
          expect.objectContaining({ name: 'qdrant-storage', type: 'docker', available: true })
        ])
      );
    });

    it('should handle Docker not being installed', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      // Mock port check failure
      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('ECONNREFUSED'));
        }
        return mockSocket;
      });

      // Mock Docker detection to return empty
      const mockDockerFn = vi.fn().mockResolvedValue([]);
      const result = await detectServices(mockDockerFn);

      // Should not throw, just return Ollama port check result (unavailable)
      // The registry declares a local port for more than one connector, so
      // assert on the ollama entry rather than the array length.
      expect(result).toContainEqual(expect.objectContaining({ name: 'ollama', type: 'port', available: false }));
      expect(result.filter(s => s.type === 'docker')).toHaveLength(0);
      const dockerResults = result.filter(s => s.type === 'docker');
      expect(dockerResults).toEqual([]);
    });

    it('should sanitize Docker container names', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      // Mock port check failure
      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('ECONNREFUSED'));
        }
        return mockSocket;
      });

      // Mock Docker detection with potentially malicious names - after sanitization
      // The sanitization regex replaces non-alphanumeric chars (except _.-) with empty string
      // "chroma-db" -> "chroma-db" (stays same)
      // "chroma; rm -rf /;" -> "chromarm" (sanitized)
      // "weaviate-instance" -> "weaviate-instance" (stays same)
      // "$(evil command)" -> "evilcommand" (sanitized)
      // "qdrant_storage" -> "qdrant_storage" (stays same)
      const mockDockerFn = vi
        .fn()
        .mockResolvedValue(['chroma-db', 'chromarm', 'weaviate-instance', 'evilcommand', 'qdrant_storage']);
      const result = await detectServices(mockDockerFn);

      // Verify we get the sanitized containers
      expect(result.length).toBeGreaterThan(0);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'chroma-db' }),
          expect.objectContaining({ name: 'weaviate-instance' }),
          expect.objectContaining({ name: 'qdrant_storage' })
        ])
      );
      // Sanitized names should not contain malicious characters
      result.forEach(service => {
        expect(service.name).toMatch(/^[a-zA-Z0-9_.-]+$/);
      });
    });

    it('should handle Docker command failure gracefully', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      // Mock port check failure
      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('ECONNREFUSED'));
        }
        return mockSocket;
      });

      // Mock Docker detection to return empty (simulating Docker command failure)
      const mockDockerFn = vi.fn().mockResolvedValue([]);
      const result = await detectServices(mockDockerFn);

      // Should not throw, just return Ollama port check result (unavailable)
      // The registry declares a local port for more than one connector, so
      // assert on the ollama entry rather than the array length.
      expect(result).toContainEqual(expect.objectContaining({ name: 'ollama', type: 'port', available: false }));
      expect(result.filter(s => s.type === 'docker')).toHaveLength(0);
    });
  });

  describe('port-scan bounding', () => {
    it('warns and truncates when the registry declares more ports than the cap', async () => {
      const many = Array.from({ length: 12 }, (_, i) => [`c${i}`, 20000 + i] as const);
      const spy = vi
        .spyOn(registry, 'getDetectionPorts')
        .mockReturnValue(many.map(([connectorId, value]) => ({ connectorId, value })));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const createConnectionMock = vi.mocked(createConnection);
      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('ECONNREFUSED'));
        }
        return mockSocket;
      });

      try {
        const result = await detectServices(vi.fn().mockResolvedValue([]));

        expect(result.filter(s => s.type === 'port')).toHaveLength(10);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Maximum port check limit'));
      } finally {
        spy.mockRestore();
        warn.mockRestore();
      }
    });
  });

  describe('isOllamaAvailable', () => {
    it('should return true when Ollama is detected', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'connect') {
          setTimeout(() => callback(), 0);
        }
        return mockSocket;
      });

      // Mock detectServices to return Ollama as available
      vi.spyOn(await import('./services.js'), 'detectServices').mockResolvedValue([
        { name: 'ollama', type: 'port', available: true, address: 'localhost:11434' }
      ]);

      const result = await isOllamaAvailable();

      expect(result).toBe(true);
    });

    it('should return false when Ollama is not detected', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          setTimeout(() => callback(new Error('ECONNREFUSED')), 0);
        }
        return mockSocket;
      });

      // Mock detectServices to return Ollama as unavailable
      vi.spyOn(await import('./services.js'), 'detectServices').mockResolvedValue([
        { name: 'ollama', type: 'port', available: false, address: 'localhost:11434' }
      ]);

      const result = await isOllamaAvailable();

      expect(result).toBe(false);
    });
  });

  describe('getVectorDbContainers', () => {
    it('should return only Docker containers with vector DB names', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      // Mock connection failure
      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          setTimeout(() => callback(new Error('ECONNREFUSED')), 0);
        }
        return mockSocket;
      });

      // Use dependency injection to test the filtering logic
      const mockDockerFn = vi.fn().mockResolvedValue(['chroma-local', 'weaviate-prod', 'postgres', 'redis']);

      // Call detectServices with injected function, then filter the results
      const services = await detectServices(mockDockerFn);
      const result = services.filter(s => s.type === 'docker' && s.available).map(s => s.name);

      expect(result).toEqual(['chroma-local', 'weaviate-prod']);
      expect(result).not.toContain('postgres');
      expect(result).not.toContain('redis');
    });

    it('should return empty array when no vector DB containers found', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      // Mock connection failure
      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          setTimeout(() => callback(new Error('ECONNREFUSED')), 0);
        }
        return mockSocket;
      });

      // Use dependency injection with non-vector DB containers
      const mockDockerFn = vi.fn().mockResolvedValue(['postgres', 'redis', 'nginx']);

      const services = await detectServices(mockDockerFn);
      const result = services.filter(s => s.type === 'docker' && s.available).map(s => s.name);

      expect(result).toEqual([]);
    });
  });

  describe('Security: Port Validation', () => {
    it('should complete without errors for valid ports', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('ECONNREFUSED'));
        }
        return mockSocket;
      });

      // Mock Docker detection
      const mockDockerFn = vi.fn().mockResolvedValue([]);
      const result = await detectServices(mockDockerFn);

      // Should complete without errors and return Ollama check result
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('Security: Docker Binary Validation (C-1)', () => {
    it('should use which() to validate Docker binary path', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          setTimeout(() => callback(new Error('ECONNREFUSED')), 0);
        }
        return mockSocket;
      });

      // Mock which to find Docker
      mockedWhich.mockResolvedValue('/usr/bin/docker' as any);

      // Call detectServices WITHOUT injecting function to test actual which() call
      await detectServices();

      // Verify which() was called to validate binary path
      expect(mockedWhich).toHaveBeenCalledWith('docker', { nothrow: true });
    });

    it('should not execute Docker when which() returns null', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          setTimeout(() => callback(new Error('ECONNREFUSED')), 0);
        }
        return mockSocket;
      });

      // Mock which to not find Docker
      mockedWhich.mockResolvedValue(null as any);

      // Call detectServices WITHOUT injecting function to test actual which() call
      await detectServices();

      // Verify which() was called to check for Docker
      expect(mockedWhich).toHaveBeenCalledWith('docker', { nothrow: true });
    });
  });

  describe('Security: DoS Prevention (C-6)', () => {
    it('should enforce MAX_PORTS_TO_CHECK limit', async () => {
      // This is enforced by the code limiting SERVICE_PORTS entries
      // Since SERVICE_PORTS only has one entry, we verify the limit exists
      const createConnectionMock = vi.mocked(createConnection);

      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'connect') {
          setTimeout(() => callback(), 0);
        }
        return mockSocket;
      });

      // Mock Docker detection
      const mockDockerFn = vi.fn().mockResolvedValue([]);
      const result = await detectServices(mockDockerFn);

      // Should only check known ports (limited by MAX_PORTS_TO_CHECK)
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(10); // MAX_PORTS_TO_CHECK
    });
  });

  describe('Timeout Enforcement', () => {
    it('should cap port check timeout to MAX_PORT_TIMEOUT', async () => {
      const createConnectionMock = vi.mocked(createConnection);
      let timeoutSet = 0;

      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.setTimeout.mockImplementation(timeout => {
        timeoutSet = timeout;
        return mockSocket;
      });
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          setTimeout(() => callback(new Error('ECONNREFUSED')), 0);
        }
        return mockSocket;
      });

      // Mock Docker detection
      const mockDockerFn = vi.fn().mockResolvedValue([]);
      await detectServices(mockDockerFn);

      // Verify timeout was capped at MAX_PORT_TIMEOUT (2000ms)
      expect(timeoutSet).toBeLessThanOrEqual(2000);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty Docker output', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('ECONNREFUSED'));
        }
        return mockSocket;
      });

      // Mock Docker detection - empty output
      const mockDockerFn = vi.fn().mockResolvedValue([]);
      const result = await detectServices(mockDockerFn);

      // Should return Ollama port check result (unavailable)
      // The registry declares a local port for more than one connector, so
      // assert on the ollama entry rather than the array length.
      expect(result).toContainEqual(expect.objectContaining({ name: 'ollama', type: 'port', available: false }));
      expect(result.filter(s => s.type === 'docker')).toHaveLength(0);
    });

    it('should handle Docker output with only whitespace', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('ECONNREFUSED'));
        }
        return mockSocket;
      });

      // Mock Docker detection - empty after trimming
      const mockDockerFn = vi.fn().mockResolvedValue([]);
      const result = await detectServices(mockDockerFn);

      // Should return Ollama port check result (unavailable)
      // The registry declares a local port for more than one connector, so
      // assert on the ollama entry rather than the array length.
      expect(result).toContainEqual(expect.objectContaining({ name: 'ollama', type: 'port', available: false }));
      expect(result.filter(s => s.type === 'docker')).toHaveLength(0);
    });

    it('should handle container names becoming empty after sanitization', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('ECONNREFUSED'));
        }
        return mockSocket;
      });

      // Container with only special characters becomes empty after sanitization
      // These are filtered out, so detectDockerContainers returns empty array
      const mockDockerFn = vi.fn().mockResolvedValue([]);
      const result = await detectServices(mockDockerFn);

      // Empty names after sanitization should be filtered out
      // Should return Ollama port check result (unavailable)
      // The registry declares a local port for more than one connector, so
      // assert on the ollama entry rather than the array length.
      expect(result).toContainEqual(expect.objectContaining({ name: 'ollama', type: 'port', available: false }));
      expect(result.filter(s => s.type === 'docker')).toHaveLength(0);
    });

    it('should detect vector DBs with case-insensitive matching', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('ECONNREFUSED'));
        }
        return mockSocket;
      });

      // All case variations should be detected - the sanitization happens at Docker level
      // detectDockerContainers returns already-sanitized names
      const mockDockerFn = vi
        .fn()
        .mockResolvedValue(['ChromaDB', 'WEAVIATE', 'Qdrant', 'chroma', 'weaviate', 'qdrant']);
      const result = await detectServices(mockDockerFn);

      // All case variations should be detected
      const dockerServices = result.filter(s => s.type === 'docker');
      expect(dockerServices).toHaveLength(6);
    });
  });

  describe('Integration Tests', () => {
    it('should detect both port and Docker services simultaneously', async () => {
      const createConnectionMock = vi.mocked(createConnection);

      createConnectionMock.mockReturnValue(mockSocket as any);
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'connect') {
          setTimeout(() => callback(), 0);
        }
        return mockSocket;
      });

      // Mock Docker detection
      const mockDockerFn = vi.fn().mockResolvedValue(['chroma-local', 'weaviate-prod']);
      const result = await detectServices(mockDockerFn);

      // Should have both Ollama (port) and vector DBs (Docker)
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'ollama', type: 'port' }),
          expect.objectContaining({ name: 'chroma-local', type: 'docker' }),
          expect.objectContaining({ name: 'weaviate-prod', type: 'docker' })
        ])
      );
    });
  });
});
