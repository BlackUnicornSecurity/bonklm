/**
 * Story 3.2 — PathTraversalValidator
 * ==================================
 * Rejects:
 *  - `..` traversal (Unix + Windows + URL-encoded)
 *  - Absolute paths outside specified `cwd`
 *  - Symlink targets (when fs check enabled)
 *
 * Benign paths inside `cwd` pass.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PathTraversalValidator } from '../../src/validators/path-traversal.js';
import { Severity } from '../../src/base/GuardrailResult.js';

describe('PathTraversalValidator — `..` traversal rejection', () => {
  const v = new PathTraversalValidator({ cwd: '/srv/app' });

  const ATTACKS = [
    '../etc/passwd',
    '../../etc/passwd',
    '../../../etc/passwd',
    'foo/../../../etc/passwd',
    'foo/bar/../../../../etc/passwd',
    '/srv/app/../../../etc/passwd',
    'foo/./../../etc/passwd',
    // Windows-style
    '..\\..\\..\\windows\\system32',
    'foo\\..\\..\\..\\etc\\passwd',
    // URL-encoded
    '%2e%2e/etc/passwd',
    '%2E%2E/etc/passwd',
    '..%2fetc%2fpasswd',
    '..%5cetc%5cpasswd',
    // Double-encoded
    '%252e%252e/etc/passwd',
    // Null byte
    'foo\x00/../../../etc/passwd'
  ];

  for (const attack of ATTACKS) {
    it(`blocks: ${JSON.stringify(attack)}`, async () => {
      const r = await v.validate(attack);
      expect(r.blocked).toBe(true);
    });
  }
});

describe('PathTraversalValidator — absolute path outside cwd', () => {
  const v = new PathTraversalValidator({ cwd: '/srv/app' });

  it('blocks /etc/passwd', async () => {
    const r = await v.validate('/etc/passwd');
    expect(r.blocked).toBe(true);
  });

  it('blocks /var/log/auth', async () => {
    const r = await v.validate('/var/log/auth');
    expect(r.blocked).toBe(true);
  });

  it('blocks Windows absolute C:\\Windows\\System32', async () => {
    const r = await v.validate('C:\\Windows\\System32\\config\\SAM');
    expect(r.blocked).toBe(true);
  });

  it('allows absolute path inside cwd', async () => {
    const r = await v.validate('/srv/app/data/file.csv');
    expect(r.blocked).toBe(false);
  });

  it('allows relative path inside cwd', async () => {
    const r = await v.validate('data/file.csv');
    expect(r.blocked).toBe(false);
  });

  it('allows path with `..` that resolves inside cwd', async () => {
    // /srv/app/foo/../data → /srv/app/data — still inside cwd.
    // This is intentionally STRICT — many traversal attacks use the
    // "resolves clean" trick so we still reject any `..` segment.
    const r = await v.validate('foo/../data/file.csv');
    expect(r.blocked).toBe(true);
  });
});

describe('PathTraversalValidator — symlink targets', () => {
  let tmpDir: string;
  let symlinkInside: string;
  let symlinkOutside: string;
  let realInside: string;
  let realOutside: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pathtrav-'));
    mkdirSync(join(tmpDir, 'data'));
    realInside = join(tmpDir, 'data', 'inside.txt');
    writeFileSync(realInside, 'safe');
    realOutside = join(tmpDir, '..', 'outside.txt');
    writeFileSync(realOutside, 'unsafe');
    symlinkInside = join(tmpDir, 'data', 'sym-inside.txt');
    symlinkOutside = join(tmpDir, 'data', 'sym-outside.txt');
    symlinkSync(realInside, symlinkInside);
    symlinkSync(realOutside, symlinkOutside);
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    try {
      rmSync(realOutside, { force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('blocks symlinks whose target escapes cwd when checkSymlinks=true', async () => {
    const v = new PathTraversalValidator({ cwd: tmpDir, checkSymlinks: true });
    const r = await v.validate(symlinkOutside);
    expect(r.blocked).toBe(true);
  });

  it('allows symlinks whose target stays inside cwd', async () => {
    const v = new PathTraversalValidator({ cwd: tmpDir, checkSymlinks: true });
    const r = await v.validate(symlinkInside);
    expect(r.blocked).toBe(false);
  });

  it('does NOT call fs when checkSymlinks=false (default)', async () => {
    const v = new PathTraversalValidator({ cwd: tmpDir });
    // Even an escaping symlink passes when the check is disabled —
    // path-only validation is the default mode (edge-runtime safe).
    const r = await v.validate(symlinkOutside);
    expect(r.blocked).toBe(false);
  });
});

describe('PathTraversalValidator — config / shape', () => {
  it('throws if cwd is not supplied', () => {
    // @ts-expect-error — runtime guard
    expect(() => new PathTraversalValidator()).toThrow();
  });

  it('returns GuardrailResult shape', async () => {
    const v = new PathTraversalValidator({ cwd: '/srv/app' });
    const r = await v.validate('../etc/passwd');
    expect(r).toHaveProperty('allowed');
    expect(r).toHaveProperty('blocked');
    expect(r).toHaveProperty('severity');
    expect(r).toHaveProperty('findings');
    expect(r.severity).toBe(Severity.CRITICAL);
  });

  it('accepts ValidatorInput { kind: "text", content }', async () => {
    const v = new PathTraversalValidator({ cwd: '/srv/app' });
    const r = await v.validate({ kind: 'text', content: '../etc/passwd' });
    expect(r.blocked).toBe(true);
  });

  it('stamps result.metadata.surface = "text_input"', async () => {
    const v = new PathTraversalValidator({ cwd: '/srv/app' });
    const r = await v.validate('../etc/passwd');
    expect(r.metadata?.surface).toBe('text_input');
  });
});

// =============================================================================
// hardening REGRESSION TESTS (Sprint 16 / Story 3.2 3-lane audit)
// =============================================================================

describe('PathTraversalValidator — startsWith prefix-collision bypass (code-reviewer BLOCK-1)', () => {
  const v = new PathTraversalValidator({ cwd: '/srv/app' });

  it('blocks `/srv/app-evil/config` (prefix-collision attack)', async () => {
    const r = await v.validate('/srv/app-evil/config');
    expect(r.blocked).toBe(true);
  });

  it('blocks `/srv/appended/evil`', async () => {
    const r = await v.validate('/srv/appended/evil');
    expect(r.blocked).toBe(true);
  });

  it('still allows the exact cwd', async () => {
    const r = await v.validate('/srv/app');
    expect(r.blocked).toBe(false);
  });

  it('still allows paths strictly inside cwd', async () => {
    const r = await v.validate('/srv/app/data/file.csv');
    expect(r.blocked).toBe(false);
  });
});

describe('PathTraversalValidator — null-byte null in payload (security CONCERN-2)', () => {
  const v = new PathTraversalValidator({ cwd: '/srv/app' });

  it('blocks a payload containing a literal \\x00 null byte', async () => {
    const r = await v.validate('foo\x00../../etc/passwd');
    expect(r.blocked).toBe(true);
    expect(r.findings.some(f => f.category === 'path_traversal_nullbyte')).toBe(true);
  });
});

describe('PathTraversalValidator — symlink fail-secure on realpath error (security CONCERN-3)', () => {
  it('blocks (fail-secure) when checkSymlinks=true and the path does not exist', async () => {
    const v = new PathTraversalValidator({
      cwd: '/srv/app',
      checkSymlinks: true
    });
    // The path is RELATIVE so the absolute-outside check doesn't fire;
    // realpath on a non-existent path under cwd will throw → fail-secure.
    const r = await v.validate('definitely/does/not/exist.txt');
    expect(r.blocked).toBe(true);
    expect(r.findings.some(f => f.category === 'path_traversal_symlink_check_error')).toBe(true);
  });
});

describe('PathTraversalValidator — extended ValidatorInput kinds (code-reviewer CONCERN-6)', () => {
  const v = new PathTraversalValidator({ cwd: '/srv/app' });

  it('accepts composed_context (joined entries)', async () => {
    const r = await v.validate({
      kind: 'composed_context',
      entries: ['benign', '../etc/passwd', 'more']
    });
    expect(r.blocked).toBe(true);
  });

  it('accepts memory_write payload.content', async () => {
    const r = await v.validate({
      kind: 'memory_write',
      payload: { content: '../etc/passwd' }
    });
    expect(r.blocked).toBe(true);
  });

  it('accepts tool_call by stringifying args', async () => {
    const r = await v.validate({
      kind: 'tool_call',
      toolName: 'read_file',
      args: { path: '../etc/passwd' }
    });
    expect(r.blocked).toBe(true);
  });
});
