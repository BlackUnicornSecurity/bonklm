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
 * Sprint 51 (B.14, B.15, B.16):
 *  - `runDoctor` now validates that `cwd` is an existing directory before
 *    running any checks (B.14).
 *  - Added `checkEnvFile` and `checkPnpmAudit` checks (B.15).
 *  - Documented and enforced `--json` sanitization contract (B.16).
 *
 * @module commands/doctor
 */

import { Command } from 'commander';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
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
 * Check that a `.env` or `.env.example` file exists in the project root.
 *
 * Many BonkLM connectors and integrations require environment variables.
 * Absence of both files is a `warn` (not a hard failure) because downstream
 * consumers may inject env vars via their CI platform rather than file-based
 * secrets, but the absence is worth surfacing so contributors don't wonder
 * why their local run silently skips a connector.
 *
 * Status semantics:
 *  - `pass` — at least one of `.env` or `.env.example` exists.
 *  - `warn` — neither file exists; env vars may still be injected externally.
 *
 * @internal exported for tests
 */
export function checkEnvFile(cwd: string): DoctorCheckResult {
  const envPath = join(cwd, '.env');
  const examplePath = join(cwd, '.env.example');
  const hasEnv = existsSync(envPath);
  const hasExample = existsSync(examplePath);

  if (hasEnv || hasExample) {
    const found = [hasEnv ? '.env' : null, hasExample ? '.env.example' : null]
      .filter(Boolean)
      .join(' and ');
    return {
      name: 'env file',
      status: 'pass',
      message: `Found ${found} in project root.`,
    };
  }

  return {
    name: 'env file',
    status: 'warn',
    message:
      'Neither .env nor .env.example found in project root. Environment variables may need to be injected via CI or shell.',
    remediation:
      'Copy .env.example to .env and populate values, or ensure your CI platform injects the required environment variables.',
  };
}

/**
 * The subset of `spawnSync`'s return value that `checkPnpmAudit` needs.
 * Keeping a narrow interface lets tests pass a plain object without
 * reconstructing the full `SpawnSyncReturns<string>` type.
 *
 * @internal
 */
export interface SpawnResult {
  stdout: string;
  error?: Error;
}

/**
 * Run `pnpm audit --prod --audit-level=high --json` and surface the count
 * of HIGH or CRITICAL findings.
 *
 * Uses `spawnSync` with a 30-second timeout so the check is bounded. Degrades
 * gracefully to `warn` when `pnpm` is not on PATH or when the audit subprocess
 * times out, so a missing pnpm install does not hard-fail the doctor run.
 *
 * Status semantics:
 *  - `pass`  — zero HIGH/CRITICAL advisories in the prod dependency tree.
 *  - `warn`  — pnpm not on PATH, audit timed out, or output unparseable.
 *  - `fail`  — one or more HIGH/CRITICAL advisories found.
 *
 * @param cwd - Working directory for the audit subprocess.
 * @param _spawnFn - Optional spawn implementation; defaults to `spawnSync`
 *   from `node:child_process`. Accepts a plain `SpawnResult`-compatible value
 *   so tests can inject a stub without fighting ESM module sealing.
 *
 * @internal exported for tests
 */
export function checkPnpmAudit(
  cwd: string,
  _spawnFn: (cmd: string, args: string[], opts: object) => SpawnResult = (cmd, args, opts) =>
    spawnSync(cmd, args, opts as Parameters<typeof spawnSync>[2]) as SpawnResult,
): DoctorCheckResult {
  const result = _spawnFn('pnpm', ['audit', '--prod', '--audit-level=high', '--json'], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: process.env,
  });

  // spawnSync sets `error` when the binary cannot be found or the child was
  // killed (e.g. timeout). Treat both as a `warn` — the check cannot run but
  // that is not itself a security failure.
  if (result.error) {
    const errMsg = sanitizeLogString(result.error.message ?? 'unknown error');
    return {
      name: 'pnpm audit',
      status: 'warn',
      message: `pnpm audit could not run: ${errMsg}`,
      remediation: 'Ensure pnpm is installed and on PATH, then re-run `bonklm doctor`.',
    };
  }

  // pnpm audit exits 1 when advisories are found; that is expected. Parse the
  // JSON output regardless of exit code.
  const raw = result.stdout ?? '';
  let parsed: unknown;
  try {
    parsed = secureJsonParse(raw, null, { protoAction: 'remove', constructorAction: 'remove' });
  } catch {
    return {
      name: 'pnpm audit',
      status: 'warn',
      message: 'pnpm audit output could not be parsed as JSON.',
      remediation: 'Run `pnpm audit --prod --audit-level=high` manually to inspect findings.',
    };
  }

  // pnpm audit --json shape: { metadata: { vulnerabilities: { high: N, critical: N, ... } } }
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'metadata' in (parsed as object)
  ) {
    const metadata = (parsed as Record<string, unknown>).metadata;
    if (
      metadata !== null &&
      typeof metadata === 'object' &&
      'vulnerabilities' in (metadata as object)
    ) {
      const vulns = (metadata as Record<string, unknown>).vulnerabilities as Record<string, number>;
      const high = Number(vulns.high ?? 0);
      const critical = Number(vulns.critical ?? 0);
      const total = high + critical;
      if (total === 0) {
        return {
          name: 'pnpm audit',
          status: 'pass',
          message: 'No HIGH or CRITICAL advisories found in prod dependency tree.',
        };
      }
      return {
        name: 'pnpm audit',
        status: 'fail',
        message: `pnpm audit found ${total} HIGH/CRITICAL advisory(ies) (high: ${high}, critical: ${critical}).`,
        remediation:
          'Run `pnpm audit --prod --audit-level=high` to review findings and update affected dependencies.',
      };
    }
  }

  // Unknown shape — degrade to warn rather than crash.
  return {
    name: 'pnpm audit',
    status: 'warn',
    message: 'pnpm audit output had an unexpected shape; could not determine advisory count.',
    remediation: 'Run `pnpm audit --prod --audit-level=high` manually to inspect findings.',
  };
}

/**
 * Names of the BonkLM framework connectors that proxy ingress requests
 * through the validator pipeline. If any of these is installed without an
 * upstream rate limiter in front, the consumer's deployment is exposed to
 * the §A.5 attack described in `team/qa/1.0.0/09-security-addendum.md`
 * (10K req/s → validator pipeline).
 *
 * @internal
 */
const BONKLM_FRAMEWORK_CONNECTORS = [
  '@blackunicorn/bonklm-express',
  '@blackunicorn/bonklm-fastify',
  '@blackunicorn/bonklm-hono',
  '@blackunicorn/bonklm-elysia',
  '@blackunicorn/bonklm-nestjs',
  '@blackunicorn/bonklm-nextjs',
] as const;

/**
 * Allow-list of known upstream rate-limiter packages. If any of these is
 * present as a (dev)dependency alongside a BonkLM framework connector, the
 * doctor treats the rate-limiting concern as addressed.
 *
 * The list is intentionally conservative: deliberate inclusion only,
 * forward-compat with Cloudflare/Vercel KV-backed limiters (the architect
 * recommended Y for forward-compat in the ST-05-104 advisory §Open
 * questions #3).
 *
 * @internal
 */
const KNOWN_LIMITER_PACKAGES = [
  'express-rate-limit',
  '@fastify/rate-limit',
  'hono-rate-limiter',
  'elysia-rate-limit',
  '@nestjs/throttler',
  '@upstash/ratelimit',
  'rate-limiter-flexible',
] as const;

/**
 * Detect whether the consumer has a BonkLM framework connector installed
 * without a known upstream rate limiter, and surface the gap as a `warn`.
 *
 * B.5 / ST-05-104 (Sprint 51): the in-process `RateLimiter` exported from
 * `@blackunicorn/bonklm/security` is intentionally NOT wired as a default
 * because it is fictional in realistic v1.0 deployment shapes (multi-pod
 * Node behind LB, Cloudflare Workers, Vercel Edge). Instead, this doctor
 * check nudges consumers toward a real, distributed limiter at install
 * time. See `team/qa/1.0.0/evidence/gate-5/ST-05-104/ADVISORY.md` for the
 * three-option analysis and `docs/user/security/rate-limiting.md` for the
 * deployment-shape rationale.
 *
 * Status semantics:
 *  - `pass` — no BonkLM framework connector is installed (limiter is moot);
 *    OR a connector is installed AND a known limiter is present;
 *    OR `package.json` declares `{ "bonklm": { "rateLimit": "documented" } }`
 *    or `"external"` as an explicit acknowledgement.
 *  - `warn` — a BonkLM framework connector is installed but no known
 *    limiter package is present. The check is `warn`-only by design (per
 *    architect advisory §Open questions #2) — `fail` would block legitimate
 *    dev-environment installs.
 *
 * @internal exported for tests
 */
export function checkRateLimiterAdvisory(cwd: string): DoctorCheckResult {
  const packageJsonPath = join(cwd, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return {
      name: 'rate-limiter advisory',
      status: 'pass',
      message: 'No package.json found at cwd; rate-limiter advisory skipped.',
    };
  }

  let raw: string;
  try {
    raw = readFileSync(packageJsonPath, 'utf8');
  } catch (err) {
    const errMsg = sanitizeLogString((err as Error).message ?? 'unknown error');
    return {
      name: 'rate-limiter advisory',
      status: 'warn',
      message: `Could not read package.json: ${errMsg}`,
      remediation: 'Verify package.json is readable and re-run `bonklm doctor`.',
    };
  }

  let parsed: unknown;
  try {
    parsed = secureJsonParse(raw, null, { protoAction: 'remove', constructorAction: 'remove' });
  } catch {
    return {
      name: 'rate-limiter advisory',
      status: 'warn',
      message: 'package.json could not be parsed as JSON.',
      remediation: 'Run `node --check package.json` (or equivalent) to inspect.',
    };
  }

  if (parsed === null || typeof parsed !== 'object') {
    return {
      name: 'rate-limiter advisory',
      status: 'warn',
      message: 'package.json had an unexpected shape; rate-limiter advisory could not run.',
    };
  }

  const pkg = parsed as Record<string, unknown>;
  const deps = (pkg.dependencies ?? {}) as Record<string, unknown>;
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, unknown>;
  const allDeps = { ...deps, ...devDeps };

  const installedConnectors = BONKLM_FRAMEWORK_CONNECTORS.filter((name) => name in allDeps);
  if (installedConnectors.length === 0) {
    return {
      name: 'rate-limiter advisory',
      status: 'pass',
      message: 'No BonkLM framework connector installed; rate-limiter advisory is moot.',
    };
  }

  // Explicit consumer opt-out via package.json `bonklm.rateLimit` field.
  const bonklmField = pkg.bonklm;
  if (bonklmField !== null && typeof bonklmField === 'object') {
    const rateLimit = (bonklmField as Record<string, unknown>).rateLimit;
    if (rateLimit === 'documented' || rateLimit === 'external' || rateLimit === 'in-process') {
      return {
        name: 'rate-limiter advisory',
        status: 'pass',
        message: `Rate-limiting policy explicitly acknowledged in package.json ("bonklm.rateLimit": "${sanitizeLogString(String(rateLimit))}").`,
      };
    }
  }

  const installedLimiters = KNOWN_LIMITER_PACKAGES.filter((name) => name in allDeps);
  if (installedLimiters.length > 0) {
    return {
      name: 'rate-limiter advisory',
      status: 'pass',
      message: `Upstream rate limiter detected: ${installedLimiters.map((n) => sanitizeLogString(n)).join(', ')}.`,
    };
  }

  // Connector installed, no limiter, no opt-out → warn.
  const connectorList = installedConnectors.map((n) => sanitizeLogString(n)).join(', ');
  return {
    name: 'rate-limiter advisory',
    status: 'warn',
    message: `BonkLM framework connector(s) installed without a known upstream rate limiter: ${connectorList}.`,
    remediation:
      'Install one of: express-rate-limit, @fastify/rate-limit, hono-rate-limiter, elysia-rate-limit, @nestjs/throttler, @upstash/ratelimit, rate-limiter-flexible. See docs/user/security/rate-limiting.md. To suppress, set `bonklm.rateLimit` to `"documented"`, `"external"`, or `"in-process"` in package.json.',
  };
}

/**
 * Compose a doctor report from all registered checks.
 *
 * B.14 (Sprint 51): validates that `cwd` exists and is a directory before
 * running any check. An invalid `cwd` produces a report with a single
 * `cwd_invalid` check entry at `status: 'fail'` rather than running checks
 * that would silently produce misleading output.
 *
 * @param cwd - Working directory to inspect. Defaults to `process.cwd()`.
 * @param _auditSpawnFn - Optional injectable spawn used by `checkPnpmAudit`.
 *   Provided so callers (and tests) can control or elide the real pnpm
 *   subprocess without fighting ESM module sealing. When omitted, the real
 *   `spawnSync` is used.
 *
 * @internal Not part of the published `@blackunicorn/bonklm` surface
 * (see {@link DoctorCheckResult}).
 */
export function runDoctor(
  cwd: string = process.cwd(),
  _auditSpawnFn?: (cmd: string, args: string[], opts: object) => SpawnResult,
): DoctorReport {
  // B.14 — validate cwd existence and directory-ness at the boundary.
  // Non-existent paths or regular files silently produced misleading reports
  // before Sprint 51. Now we short-circuit with a clear failure entry.
  let cwdStat: ReturnType<typeof statSync> | null = null;
  try {
    cwdStat = statSync(cwd);
  } catch {
    cwdStat = null;
  }

  if (cwdStat === null || !cwdStat.isDirectory()) {
    const cwdDisplay = sanitizeLogString(cwd);
    const reason = cwdStat === null
      ? 'path does not exist'
      : 'path is not a directory';
    const invalidCheck: DoctorCheckResult = {
      name: 'cwd_invalid',
      status: 'fail',
      message: `runDoctor cwd is invalid (${reason}): ${cwdDisplay}`,
      remediation:
        'Pass an existing directory path to runDoctor(), or call it without arguments to use process.cwd().',
    };
    return { checks: [invalidCheck], overallStatus: 'fail' };
  }

  const checks: DoctorCheckResult[] = [
    checkPreCommitHook(cwd),
    checkEnvFile(cwd),
    checkPnpmAudit(cwd, _auditSpawnFn),
    checkRateLimiterAdvisory(cwd),
  ];

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
 * Render the doctor report as a machine-parseable JSON string.
 *
 * ### Sanitization contract (B.16, Sprint 51 — ADR-0001 alignment)
 *
 * All attacker-controllable strings that flow into `DoctorCheckResult`
 * fields (`.name`, `.message`, `.remediation`) originate from:
 *  - File-system paths read via `resolveHooksPath` — passed through
 *    `sanitizeLogString` at the variable-binding site before entering
 *    any `DoctorCheckResult`.
 *  - User-supplied `cwd` argument — sanitized in the `cwd_invalid` check
 *    entry produced by `runDoctor`.
 *  - `package.json` `simple-git-hooks.pre-commit` values — sanitized via
 *    `configuredDisplay` before entering any message string.
 *  - Error messages from `readFileSync` — sanitized via `sanitizeLogString`
 *    at their respective catch sites.
 *  - `pnpm audit` output — parsed as JSON by `secureJsonParse`; numeric
 *    fields only are reflected into the message (no raw string pass-through).
 *
 * `sanitizeLogString` hex-escapes C0/C1 control characters, newlines, CR,
 * U+2028, U+2029, and Unicode bidi-override/isolate code points
 * (U+202A..U+202E, U+2066..U+2069). After sanitization:
 *  - No string field in the JSON output contains raw newlines that would
 *    break JSON parsing or split a log line in a SIEM ingestor.
 *  - No string field contains raw ANSI escape sequences that could corrupt
 *    a terminal or a structured-log viewer.
 *  - Callers may safely pass the output to `JSON.parse` with strict mode.
 *
 * **Future contributors**: any new check function that reflects a
 * user-controllable string into a `DoctorCheckResult` field MUST pass that
 * string through `sanitizeLogString` before including it in `.message` or
 * `.remediation`. The raw value (needed for filesystem operations) must be
 * kept in a separate binding.
 */
function renderJson(report: DoctorReport): string {
  // All strings in `report` are already sanitized at their origin sites.
  // JSON.stringify is safe: the sanitized strings contain no raw control
  // characters that could escape a JSON string literal.
  return JSON.stringify(report, null, 2);
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
      console.log(renderJson(report));
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
