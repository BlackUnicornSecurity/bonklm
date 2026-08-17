import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  classifyReleaseVersion,
  runCli,
  validateChangesetsPreFile,
  validateChangesetsPreState
} from './release-version.js';

function temporaryDirectory(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

describe('classifyReleaseVersion', () => {
  it.each([
    ['1.0.1', false],
    ['1.0.1-rc.1', true]
  ])('classifies %s', (version, prerelease) => {
    expect(classifyReleaseVersion(version)).toEqual({ version, prerelease });
  });

  it.each([
    ['missing version', undefined],
    ['invalid SemVer', 'latest'],
    ['OCI-incompatible build metadata', '1.0.1+build-1'],
    ['OCI tag longer than 128 characters', `1.0.1-${'a'.repeat(123)}`]
  ])('rejects %s', (_label, version) => {
    expect(() => classifyReleaseVersion(version)).toThrow(/release version/i);
  });
});

describe('Changesets prerelease state', () => {
  it('accepts active matching prerelease state and inactive stable state', () => {
    expect(validateChangesetsPreState('1.0.1-rc.1', { mode: 'pre', tag: 'rc' }).prerelease).toBe(true);
    expect(validateChangesetsPreState('1.0.1', null).prerelease).toBe(false);
    expect(validateChangesetsPreState('1.0.1', { mode: 'exit', tag: 'rc' }).prerelease).toBe(false);
  });

  it.each([
    ['missing prerelease state', '1.0.1-rc.1', null, /active Changesets pre mode/],
    ['exiting prerelease state', '1.0.1-rc.1', { mode: 'exit', tag: 'rc' }, /active Changesets pre mode/],
    ['wrong prerelease tag', '1.0.1-rc.1', { mode: 'pre', tag: 'beta' }, /tag rc/],
    ['active state for stable release', '1.0.1', { mode: 'pre', tag: 'rc' }, /Stable release/]
  ])('rejects %s', (_label, version, state, message) => {
    expect(() => validateChangesetsPreState(version, state)).toThrow(message);
  });

  it('loads prerelease state from disk and treats a missing file as inactive', () => {
    const root = temporaryDirectory('bonklm-pre-state-');
    const path = join(root, 'pre.json');
    writeFileSync(path, JSON.stringify({ mode: 'pre', tag: 'rc' }));
    expect(validateChangesetsPreFile('1.0.1-rc.1', path).prerelease).toBe(true);
    expect(validateChangesetsPreFile('1.0.1', join(root, 'missing.json')).prerelease).toBe(false);
  });
});

describe('release-version CLI', () => {
  it('prints the prerelease state only for its own entrypoint', () => {
    const log = vi.fn();
    expect(runCli({ argv1: '/other.js', scriptPath: '/release.js', version: '1.0.1', log })).toBe(false);
    expect(runCli({ argv1: '/release.js', scriptPath: '/release.js', version: '1.0.1-rc.1', log })).toBe(true);
    expect(log).toHaveBeenCalledWith('true');
  });

  it('validates a supplied Changesets state file', () => {
    const root = temporaryDirectory('bonklm-pre-cli-');
    const path = join(root, 'pre.json');
    writeFileSync(path, JSON.stringify({ mode: 'pre', tag: 'rc' }));
    const log = vi.fn();
    expect(
      runCli({ argv1: '/release.js', scriptPath: '/release.js', version: '1.0.1-rc.1', preStatePath: path, log })
    ).toBe(true);
    expect(log).toHaveBeenCalledWith('true');
  });
});
