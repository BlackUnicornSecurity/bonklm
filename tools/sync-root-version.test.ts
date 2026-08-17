import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { runCli, syncRootVersion } from './sync-root-version.js';

function fixture(coreVersion: unknown) {
  const root = mkdtempSync(join(tmpdir(), 'bonklm-sync-version-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const rootPath = join(root, 'package.json');
  const corePath = join(root, 'packages', 'core', 'package.json');
  mkdirSync(join(root, 'packages', 'core'), { recursive: true });
  writeFileSync(rootPath, '{"name":"workspace","version":"1.0.0","private":true}\n');
  writeFileSync(corePath, JSON.stringify({ name: '@x/core', version: coreVersion }));
  return { rootPath, corePath, read: readFileSync, write: writeFileSync };
}

describe('syncRootVersion', () => {
  it('copies the canonical core version to root without changing other metadata', () => {
    const paths = fixture('1.0.1');

    expect(syncRootVersion(paths)).toBe('1.0.1');
    expect(JSON.parse(readFileSync(paths.rootPath, 'utf8'))).toEqual({
      name: 'workspace',
      version: '1.0.1',
      private: true
    });
  });

  it.each([undefined, '', 1])('fails closed for invalid core version %s', coreVersion => {
    const paths = fixture(coreVersion);
    expect(() => syncRootVersion(paths)).toThrow(/no valid version/);
  });

  it('runs only as its own entrypoint', () => {
    const run = vi.fn(() => '1.0.1');
    const log = vi.fn();
    expect(runCli({ argv1: '/other.js', scriptPath: '/sync.js', run, log })).toBe(false);
    expect(runCli({ argv1: '/sync.js', scriptPath: '/sync.js', run, log })).toBe(true);
    expect(log).toHaveBeenCalledWith('sync-root-version: root metadata aligned to 1.0.1.');
  });

  it('supports injected paths and I/O', () => {
    const read = vi
      .fn()
      .mockReturnValueOnce('{"name":"workspace","version":"1.0.0"}')
      .mockReturnValueOnce('{"name":"core","version":"1.0.1"}');
    const write = vi.fn();

    expect(
      syncRootVersion({ rootPath: '/repo/package.json', corePath: '/repo/packages/core/package.json', read, write })
    ).toBe('1.0.1');
    expect(write).toHaveBeenCalledWith(expect.stringMatching(/package\.json$/), expect.stringContaining('"1.0.1"'));
  });
});
