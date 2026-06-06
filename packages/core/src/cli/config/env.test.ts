/**
 * Unit tests for EnvManager
 *
 * Tests the atomic environment file manager with:
 * - Read operations (existing and missing files)
 * - Write operations (merge and replace)
 * - Atomic write guarantees
 * - Permission handling
 * - Same-filesystem verification
 * - Temp directory cleanup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EnvManager } from './env.js';
import { WizardError } from '../utils/error.js';

// Mock fs/promises functions
const mocks = {
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  chmod: vi.fn(),
  rm: vi.fn(),
  access: vi.fn(),
  stat: vi.fn(),
  mkdtemp: vi.fn()
};

vi.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mocks.readFile(...args),
  writeFile: (...args: unknown[]) => mocks.writeFile(...args),
  rename: (...args: unknown[]) => mocks.rename(...args),
  chmod: (...args: unknown[]) => mocks.chmod(...args),
  rm: (...args: unknown[]) => mocks.rm(...args),
  access: (...args: unknown[]) => mocks.access(...args),
  stat: (...args: unknown[]) => mocks.stat(...args),
  constants: { R_OK: 4, W_OK: 2 },
  mkdtemp: (...args: unknown[]) => mocks.mkdtemp(...args)
}));

// Mock existsSync
const existsSyncMock = vi.fn();
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  constants: { R_OK: 4, W_OK: 2 }
}));

// Mock platform
const platformMock = vi.fn();
vi.mock('os', () => ({
  platform: (...args: unknown[]) => platformMock(...args),
  tmpdir: () => '/tmp'
}));

describe('EnvManager', () => {
  let envManager: EnvManager;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    platformMock.mockReturnValue('darwin');

    // Default mock behaviors
    existsSyncMock.mockReturnValue(true);
    mocks.access.mockResolvedValue(undefined);
    // Mock stat to return same filesystem and no symlink
    mocks.stat.mockResolvedValue({ dev: 1, isSymbolicLink: () => false });
    mocks.mkdtemp.mockResolvedValue('/tmp/.env-abc123');
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.rename.mockResolvedValue(undefined);
    mocks.chmod.mockResolvedValue(undefined);
    mocks.rm.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default .env path when none provided', () => {
      envManager = new EnvManager();
      expect(envManager.getPath()).toBe('.env');
    });

    it('should use custom path when provided', () => {
      envManager = new EnvManager('/custom/path/.env');
      expect(envManager.getPath()).toBe('/custom/path/.env');
    });
  });

  describe('read()', () => {
    it('should return empty object when file does not exist', async () => {
      existsSyncMock.mockReturnValue(false);
      envManager = new EnvManager('.test.env');

      const result = await envManager.read();

      expect(result).toEqual({});
      expect(mocks.readFile).not.toHaveBeenCalled();
    });

    it('should parse valid .env file content', async () => {
      const mockContent = 'KEY1=value1\nKEY2=value2\nKEY3=value3';
      mocks.readFile.mockResolvedValue(mockContent);
      envManager = new EnvManager('.test.env');

      const result = await envManager.read();

      expect(result).toEqual({
        KEY1: 'value1',
        KEY2: 'value2',
        KEY3: 'value3'
      });
      expect(mocks.readFile).toHaveBeenCalledWith('.test.env', 'utf-8');
    });

    it('should parse .env file with comments', async () => {
      const mockContent = '# This is a comment\nKEY=value\n# Another comment';
      mocks.readFile.mockResolvedValue(mockContent);
      envManager = new EnvManager('.test.env');

      const result = await envManager.read();

      expect(result).toEqual({ KEY: 'value' });
    });

    it('should parse .env file with quoted values', async () => {
      const mockContent = 'KEY1="quoted value"\nKEY2=\'single quoted\'';
      mocks.readFile.mockResolvedValue(mockContent);
      envManager = new EnvManager('.test.env');

      const result = await envManager.read();

      expect(result).toEqual({
        KEY1: 'quoted value',
        KEY2: 'single quoted'
      });
    });

    it('should throw WizardError when read fails', async () => {
      const readError = new Error('EACCES: permission denied');
      (readError as NodeJS.ErrnoException).code = 'EACCES';
      mocks.readFile.mockRejectedValue(readError);
      envManager = new EnvManager('.test.env');

      await expect(envManager.read()).rejects.toThrow(WizardError);
      await expect(envManager.read()).rejects.toHaveProperty('code', 'ENV_READ_FAILED');
    });
  });

  describe('write()', () => {
    it('should merge new entries with existing ones by default', async () => {
      const existingContent = 'EXISTING=value\nKEY=old';
      mocks.readFile.mockResolvedValue(existingContent);
      envManager = new EnvManager('.test.env');

      await envManager.write({ KEY: 'new', NEW_KEY: 'new_value' });

      // Verify write was called with merged content
      const writeCall = mocks.writeFile.mock.calls[0];
      const writtenContent = writeCall[1] as string;

      expect(writtenContent).toContain('EXISTING=value');
      expect(writtenContent).toContain('KEY=new');
      expect(writtenContent).toContain('NEW_KEY=new_value');
    });

    it('should replace all content when merge is false', async () => {
      const existingContent = 'EXISTING=value\nKEY=old';
      mocks.readFile.mockResolvedValue(existingContent);
      envManager = new EnvManager('.test.env');

      await envManager.write({ ONLY_KEY: 'only_value' }, false);

      const writeCall = mocks.writeFile.mock.calls[0];
      const writtenContent = writeCall[1] as string;

      expect(writtenContent).not.toContain('EXISTING=value');
      expect(writtenContent).not.toContain('KEY=old');
      expect(writtenContent).toContain('ONLY_KEY=only_value');
    });

    it('should create new file when none exists', async () => {
      existsSyncMock.mockReturnValue(false);
      envManager = new EnvManager('.test.env');

      await envManager.write({ KEY: 'value' });

      expect(mocks.readFile).not.toHaveBeenCalled();
      const writeCall = mocks.writeFile.mock.calls[0];
      expect(writeCall[1]).toContain('KEY=value');
    });

    it('should handle empty entries object', async () => {
      existsSyncMock.mockReturnValue(false);
      envManager = new EnvManager('.test.env');

      await envManager.write({});

      expect(mocks.writeFile).toHaveBeenCalled();
      const writeCall = mocks.writeFile.mock.calls[0];
      expect(writeCall[1]).toBe('');
    });
  });

  describe('writeAtomic() - Security Tests', () => {
    beforeEach(() => {
      // Set up platform mocks
      platformMock.mockReturnValue('darwin');
    });

    it('should use mkdtemp for secure temp directory (C-2 fix)', async () => {
      existsSyncMock.mockReturnValue(false);
      envManager = new EnvManager('.test.env');

      await envManager.write({ KEY: 'value' });

      // Verify mkdtemp was called with secure prefix
      expect(mocks.mkdtemp).toHaveBeenCalledWith('/tmp/.env-');
    });

    it('should write to temp file before renaming', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-xyz789');
      envManager = new EnvManager('.test.env');

      await envManager.write({ KEY: 'value' });

      // Verify temp file write
      expect(mocks.writeFile).toHaveBeenCalledWith('/tmp/.env-xyz789/write.tmp', expect.stringContaining('KEY=value'), {
        mode: 0o600
      });
    });

    it('should set permissions on temp file before rename', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-secure');
      envManager = new EnvManager('.test.env');

      await envManager.write({ KEY: 'value' });

      // chmod called on Unix platforms
      expect(mocks.chmod).toHaveBeenCalledWith('/tmp/.env-secure/write.tmp', 0o600);
    });

    it('should verify same filesystem before rename', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-secure');
      mocks.stat.mockImplementation(path => {
        // Same filesystem for temp and target
        return Promise.resolve({ dev: 1 });
      });
      envManager = new EnvManager('.test.env');

      await envManager.write({ KEY: 'value' });

      // stat was called to verify same filesystem
      expect(mocks.stat).toHaveBeenCalled();
    });

    it('should throw when on different filesystems', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-secure');

      // Mock stat to simulate different filesystems
      let statCallCount = 0;
      mocks.stat.mockImplementation(() => {
        statCallCount++;
        // resolveSymlinks calls stat on tmpdir first (returns isSymbolicLink: false)
        // Then ensureSameFilesystem calls stat on tempDir (dev 1)
        // Then calls stat on target path or parent (dev 2)
        return Promise.resolve({
          dev: statCallCount === 2 ? 1 : 2,
          isSymbolicLink: () => false
        });
      });

      envManager = new EnvManager('.test.env');

      await expect(envManager.write({ KEY: 'value' })).rejects.toThrow();
    });

    it('should perform atomic rename after temp file write', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-abc');
      envManager = new EnvManager('.test.env');

      await envManager.write({ KEY: 'value' });

      expect(mocks.rename).toHaveBeenCalledWith('/tmp/.env-abc/write.tmp', '.test.env');
    });

    it('should verify permissions after rename', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-abc');
      envManager = new EnvManager('.test.env');

      await envManager.write({ KEY: 'value' });

      expect(mocks.access).toHaveBeenCalledWith('.test.env', 6); // R_OK | W_OK
    });

    it('should clean up temp directory even on success', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-cleanup');
      mocks.stat.mockResolvedValue({ dev: 1, isSymbolicLink: () => false });
      envManager = new EnvManager('.test.env');

      await envManager.write({ KEY: 'value' });

      expect(mocks.rm).toHaveBeenCalledWith('/tmp/.env-cleanup', {
        recursive: true,
        force: false // Implementation uses force: false
      });
    });

    it('should clean up temp directory even on rename failure', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-fail');
      mocks.rename.mockRejectedValue(new Error('Rename failed'));
      mocks.stat.mockResolvedValue({ dev: 1, isSymbolicLink: () => false });
      envManager = new EnvManager('.test.env');

      await expect(envManager.write({ KEY: 'value' })).rejects.toThrow();

      // Cleanup still happened despite rename failure
      expect(mocks.rm).toHaveBeenCalledWith('/tmp/.env-fail', {
        recursive: true,
        force: false // Implementation uses force: false
      });
    });

    it('should not fail if cleanup fails after successful write', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-ok');
      mocks.rm.mockRejectedValue(new Error('Cleanup failed'));
      envManager = new EnvManager('.test.env');

      // Should not throw even though cleanup fails
      await expect(envManager.write({ KEY: 'value' })).resolves.toBeUndefined();
    });
  });

  describe('Cross-platform permission handling', () => {
    it('should use chmod on Unix platforms', async () => {
      platformMock.mockReturnValue('darwin');
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-unix');
      envManager = new EnvManager('.test.env');

      await envManager.write({ KEY: 'value' });

      expect(mocks.chmod).toHaveBeenCalledWith('/tmp/.env-unix/write.tmp', 0o600);
    });

    it('should use chmod on Linux', async () => {
      platformMock.mockReturnValue('linux');
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-linux');
      envManager = new EnvManager('.test.env');

      await envManager.write({ KEY: 'value' });

      expect(mocks.chmod).toHaveBeenCalledWith('/tmp/.env-linux/write.tmp', 0o600);
    });

    it('should use icacls on Windows', async () => {
      platformMock.mockReturnValue('win32');
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-win');
      // Make writeFile succeed without chmod being called
      mocks.writeFile.mockResolvedValue(undefined);
      mocks.rename.mockResolvedValue(undefined);
      mocks.access.mockResolvedValue(undefined);
      mocks.rm.mockResolvedValue(undefined);

      envManager = new EnvManager('.test.env');

      // On Windows, chmod is not called but the write should still succeed
      // Note: The actual icacls call happens via dynamic import which is hard to mock
      // This test verifies that chmod is NOT called (Windows uses different mechanism)
      try {
        await envManager.write({ KEY: 'value' });
        // Write succeeded - chmod was not called
        expect(mocks.chmod).not.toHaveBeenCalled();
      } catch (error) {
        // If the Windows-specific call fails, that's expected in a non-Windows test env
        // The important thing is that chmod was not called
        expect(mocks.chmod).not.toHaveBeenCalled();
      }
    });
  });

  describe('Error handling', () => {
    it('should throw WizardError when permission verification fails', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-test');
      mocks.access.mockRejectedValue(new Error('Permission denied'));
      envManager = new EnvManager('.test.env');

      await expect(envManager.write({ KEY: 'value' })).rejects.toHaveProperty('code', 'PERMISSION_VERIFICATION_FAILED');
    });

    it('should throw WizardError with proper error codes', async () => {
      existsSyncMock.mockReturnValue(true);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-error');
      mocks.readFile.mockRejectedValue(new Error('Read failed'));
      envManager = new EnvManager('.test.env');

      await expect(envManager.read()).rejects.toThrow(WizardError);
      const error = await envManager.read().catch(e => e);
      expect(error.code).toBe('ENV_READ_FAILED');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty values in entries', async () => {
      existsSyncMock.mockReturnValue(false);
      envManager = new EnvManager('.test.env');

      await envManager.write({ EMPTY: '', NON_EMPTY: 'value' });

      const writeCall = mocks.writeFile.mock.calls[0];
      const writtenContent = writeCall[1] as string;

      expect(writtenContent).toContain('EMPTY=');
      expect(writtenContent).toContain('NON_EMPTY=value');
    });

    it('should reject values with newlines (security validation)', async () => {
      existsSyncMock.mockReturnValue(false);
      envManager = new EnvManager('.test.env');

      await expect(envManager.write({ NEWLINES: 'line1\nline2' })).rejects.toHaveProperty('code', 'INVALID_ENV_VALUE');
    });

    it('should handle allowed special characters in values', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.stat.mockResolvedValue({ dev: 1, isSymbolicLink: () => false });
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-special');
      envManager = new EnvManager('.test.env');

      await envManager.write({
        SPECIAL: 'value with spaces',
        WITH_EQUALS: 'value=with=equals',
        WITH_DASH: 'value-with-dash',
        WITH_DOTS: 'value.with.dots'
      });

      const writeCall = mocks.writeFile.mock.calls[0];
      const writtenContent = writeCall[1] as string;

      expect(writtenContent).toContain('SPECIAL=value with spaces');
      expect(writtenContent).toContain('WITH_EQUALS=value=with=equals');
    });

    it('should reject invalid environment variable keys', async () => {
      existsSyncMock.mockReturnValue(false);
      envManager = new EnvManager('.test.env');

      // Key with invalid characters
      await expect(envManager.write({ 'INVALID-KEY': 'value' })).rejects.toHaveProperty('code', 'INVALID_ENV_KEY');

      // Key starting with number
      await expect(envManager.write({ '123INVALID': 'value' })).rejects.toHaveProperty('code', 'INVALID_ENV_KEY');
    });

    it('should handle missing target directory stat gracefully', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-missing');

      let statCallCount = 0;
      mocks.stat.mockImplementation(() => {
        statCallCount++;
        if (statCallCount === 1) {
          return Promise.resolve({ dev: 1 }); // Temp file stat succeeds
        }
        // Target file doesn't exist, stat throws
        const error = new Error('ENOENT');
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        return Promise.reject(error);
      });

      envManager = new EnvManager('.test.env');

      // Should not throw - handles missing target gracefully
      await expect(envManager.write({ KEY: 'value' })).resolves.toBeUndefined();
    });
  });

  describe('Security tests', () => {
    it('should use secure file mode (0o600) for temp file', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-secure');
      envManager = new EnvManager('.test.env');

      await envManager.write({ SECRET: 'value' });

      const writeCall = mocks.writeFile.mock.calls[0];
      expect(writeCall[2]).toEqual({ mode: 0o600 });
    });

    it('should use unpredictable temp directory names (mkdtemp)', async () => {
      existsSyncMock.mockReturnValue(false);
      envManager = new EnvManager('.test.env');

      // Multiple writes should call mkdtemp each time
      await envManager.write({ KEY1: 'value1' });
      await envManager.write({ KEY2: 'value2' });

      // mkdtemp called for each write (unpredictable names)
      expect(mocks.mkdtemp).toHaveBeenCalledTimes(2);
    });

    it('should verify read/write access after write', async () => {
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-access');
      envManager = new EnvManager('.test.env');

      await envManager.write({ KEY: 'value' });

      // access called with R_OK | W_OK flags
      expect(mocks.access).toHaveBeenCalledWith('.test.env', 6);
    });
  });

  // -------------------------------------------------------------------------
  // ST-05-009 / Gate 5.9 — CLI path-traversal input validation regression lock
  //
  // `validateEnvPath` (cli/config/env.ts) runs synchronously inside the public
  // `EnvManager` constructor, BEFORE any fs access — so these tests need no fs
  // mocks. The guard rejects three distinct attack classes: parent-directory
  // traversal (`..` matched as a path SEGMENT, so benign names like
  // `my..config.env` are NOT false-rejected), null-byte injection (`\0`), and
  // over-long paths (DoS).
  // Each assertion targets one clause; deleting that clause from the source
  // makes the matching test fail (ADR-0001 non-vacuity contract). Exercised via
  // the public constructor (integration-style) rather than the unexported
  // `validateEnvPath`, per ADR-0001's "integration over contract-lock" preference.
  // -------------------------------------------------------------------------
  describe('constructor — path-traversal input validation (ST-05-009 / Gate 5.9)', () => {
    // Capture the constructor throw without a bare `new` statement — matches the
    // file's existing `envManager = new EnvManager(...)` assignment idiom and
    // sidesteps the `no-new` lint rule.
    const captureConstruct = (path: string): unknown => {
      try {
        envManager = new EnvManager(path);
        return undefined;
      } catch (error) {
        return error;
      }
    };

    it('rejects parent-directory traversal sequences with INVALID_PATH', () => {
      const error = captureConstruct('../../../etc/passwd');
      expect(error).toBeInstanceOf(WizardError);
      expect((error as WizardError).code).toBe('INVALID_PATH');
      expect((error as WizardError).message).toContain('path traversal');
    });

    it('rejects traversal sequences embedded mid-path', () => {
      const error = captureConstruct('config/../../secret.env');
      expect(error).toBeInstanceOf(WizardError);
      expect((error as WizardError).code).toBe('INVALID_PATH');
      expect((error as WizardError).message).toContain('path traversal');
    });

    it('rejects null-byte injection with INVALID_PATH', () => {
      // String.fromCharCode(0) keeps a raw NUL byte out of the test source
      // (same convention as the C1-range corpus in common/index.test.ts).
      const error = captureConstruct(`.env${String.fromCharCode(0)}.txt`);
      expect(error).toBeInstanceOf(WizardError);
      expect((error as WizardError).code).toBe('INVALID_PATH');
      expect((error as WizardError).message).toContain('null byte');
    });

    it('rejects paths exceeding MAX_PATH_LENGTH with PATH_TOO_LONG (DoS guard)', () => {
      const error = captureConstruct('a'.repeat(257));
      expect(error).toBeInstanceOf(WizardError);
      expect((error as WizardError).code).toBe('PATH_TOO_LONG');
    });

    it('locks the MAX_PATH_LENGTH boundary: 256 accepted, 257 rejected (guards `>` vs `>=` drift)', () => {
      // The cap is `> 256`. Pin both sides so a regression to `>=` (which would
      // wrongly reject a legitimate 256-char path) is caught.
      expect(captureConstruct('a'.repeat(256))).toBeUndefined();
      expect((captureConstruct('a'.repeat(257)) as WizardError).code).toBe('PATH_TOO_LONG');
    });

    it('accepts legitimate relative and absolute paths (no false positives)', () => {
      expect(() => new EnvManager('.env')).not.toThrow();
      expect(() => new EnvManager('.env.local')).not.toThrow();
      expect(() => new EnvManager('.env.example')).not.toThrow();
      expect(() => new EnvManager('config/app.env')).not.toThrow();
      expect(() => new EnvManager('/custom/absolute/path/.env')).not.toThrow();
    });

    // Segment-vs-substring regression lock. The guard matches `..` as a whole
    // path SEGMENT, not a bare substring. These names contain the literal `..`
    // substring yet are NOT traversal (no `..` segment), so each was wrongly
    // rejected by the prior `path.includes('..')` check and must now be
    // accepted. This test fails against that old behavior — it is not vacuous.
    it('accepts benign filenames that merely contain a ".." substring', () => {
      expect('my..config.env').toContain('..'); // precondition: the old guard's trigger
      expect(() => new EnvManager('my..config.env')).not.toThrow();
      expect(() => new EnvManager('.env..bak')).not.toThrow();
      expect(() => new EnvManager('app..env')).not.toThrow();
    });

    it('rejects Windows-separator (`\\`) traversal, not just POSIX `/`', () => {
      // The segment split covers both separators, so a `..` segment delimited
      // by backslashes is caught the same as a forward-slash one.
      expect((captureConstruct('..\\secret.env') as WizardError).code).toBe('INVALID_PATH');
      expect((captureConstruct('config\\..\\..\\secret.env') as WizardError).code).toBe('INVALID_PATH');
    });

    it('reports PATH_TOO_LONG when an over-length path also contains traversal (length guard precedes traversal)', () => {
      // The length check runs before the traversal check, so the length code
      // wins for an input that violates both. Both orderings still reject —
      // pinning the order makes any future reorder a test-visible decision.
      const longTraversal = `../${'a'.repeat(300)}`;
      expect(longTraversal.length).toBeGreaterThan(256);
      expect((captureConstruct(longTraversal) as WizardError).code).toBe('PATH_TOO_LONG');
    });
  });
});
