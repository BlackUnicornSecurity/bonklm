/**
 * Project dependency reader for the BonkLM Installation Wizard
 *
 * Reads the current project's `package.json` and returns its merged
 * `dependencies` + `devDependencies` map. This is the single hardened read used
 * by BOTH framework detection (`detection/framework.ts`) and the connector
 * `installed` probe (`connectors/descriptor.ts`) — previously the guards below
 * lived inline inside `detectFrameworks`, so any second consumer would have had
 * to re-implement them (and would have drifted).
 *
 * SECURITY FEATURES (unchanged from the original inline implementation):
 * - Path traversal protection: uses realpath() to validate package.json location
 * - Prototype pollution prevention: secure-json-parse with proto/constructor removal
 * - DoS protection: enforces a 1MB file size limit
 *
 * @module detection/project-deps
 */

import { readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { parse } from 'secure-json-parse';
import { WizardError } from '../utils/error.js';
import { isPathWithinRoot } from '../utils/path.js';
import { DETECTION_TIMEOUTS, detectWithTimeout } from './timeout.js';

/** Maximum package.json file size (1MB) to prevent DoS */
export const MAX_PACKAGE_JSON_SIZE = 1024 * 1024;

/**
 * Options for locating the project `package.json`.
 */
export interface ProjectDepsOptions {
  /** Custom working directory (defaults to process.cwd()) */
  workingDir?: string;
  /** Custom package.json path (relative to working dir) */
  packageJsonPath?: string;
}

/**
 * A project's declared dependencies.
 *
 * `dependencies` and `devDependencies` are kept separate so callers that care
 * about the distinction (e.g. reporting where a package was found) can tell
 * them apart; {@link lookupDependency} searches both.
 */
export interface ProjectDependencies {
  /** Contents of `dependencies` (empty object when absent) */
  dependencies: Record<string, string>;
  /** Contents of `devDependencies` (empty object when absent) */
  devDependencies: Record<string, string>;
}

/** Empty result, returned for every non-fatal "cannot read" outcome. */
const EMPTY: ProjectDependencies = Object.freeze({
  dependencies: Object.freeze({}) as Record<string, string>,
  devDependencies: Object.freeze({}) as Record<string, string>
});

/**
 * Narrows an untrusted `package.json` field to a string-valued record.
 *
 * Non-object values (a `"dependencies": "foo"` string, an array, null) are
 * discarded rather than trusted, and non-string version values are dropped so
 * downstream callers can rely on `Record<string, string>`.
 *
 * @param value - The raw parsed field.
 * @returns A record containing only own string-valued entries.
 */
function toDependencyRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [name, version] of Object.entries(value as Record<string, unknown>)) {
    if (typeof version === 'string') {
      out[name] = version;
    }
  }
  return out;
}

/**
 * Reads the current project's declared dependencies.
 *
 * Returns an empty result (rather than throwing) when there is no
 * `package.json`, when it cannot be stat'ed, or when it fails to parse —
 * detection is best-effort and must never break the CLI. It DOES throw for the
 * two conditions that indicate an attack or an unusable input: a path that
 * resolves outside the working directory, and a file over the size cap.
 *
 * @param options - Optional working directory / package.json path override.
 * @returns The project's `dependencies` and `devDependencies`.
 *
 * @throws {WizardError} `PATH_TRAVERSAL` if package.json resolves outside the working directory.
 * @throws {WizardError} `FILE_TOO_LARGE` if package.json exceeds {@link MAX_PACKAGE_JSON_SIZE}.
 * @throws {WizardError} `INVALID_PACKAGE_JSON` if package.json carries prototype-pollution markers.
 *
 * @example
 * ```ts
 * const { dependencies } = await readProjectDependencies();
 * if (dependencies.express) { ... }
 * ```
 */
export async function readProjectDependencies(options: ProjectDepsOptions = {}): Promise<ProjectDependencies> {
  // Bound the read here rather than at each call site. `stat` proves the path
  // is a regular file, but `readFile` re-opens it by NAME — a package.json
  // swapped for a FIFO in between blocks `open(2)` forever, and opening first
  // does not help because open blocks too. A timeout is the only primitive
  // that closes it, and putting it in the shared function means every caller
  // (framework detection AND the connector `installed` probe) is covered.
  return detectWithTimeout(() => readProjectDependenciesUnbounded(options), DETECTION_TIMEOUTS.framework, 'framework');
}

/**
 * The unbounded read. Exported for no one — {@link readProjectDependencies} is
 * the only entry point, and it applies the timeout.
 *
 * @param options - Optional working directory / package.json path override.
 * @returns The project's `dependencies` and `devDependencies`.
 */
async function readProjectDependenciesUnbounded(options: ProjectDepsOptions): Promise<ProjectDependencies> {
  // Resolve real paths to prevent symlink attacks (C-4 fix)
  const workingDir = await realpath(options.workingDir || cwd());
  const pkgPath = join(workingDir, options.packageJsonPath || 'package.json');

  let realPath: string;
  let size: number;
  try {
    realPath = await realpath(pkgPath);

    // SECURITY FIX: Validate path is within working directory (C-4 fix).
    // Defeats a symlinked package.json that points outside the project. See
    // cli/utils/path.ts and ADR-0003 for the `caseInsensitive` /
    // `allowRootItself` rationale (behaviour preserved from framework.ts).
    if (!isPathWithinRoot(realPath, workingDir, { caseInsensitive: true, allowRootItself: true })) {
      throw new WizardError(
        'PATH_TRAVERSAL',
        'package.json path resolved outside working directory',
        'Ensure package.json is within the project directory',
        undefined,
        1 // ERROR exit code
      );
    }

    const fileStat = await stat(realPath);
    // A FIFO reports size 0, sails under the size cap, and then blocks readFile
    // until a writer closes — unbounded. Only ever read a regular file.
    if (!fileStat.isFile()) {
      return EMPTY;
    }
    size = fileStat.size;
  } catch (error) {
    // A containment violation is an attack signal and must surface. Everything
    // else here — no package.json, a broken symlink, a permission-denied or
    // raced path — means "cannot read the manifest", which detection treats as
    // "nothing declared" rather than an error.
    if (error instanceof WizardError) {
      throw error;
    }
    return EMPTY;
  }

  // SECURITY FIX: Check file size before reading (MP-6 fix)
  if (size > MAX_PACKAGE_JSON_SIZE) {
    throw new WizardError(
      'FILE_TOO_LARGE',
      `package.json exceeds ${MAX_PACKAGE_JSON_SIZE} bytes`,
      'Remove unused dependencies or split your package.json',
      undefined,
      1 // ERROR exit code
    );
  }

  try {
    const content = await readFile(realPath, 'utf-8');

    // SECURITY FIX: secure-json-parse with protoAction/constructorAction removal (HP-6 fix)
    const pkg = parse(content, null, {
      protoAction: 'remove',
      constructorAction: 'remove'
    }) as Record<string, unknown>;

    // Additional validation: reject explicit prototype pollution markers that
    // survived as own properties.
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

    if (!pkg || typeof pkg !== 'object') {
      return EMPTY;
    }

    return {
      dependencies: toDependencyRecord(pkg.dependencies),
      devDependencies: toDependencyRecord(pkg.devDependencies)
    };
  } catch (error) {
    if (error instanceof WizardError) {
      throw error;
    }
    // Parse errors - return empty without exposing error details
    // (a parse error message can echo attacker-controlled file content)
    return EMPTY;
  }
}

/**
 * Looks a package up in a project's dependencies, checking `dependencies`
 * first and falling back to `devDependencies`.
 *
 * Uses an own-property check so a package named after an `Object.prototype`
 * member (`constructor`, `toString`) cannot resolve to an inherited value.
 *
 * @param deps - Result of {@link readProjectDependencies}.
 * @param name - The package name to look up.
 * @returns The declared version range, or undefined if absent.
 */
export function lookupDependency(deps: ProjectDependencies, name: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(deps.dependencies, name)) {
    return deps.dependencies[name];
  }
  if (Object.prototype.hasOwnProperty.call(deps.devDependencies, name)) {
    return deps.devDependencies[name];
  }
  return undefined;
}
