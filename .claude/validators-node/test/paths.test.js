import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { resolvePath, isPathInRepo } from '../lib/paths.js';

describe('resolvePath', () => {
  it('returns empty for empty input', () => {
    expect(resolvePath('', '/cwd')).toBe('');
  });

  it('expands a leading ~ to the home directory', () => {
    expect(resolvePath('~/foo', '/cwd')).toBe(path.join(os.homedir(), 'foo'));
  });

  it('resolves a relative path against cwd', () => {
    expect(resolvePath('a/b', '/cwd')).toBe(path.resolve('/cwd/a/b'));
  });

  it('normalizes a non-existent absolute path via path.resolve', () => {
    expect(resolvePath('/no/such/xyz-123', '/cwd')).toBe(path.resolve('/no/such/xyz-123'));
  });

  it('realpath-resolves an existing path', () => {
    const out = resolvePath(process.cwd(), '/');
    expect(path.isAbsolute(out)).toBe(true);
  });
});

describe('isPathInRepo', () => {
  const repo = process.cwd();

  it('treats an empty path as in-repo (nothing to check)', () => {
    expect(isPathInRepo('', repo, repo)).toBe(true);
  });

  it('accepts a path inside the repo', () => {
    expect(isPathInRepo(path.join(repo, 'lib', 'x.js'), repo, repo)).toBe(true);
  });

  it('accepts the repo root itself', () => {
    expect(isPathInRepo(repo, repo, repo)).toBe(true);
  });

  it('rejects a path outside the repo', () => {
    expect(isPathInRepo('/etc/passwd', repo, repo)).toBe(false);
  });

  it('rejects a sibling-prefix path (boundary, not bare startsWith)', () => {
    expect(isPathInRepo(`${repo}-evil/x`, repo, repo)).toBe(false);
  });

  it('falls back to path.resolve when the repo dir does not exist', () => {
    expect(isPathInRepo('/no/such/repo-999/sub', '/cwd', '/no/such/repo-999')).toBe(true);
  });
});
