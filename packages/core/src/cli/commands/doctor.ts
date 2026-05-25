/**
 * Doctor Command
 *
 * Diagnoses the local BonkLM contributor environment and reports any
 * configuration drift that would surface as a confusing error later
 * (a typecheck error from a missing pre-commit hook, a stale generated
 * file, a misconfigured env). Designed to be cheap to run and safe in
 * any working directory — no mutations, no network, no spawning of
 * tools that may not be installed.
 *
 * Sprint 50: ships with a single check — pre-commit hook installation
 * — closing architect M-2 from Sprint 41. Future sprints can append
 * additional checks to {@link runDoctor} without changing the public
 * command surface.
 *
 * @module commands/doctor
 */

import { Command } from 'commander';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parse as secureJsonParse } from 'secure-json-parse';

import { sanitizeLogString } from '../../common/index.js';

const STATUS_GLYPH = {
  pass: '✓',
  warn: '⚠',
  fail: '✗',
} as const;

/**
 * Outcome of a single doctor check.
 *
 * @internal Doctor types are reachable via the `cli/commands/index.ts`
 * barrel for in-tree consumers (tests, future internal callers) but
 * NOT through any `package.json` `exports` subpath — they are not
 * part of the published `@blackunicorn/bonklm` surface.
 */
export interface DoctorCheckResult {
  /** Human-readable check identifier (rendered as the row label). */
  readonly name: string;
  /** PASS / WARN / FAIL signal. FAIL drives `process.exit(1)`. */
  readonly status: 'pass' | 'warn' | 'fail';
  /** Single-line explanation of the outcome. */
  readonly message: string;
  /**
   * Optional remediation hint. Always set on WARN / FAIL so the user
   * has a concrete next action.
   */
  readonly remediation?: string;
}

/**
 * Aggregated doctor report.
 *
 * @internal Not part of the published `@blackunicorn/bonklm` surface
 * (see {@link DoctorCheckResult}).
 */
export interface DoctorReport {
  readonly checks: readonly DoctorCheckResult[];
  /**
   * Aggregate status — `fail` if any check failed, else `warn` if any
   * check warned, else `pass`. Drives the CLI exit code: `fail` →
   * `process.exit(1)`, both `warn` and `pass` → exit 0.
   */
  readonly overallStatus: 'pass' | 'warn' | 'fail';
}

/**
 * Resolve the configured git hooks path for a working tree.
 *
 * Reads `core.hooksPath` from `.git/config` (the only path git honours
 * for hook discovery) and falls back to the default `.git/hooks`.
 * Reading the config file directly (rather than invoking `git config`)
 * keeps the doctor runnable inside environments without git on PATH —
 * e.g. minimal Docker images.
 *
 * Returns `null` if the cwd is not inside a git working tree.
 *
 * @internal exported for tests
 */
export function resolveHooksPath(cwd: string): string | null {
  const gitDir = join(cwd, '.git');
  if (!existsSync(gitDir)) {
    return null;
  }

  // `.git` may be a directory (regular checkout) or a file (worktree
  // / submodule). For now we honour the directory case and treat the
  // file case as "default hooks path" — worktree hook discovery is
  // out of scope for the M-2 check.
  let isDir = false;
  try {
    isDir = statSync(gitDir).isDirectory();
  } catch {
    return null;
  }

  if (!isDir) {
    // Worktree / submodule. Conservative fallback: assume default
    // `.git/hooks` relative path resolves correctly when git invokes
    // the hook. The actual hook file may live elsewhere, but absence
    // of that file is still a useful signal — see the check below.
    return join(gitDir, 'hooks');
  }

  const defaultPath = join(gitDir, 'hooks');
  const configPath = join(gitDir, 'config');
  if (!existsSync(configPath)) {
    return defaultPath;
  }

  try {
    const config = readFileSync(configPath, 'utf8');
    // Match `hooksPath = <value>` ONLY when it appears inside a `[core]`
    // section. Sprint 50 audit (architect M-2 + code-review MUST-FIX 2):
    // the previous regex matched the key under any section header, so a
    // stray `hooksPath = …` under `[alias]` / `[remote "origin"]` /
    // third-party tool sections would silently win. Git itself only
    // honours `core.hooksPath`; the doctor must match git's behaviour.
    //
    // Strategy: isolate the body of every `[core]` (or `[core "subkey"]`)
    // section, then search within that slice. We accept the `[core
    // "subkey"]` variant for forward-compat with newer git, even though
    // current git emits a flat `[core]`.
    const coreSection =
      /\[core(?:\s+"[^"]*")?\][^[]*/gi
        .exec(config)?.[0] ?? '';
    const match = /^\s*hooksPath\s*=\s*(.+?)\s*$/im.exec(coreSection);
    if (!match) {
      return defaultPath;
    }
    const value = match[1].trim();
    return isAbsolute(value) ? value : resolve(cwd, value);
  } catch {
    return defaultPath;
  }
}

/**
 * Extract the `simple-git-hooks.pre-commit` directive from a project's
 * root `package.json`. Returns `null` if the package.json is missing,
 * unparseable, or does not declare a `simple-git-hooks` section with
 * a `pre-commit` entry.
 *
 * @internal exported for tests
 */
export function readConfiguredPreCommit(cwd: string): string | null {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    return null;
  }
  try {
    const raw = readFileSync(pkgPath, 'utf8');
    // Sprint 50 audit (architect L-1): consistency with the rest of
    // the cli/detection layer which uses secure-json-parse for
    // prototype-pollution defence. Cheap; mandatory across boundaries.
    const parsed = secureJsonParse(raw, null, {
      protoAction: 'remove',
      constructorAction: 'remove',
    }) as { 'simple-git-hooks'?: unknown };
    const cfg = parsed['simple-git-hooks'];
    // Array.isArray check excludes arrays (which are `typeof === 'object'`)
    // — `simple-git-hooks: ["pnpm typecheck"]` is malformed and must
    // return null, not silently index into the array.
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
      return null;
    }
    const cmd = (cfg as Record<string, unknown>)['pre-commit'];
    return typeof cmd === 'string' && cmd.trim().length > 0 ? cmd : null;
  } catch {
    return null;
  }
}

/**
 * Verify the simple-git-hooks pre-commit hook is installed and
 * matches the command declared in the project's `package.json`.
 *
 * Status semantics:
 *  - `pass` — hook file exists and contains the configured command.
 *  - `warn` — informational mismatch only: package.json declares a
 *    pre-commit but the project is not a git repo, OR the project
 *    is a repo but does not declare a simple-git-hooks pre-commit
 *    (legitimate for downstream consumers of
 *    `@blackunicorn/bonklm`). These cases do not represent a
 *    broken enforcement contract.
 *  - `fail` — the contributor's `pre-commit = pnpm typecheck`
 *    enforcement IS supposed to be on but is NOT actually in
 *    effect. Covers three sub-cases: hook file missing, hook file
 *    unreadable, OR hook file present but its body does not contain
 *    the configured command (stale install — package.json updated
 *    after the postinstall ran). All three produce
 *    `process.exit(1)` so CI gates relying on `bonklm doctor` catch
 *    the broken state. Sprint 50 audit (architect M-3 + code-review
 *    SHOULD-FIX 3): the previous WARN classification for stale
 *    hooks silently passed CI; promoted to FAIL because the
 *    contributor mental model ("hook installed = protected") must
 *    hold.
 *
 * @internal exported for tests
 */
export function checkPreCommitHook(cwd: string): DoctorCheckResult {
  const configuredRaw = readConfiguredPreCommit(cwd);
  const hooksPath = resolveHooksPath(cwd);

  if (!configuredRaw && !hooksPath) {
    return {
      name: 'pre-commit hook',
      status: 'warn',
      message:
        'Not a git repo and no simple-git-hooks pre-commit declared — nothing to verify.',
      remediation:
        'If you intend to use BonkLM as a contributor, clone the repo with `git clone` and run `pnpm install`.',
    };
  }

  if (!configuredRaw) {
    return {
      name: 'pre-commit hook',
      status: 'warn',
      message:
        'No `simple-git-hooks.pre-commit` directive in package.json — nothing to enforce locally.',
      remediation:
        'This is expected for downstream consumers of `@blackunicorn/bonklm`. Internal contributors should run from the BonkLM repo root.',
    };
  }

  if (!hooksPath) {
    return {
      name: 'pre-commit hook',
      status: 'warn',
      message:
        'package.json declares a simple-git-hooks pre-commit but the cwd is not a git working tree.',
      remediation:
        'Run the doctor from the project root containing `.git/`. If you cloned via a tarball, re-clone with `git clone` so the pre-commit hook can install.',
    };
  }

  // Sprint 50 audit (security HIGH + MEDIUM): both `hooksPath` (from
  // `.git/config`) and `configuredRaw` (from `package.json`) cross a
  // trust boundary — a hostile repo could put control chars / ANSI
  // sequences into either. The raw values must reach `existsSync` /
  // `readFileSync` / `.includes()` (those operations need the actual
  // bytes), but the rendered `DoctorCheckResult.message` flows to
  // `console.log` and from there into CI logs / SIEM ingestors.
  // Sanitize at the variable-binding site, consistent with the
  // Sprint 44 / 46 / 49 ADR-0001 pattern. `hookFileDisplay` and
  // `configuredDisplay` are used ONLY in message strings; the raw
  // bindings (`hookFile`, `configuredRaw`) drive the real fs ops
  // and the body-content `.includes()` check.
  const hookFile = join(hooksPath, 'pre-commit');
  const hookFileDisplay = sanitizeLogString(hookFile);
  const configuredDisplay = sanitizeLogString(configuredRaw);

  if (!existsSync(hookFile)) {
    return {
      name: 'pre-commit hook',
      status: 'fail',
      message: `Pre-commit hook missing at ${hookFileDisplay}.`,
      remediation:
        'Run `pnpm install` to install pre-commit hooks via the simple-git-hooks postinstall step.',
    };
  }

  let body: string;
  try {
    body = readFileSync(hookFile, 'utf8');
  } catch (error) {
    const errMessage = sanitizeLogString(
      error instanceof Error ? error.message : 'unknown error'
    );
    return {
      name: 'pre-commit hook',
      status: 'fail',
      message: `Pre-commit hook unreadable at ${hookFileDisplay}: ${errMessage}.`,
      remediation:
        'Check file permissions, then run `pnpm install` to reinstall the pre-commit hook.',
    };
  }

  if (!body.includes(configuredRaw)) {
    return {
      name: 'pre-commit hook',
      // Sprint 50 audit (architect M-3 + code-review SHOULD-FIX 3):
      // promoted from WARN to FAIL. A stale hook is functionally
      // identical to a missing hook — the contributor's typecheck
      // does not run on commit. WARN would silently pass CI.
      status: 'fail',
      message: `Pre-commit hook installed at ${hookFileDisplay} but its body does not reference the configured command (\`${configuredDisplay}\`).`,
      remediation:
        'package.json was likely updated after the hook was installed. Re-run `pnpm install` to refresh the hook.',
    };
  }

  return {
    name: 'pre-commit hook',
    status: 'pass',
    message: `Pre-commit hook installed at ${hookFileDisplay} and references \`${configuredDisplay}\`.`,
  };
}

/**
 * Compose a doctor report from all registered checks.
 *
 * @internal Not part of the published `@blackunicorn/bonklm` surface
 * (see {@link DoctorCheckResult}).
 */
export function runDoctor(cwd: string = process.cwd()): DoctorReport {
  const checks: DoctorCheckResult[] = [checkPreCommitHook(cwd)];

  let overallStatus: 'pass' | 'warn' | 'fail' = 'pass';
  for (const check of checks) {
    if (check.status === 'fail') {
      overallStatus = 'fail';
      break;
    }
    if (check.status === 'warn') {
      overallStatus = 'warn';
    }
  }

  return { checks, overallStatus };
}

function renderHuman(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('═'.repeat(50));
  lines.push('  BonkLM Doctor');
  lines.push('═'.repeat(50));
  lines.push('');

  for (const check of report.checks) {
    lines.push(`${STATUS_GLYPH[check.status]} ${check.name}`);
    lines.push(`  ${check.message}`);
    if (check.remediation) {
      lines.push(`  → ${check.remediation}`);
    }
    lines.push('');
  }

  lines.push('═'.repeat(50));
  lines.push(`  Overall: ${report.overallStatus.toUpperCase()}`);
  lines.push('═'.repeat(50));
  lines.push('');

  return lines.join('\n');
}

interface DoctorOptions {
  json: boolean;
}

/**
 * Doctor command implementation.
 */
export const doctorCommand = new Command('doctor')
  .description(
    'Diagnose the local BonkLM contributor environment (pre-commit hook installation, etc.)'
  )
  .option('--json', 'Output in JSON format')
  .action((options: DoctorOptions) => {
    const report = runDoctor();

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderHuman(report));
    }

    if (report.overallStatus === 'fail') {
      // Sprint 50 audit (code-review MUST-FIX 1): `process.exit(1)`
      // is deterministic and unaffected by future harness changes
      // that might call `process.exit(0)` after `program.parse()`.
      // For a command whose purpose is to drive CI gates, the
      // immediate-exit form is the only correct choice.
      process.exit(1);
    }
  });
