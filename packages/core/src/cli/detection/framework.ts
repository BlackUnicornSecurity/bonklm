/**
 * Framework Detection for the BonkLM Installation Wizard
 *
 * This module detects installed frameworks in the current project by:
 * 1. Reading package.json from the current directory
 * 2. Parsing dependencies and devDependencies
 * 3. Matching against known framework patterns
 *
 * SECURITY FEATURES:
 * - Path traversal protection: Uses realpath() to validate package.json location
 * - Prototype pollution prevention: Uses secure-json-parse with protoAction removal
 * - DoS protection: Enforces 1MB file size limit
 * - Dependency limit: Caps checked dependencies to prevent resource exhaustion
 */

import { readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { existsSync } from 'node:fs';
import { parse } from 'secure-json-parse';
import { WizardError } from '../utils/error.js';
import { isPathWithinRoot } from '../utils/path.js';

/**
 * Detected framework information
 *
 * Represents a framework found in the current project.
 */
export interface DetectedFramework {
  /** Framework identifier (e.g., 'express', 'nestjs') */
  name: string;
  /** Version from package.json (if available) */
  version?: string;
}

/**
 * Framework detection patterns
 *
 * Maps framework IDs to their package dependencies.
 * Checks both dependencies and devDependencies.
 */
const FRAMEWORK_PATTERNS = {
  express: {
    dependencies: ['express'],
    devDependencies: []
  },
  fastify: {
    dependencies: ['fastify'],
    devDependencies: []
  },
  nestjs: {
    dependencies: ['@nestjs/core'],
    devDependencies: []
  },
  langchain: {
    dependencies: ['langchain', '@langchain/core'],
    devDependencies: []
  }
} as const;

/** Type containing all framework IDs */
export type FrameworkId = keyof typeof FRAMEWORK_PATTERNS;

/** Maximum package.json file size (1MB) to prevent DoS */
const MAX_PACKAGE_JSON_SIZE = 1024 * 1024;

/** Maximum number of dependencies to check */
const MAX_DEPENDENCIES = 1000;

/**
 * Framework detection options
 *
 * Optional configuration for framework detection behavior.
 */
export interface FrameworkDetectionOptions {
  /** Custom working directory (defaults to process.cwd()) */
  workingDir?: string;
  /** Custom package.json path (relative to working dir) */
  packageJsonPath?: string;
}

/**
 * Detects frameworks installed in the current project
 *
 * This function performs the following security checks:
 * 1. Resolves real paths to prevent symlink attacks (C-4 fix)
 * 2. Validates path is within working directory (C-4 fix)
 * 3. Checks file size before reading (MP-6 fix)
 * 4. Uses secure JSON parser to prevent prototype pollution (HP-6 fix)
 * 5. Limits number of dependencies checked (MP-6 fix)
 *
 * @param options - Optional detection configuration
 * @returns Array of detected frameworks with versions
 *
 * @throws {WizardError} If package.json is outside working directory (path traversal)
 * @throws {WizardError} If package.json exceeds size limit
 *
 * @example
 * ```ts
 * const frameworks = await detectFrameworks();
 * // [{ name: 'express', version: '^4.18.0' }]
 * ```
 */
export async function detectFrameworks(options: FrameworkDetectionOptions = {}): Promise<DetectedFramework[]> {
  // Resolve real paths to prevent symlink attacks (C-4 fix)
  const workingDir = await realpath(options.workingDir || cwd());
  const pkgPath = join(workingDir, options.packageJsonPath || 'package.json');

  // Check if file exists
  if (!existsSync(pkgPath)) {
    return [];
  }

  // Resolve real path of package.json to detect symlink attacks
  let realPath: string;
  try {
    realPath = await realpath(pkgPath);
  } catch {
    // File doesn't exist or is a broken symlink
    return [];
  }

  // SECURITY FIX: Validate path is within working directory (C-4 fix).
  // Defeats a symlinked package.json that points outside the project. Both
  // `workingDir` and `realPath` are realpath()-resolved above, so the shared
  // containment helper compares their on-disk-canonical forms. `caseInsensitive`
  // preserves this module's long-standing case-fold for Windows/macOS (a
  // platform-conditional fold is a possible future refinement, deferred to avoid
  // a behaviour change here — see ADR-0003 "Open question (a)"). The helper's
  // `root + sep` boundary closes the sibling-prefix bypass (`/foo/bar` vs
  // `/foo/bar1`) that the previous segment-count check did NOT catch.
  // `allowRootItself: true` preserves prior behaviour for the degenerate case
  // where `realPath` resolves to `workingDir` itself (e.g. `packageJsonPath: '.'`):
  // the old `startsWith` accepted it and the subsequent `readFile` on a directory
  // returned [] (EISDIR) — so we accept here too rather than mislabel a
  // non-traversal input as PATH_TRAVERSAL. See cli/utils/path.ts.
  if (!isPathWithinRoot(realPath, workingDir, { caseInsensitive: true, allowRootItself: true })) {
    throw new WizardError(
      'PATH_TRAVERSAL',
      'package.json path resolved outside working directory',
      'Ensure package.json is within the project directory',
      undefined,
      1 // ERROR exit code
    );
  }

  // SECURITY FIX: Check file size before reading (MP-6 fix)
  try {
    const fileStat = await stat(realPath);
    if (fileStat.size > MAX_PACKAGE_JSON_SIZE) {
      throw new WizardError(
        'FILE_TOO_LARGE',
        `package.json exceeds ${MAX_PACKAGE_JSON_SIZE} bytes`,
        'Remove unused dependencies or split your package.json',
        undefined,
        1 // ERROR exit code
      );
    }
  } catch (error) {
    if (error instanceof WizardError && error.code === 'FILE_TOO_LARGE') {
      throw error;
    }
    // Other stat errors (permission denied, etc.) - return empty
    return [];
  }

  // SECURITY FIX: Use secure JSON parser to prevent prototype pollution (HP-6 fix)
  let content: string;
  let pkg: Record<string, unknown>;

  try {
    content = await readFile(realPath, 'utf-8');

    // Use secure-json-parse with protoAction and constructorAction removal
    // Call parse with null reviver and options object
    pkg = parse(content, null, {
      protoAction: 'remove',
      constructorAction: 'remove'
    }) as Record<string, unknown>;

    // Additional validation: Check for prototype pollution markers
    // Use hasOwnProperty to check if these are own properties (not inherited)
    if (
      Object.prototype.hasOwnProperty.call(pkg, '__proto__') ||
      Object.prototype.hasOwnProperty.call(pkg, 'constructor')
    ) {
      throw new WizardError(
        'INVALID_PACKAGE_JSON',
        'package.json contains prototype pollution',
        'Remove malicious __proto__ or constructor properties',
        undefined,
        1
      );
    }

    // Validate that pkg is an object
    if (!pkg || typeof pkg !== 'object') {
      return [];
    }
  } catch (error) {
    if (error instanceof WizardError) {
      throw error;
    }
    // Parse errors - return empty without exposing error details
    // (parse error might contain malicious content)
    return [];
  }

  const detected: DetectedFramework[] = [];
  let depsChecked = 0;

  // SECURITY FIX: Limit number of dependencies checked (MP-6 fix)
  for (const [name, pattern] of Object.entries(FRAMEWORK_PATTERNS)) {
    if (depsChecked >= MAX_DEPENDENCIES) {
      console.warn('Maximum dependency check limit reached');
      break;
    }

    const deps = (pkg.dependencies as Record<string, string> | undefined) || {};
    const devDeps = (pkg.devDependencies as Record<string, string> | undefined) || {};

    let found = false;
    let version: string | undefined;

    // Check regular dependencies first
    for (const dep of pattern.dependencies) {
      if (deps[dep]) {
        found = true;
        version = deps[dep];
        break;
      }
    }

    // If not found in dependencies, check devDependencies
    if (!found) {
      for (const dep of pattern.dependencies) {
        if (devDeps[dep]) {
          found = true;
          version = devDeps[dep];
          break;
        }
      }
    }

    // Check pattern-specific devDependencies (usually empty)
    if (!found) {
      for (const dep of pattern.devDependencies) {
        if (devDeps[dep]) {
          found = true;
          version = devDeps[dep];
          break;
        }
      }
    }

    if (found && version) {
      detected.push({ name, version });
    }

    depsChecked++;
  }

  return detected;
}

/**
 * Checks if a specific framework is detected in the current project
 *
 * @param frameworkId - The framework ID to check
 * @param options - Optional detection configuration
 * @returns True if the framework is detected
 *
 * @example
 * ```ts
 * if (await isFrameworkDetected('express')) {
 *   // Use Express-specific code
 * }
 * ```
 */
export async function isFrameworkDetected(
  frameworkId: FrameworkId,
  options?: FrameworkDetectionOptions
): Promise<boolean> {
  const frameworks = await detectFrameworks(options);
  return frameworks.some(f => f.name === frameworkId);
}

/**
 * Gets version of a specific framework if detected
 *
 * @param frameworkId - The framework ID to check
 * @param options - Optional detection configuration
 * @returns Version string or undefined if not detected
 *
 * @example
 * ```ts
 * const expressVersion = await getFrameworkVersion('express');
 * // '^4.18.0' or undefined
 * ```
 */
export async function getFrameworkVersion(
  frameworkId: FrameworkId,
  options?: FrameworkDetectionOptions
): Promise<string | undefined> {
  const frameworks = await detectFrameworks(options);
  return frameworks.find(f => f.name === frameworkId)?.version;
}
