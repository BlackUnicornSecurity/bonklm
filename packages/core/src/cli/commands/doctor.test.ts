/**
 * Doctor Command Tests
 *
 * Sprint 50: covers the pre-commit hook check + the surrounding
 * primitives (`resolveHooksPath`, `readConfiguredPreCommit`,
 * `runDoctor` aggregation). Creates ephemeral fixture directories
 * under `os.tmpdir()` so each test exercises the real filesystem
 * code paths without touching the project's own `.git/`.
 *
 * Sprint 51 (B.14, B.15, B.16):
 *  - `runDoctor` cwd validation tests (non-existent path, file-not-dir).
 *  - `checkEnvFile` happy path + failure path.
 *  - `checkPnpmAudit` happy path + failure path (uses injectable _spawnFn).
 *  - `--json` round-trip sanitization test (ANSI escapes, embedded newlines).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkEnvFile,
  checkPnpmAudit,
  checkPreCommitHook,
  checkRateLimiterAdvisory,
  doctorCommand,
  readConfiguredPreCommit,
  resolveHooksPath,
  runDoctor,
  type SpawnResult,
} from './doctor.js';

// ---------------------------------------------------------------------------
// Helpers for checkPnpmAudit injectable spawn stubs (avoids ESM module seal)
// ---------------------------------------------------------------------------

function makePassAuditSpawn(): (cmd: string, args: string[], opts: object) => SpawnResult {
  return () => ({
    stdout: JSON.stringify({
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } },
    }),
  });
}

function makeFailAuditSpawn(
  high: number,
  critical: number,
): (cmd: string, args: string[], opts: object) => SpawnResult {
  return () => ({
    stdout: JSON.stringify({
      metadata: { vulnerabilities: { info: 0, low: 1, moderate: 2, high, critical } },
    }),
  });
}

function makeErrorAuditSpawn(
  errMsg: string,
): (cmd: string, args: string[], opts: object) => SpawnResult {
  return () => ({ stdout: '', error: new Error(errMsg) });
}

function makeBadJsonAuditSpawn(): (cmd: string, args: string[], opts: object) => SpawnResult {
  return () => ({ stdout: 'not valid json {{{' });
}

function makeFixture(): string {
  return mkdtempSync(join(tmpdir(), 'bonklm-doctor-'));
}

function writePackageJson(cwd: string, body: Record<string, unknown>): void {
  writeFileSync(join(cwd, 'package.json'), JSON.stringify(body, null, 2));
}

/**
 * Materialise a minimal `.git/` skeleton at `cwd` with the given
 * optional `[core] hooksPath` directive in `.git/config`.
 */
function writeGitDir(cwd: string, hooksPathOverride?: string): string {
  const gitDir = join(cwd, '.git');
  mkdirSync(gitDir, { recursive: true });
  mkdirSync(join(gitDir, 'hooks'), { recursive: true });
  const configBody = hooksPathOverride
    ? `[core]\n\trepositoryformatversion = 0\n\thooksPath = ${hooksPathOverride}\n`
    : `[core]\n\trepositoryformatversion = 0\n`;
  writeFileSync(join(gitDir, 'config'), configBody);
  return gitDir;
}

describe('resolveHooksPath', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = makeFixture();
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns null when cwd is not a git working tree', () => {
    expect(resolveHooksPath(cwd)).toBeNull();
  });

  it('returns the default `.git/hooks` when no override is configured', () => {
    writeGitDir(cwd);
    expect(resolveHooksPath(cwd)).toBe(join(cwd, '.git', 'hooks'));
  });

  it('honours an absolute `core.hooksPath` override', () => {
    const overrideRoot = makeFixture();
    try {
      writeGitDir(cwd, overrideRoot);
      expect(resolveHooksPath(cwd)).toBe(overrideRoot);
    } finally {
      rmSync(overrideRoot, { recursive: true, force: true });
    }
  });

  it('resolves a relative `core.hooksPath` against the cwd', () => {
    writeGitDir(cwd, '.githooks');
    expect(resolveHooksPath(cwd)).toBe(join(cwd, '.githooks'));
  });

  it('falls back to default when .git/config is unreadable JSON-style noise', () => {
    const gitDir = join(cwd, '.git');
    mkdirSync(join(gitDir, 'hooks'), { recursive: true });
    // git config files are ini-style; a noisy file should not panic
    // the parser.
    writeFileSync(join(gitDir, 'config'), 'not a real ini file ###');
    expect(resolveHooksPath(cwd)).toBe(join(gitDir, 'hooks'));
  });

  it('ignores hooksPath under a non-[core] section (Sprint 50 audit MUST-FIX 2)', () => {
    const gitDir = join(cwd, '.git');
    mkdirSync(join(gitDir, 'hooks'), { recursive: true });
    // A hostile or malformed config that puts `hooksPath` under a
    // non-`[core]` section MUST be ignored — git itself only honours
    // `core.hooksPath`. Pre-Sprint-50 the regex matched the key
    // under any section, so this case would have wrongly resolved
    // to `/attacker/path`.
    writeFileSync(
      join(gitDir, 'config'),
      '[remote "origin"]\n\thooksPath = /attacker/path\n[core]\n\trepositoryformatversion = 0\n'
    );
    expect(resolveHooksPath(cwd)).toBe(join(gitDir, 'hooks'));
  });

  it('honours hooksPath when the [core] section appears after another section', () => {
    const gitDir = join(cwd, '.git');
    mkdirSync(join(gitDir, 'hooks'), { recursive: true });
    writeFileSync(
      join(gitDir, 'config'),
      '[remote "origin"]\n\turl = git@example.com:x.git\n[core]\n\thooksPath = .githooks\n'
    );
    expect(resolveHooksPath(cwd)).toBe(join(cwd, '.githooks'));
  });

  it('treats `.git` as worktree-marker file and falls back to default hooks path', () => {
    // Worktree / submodule layout: `.git` is a FILE pointing at the
    // real gitdir. We do not chase that pointer — just fall back to
    // the default relative `.git/hooks` location.
    writeFileSync(join(cwd, '.git'), 'gitdir: /some/other/gitdir\n');
    expect(resolveHooksPath(cwd)).toBe(join(cwd, '.git', 'hooks'));
  });
});

describe('readConfiguredPreCommit', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = makeFixture();
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns null when package.json is absent', () => {
    expect(readConfiguredPreCommit(cwd)).toBeNull();
  });

  it('returns null when package.json has no simple-git-hooks section', () => {
    writePackageJson(cwd, { name: 'whatever' });
    expect(readConfiguredPreCommit(cwd)).toBeNull();
  });

  it('returns null when simple-git-hooks lacks a pre-commit entry', () => {
    writePackageJson(cwd, {
      name: 'whatever',
      'simple-git-hooks': { 'pre-push': 'pnpm test' },
    });
    expect(readConfiguredPreCommit(cwd)).toBeNull();
  });

  it('returns the configured command when present', () => {
    writePackageJson(cwd, {
      name: 'whatever',
      'simple-git-hooks': { 'pre-commit': 'pnpm typecheck' },
    });
    expect(readConfiguredPreCommit(cwd)).toBe('pnpm typecheck');
  });

  it('returns null when package.json is unparseable', () => {
    writeFileSync(join(cwd, 'package.json'), '{ not valid json');
    expect(readConfiguredPreCommit(cwd)).toBeNull();
  });

  it('returns null when pre-commit value is empty', () => {
    writePackageJson(cwd, {
      name: 'whatever',
      'simple-git-hooks': { 'pre-commit': '   ' },
    });
    expect(readConfiguredPreCommit(cwd)).toBeNull();
  });

  it('returns null when simple-git-hooks is a string (malformed shape)', () => {
    writePackageJson(cwd, {
      name: 'whatever',
      'simple-git-hooks': 'oops',
    });
    expect(readConfiguredPreCommit(cwd)).toBeNull();
  });

  it('returns null when simple-git-hooks is an array (malformed shape)', () => {
    writePackageJson(cwd, {
      name: 'whatever',
      'simple-git-hooks': ['pnpm typecheck'],
    });
    expect(readConfiguredPreCommit(cwd)).toBeNull();
  });
});

describe('checkPreCommitHook', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = makeFixture();
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('PASS when hook installed and contains the configured command', () => {
    writePackageJson(cwd, {
      name: 'whatever',
      'simple-git-hooks': { 'pre-commit': 'pnpm typecheck' },
    });
    writeGitDir(cwd);
    writeFileSync(
      join(cwd, '.git', 'hooks', 'pre-commit'),
      '#!/usr/bin/env sh\npnpm typecheck\n'
    );

    const result = checkPreCommitHook(cwd);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('pre-commit');
    expect(result.message).toContain('pnpm typecheck');
    expect(result.remediation).toBeUndefined();
  });

  it('FAIL when hook is missing entirely', () => {
    writePackageJson(cwd, {
      name: 'whatever',
      'simple-git-hooks': { 'pre-commit': 'pnpm typecheck' },
    });
    writeGitDir(cwd);

    const result = checkPreCommitHook(cwd);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('missing');
    expect(result.remediation).toContain('pnpm install');
  });

  it('FAIL when hook installed but does not reference the configured command (Sprint 50 audit MUST-FIX 3)', () => {
    writePackageJson(cwd, {
      name: 'whatever',
      'simple-git-hooks': { 'pre-commit': 'pnpm typecheck' },
    });
    writeGitDir(cwd);
    writeFileSync(
      join(cwd, '.git', 'hooks', 'pre-commit'),
      '#!/usr/bin/env sh\necho "stale hook"\n'
    );

    // Sprint 50 promotion: a stale hook is functionally identical to
    // a missing hook from the contributor's perspective — the
    // configured typecheck does not run on commit. WARN would
    // silently pass any CI gate keyed on the exit code.
    const result = checkPreCommitHook(cwd);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('does not reference');
    expect(result.remediation).toContain('pnpm install');
  });

  it('sanitizes control chars in rendered hookFile + configured command (Sprint 50 audit HIGH/MEDIUM)', () => {
    // A hostile `.git/config` with control chars in `core.hooksPath`
    // and a hostile `package.json` `pre-commit` value: both reach
    // `DoctorCheckResult.message`. Without sanitization, the rendered
    // stdout would carry the CR/LF/ESC sequences into any CI log
    // ingestor that consumes the doctor output.
    writePackageJson(cwd, {
      name: 'whatever',
      'simple-git-hooks': { 'pre-commit': 'pnpm\ttypecheck' },
    });
    const gitDir = join(cwd, '.git');
    mkdirSync(join(gitDir, 'hooks'), { recursive: true });
    // hooksPath value with embedded newline: pre-Sprint-50 fix this
    // would inject a fake log line.
    writeFileSync(
      join(gitDir, 'config'),
      `[core]\n\thooksPath = .hooks\nINJECTED_LOG_LINE\n`
    );
    mkdirSync(join(cwd, '.hooks'), { recursive: true });

    const result = checkPreCommitHook(cwd);
    // Output is FAIL (hook missing at .hooks/pre-commit). What we
    // assert here is the rendered message contains NO raw control
    // chars — the path renders sanitized, the command renders
    // sanitized.
    expect(result.message).not.toMatch(/[\r\n\t\x00-\x08\x0b-\x1f\x7f]/);
    // Configured command's TAB renders as the hex-escape marker.
    // (Only present in the stale-hook branch; here we test the
    // missing-hook branch — so just assert no control chars
    // survive the sanitize layer.)
  });

  it('sanitizes control chars in stale-hook message including configured command (Sprint 50 audit MEDIUM)', () => {
    writePackageJson(cwd, {
      name: 'whatever',
      'simple-git-hooks': { 'pre-commit': 'pnpm\ttypecheck' },
    });
    writeGitDir(cwd);
    writeFileSync(
      join(cwd, '.git', 'hooks', 'pre-commit'),
      '#!/usr/bin/env sh\necho "stale hook"\n'
    );

    const result = checkPreCommitHook(cwd);
    expect(result.status).toBe('fail');
    // The TAB in `pnpm\ttypecheck` hex-escapes to `\x09` per
    // sanitizeLogString — proves the configured-command sink got the
    // sanitize wrap.
    expect(result.message).toContain('pnpm\\x09typecheck');
    expect(result.message).not.toMatch(/[\r\n\t\x00-\x08\x0b-\x1f\x7f]/);
  });

  it('WARN when project declares pre-commit but cwd is not a git repo', () => {
    writePackageJson(cwd, {
      name: 'whatever',
      'simple-git-hooks': { 'pre-commit': 'pnpm typecheck' },
    });

    const result = checkPreCommitHook(cwd);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('not a git working tree');
  });

  it('WARN when no simple-git-hooks directive but cwd is a git repo (downstream consumer)', () => {
    writePackageJson(cwd, { name: 'whatever' });
    writeGitDir(cwd);

    const result = checkPreCommitHook(cwd);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('No `simple-git-hooks.pre-commit`');
    expect(result.remediation).toContain('downstream consumers');
  });

  it('WARN when neither package.json directive nor git repo present', () => {
    const result = checkPreCommitHook(cwd);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('Not a git repo');
    expect(result.message).toContain('nothing to verify');
  });

  it('honours `core.hooksPath` override when checking the hook file', () => {
    writePackageJson(cwd, {
      name: 'whatever',
      'simple-git-hooks': { 'pre-commit': 'pnpm typecheck' },
    });
    writeGitDir(cwd, '.githooks');
    mkdirSync(join(cwd, '.githooks'), { recursive: true });
    writeFileSync(
      join(cwd, '.githooks', 'pre-commit'),
      '#!/usr/bin/env sh\npnpm typecheck\n'
    );

    const result = checkPreCommitHook(cwd);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('.githooks');
  });
});

describe('runDoctor', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = makeFixture();
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('overallStatus is pass when every check passes', () => {
    writePackageJson(cwd, {
      name: 'whatever',
      'simple-git-hooks': { 'pre-commit': 'pnpm typecheck' },
    });
    writeGitDir(cwd);
    writeFileSync(
      join(cwd, '.git', 'hooks', 'pre-commit'),
      '#!/usr/bin/env sh\npnpm typecheck\n'
    );
    // Sprint 51: env file check also runs — provide .env.example so it passes.
    writeFileSync(join(cwd, '.env.example'), '# example');

    // Sprint 51: inject a zero-advisory audit stub so the pnpm audit check
    // passes without spawning a real subprocess.
    const report = runDoctor(cwd, makePassAuditSpawn());
    expect(report.overallStatus).toBe('pass');
    expect(report.checks.length).toBeGreaterThan(0);
  });

  it('overallStatus is fail when any check fails', () => {
    writePackageJson(cwd, {
      name: 'whatever',
      'simple-git-hooks': { 'pre-commit': 'pnpm typecheck' },
    });
    writeGitDir(cwd);

    const report = runDoctor(cwd, makePassAuditSpawn());
    expect(report.overallStatus).toBe('fail');
  });

  it('overallStatus is warn when no fails but at least one warn', () => {
    // Not a git repo + no simple-git-hooks directive → WARN from pre-commit check.
    const report = runDoctor(cwd, makePassAuditSpawn());
    expect(report.overallStatus).toBe('warn');
  });
});

describe('doctorCommand', () => {
  it('is defined', () => {
    expect(doctorCommand).toBeDefined();
  });

  it('has the expected name', () => {
    expect(doctorCommand.name()).toBe('doctor');
  });

  it('has a description', () => {
    expect(doctorCommand.description()).toBeTruthy();
  });

  it('exposes a --json option', () => {
    const jsonOption = doctorCommand.options.find((opt) => opt.long === '--json');
    expect(jsonOption).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Sprint 51 — B.14: runDoctor cwd validation
// ---------------------------------------------------------------------------

describe('runDoctor — cwd validation (B.14)', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'bonklm-doctor-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns a fail report with cwd_invalid check when cwd does not exist', () => {
    const nonExistent = '/this/path/absolutely/does/not/exist/bonklm-test-b14';
    const report = runDoctor(nonExistent, makePassAuditSpawn());

    expect(report.overallStatus).toBe('fail');
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0].name).toBe('cwd_invalid');
    expect(report.checks[0].status).toBe('fail');
    expect(report.checks[0].message).toContain('path does not exist');
  });

  it('returns a fail report with cwd_invalid check when cwd is a regular file (not a directory)', () => {
    const filePath = join(cwd, 'regular-file.txt');
    writeFileSync(filePath, 'hello');

    const report = runDoctor(filePath, makePassAuditSpawn());

    expect(report.overallStatus).toBe('fail');
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0].name).toBe('cwd_invalid');
    expect(report.checks[0].status).toBe('fail');
    expect(report.checks[0].message).toContain('path is not a directory');
  });

  it('sanitizes a hostile cwd path (ANSI + newline) in the cwd_invalid message', () => {
    // A cwd containing ANSI sequences or newlines must not leak into the message
    // — sanitizeLogString should hex-escape them.
    const hostile = '/tmp/\x1b[31mRED\x1b[0m/nonexistent\nnewline';
    const report = runDoctor(hostile, makePassAuditSpawn());

    expect(report.overallStatus).toBe('fail');
    expect(report.checks[0].name).toBe('cwd_invalid');
    // Raw ESC or raw newline must NOT appear in the message
    expect(report.checks[0].message).not.toMatch(/\x1b/);
    expect(report.checks[0].message).not.toMatch(/\n/);
  });

  it('runs normally when cwd is a valid existing directory', () => {
    // A valid cwd should NOT produce a cwd_invalid check
    const report = runDoctor(cwd, makePassAuditSpawn());
    const cwdInvalid = report.checks.find((c) => c.name === 'cwd_invalid');
    expect(cwdInvalid).toBeUndefined();
    // At minimum pre-commit, env, audit checks are present
    expect(report.checks.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Sprint 51 — B.15: checkEnvFile
// ---------------------------------------------------------------------------

describe('checkEnvFile (B.15)', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'bonklm-doctor-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('PASS when .env exists', () => {
    writeFileSync(join(cwd, '.env'), 'FOO=bar');
    const result = checkEnvFile(cwd);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('.env');
  });

  it('PASS when .env.example exists', () => {
    writeFileSync(join(cwd, '.env.example'), '# example');
    const result = checkEnvFile(cwd);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('.env.example');
  });

  it('PASS when both .env and .env.example exist', () => {
    writeFileSync(join(cwd, '.env'), 'FOO=bar');
    writeFileSync(join(cwd, '.env.example'), '# example');
    const result = checkEnvFile(cwd);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('.env');
    expect(result.message).toContain('.env.example');
  });

  it('WARN when neither .env nor .env.example exists', () => {
    const result = checkEnvFile(cwd);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('Neither .env nor .env.example');
    expect(result.remediation).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Sprint 51 — B.15: checkPnpmAudit (uses injectable _spawnFn; no ESM spy)
// ---------------------------------------------------------------------------

describe('checkPnpmAudit (B.15)', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'bonklm-doctor-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('PASS when pnpm audit reports zero HIGH/CRITICAL advisories', () => {
    const result = checkPnpmAudit(cwd, makePassAuditSpawn());
    expect(result.status).toBe('pass');
    expect(result.message).toContain('No HIGH or CRITICAL');
  });

  it('FAIL when pnpm audit reports HIGH + CRITICAL advisories', () => {
    const result = checkPnpmAudit(cwd, makeFailAuditSpawn(3, 1));
    expect(result.status).toBe('fail');
    // 3 high + 1 critical = 4
    expect(result.message).toContain('4');
    expect(result.remediation).toBeTruthy();
  });

  it('FAIL when pnpm audit reports only HIGH advisories', () => {
    const result = checkPnpmAudit(cwd, makeFailAuditSpawn(2, 0));
    expect(result.status).toBe('fail');
    expect(result.message).toContain('2');
  });

  it('WARN when pnpm is not on PATH (spawn returns error)', () => {
    const result = checkPnpmAudit(cwd, makeErrorAuditSpawn('spawn pnpm ENOENT'));
    expect(result.status).toBe('warn');
    expect(result.message).toContain('could not run');
    expect(result.remediation).toContain('pnpm');
  });

  it('WARN when pnpm audit output is not valid JSON', () => {
    const result = checkPnpmAudit(cwd, makeBadJsonAuditSpawn());
    expect(result.status).toBe('warn');
    expect(result.message).toContain('could not be parsed');
  });
});

// ---------------------------------------------------------------------------
// Sprint 51 — B.16: --json output round-trip sanitization
// ---------------------------------------------------------------------------

describe('runDoctor --json sanitization round-trip (B.16)', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'bonklm-doctor-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('JSON.parse round-trip succeeds when audit error message contains newlines + ANSI escapes', () => {
    // Inject an audit spawn that returns an error with ANSI codes + embedded newline.
    // These are attacker-controllable strings flowing into a DoctorCheckResult message.
    const hostileSpawn = makeErrorAuditSpawn('\x1b[31mRED error\x1b[0m\nnewline injected');
    const report = runDoctor(cwd, hostileSpawn);

    // Serialize as the --json path (renderJson) does
    const jsonString = JSON.stringify(report, null, 2);

    // Must be valid JSON — JSON.parse must not throw
    let parsed: unknown;
    expect(() => {
      parsed = JSON.parse(jsonString);
    }).not.toThrow();

    // Raw ESC must not appear in the JSON output after sanitizeLogString
    expect(jsonString).not.toMatch(/\x1b/);

    // The result must be truthy (non-null) — the round-trip preserved the object
    expect(parsed).toBeTruthy();
  });

  it('JSON output is parseable when pre-commit hook path contains ANSI escapes', () => {
    // A hostile .git/config with ANSI in hooksPath flows into the message via
    // hookFileDisplay = sanitizeLogString(hookFile). Verify the JSON remains parseable.
    writePackageJson(cwd, {
      name: 'whatever',
      'simple-git-hooks': { 'pre-commit': 'pnpm typecheck' },
    });
    // Write a .git dir with an ANSI-contaminated hooksPath
    const gitDir = join(cwd, '.git');
    mkdirSync(join(gitDir, 'hooks'), { recursive: true });
    writeFileSync(
      join(gitDir, 'config'),
      '[core]\n\thooksPath = \x1b[31mred-path\x1b[0m\n'
    );

    const report = runDoctor(cwd, makePassAuditSpawn());
    const jsonString = JSON.stringify(report, null, 2);

    expect(() => JSON.parse(jsonString)).not.toThrow();
    expect(jsonString).not.toMatch(/\x1b/);
  });
});

describe('checkRateLimiterAdvisory (B.5, ST-05-104)', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = makeFixture();
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('PASS when no package.json is present (advisory cannot run)', () => {
    const result = checkRateLimiterAdvisory(cwd);
    expect(result.status).toBe('pass');
    expect(result.message).toMatch(/No package.json/);
  });

  it('PASS when no BonkLM framework connector is installed', () => {
    writePackageJson(cwd, {
      name: 'consumer',
      dependencies: { lodash: '^4.17.21' },
    });
    const result = checkRateLimiterAdvisory(cwd);
    expect(result.status).toBe('pass');
    expect(result.message).toMatch(/No BonkLM framework connector installed/);
  });

  it('PASS when a connector is installed alongside a known upstream limiter', () => {
    writePackageJson(cwd, {
      name: 'consumer',
      dependencies: {
        '@blackunicorn/bonklm-express': '^1.0.0',
        'express-rate-limit': '^7.0.0',
      },
    });
    const result = checkRateLimiterAdvisory(cwd);
    expect(result.status).toBe('pass');
    expect(result.message).toMatch(/Upstream rate limiter detected/);
    expect(result.message).toMatch(/express-rate-limit/);
  });

  it('PASS when consumer explicitly opts out via bonklm.rateLimit = "documented"', () => {
    writePackageJson(cwd, {
      name: 'consumer',
      dependencies: { '@blackunicorn/bonklm-fastify': '^1.0.0' },
      bonklm: { rateLimit: 'documented' },
    });
    const result = checkRateLimiterAdvisory(cwd);
    expect(result.status).toBe('pass');
    expect(result.message).toMatch(/explicitly acknowledged/);
    expect(result.message).toMatch(/documented/);
  });

  it('PASS when consumer opts out via bonklm.rateLimit = "external" (alternate spelling)', () => {
    writePackageJson(cwd, {
      name: 'consumer',
      dependencies: { '@blackunicorn/bonklm-hono': '^1.0.0' },
      bonklm: { rateLimit: 'external' },
    });
    const result = checkRateLimiterAdvisory(cwd);
    expect(result.status).toBe('pass');
  });

  it('PASS when consumer opts out via bonklm.rateLimit = "in-process" (uses bundled RateLimiter)', () => {
    writePackageJson(cwd, {
      name: 'consumer',
      dependencies: { '@blackunicorn/bonklm-elysia': '^1.0.0' },
      bonklm: { rateLimit: 'in-process' },
    });
    const result = checkRateLimiterAdvisory(cwd);
    expect(result.status).toBe('pass');
  });

  it('WARN when framework connector is installed with no known limiter and no opt-out', () => {
    writePackageJson(cwd, {
      name: 'consumer',
      dependencies: { '@blackunicorn/bonklm-nextjs': '^1.0.0' },
    });
    const result = checkRateLimiterAdvisory(cwd);
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/without a known upstream rate limiter/);
    expect(result.message).toMatch(/@blackunicorn\/bonklm-nextjs/);
    expect(result.remediation).toMatch(/express-rate-limit/);
    expect(result.remediation).toMatch(/bonklm\.rateLimit/);
  });

  it('WARN lists ALL installed connectors when multiple framework connectors are present without a limiter', () => {
    writePackageJson(cwd, {
      name: 'consumer',
      dependencies: {
        '@blackunicorn/bonklm-express': '^1.0.0',
        '@blackunicorn/bonklm-fastify': '^1.0.0',
      },
    });
    const result = checkRateLimiterAdvisory(cwd);
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/@blackunicorn\/bonklm-express/);
    expect(result.message).toMatch(/@blackunicorn\/bonklm-fastify/);
  });

  it('Treats devDependencies the same as dependencies for limiter detection', () => {
    writePackageJson(cwd, {
      name: 'consumer',
      dependencies: { '@blackunicorn/bonklm-nestjs': '^1.0.0' },
      devDependencies: { '@nestjs/throttler': '^6.0.0' },
    });
    const result = checkRateLimiterAdvisory(cwd);
    expect(result.status).toBe('pass');
    expect(result.message).toMatch(/Upstream rate limiter detected/);
  });

  it('WARN when package.json is unparseable JSON', () => {
    writeFileSync(join(cwd, 'package.json'), 'not { valid json');
    const result = checkRateLimiterAdvisory(cwd);
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/could not be parsed/);
  });

  it('Sanitizes connector + limiter names in output (no raw control chars)', () => {
    // Synthesize a hostile dependency name with embedded ANSI escape.
    // Real package names cannot contain these, but defence-in-depth verifies
    // sanitizeLogString runs over the values that flow into the message.
    writePackageJson(cwd, {
      name: 'consumer',
      dependencies: {
        '@blackunicorn/bonklm-express': '^1.0.0\x1b[31mred\x1b[0m',
      },
    });
    const result = checkRateLimiterAdvisory(cwd);
    // The KEY (@blackunicorn/bonklm-express) passes through sanitizeLogString;
    // the value is not reflected. Assert no raw ESC in output.
    const allOutput = `${result.message}${result.remediation ?? ''}`;
    expect(allOutput).not.toMatch(/\x1b/);
  });
});
