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

// Mock child_process with a FAITHFUL model of the Node callback API so the
// win32 icacls/attrib branch is exercisable on a non-Windows host AND the
// promisify contract is genuinely tested. The real `execFile` returns a
// ChildProcess (NOT a Promise) and reports completion ONLY through its trailing
// callback; the source promisifies it (`util.promisify`, left real below)
// before awaiting. Modelling the callback contract — rather than returning a
// Promise directly — is what makes the promisify regression non-vacuous: the
// previously masked, un-promisified `await execFile(...)` passes NO callback,
// so it never observes the outcome and resolves immediately, exactly as it
// (mis)behaves on real Windows (D-024). Per-test outcome control: list the
// commands that must fail in `execFileFailFor` (empty ⇒ every call succeeds).
// Only `(cmd, args)` is recorded on `execFileMock`, so the call-args assertions
// below are agnostic to the promisify-appended callback.
let execFileFailFor = new Set<string>();
const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (cmd: string, args: readonly string[], callback?: (err: Error | null) => void): unknown => {
    // Record the user-visible arguments only (no trailing callback) so
    // `toHaveBeenCalledWith('icacls', [...])` holds whether or not the source
    // promisifies the call (promisify appends the callback as a third arg).
    execFileMock(cmd, args);
    const error = execFileFailFor.has(cmd) ? new Error(`${cmd} failed (mock)`) : null;
    // A promisified caller passes a callback and is signalled exclusively
    // through it. A bare `await execFile(...)` passes none, so it CANNOT observe
    // `error` — the regression this models.
    if (typeof callback === 'function') {
      callback(error);
    }
    // Non-thenable stand-in for ChildProcess (never a Promise): an
    // un-promisified `await` resolves to it immediately, skipping error handling.
    return { _childProcessStub: true };
  }
}));

describe('EnvManager', () => {
  let envManager: EnvManager;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    // execFile outcomes are driven by `execFileFailFor` (not by mock return
    // values); clear recorded calls and reset the set so every win32 test starts
    // from "every command succeeds" with no cross-test leakage.
    execFileMock.mockReset();
    execFileFailFor = new Set();
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

    // win32 applies perms via icacls/attrib (not chmod). The previous test here
    // wrapped write() in try/catch and asserted the same thing in BOTH branches,
    // so it passed whether or not the Windows write actually worked — masking the
    // PATH_OUTSIDE_DIRECTORY regression (observation #3). This replacement is
    // non-vacuous: it asserts the write RESOLVES, which it did NOT under the old
    // temp-path guard (the temp file is in the OS tmpdir, outside cwd).
    it('uses icacls (never chmod) on Windows and succeeds for an in-cwd path', async () => {
      platformMock.mockReturnValue('win32');
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-win');
      // execFileFailFor is empty (beforeEach) ⇒ icacls succeeds.
      envManager = new EnvManager('.test.env');

      await expect(envManager.write({ KEY: 'value' })).resolves.toBeUndefined();

      expect(mocks.chmod).not.toHaveBeenCalled();
      // icacls runs on the TEMP file (perms set before the atomic rename).
      expect(execFileMock).toHaveBeenCalledWith('icacls', ['/tmp/.env-win/write.tmp', '/inheritance:r']);
    });
  });

  // -------------------------------------------------------------------------
  // Observation #3 (PR #46 handover) regression — the win32 icacls-sink
  // cwd-containment guard must validate the FINAL destination (`this.path`),
  // NOT the internal mkdtemp temp file. The temp file lives in the OS tmpdir
  // (outside cwd) by design, so the previous temp-path guard rejected EVERY
  // Windows write with PATH_OUTSIDE_DIRECTORY. platform is mocked to win32 and
  // child_process is mocked so icacls "succeeds" on a non-Windows host.
  // -------------------------------------------------------------------------
  describe('setWindowsPermissions — cwd-containment at the icacls sink (observation #3)', () => {
    beforeEach(() => {
      platformMock.mockReturnValue('win32');
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-win');
    });

    it('rejects a final destination outside cwd with PATH_OUTSIDE_DIRECTORY, before any icacls side effect', async () => {
      // Absolute path at the filesystem root: outside any real cwd, yet accepted
      // by validateEnvPath (absolute, no `..` segment). The sink guard must
      // reject it — and must do so BEFORE spawning icacls.
      envManager = new EnvManager('/.bonklm-outside.env');

      await expect(envManager.write({ KEY: 'value' })).rejects.toHaveProperty('code', 'PATH_OUTSIDE_DIRECTORY');
      expect(execFileMock).not.toHaveBeenCalled();
    });

    it('falls back to attrib when icacls fails, and still resolves (locks the awaited icacls rejection — D-024)', async () => {
      // icacls fails; attrib succeeds. The fallback only runs if the icacls
      // rejection was AWAITED and caught — un-promisified, that await resolves to
      // a ChildProcess, attrib is never reached, and this test goes RED.
      execFileFailFor = new Set(['icacls']);
      envManager = new EnvManager('.test.env');

      await expect(envManager.write({ KEY: 'value' })).resolves.toBeUndefined();
      expect(execFileMock).toHaveBeenNthCalledWith(1, 'icacls', ['/tmp/.env-win/write.tmp', '/inheritance:r']);
      expect(execFileMock).toHaveBeenNthCalledWith(2, 'attrib', ['+R', '/tmp/.env-win/write.tmp']);
    });

    it('throws WINDOWS_PERMISSIONS_FAILED when both icacls and attrib fail', async () => {
      // Both fail. Only reachable if BOTH awaited rejections are caught — the
      // un-promisified source resolves through both, so write() would resolve
      // and this assertion would never see the error (D-024 lock).
      execFileFailFor = new Set(['icacls', 'attrib']);
      envManager = new EnvManager('.test.env');

      await expect(envManager.write({ KEY: 'value' })).rejects.toHaveProperty('code', 'WINDOWS_PERMISSIONS_FAILED');
    });

    // The guard reads process.cwd() directly, so mocking it pins the two subtle
    // boundary behaviours deterministically (independent of the runner's cwd).
    // platform() is mocked to win32, so the real path module uses the host
    // separator ('/' on the CI/dev host) — paths below use '/' to match.
    describe('destination-containment boundary (cwd-mocked)', () => {
      beforeEach(() => {
        vi.spyOn(process, 'cwd').mockReturnValue('/project');
        // execFileFailFor empty (outer beforeEach) ⇒ icacls succeeds when reached.
      });

      it('accepts an in-cwd ABSOLUTE destination and reaches icacls', async () => {
        // Locks the other half of the fix: an absolute path INSIDE cwd is allowed
        // (the prior temp-path guard rejected even this on win32).
        envManager = new EnvManager('/project/.env');

        await expect(envManager.write({ KEY: 'value' })).resolves.toBeUndefined();
        expect(execFileMock).toHaveBeenCalledWith('icacls', ['/tmp/.env-win/write.tmp', '/inheritance:r']);
      });

      it('rejects a sibling-prefix destination — locks the `root + sep` boundary', async () => {
        // cwd `/project`; `/project-evil/.env` shares the `/project` text prefix
        // but is NOT inside cwd. A guard using a bare `startsWith(root)` (no
        // `+ sep`) would WRONGLY accept it — so this fails if `+ sep` is dropped.
        envManager = new EnvManager('/project-evil/.env');

        await expect(envManager.write({ KEY: 'value' })).rejects.toHaveProperty('code', 'PATH_OUTSIDE_DIRECTORY');
        expect(execFileMock).not.toHaveBeenCalled();
      });

      it('accepts a destination differing from cwd only in CASE — locks the win32 case-fold', async () => {
        // win32 filesystems are case-insensitive: `/PROJECT/.env` is the same
        // directory as cwd `/project`. Without the `toLowerCase()` fold this would
        // be a spurious PATH_OUTSIDE_DIRECTORY — the false-reject class this fix
        // exists to eliminate. Fails if the case-fold is removed.
        envManager = new EnvManager('/PROJECT/.env');

        await expect(envManager.write({ KEY: 'value' })).resolves.toBeUndefined();
        expect(execFileMock).toHaveBeenCalledWith('icacls', ['/tmp/.env-win/write.tmp', '/inheritance:r']);
      });
    });
  });

  // -------------------------------------------------------------------------
  // D-024 regression — `execFile` MUST be promisified before being awaited.
  //
  // Callback-style execFile returns a ChildProcess, not a Promise, so a bare
  // `await execFile(...)` never waits for the process and never sees a non-zero
  // exit / spawn error — which silently disabled the attrib fallback and the
  // WINDOWS_PERMISSIONS_FAILED path on real Windows. The child_process mock
  // above models that callback contract faithfully (it signals ONLY through the
  // trailing callback that promisify appends), so the assertions here are RED
  // against the un-promisified source and GREEN once promisified (ADR-0001
  // non-vacuity). The attrib-fallback + both-fail tests above are the companion
  // behavioural locks; this one additionally proves the original rejection
  // PROPAGATED into the catch (it survives as the WizardError cause).
  // -------------------------------------------------------------------------
  describe('setWindowsPermissions — execFile promisify contract (D-024)', () => {
    beforeEach(() => {
      platformMock.mockReturnValue('win32');
      existsSyncMock.mockReturnValue(false);
      mocks.mkdtemp.mockResolvedValue('/tmp/.env-win');
    });

    it('carries the awaited icacls rejection as the WINDOWS_PERMISSIONS_FAILED cause', async () => {
      execFileFailFor = new Set(['icacls', 'attrib']);
      envManager = new EnvManager('.test.env');

      const error = await envManager.write({ KEY: 'value' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WizardError);
      expect((error as WizardError).code).toBe('WINDOWS_PERMISSIONS_FAILED');
      // The cause is the original icacls rejection (sanitized by WizardError) and
      // can only be present if the promisified await actually threw into the
      // catch. The un-promisified source never throws, so write() would RESOLVE
      // and this assertion is unreachable.
      const cause = (error as WizardError).cause;
      expect(cause).toBeInstanceOf(Error);
      expect(cause?.message ?? '').toContain('icacls');
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
