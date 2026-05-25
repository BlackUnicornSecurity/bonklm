/**
 * Doctor Command Tests
 *
 * Sprint 50: covers the pre-commit hook check + the surrounding
 * primitives (`resolveHooksPath`, `readConfiguredPreCommit`,
 * `runDoctor` aggregation). Creates ephemeral fixture directories
 * under `os.tmpdir()` so each test exercises the real filesystem
 * code paths without touching the project's own `.git/`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkPreCommitHook,
  doctorCommand,
  readConfiguredPreCommit,
  resolveHooksPath,
  runDoctor,
} from './doctor.js';

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

    const report = runDoctor(cwd);
    expect(report.overallStatus).toBe('pass');
    expect(report.checks.length).toBeGreaterThan(0);
  });

  it('overallStatus is fail when any check fails', () => {
    writePackageJson(cwd, {
      name: 'whatever',
      'simple-git-hooks': { 'pre-commit': 'pnpm typecheck' },
    });
    writeGitDir(cwd);

    const report = runDoctor(cwd);
    expect(report.overallStatus).toBe('fail');
  });

  it('overallStatus is warn when no fails but at least one warn', () => {
    // Not a git repo + no simple-git-hooks directive → WARN
    const report = runDoctor(cwd);
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
