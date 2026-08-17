import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — dependency-free release script has no declaration file
import {
  command,
  createInstaller,
  inspectNpmTarball,
  installFromRegistry,
  installPinnedNpm,
  makeTemporaryDirectory,
  removeTemporaryDirectory,
  runCli,
  setProcessExitCode
} from './install-pinned-npm.js';

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

function fixture({
  version = '10.9.9',
  tarRange = '^7.5.22',
  bundledTarName = 'tar',
  bundledTarVersion = '7.5.22'
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bonklm-pinned-npm-'));
  temporary.push(root);
  const stage = join(root, 'stage');
  mkdirSync(join(stage, 'package', 'node_modules', 'tar'), { recursive: true });
  writeFileSync(join(stage, 'package', 'package.json'), JSON.stringify({ version, dependencies: { tar: tarRange } }));
  writeFileSync(
    join(stage, 'package', 'node_modules', 'tar', 'package.json'),
    JSON.stringify({ name: bundledTarName, version: bundledTarVersion })
  );
  const tarball = join(root, 'npm-10.9.9.tgz');
  execFileSync('tar', ['-czf', tarball, '-C', stage, 'package']);
  const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
  return { integrity, root, tarball };
}

function runner(version = '10.9.9') {
  return vi.fn((tool: string, args: string[]) => {
    if (tool === 'npm' && args[0] === 'pack') return JSON.stringify([{ filename: 'npm-10.9.9.tgz' }]);
    if (tool === 'npm' && args[0] === '--version') return `${version}\n`;
    if (tool === 'tar') return execFileSync(tool, args, { encoding: 'utf8' });
    return '';
  });
}

describe('pinned npm CLI installer', () => {
  it('installs only after the tarball and bundled dependency set match', () => {
    const { integrity, root } = fixture();
    const run = runner();
    installPinnedNpm({ run, directory: root, expectedIntegrity: integrity });
    expect(run.mock.calls[0]?.[1]).toContain('--ignore-scripts');
    expect(run.mock.calls[3]?.[1]).toEqual(
      expect.arrayContaining(['install', '--global', join(root, 'npm-10.9.9.tgz'), '--ignore-scripts'])
    );
    expect(run.mock.calls[4]?.[1]).toEqual(['--version']);
  });

  it('rejects digest, package metadata, and active executable mismatches', () => {
    const trusted = fixture();
    expect(() =>
      installPinnedNpm({ run: runner(), directory: trusted.root, expectedIntegrity: 'sha512-wrong' })
    ).toThrow(/integrity mismatch/);
    const unsafe = fixture({ tarRange: '^7.5.19' });
    expect(() =>
      installPinnedNpm({ run: runner(), directory: unsafe.root, expectedIntegrity: unsafe.integrity })
    ).toThrow(/reviewed runtime dependency set/);
    const vulnerable = fixture({ bundledTarVersion: '7.5.20' });
    expect(() =>
      installPinnedNpm({ run: runner(), directory: vulnerable.root, expectedIntegrity: vulnerable.integrity })
    ).toThrow(/reviewed runtime dependency set/);
    const wrongPackage = fixture({ version: '10.9.8' });
    expect(() =>
      installPinnedNpm({ run: runner(), directory: wrongPackage.root, expectedIntegrity: wrongPackage.integrity })
    ).toThrow(/reviewed runtime dependency set/);
    const wrongBundledName = fixture({ bundledTarName: 'not-tar' });
    expect(() =>
      installPinnedNpm({
        run: runner(),
        directory: wrongBundledName.root,
        expectedIntegrity: wrongBundledName.integrity
      })
    ).toThrow(/reviewed runtime dependency set/);
    expect(() =>
      installPinnedNpm({ run: runner('10.0.0'), directory: trusted.root, expectedIntegrity: trusted.integrity })
    ).toThrow(/active npm version/);
  });

  it('rejects an unreadable embedded manifest', () => {
    expect(() => inspectNpmTarball('/fixture.tgz', () => 'not-json')).toThrow(/manifest is invalid/);
  });

  it.each(['{}', 'not-json', JSON.stringify([{ filename: '../npm-10.9.9.tgz' }])])(
    'rejects malformed pack output %j',
    output => {
      const run = vi.fn(() => output);
      expect(() => installPinnedNpm({ run, directory: fixture().root, expectedIntegrity: 'unused' })).toThrow(
        /pack output/
      );
    }
  );

  it('cleans temporary files and routes CLI success and failures', () => {
    const trusted = fixture();
    const removeDirectory = vi.fn();
    const options = {
      run: runner(),
      makeDirectory: () => trusted.root,
      removeDirectory,
      expectedIntegrity: trusted.integrity
    };
    installFromRegistry(options);
    expect(removeDirectory).toHaveBeenCalledWith(trusted.root);
    createInstaller(options)();
    const install = vi.fn();
    const logError = vi.fn();
    const setExitCode = vi.fn();
    expect(runCli({ argv1: '/other', scriptPath: '/script', install, logError, setExitCode })).toBe(false);
    expect(runCli({ argv1: '/script', scriptPath: '/script', install, logError, setExitCode })).toBe(true);
    install.mockImplementationOnce(() => {
      throw '\u001b[31mfailed\nsecret\u2028' + 'x'.repeat(600);
    });
    runCli({ argv1: '/script', scriptPath: '/script', install, logError, setExitCode });
    expect(logError).toHaveBeenCalledWith('install-pinned-npm: pinned npm installation failed');
    expect(setExitCode).toHaveBeenCalledWith(1);

    install.mockImplementationOnce(() => {
      throw new Error('error object');
    });
    runCli({ argv1: '/script', scriptPath: '/script', install, logError, setExitCode });
    expect(logError).not.toHaveBeenCalledWith(expect.stringContaining('error object'));
  });

  it('cleans temporary files when installation fails', () => {
    const removeDirectory = vi.fn();
    expect(() =>
      installFromRegistry({
        run: () => {
          throw new Error('registry unavailable');
        },
        makeDirectory: () => '/temporary',
        removeDirectory,
        expectedIntegrity: 'unused'
      })
    ).toThrow(/registry unavailable/);
    expect(removeDirectory).toHaveBeenCalledWith('/temporary');
  });

  it('covers filesystem and command helpers', () => {
    expect(command(process.execPath, ['--version'])).toMatch(/^v/);
    const directory = makeTemporaryDirectory();
    expect(readFileSync(join(directory, 'missing'), { encoding: 'utf8', flag: 'a+' })).toBe('');
    removeTemporaryDirectory(directory);
    const priorExitCode = process.exitCode;
    setProcessExitCode(0);
    expect(process.exitCode).toBe(0);
    process.exitCode = priorExitCode;
  });
});
