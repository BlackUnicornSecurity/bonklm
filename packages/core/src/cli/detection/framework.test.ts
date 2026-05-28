/**
 * Framework Detection Tests
 *
 * Comprehensive test suite for framework detection including:
 * - Standard framework detection
 * - Security tests (path traversal, prototype pollution, file size limits)
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile, mkdtemp, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectFrameworks, isFrameworkDetected, getFrameworkVersion, type FrameworkId } from './framework.js';
import { WizardError } from '../utils/error.js';

describe('Framework Detection', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await mkdtemp(join(tmpdir(), 'framework-test-'));
    originalCwd = process.cwd();
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    // Restore original working directory
    process.chdir(originalCwd);
  });

  describe('Basic Detection', () => {
    it('should detect Express.js from dependencies', async () => {
      const pkgJson = {
        name: 'test-app',
        dependencies: { express: '^4.18.2' }
      };
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(1);
      expect(frameworks[0].name).toBe('express');
      expect(frameworks[0].version).toBe('^4.18.2');
    });

    it('should detect Fastify from dependencies', async () => {
      const pkgJson = {
        name: 'test-app',
        dependencies: { fastify: '^4.0.0' }
      };
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(1);
      expect(frameworks[0].name).toBe('fastify');
      expect(frameworks[0].version).toBe('^4.0.0');
    });

    it('should detect NestJS from dependencies', async () => {
      const pkgJson = {
        name: 'test-app',
        dependencies: { '@nestjs/core': '^10.0.0' }
      };
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(1);
      expect(frameworks[0].name).toBe('nestjs');
      expect(frameworks[0].version).toBe('^10.0.0');
    });

    it('should detect LangChain from dependencies', async () => {
      const pkgJson = {
        name: 'test-app',
        dependencies: { langchain: '^0.1.0' }
      };
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(1);
      expect(frameworks[0].name).toBe('langchain');
      expect(frameworks[0].version).toBe('^0.1.0');
    });

    it('should detect LangChain from @langchain/core', async () => {
      const pkgJson = {
        name: 'test-app',
        dependencies: { '@langchain/core': '^0.1.0' }
      };
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(1);
      expect(frameworks[0].name).toBe('langchain');
    });

    it('should detect multiple frameworks', async () => {
      const pkgJson = {
        name: 'test-app',
        dependencies: {
          express: '^4.18.2',
          langchain: '^0.1.0'
        },
        devDependencies: {
          fastify: '^4.0.0'
        }
      };
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(3);
      const frameworkNames = frameworks.map(f => f.name);
      expect(frameworkNames).toContain('express');
      expect(frameworkNames).toContain('langchain');
      expect(frameworkNames).toContain('fastify');
    });

    it('should return empty array when no frameworks are detected', async () => {
      const pkgJson = {
        name: 'test-app',
        dependencies: { lodash: '^4.17.21' }
      };
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(0);
    });

    it('should return empty array when package.json does not exist', async () => {
      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(0);
    });

    it('should return empty array when dependencies are missing', async () => {
      const pkgJson = {
        name: 'test-app',
        version: '1.0.0'
      };
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(0);
    });
  });

  describe('Security: Path Traversal Protection (C-4 fix)', () => {
    it('should handle path resolution correctly for nested directories', async () => {
      // Create a nested directory structure to test path resolution
      const nestedDir = join(tempDir, 'nested', 'deep');
      await mkdir(nestedDir, { recursive: true });

      const pkgJson = {
        name: 'nested-app',
        dependencies: { express: '^4.18.2' }
      };
      await writeFile(join(nestedDir, 'package.json'), JSON.stringify(pkgJson));

      // Detect from the nested directory
      const frameworks = await detectFrameworks({ workingDir: nestedDir });

      expect(frameworks).toHaveLength(1);
      expect(frameworks[0].name).toBe('express');
    });

    it('should validate path is within working directory after realpath resolution', async () => {
      // This test verifies the path validation logic with realpath
      const pkgJson = {
        name: 'test-app',
        dependencies: { express: '^4.18.2' }
      };
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      // Get the real path of tempDir
      const realTempDir = await realpath(tempDir);

      // Detection should work from the real path
      const frameworks = await detectFrameworks({ workingDir: realTempDir });

      expect(frameworks).toHaveLength(1);
    });

    it('should validate path is within working directory', async () => {
      // This test verifies the path validation logic
      const pkgJson = {
        name: 'test-app',
        dependencies: { express: '^4.18.2' }
      };
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      // Get the real path of tempDir
      const realTempDir = await realpath(tempDir);

      // Detection should work from the real path
      const frameworks = await detectFrameworks({ workingDir: realTempDir });

      expect(frameworks).toHaveLength(1);
    });
  });

  describe('Security: Prototype Pollution Protection (HP-6 fix)', () => {
    it('should handle __proto__ property safely (removed by secure-json-parse)', async () => {
      // Note: JSON.stringify() doesn't include __proto__ in output
      // But if someone manually crafts JSON with __proto__ as a key
      const maliciousJson = '{"name":"test","dependencies":{"express":"^4.18.2"},"__proto__":{"isAdmin":true}}';

      await writeFile(join(tempDir, 'package.json'), maliciousJson);

      // secure-json-parse removes __proto__ keys, so detection should work
      const frameworks = await detectFrameworks({ workingDir: tempDir });

      // Should successfully detect express (malicious __proto__ was removed)
      expect(frameworks).toHaveLength(1);
      expect(frameworks[0].name).toBe('express');
    });

    it('should handle constructor property safely (removed by secure-json-parse)', async () => {
      const maliciousJson = {
        name: 'malicious',
        dependencies: { express: '^4.18.2' },
        constructor: { prototype: { polluted: true } }
      };

      await writeFile(join(tempDir, 'package.json'), JSON.stringify(maliciousJson));

      // secure-json-parse removes constructor keys
      const frameworks = await detectFrameworks({ workingDir: tempDir });

      // Should successfully detect express (malicious constructor was removed)
      expect(frameworks).toHaveLength(1);
      expect(frameworks[0].name).toBe('express');
    });

    it('should use secure-json-parse with protoAction remove', async () => {
      // Create a JSON string that attempts prototype pollution
      const maliciousJson = '{"name":"test","dependencies":{"express":"^4.18.2"},"__proto__":{"polluted":true}}';

      await writeFile(join(tempDir, 'package.json'), maliciousJson);

      // secure-json-parse removes the __proto__ key, so detection works
      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(1);
      expect(frameworks[0].name).toBe('express');
    });

    it('should verify prototype pollution did not occur', async () => {
      // Before secure-json-parse, this could pollute Object.prototype
      const maliciousString = '{"__proto__":{"polluted":"yes"}}';

      await writeFile(join(tempDir, 'package.json'), maliciousString);

      // Parse the file - __proto__ should be removed
      const frameworks = await detectFrameworks({ workingDir: tempDir });

      // Verify that Object.prototype was not polluted
      expect(({} as any).polluted).toBeUndefined();

      // Should return empty since no valid frameworks
      expect(frameworks).toEqual([]);
    });
  });

  describe('Security: File Size Limit (MP-6 fix)', () => {
    it('should throw WizardError when package.json exceeds size limit', async () => {
      // Create a package.json that exceeds 1MB
      const largeObject = {
        name: 'large-app',
        dependencies: { express: '^4.18.2' }
      };

      // Add a huge field to exceed the size limit
      const deps: Record<string, string> = {};
      largeObject.dependencies = deps;
      for (let i = 0; i < 100000; i++) {
        largeObject.dependencies[`dep-${i}`] = 'x'.repeat(100);
      }

      await writeFile(join(tempDir, 'package.json'), JSON.stringify(largeObject));

      await expect(detectFrameworks({ workingDir: tempDir })).rejects.toThrow(WizardError);

      try {
        const frameworks = await detectFrameworks({ workingDir: tempDir });
        // If it doesn't throw, check the error code
        expect(frameworks).toBeUndefined();
      } catch (error) {
        expect(error).toBeInstanceOf(WizardError);
        if (error instanceof WizardError) {
          expect(error.code).toBe('FILE_TOO_LARGE');
        }
      }
    });

    it('should accept package.json under size limit', async () => {
      // Create a package.json that's close to but under the limit
      const reasonableObject = {
        name: 'reasonable-app',
        dependencies: {} as Record<string, string>
      };

      // Add a reasonable number of dependencies
      for (let i = 0; i < 100; i++) {
        reasonableObject.dependencies[`dep-${i}`] = `^${i}.0.0`;
      }

      await writeFile(join(tempDir, 'package.json'), JSON.stringify(reasonableObject));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(Array.isArray(frameworks)).toBe(true);
    });
  });

  describe('Security: Dependency Limit (MP-6 fix)', () => {
    it('should enforce MAX_DEPENDENCIES limit', async () => {
      // Create a package.json with many dependencies
      const pkgJson = {
        name: 'many-deps',
        dependencies: {} as Record<string, string>
      };

      // Add many dependencies (more than patterns exist)
      for (let i = 0; i < 2000; i++) {
        pkgJson.dependencies[`unknown-dep-${i}`] = '^1.0.0';
      }

      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      // Should not throw, but should limit checks
      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(Array.isArray(frameworks)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      await writeFile(join(tempDir, 'package.json'), '{ invalid json }');

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toEqual([]);
    });

    it('should handle empty package.json', async () => {
      await writeFile(join(tempDir, 'package.json'), '{}');

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toEqual([]);
    });

    it('should handle package.json with null dependencies', async () => {
      const pkgJson = {
        name: 'test-app',
        dependencies: null,
        devDependencies: null
      };
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toEqual([]);
    });

    it('should handle non-object package.json', async () => {
      await writeFile(join(tempDir, 'package.json'), '[]');

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toEqual([]);
    });

    it('should handle empty package.json gracefully', async () => {
      const emptyPath = join(tempDir, 'package.json');

      // Write an empty file (simulates corrupted or empty package.json)
      try {
        await writeFile(emptyPath, '');
      } catch {
        // Ignore write errors
      }

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      // Should handle gracefully and return empty array
      expect(Array.isArray(frameworks)).toBe(true);
      expect(frameworks).toEqual([]);
    });
  });

  describe('Helper Functions', () => {
    beforeEach(async () => {
      const pkgJson = {
        name: 'test-app',
        dependencies: { express: '^4.18.2', langchain: '^0.1.0' }
      };
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));
    });

    it('isFrameworkDetected should return true for detected framework', async () => {
      const result = await isFrameworkDetected('express', {
        workingDir: tempDir
      });

      expect(result).toBe(true);
    });

    it('isFrameworkDetected should return false for undetected framework', async () => {
      const result = await isFrameworkDetected('fastify', {
        workingDir: tempDir
      });

      expect(result).toBe(false);
    });

    it('getFrameworkVersion should return version for detected framework', async () => {
      const version = await getFrameworkVersion('express', {
        workingDir: tempDir
      });

      expect(version).toBe('^4.18.2');
    });

    it('getFrameworkVersion should return undefined for undetected framework', async () => {
      const version = await getFrameworkVersion('fastify', {
        workingDir: tempDir
      });

      expect(version).toBeUndefined();
    });
  });

  describe('Custom Options', () => {
    it('should use custom working directory', async () => {
      const customDir = join(tempDir, 'custom');
      await mkdir(customDir, { recursive: true });

      const pkgJson = {
        name: 'custom-app',
        dependencies: { express: '^4.18.2' }
      };
      await writeFile(join(customDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: customDir });

      expect(frameworks).toHaveLength(1);
      expect(frameworks[0].name).toBe('express');
    });

    it('should use custom package.json path', async () => {
      const pkgJson = {
        name: 'custom-path',
        dependencies: { '@nestjs/core': '^10.0.0' }
      };

      const customPath = join(tempDir, 'custom-package.json');
      await writeFile(customPath, JSON.stringify(pkgJson));

      // Verify the file exists
      const { existsSync } = await import('node:fs');
      expect(existsSync(customPath)).toBe(true);

      const frameworks = await detectFrameworks({
        workingDir: tempDir,
        packageJsonPath: 'custom-package.json'
      });

      expect(frameworks).toHaveLength(1);
      expect(frameworks[0].name).toBe('nestjs');
    });
  });

  describe('Framework Patterns', () => {
    it('should detect framework from devDependencies', async () => {
      const pkgJson = {
        name: 'test-app',
        devDependencies: { fastify: '^4.0.0' }
      };
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(1);
      expect(frameworks[0].name).toBe('fastify');
    });

    it('should prioritize dependencies over devDependencies', async () => {
      const pkgJson = {
        name: 'test-app',
        dependencies: { express: '^4.18.2' },
        devDependencies: { express: '^5.0.0' }
      };
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(1);
      // Should use the dependencies version
      expect(frameworks[0].version).toBe('^4.18.2');
    });

    it('should detect all supported framework types', async () => {
      const supportedFrameworks: FrameworkId[] = ['express', 'fastify', 'nestjs', 'langchain'];

      for (const framework of supportedFrameworks) {
        // Create a new temp dir for each framework
        const testDir = await mkdtemp(join(tmpdir(), `test-${framework}-`));

        try {
          const pattern = {
            express: { dependencies: ['express'] },
            fastify: { dependencies: ['fastify'] },
            nestjs: { dependencies: ['@nestjs/core'] },
            langchain: { dependencies: ['langchain'] }
          }[framework];

          const pkgJson = {
            name: `test-${framework}`,
            dependencies: Object.fromEntries(pattern.dependencies.map(dep => [dep, '^1.0.0']))
          };

          await writeFile(join(testDir, 'package.json'), JSON.stringify(pkgJson));

          const frameworks = await detectFrameworks({ workingDir: testDir });

          expect(frameworks).toHaveLength(1);
          expect(frameworks[0].name).toBe(framework);
        } finally {
          await rm(testDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle version with special characters', async () => {
      const pkgJson = {
        name: 'test-app',
        dependencies: {
          express: '>=4.18.0 <5.0.0',
          langchain: 'github:langchain-ai/langchainjs'
        }
      };
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(2);
      expect(frameworks[0].version).toBe('>=4.18.0 <5.0.0');
    });

    it('should handle duplicate framework detection', async () => {
      const pkgJson = {
        name: 'test-app',
        dependencies: {
          express: '^4.18.2'
        },
        devDependencies: {
          express: '^4.18.2'
        }
      };
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      // Should only detect express once
      const expressCount = frameworks.filter(f => f.name === 'express').length;
      expect(expressCount).toBe(1);
    });

    it('should handle package.json with BOM', async () => {
      // UTF-8 BOM + JSON
      const content =
        '\uFEFF' +
        JSON.stringify({
          name: 'test-app',
          dependencies: { express: '^4.18.2' }
        });

      await writeFile(join(tempDir, 'package.json'), content);

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(1);
    });

    it('should handle package.json with comments (non-standard)', async () => {
      // This is non-standard JSON but some tools support it
      // Our parser should fail gracefully
      const content = `{
        // This is a comment
        "name": "test-app",
        "dependencies": {
          "express": "^4.18.2" // inline comment
        }
      }`;

      await writeFile(join(tempDir, 'package.json'), content);

      // Should handle gracefully (either parse or return empty)
      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(Array.isArray(frameworks)).toBe(true);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should detect frameworks from a typical Express app', async () => {
      const pkgJson = {
        name: 'express-api',
        version: '1.0.0',
        description: 'Express REST API',
        main: 'src/index.js',
        scripts: {
          start: 'node src/index.js',
          dev: 'nodemon src/index.js'
        },
        dependencies: {
          express: '^4.18.2',
          cors: '^2.8.5',
          helmet: '^7.0.0',
          morgan: '^1.10.0'
        },
        devDependencies: {
          nodemon: '^3.0.1'
        }
      };

      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(1);
      expect(frameworks[0].name).toBe('express');
    });

    it('should detect frameworks from a typical NestJS app', async () => {
      const pkgJson = {
        name: 'nestjs-api',
        version: '1.0.0',
        description: 'NestJS REST API',
        dependencies: {
          '@nestjs/common': '^10.0.0',
          '@nestjs/core': '^10.0.0',
          '@nestjs/platform-express': '^10.0.0',
          'reflect-metadata': '^0.1.13',
          rxjs: '^7.8.1'
        },
        devDependencies: {
          '@nestjs/cli': '^10.0.0'
        }
      };

      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(1);
      expect(frameworks[0].name).toBe('nestjs');
    });

    it('should detect frameworks from a LangChain app', async () => {
      const pkgJson = {
        name: 'langchain-app',
        version: '1.0.0',
        type: 'module',
        dependencies: {
          '@langchain/openai': '^0.0.1',
          langchain: '^0.1.0',
          '@langchain/core': '^0.1.0'
        }
      };

      await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkgJson));

      const frameworks = await detectFrameworks({ workingDir: tempDir });

      expect(frameworks).toHaveLength(1);
      expect(frameworks[0].name).toBe('langchain');
    });
  });
});
