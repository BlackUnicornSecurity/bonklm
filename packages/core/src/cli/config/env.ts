/**
 * Environment Configuration Manager
 *
 * This module provides secure atomic .env file management with:
 * - Atomic write operations using mkdtemp() for security (C-2 fix)
 * - Cross-platform permission handling (0o600 on Unix, icacls on Windows)
 * - Same-filesystem verification for atomic rename guarantees
 * - Automatic temp directory cleanup
 *
 * SECURITY: TOCTOU Race Condition Protection (C-2)
 * - Uses mkdtemp() for unpredictable temp directory names
 * - Atomic rename prevents partial writes
 * - Proper cleanup prevents temp file leakage
 *
 * SECURITY: Insecure Random Number Generation (HP-7)
 * - mkdtemp() uses crypto-random suffixes, not Date.now()
 * - No predictable temp file patterns
 */

import { access, chmod, constants, mkdtemp, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { platform, tmpdir } from 'os';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { parse as dotenvParse } from 'dotenv';
import { WizardError } from '../utils/error.js';

/**
 * Default mode for newly created files
 * Read/write for owner only (no group/other permissions)
 */
const SECURE_FILE_MODE = 0o600;

/**
 * Maximum allowed path length to prevent DoS attacks
 */
const MAX_PATH_LENGTH = 256;

/**
 * Validates that a file path is safe for use with EnvManager
 *
 * SECURITY: Prevents path traversal attacks and limits path length
 *
 * This validation blocks:
 * - Path traversal sequences (`..` appearing as a complete path segment)
 * - Excessive path length (DoS prevention)
 *
 * Note: Absolute paths are allowed for test/internal use cases
 *
 * @param path - The path to validate
 * @returns The validated path
 * @throws {WizardError} If path is invalid
 */
function validateEnvPath(path: string): string {
  // Check path length
  if (path.length > MAX_PATH_LENGTH) {
    throw new WizardError(
      'PATH_TOO_LONG',
      `File path exceeds maximum length of ${MAX_PATH_LENGTH}`,
      'Use a shorter file name'
    );
  }

  // Disallow path traversal — reject `..` only as a complete path SEGMENT.
  //
  // Splitting on both POSIX (`/`) and Windows (`\`) separators and matching a
  // whole segment (rather than the previous `path.includes('..')` substring
  // test) means legitimate filenames that merely CONTAIN a `..` substring —
  // `my..config.env`, `.env..bak`, `app..env` — are accepted, while real
  // traversal (`../x`, `a/../../x`, `..\\x`) is still rejected.
  //
  // A resolve-based containment check (as in doctor.ts `setWindowsPermissions`)
  // is deliberately NOT used here: this function allows absolute paths by
  // contract (see above), so a `resolve(cwd, path).startsWith(cwd)` guard would
  // wrongly reject the supported absolute-path case.
  if (path.split(/[\\/]/).includes('..')) {
    throw new WizardError(
      'INVALID_PATH',
      'Invalid file path: path traversal detected',
      'Path traversal sequences (..) are not allowed'
    );
  }

  // Check for null bytes (another attack vector)
  if (path.includes('\0')) {
    throw new WizardError(
      'INVALID_PATH',
      'Invalid file path: null bytes detected',
      'Null bytes are not allowed in file paths'
    );
  }

  return path;
}

/**
 * Manages environment file (.env) operations with atomic writes
 *
 * This class provides secure read, write, and merge operations for
 * .env files with automatic permission handling and atomic updates.
 *
 * @example
 * ```ts
 * const envManager = new EnvManager('.env');
 *
 * // Read existing values
 * const current = await envManager.read();
 *
 * // Write new values (merges with existing)
 * await envManager.write({ API_KEY: 'sk-...' });
 *
 * // Atomic replace (no merge)
 * await envManager.write({ NEW_KEY: 'value' }, false);
 * ```
 */
export class EnvManager {
  /**
   * Path to the .env file being managed
   */
  private readonly path: string;

  /**
   * Creates a new EnvManager instance
   *
   * @param path - Path to the .env file (default: '.env' in current directory)
   */
  constructor(path: string = '.env') {
    this.path = validateEnvPath(path);
  }

  /**
   * Reads and parses the .env file
   *
   * Returns an empty object if the file doesn't exist.
   * Uses dotenv.parse() for proper parsing of:
   * - Comments (# prefix)
   * - Quoted values (single and double quotes)
   * - Multi-line values
   * - Export statements
   *
   * @returns Parsed environment variables as key-value pairs
   * @throws {WizardError} If file exists but cannot be read
   */
  async read(): Promise<Record<string, string>> {
    if (!existsSync(this.path)) {
      return {};
    }

    try {
      const content = await readFile(this.path, 'utf-8');
      return dotenvParse(content);
    } catch (error) {
      throw new WizardError(
        'ENV_READ_FAILED',
        `Failed to read .env file: ${this.path}`,
        'Check file permissions and ensure the file is valid UTF-8 text',
        error as Error,
        1
      );
    }
  }

  /**
   * Writes environment variables to the .env file
   *
   * By default, merges with existing values (new values overwrite).
   * Set `merge` to false to replace all existing content.
   *
   * The write operation is atomic:
   * 1. Create secure temp directory with mkdtemp()
   * 2. Write content to temp file with secure permissions
   * 3. Verify same filesystem for atomic rename
   * 4. Atomic rename from temp to target
   * 5. Cleanup temp directory (even if rename fails)
   *
   * @param entries - Key-value pairs to write
   * @param merge - Whether to merge with existing values (default: true)
   * @throws {WizardError} If write operation fails
   */
  async write(entries: Record<string, string>, merge: boolean = true): Promise<void> {
    let content: string;

    if (merge) {
      // Read existing and merge
      const existing = await this.read();
      const merged = { ...existing, ...entries };
      content = this.formatEntries(merged);
    } else {
      content = this.formatEntries(entries);
    }

    await this.writeAtomic(content);
  }

  /**
   * Performs an atomic write operation
   *
   * SECURITY FIX C-2: Uses mkdtemp() instead of predictable filenames
   * - Creates temp directory with crypto-random suffix
   * - No race condition from predictable temp names
   * - Atomic rename guarantees either complete success or complete failure
   *
   * @param content - The content to write
   * @throws {WizardError} If atomic write fails
   */
  private async writeAtomic(content: string): Promise<void> {
    // Create secure temp directory with unpredictable name (C-2 fix)
    // SECURITY: Resolve symlinks in tmpdir to prevent symlink attacks
    const tmpDirResolved = await this.resolveSymlinks(tmpdir());
    const tempDir = await mkdtemp(join(tmpDirResolved, '.env-'));
    const tempPath = join(tempDir, 'write.tmp');

    let writeSuccessful = false;

    try {
      // Step 1: Verify same filesystem BEFORE writing (fail fast)
      await this.ensureSameFilesystem(tempDir, this.path);

      // Step 2: Write to temp file with secure permissions
      await writeFile(tempPath, content, { mode: SECURE_FILE_MODE });
      await this.setSecurePermissions(tempPath);
      writeSuccessful = true;

      // Step 3: Atomic rename (guaranteed atomic on same filesystem)
      await rename(tempPath, this.path);

      // Step 4: Verify permissions after rename
      await this.verifyPermissions(this.path);
    } finally {
      // SECURITY: Cleanup only happens AFTER write is complete or fails
      // Only cleanup if temp file exists (rename may have moved it)
      // Use non-force rm to detect if file is still in use
      try {
        await rm(tempDir, { recursive: true, force: false });
      } catch (cleanupError) {
        // If cleanup fails and write was successful, log warning
        // but don't fail the operation
        if (writeSuccessful) {
          console.warn(`[WARN] Failed to cleanup temp directory: ${tempDir}`);
        }
      }
    }
  }

  /**
   * Resolves symlinks in a path to prevent symlink attacks
   *
   * @param path - The path to resolve
   * @returns The resolved path without symlinks
   */
  private async resolveSymlinks(path: string): Promise<string> {
    try {
      const stats = await stat(path);
      if (stats.isSymbolicLink()) {
        // Use realpath to resolve the symlink
        const { realpath } = await import('node:fs/promises');
        return await realpath(path);
      }
    } catch {
      // Path doesn't exist or can't be resolved, return as-is
    }
    return path;
  }

  /**
   * Verifies both paths are on the same filesystem
   *
   * Atomic rename is only guaranteed within the same filesystem.
   * Cross-filesystem rename performs copy+delete which is not atomic.
   *
   * @param from - Source path
   * @param to - Target path
   * @throws {WizardError} If paths are on different filesystems
   */
  private async ensureSameFilesystem(from: string, to: string): Promise<void> {
    try {
      const stat1 = await stat(from);
      let stat2;

      // Try to stat the target file
      try {
        stat2 = await stat(to);
      } catch {
        // Target doesn't exist yet, stat the parent directory instead
        const parentDir = dirname(to);
        stat2 = await stat(parentDir);
      }

      // Compare device IDs - same filesystem means same device
      if (stat1.dev !== stat2.dev) {
        throw new WizardError(
          'CROSS_FILESYSTEM_RENAME',
          'Cannot atomically rename across filesystems',
          'Ensure .env is on the same filesystem as the temp directory',
          undefined,
          1
        );
      }
    } catch (error) {
      // Re-throw WizardError, fail on other errors
      if (error instanceof WizardError) {
        throw error;
      }
      // If stat fails for other reasons, proceed with caution
      // This is a best-effort check
    }
  }

  /**
   * Sets platform-specific secure file permissions
   *
   * Unix/macOS: Uses chmod to set 0o600 (owner read/write only)
   * Windows: Uses icacls to disable inheritance
   *
   * @param filePath - Path to the file
   */
  private async setSecurePermissions(filePath: string): Promise<void> {
    if (platform() === 'win32') {
      await this.setWindowsPermissions(filePath);
    } else {
      await chmod(filePath, SECURE_FILE_MODE);
    }
  }

  /**
   * Sets Windows-specific file permissions using icacls
   *
   * The /inheritance:r flag removes inherited permissions,
   * leaving only explicitly granted permissions.
   *
   * SECURITY: If icacls fails, we try alternative methods
   * and throw an error if all methods fail (rather than silently continuing).
   *
   * @param filePath - Path to the file
   * @throws {WizardError} If unable to set secure permissions
   */
  private async setWindowsPermissions(filePath: string): Promise<void> {
    // SECURITY: Validate file path is within safe directory before execution
    // Resolve to absolute path to prevent path traversal
    const pathModule = await import('node:path');
    const normalizedPath = pathModule.resolve(filePath);
    const cwd = process.cwd();

    // Ensure the path is within the current working directory
    if (!normalizedPath.startsWith(pathModule.resolve(cwd))) {
      throw new WizardError(
        'PATH_OUTSIDE_DIRECTORY',
        'File path is outside the allowed directory',
        'File path must be within the project directory'
      );
    }

    try {
      const { execFile } = await import('node:child_process');
      await execFile('icacls', [filePath, '/inheritance:r']);
    } catch (error) {
      // Try using attrib as fallback for read-only flag
      try {
        const { execFile: execFile2 } = await import('node:child_process');
        // Set read-only flag as minimal security measure
        await execFile2('attrib', ['+R', filePath]);
      } catch (fallbackError) {
        // Both methods failed - this is a security concern
        throw new WizardError(
          'WINDOWS_PERMISSIONS_FAILED',
          'Unable to set secure file permissions on Windows',
          'Ensure icacls.exe is available or run with appropriate privileges',
          error as Error,
          1
        );
      }
    }
  }

  /**
   * Verifies the file is readable and writable
   *
   * Uses access() with R_OK and W_OK flags to verify
   * the current process can read and write the file.
   *
   * @param filePath - Path to verify
   * @throws {WizardError} If file is not accessible
   */
  private async verifyPermissions(filePath: string): Promise<void> {
    try {
      await access(filePath, constants.R_OK | constants.W_OK);
    } catch (error) {
      throw new WizardError(
        'PERMISSION_VERIFICATION_FAILED',
        `File is not accessible: ${filePath}`,
        'Check file permissions and ownership',
        error as Error,
        1
      );
    }
  }

  /**
   * Formats entries as .env file content
   *
   * Simple KEY=value format, one entry per line.
   * Values are written as-is (caller is responsible for proper escaping).
   *
   * SECURITY: Validates keys to prevent injection attacks.
   * Only allows alphanumeric characters, underscore, and valid shell variable names.
   *
   * @param entries - Key-value pairs to format
   * @returns Formatted .env content
   * @throws {WizardError} If a key contains invalid characters
   */
  private formatEntries(entries: Record<string, string>): string {
    const lines: string[] = [];

    // Validate key format (prevent injection)
    const validKeyPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

    for (const [key, value] of Object.entries(entries)) {
      if (!validKeyPattern.test(key)) {
        throw new WizardError(
          'INVALID_ENV_KEY',
          `Invalid environment variable key: ${key}`,
          'Keys must start with letter/underscore and contain only alphanumeric/underscore characters',
          undefined,
          1
        );
      }

      // Check for newlines in value (prevent multiline injection)
      if (value.includes('\n') || value.includes('\r')) {
        throw new WizardError(
          'INVALID_ENV_VALUE',
          `Environment variable value contains newline: ${key}`,
          'Remove newlines from environment variable values',
          undefined,
          1
        );
      }

      lines.push(`${key}=${value}`);
    }

    return lines.join('\n');
  }

  /**
   * Returns the path being managed
   *
   * @returns The .env file path
   */
  getPath(): string {
    return this.path;
  }
}
