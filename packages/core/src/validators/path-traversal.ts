/**
 * Story 3.2 — PathTraversalValidator (CORE)
 * ==========================================
 * Rejects:
 *  - `..` traversal (Unix + Windows + single/double URL-encoded + null-byte)
 *  - Absolute paths outside the configured `cwd`
 *  - Symlink targets that escape `cwd` (only when `checkSymlinks: true`;
 *    requires fs access — NOT safe in edge runtimes).
 *
 * Strict mode: ANY `..` segment is rejected, even when the path resolves
 * cleanly inside cwd. This trades a small false-positive surface for
 * defeating the resolve-clean trick.
 *
 * **Surface vocab** (R2-10): result.metadata.surface = 'text_input'.
 *
 * **First-line defence ONLY** (consistent with `CodeInjectionValidator`):
 * filesystem chroot / jail is the true containment. This validator
 * cuts the volume of escaping paths that reach the sandbox.
 */
import type { Validator, ValidatorInput, HookSurface } from '../engine/GuardrailEngine.types.js';
import {
  createResult,
  type GuardrailResult,
  Severity,
  type Finding,
} from '../base/GuardrailResult.js';
import { resolve as pathResolve, isAbsolute as pathIsAbsolute, sep as pathSep } from 'node:path';
import { unwrapValidatorInput, scoreToRiskLevel } from './internal/unwrap-input.js';

const SURFACE: HookSurface = 'text_input';

export interface PathTraversalValidatorConfig {
  /**
   * Containment root. ALL paths must resolve inside this directory.
   * Required — there is no safe default.
   */
  cwd: string;
  /**
   * When true, the validator calls `fs.realpathSync` to resolve
   * symlinks and verify the target stays inside `cwd`. Default
   * `false` — keeps the validator edge-runtime safe.
   */
  checkSymlinks?: boolean;
}

export class PathTraversalValidator implements Validator {
  readonly name = 'path_traversal';
  private readonly cwd: string;
  private readonly checkSymlinks: boolean;

  constructor(config: PathTraversalValidatorConfig) {
    if (!config || typeof config.cwd !== 'string' || config.cwd.length === 0) {
      throw new TypeError(
        'PathTraversalValidator: config.cwd is required (non-empty string).'
      );
    }
    this.cwd = pathResolve(config.cwd);
    this.checkSymlinks = config.checkSymlinks ?? false;
  }

  async validate(input: string | ValidatorInput): Promise<GuardrailResult> {
    const content = unwrapValidatorInput(input, 'PathTraversalValidator');
    return this.validateString(content);
  }

  private async validateString(content: string): Promise<GuardrailResult> {
    const findings: Finding[] = [];

    // 1. Null byte (defeats many path-truncation parsers).
    if (content.includes('\x00')) {
      findings.push({
        category: 'path_traversal_nullbyte',
        severity: Severity.CRITICAL,
        description: 'Path contains a null byte (path-truncation attack)',
        weight: 10,
      });
    }

    // 2. URL-decoded `..` scan (single + double decode).
    const decoded = tryDecode(content);
    const doubleDecoded = tryDecode(decoded);

    if (hasDotDotSegment(content) || hasDotDotSegment(decoded) || hasDotDotSegment(doubleDecoded)) {
      findings.push({
        category: 'path_traversal_dotdot',
        severity: Severity.CRITICAL,
        description: 'Path contains `..` traversal segment',
        weight: 10,
      });
    }

    // 3. Absolute path outside cwd (Unix + Windows).
    if (isAbsoluteUnixOrWindows(content)) {
      const resolved = safeResolve(content, this.cwd);
      if (resolved && !isInside(resolved, this.cwd)) {
        findings.push({
          category: 'path_traversal_absolute_outside',
          severity: Severity.CRITICAL,
          description: `Absolute path '${content}' resolves outside cwd '${this.cwd}'`,
          weight: 10,
        });
      }
    }

    // 4. Symlink check (opt-in; uses fs).
    if (this.checkSymlinks && findings.length === 0) {
      try {
        const fs = await import('node:fs');
        // Realpath BOTH sides so macOS `/var → /private/var` (and any
        // other parent-chain symlink under cwd) doesn't produce false
        // positives. Without realpath-ing cwd, a symlink target whose
        // resolved path lives under `/private/var/...` while cwd is
        // `/var/...` would appear to escape.
        const realCwd = fs.realpathSync(this.cwd);
        const resolved = fs.realpathSync(pathResolve(this.cwd, content));
        // Audit closure code-reviewer BLOCK-1: use sep-bounded inside
        // check, NOT raw startsWith. Defeats `/srv/app` vs `/srv/app-evil`
        // prefix-collision bypass.
        if (!isInside(resolved, realCwd)) {
          findings.push({
            category: 'path_traversal_symlink_escape',
            severity: Severity.CRITICAL,
            description: `Symlink target '${resolved}' escapes cwd '${realCwd}'`,
            weight: 10,
          });
        }
      } catch {
        // Audit closure security CONCERN-3: fail-SECURE on realpath
        // error. Previous behaviour silently allowed dangling symlinks /
        // permission errors through, converting infrastructure errors
        // into security bypasses in sandbox contexts.
        findings.push({
          category: 'path_traversal_symlink_check_error',
          severity: Severity.CRITICAL,
          description: 'Symlink resolution failed — treating as potential escape (fail-secure)',
          weight: 10,
        });
      }
    }

    const blocked = findings.length > 0;
    const worst = findings.length > 0 ? Severity.CRITICAL : Severity.INFO;
    const score = findings.reduce((s, f) => s + (f.weight ?? 0), 0);

    const result = createResult(!blocked, worst, findings);
    result.risk_score = score;
    result.risk_level = scoreToRiskLevel(score);
    result.metadata = { surface: SURFACE };
    return result;
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Sep-bounded containment check (code-reviewer BLOCK-1 fix).
 * `'/srv/app-evil'.startsWith('/srv/app')` is true but `app-evil` is
 * NOT inside `app`. Require either exact match OR `parent + sep`
 * prefix.
 */
function isInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  const bound = parent.endsWith(pathSep) ? parent : parent + pathSep;
  return child.startsWith(bound);
}

function tryDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function hasDotDotSegment(s: string): boolean {
  // Match `..` as a path segment:
  //  - between slashes / at start, OR at end (`/(^|[/\\])\.\.([/\\]|$)/`)
  //  - OR `..` immediately followed by a path separator anywhere
  //    (`/\.\.[/\\]/`) — catches `..` inside quoted JSON args / tool_call
  //    payloads where the leading boundary is `"` rather than a slash.
  return /(^|[/\\])\.\.([/\\]|$)/.test(s) || /\.\.[/\\]/.test(s);
}

function isAbsoluteUnixOrWindows(s: string): boolean {
  if (pathIsAbsolute(s)) return true;
  // Windows drive letter (path.isAbsolute checks platform-dependent — on
  // POSIX, "C:\\..." returns false; we want to catch it cross-platform).
  return /^[A-Za-z]:[\\/]/.test(s);
}

function safeResolve(p: string, _cwd: string): string | null {
  try {
    // For Windows drive-letter paths on POSIX, path.resolve returns
    // `${cwd}/C:\\...` which is meaningless. Treat as outside cwd by
    // returning a synthetic absolute string that does not start with cwd.
    if (/^[A-Za-z]:[\\/]/.test(p)) {
      return p; // never starts with cwd (which is POSIX-rooted).
    }
    return pathResolve(p);
  } catch {
    return null;
  }
}

