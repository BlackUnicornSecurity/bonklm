import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
// @ts-expect-error — dependency-free release scripts have no declaration files
import { fullProdLicenseMap, main, parseArgs, runCli } from '../scripts/license-audit.mjs';

function rootFixture(license = 'MIT') {
  const directory = mkdtempSync(join(tmpdir(), 'bonklm-license-cli-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ name: '@blackunicorn/root', version: '1.0.1', license })
  );
  return { dir: directory, name: '@blackunicorn/root' };
}

describe('license audit command boundary', () => {
  it('parses report, full, root, and help options', () => {
    expect(parseArgs(['--json', 'report.json', '--full', '--root', 'packages/core'])).toEqual({
      full: true,
      help: undefined,
      json: 'report.json',
      roots: ['packages/core']
    });
    expect(parseArgs(['--help'])).toMatchObject({ help: true });
    const error = vi.fn();
    const exit = vi.fn();
    expect(parseArgs(['--unknown'], { error, exit })).toBeNull();
    expect(exit).toHaveBeenCalledWith(2);
  });

  it('normalizes the broader production-license command and tolerates advisory failures', () => {
    const listed = fullProdLicenseMap({
      repoRoot: '/repo',
      run: vi.fn(() =>
        JSON.stringify({
          MIT: [
            { name: 'multi', versions: ['1.0.0', '2.0.0'] },
            { name: 'single', version: '3.0.0' },
            { name: 'unknown-version' }
          ]
        })
      )
    });
    expect([...listed.entries()]).toEqual([
      ['multi@1.0.0', 'MIT'],
      ['multi@2.0.0', 'MIT'],
      ['single@3.0.0', 'MIT'],
      ['unknown-version@*', 'MIT']
    ]);
    expect(
      fullProdLicenseMap({
        repoRoot: '/repo',
        run: vi.fn(() => {
          throw new Error('unavailable');
        })
      })
    ).toEqual(new Map());
  });

  it('reports a clean shipped closure', () => {
    const root = rootFixture();
    const exit = vi.fn();
    const log = vi.fn();
    const result = main({
      argv: ['--full'],
      exit,
      log,
      roots: [root],
      closure: new Map([
        ['@blackunicorn/root@1.0.1', { name: root.name, version: '1.0.1', license: 'MIT', viaWorkspace: true }],
        ['dep@1.0.0', { name: 'dep', version: '1.0.0', license: 'MIT', viaWorkspace: false }]
      ]),
      peerLicenseMap: new Map()
    });

    expect(result).toMatchObject({ flagged: [], peerFlags: [] });
    expect(exit).toHaveBeenCalledWith(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('RESULT: PASS'));
  });

  it('writes a full report and blocks non-permissive roots', () => {
    const root = rootFixture('GPL-3.0-only');
    const report = join(root.dir, 'report.json');
    const exit = vi.fn();
    const log = vi.fn();
    const result = main({
      argv: ['--full', '--json', report],
      exit,
      log,
      roots: [root],
      closure: new Map([
        ['@blackunicorn/root@1.0.1', { name: root.name, version: '1.0.1', license: 'GPL-3.0-only', viaWorkspace: true }]
      ]),
      peerLicenseMap: new Map([
        ['@blackunicorn/root@1.0.1', 'GPL-3.0-only'],
        ['peer@1.0.0', 'GPL-3.0-only'],
        ['permissive@1.0.0', 'MIT']
      ])
    });

    expect(result.flagged).toHaveLength(1);
    expect(result.peerFlags).toEqual([{ key: 'peer@1.0.0', license: 'GPL-3.0-only' }]);
    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.parse(readFileSync(report, 'utf8'))).toMatchObject({ flaggedInShipped: [{ root: true }] });
  });

  it('stops when argument parsing fails through the main seam', () => {
    const exit = vi.fn();
    expect(main({ argv: ['--unknown'], exit, log: vi.fn() })).toBeNull();
    expect(exit).toHaveBeenCalledWith(2);
  });

  it('blocks a non-permissive external dependency while skipping first-party workspace packages', () => {
    const root = rootFixture();
    const exit = vi.fn();
    const result = main({
      argv: [],
      exit,
      log: vi.fn(),
      roots: [root],
      closure: new Map([
        ['@blackunicorn/root@1.0.1', { name: root.name, version: '1.0.1', license: 'MIT', viaWorkspace: true }],
        ['external@1.0.0', { name: 'external', version: '1.0.0', license: 'GPL-3.0-only', viaWorkspace: false }]
      ])
    });
    expect(result.flagged).toEqual([expect.objectContaining({ name: 'external', verdict: 'flagged' })]);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('runs the default repository selection without a supplied closure', () => {
    const exit = vi.fn();
    const licenseMapLoader = vi.fn(() => new Map());
    const result = main({ argv: ['--full'], exit, licenseMapLoader, log: vi.fn() });
    expect(result.flagged).toEqual([]);
    expect(exit).toHaveBeenCalledWith(0);
    expect(licenseMapLoader).toHaveBeenCalledOnce();
  });

  it('prints help and only runs for its own entrypoint', () => {
    const log = vi.fn();
    const exit = vi.fn();
    expect(main({ argv: ['--help'], exit, log })).toBeNull();
    expect(exit).toHaveBeenCalledWith(0);
    const run = vi.fn();
    expect(runCli({ argv1: '/other', scriptPath: '/script', run })).toBe(false);
    expect(runCli({ argv1: '/script', scriptPath: '/script', run })).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });
});
