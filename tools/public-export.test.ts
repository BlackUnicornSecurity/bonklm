import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — dependency-free release script has no declaration file
import {
  checkPublicExport,
  rejectPublicDisclosureMarkers,
  runCli,
  setProcessExitCode,
  trackedFiles,
  validatePublicPath
} from '../scripts/check-public-export.js';

const temporary: string[] = [];
const privateAddress = ['192', '168', '1', '1'].join('.');
afterEach(() => temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bonklm-public-export-'));
  temporary.push(root);
  mkdirSync(join(root, 'packages', 'core'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# Public\n');
  writeFileSync(join(root, 'packages', 'core', 'index.ts'), 'export const publicValue = true;\n');
  writeFileSync(
    join(root, 'packages', 'core', 'package.json'),
    JSON.stringify({ name: '@blackunicorn/core', license: 'Apache-2.0' })
  );
  return root;
}

describe('public release export boundary', () => {
  it('rejects internal incident and scanner-version breadcrumbs', () => {
    for (const text of [
      ['D', '042 shipped this change'].join('-'),
      ['audit', 'closure details'].join('-'),
      ['SME', 'review details'].join(' '),
      ['internal', 'review findings'].join(' '),
      ['Story', '2.13', 'audit sec S6'].join(' '),
      ['SEC', '001'].join('-'),
      ['DEV', '006'].join('-'),
      ['sec', 'v5#9 closure'].join(' '),
      `${['GITLEAKS', 'VERSION'].join('_')}: '8.30.1'`,
      ['gitleaks', 'v8.30.1'].join(' ')
    ]) {
      expect(() => rejectPublicDisclosureMarkers(text)).toThrow(/public disclosure marker/);
    }
    expect(rejectPublicDisclosureMarkers('Hardened validation with regression coverage.')).toBe(true);
    expect(rejectPublicDisclosureMarkers('SIR-D-001 is a public corpus case identifier.')).toBe(true);
    expect(
      rejectPublicDisclosureMarkers(
        readFileSync(fileURLToPath(new URL('../scripts/check-public-export.js', import.meta.url)), 'utf8')
      )
    ).toBe(true);
    expect(rejectPublicDisclosureMarkers(readFileSync(fileURLToPath(import.meta.url), 'utf8'))).toBe(true);
  });

  it('accepts only the explicit public root and tools-subtree allowlists', () => {
    expect(validatePublicPath('README.md')).toBe(true);
    expect(validatePublicPath('tools/release-state.js')).toBe(true);
    expect(validatePublicPath('tools/eslint-plugin-bonklm-edge/src/index.ts')).toBe(true);
    expect(() => validatePublicPath('demo/private/file')).toThrow(/unapproved root/);
    expect(() => validatePublicPath('tools/operator-only/file')).toThrow(/unapproved tools subtree/);
    expect(() => validatePublicPath('.github/workflows/oss-export-gate.yml')).toThrow(/canonical-only/);
    expect(() => validatePublicPath('docs/forged\n::error::path.md')).toThrow(/unsafe/);
    expect(() => validatePublicPath('docs/bidi\u202ename.md')).toThrow(/unsafe/);
  });

  it('scans exact tracked paths and bytes and rejects symlinks', () => {
    const root = fixture();
    const paths = ['README.md', 'packages/core/index.ts', 'packages/core/package.json'];
    expect(checkPublicExport(root, paths, ['private-marker'])).toBe(3);
    writeFileSync(join(root, 'packages', 'core', 'index.ts'), 'private-marker');
    expect(() => checkPublicExport(root, paths, ['private-marker'])).toThrow(/restricted/);
    writeFileSync(join(root, 'packages', 'core', 'index.ts'), 'safe');
    expect(() =>
      checkPublicExport(root, ['packages/core/package.json', 'packages/core/private-marker.ts'], ['private-marker'])
    ).toThrow(/restricted/);
    expect(() => checkPublicExport(root, [], ['private-marker'])).toThrow(/empty/);
    symlinkSync(join(root, 'README.md'), join(root, 'packages', 'core', 'link.ts'));
    expect(() =>
      checkPublicExport(root, ['packages/core/package.json', 'packages/core/link.ts'], ['private-marker'])
    ).toThrow(/symbolic link/);
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets', 'logo.png'), Buffer.from([0, 1, 2]));
    expect(() => checkPublicExport(root, ['assets/logo.png'], ['private-marker'])).toThrow(/reviewed binary/);
    const reviewedLogo = readFileSync(fileURLToPath(new URL('../assets/logo.jpg', import.meta.url)));
    writeFileSync(join(root, 'assets', 'logo.jpg'), reviewedLogo);
    expect(checkPublicExport(root, ['assets/logo.jpg'], ['private-marker'])).toBe(1);
    writeFileSync(join(root, 'assets', 'logo.jpg'), Buffer.concat([reviewedLogo, Buffer.from([0])]));
    expect(() => checkPublicExport(root, ['assets/logo.jpg'], ['private-marker'])).toThrow(/reviewed binary/);
    writeFileSync(join(root, 'assets', 'logo.png'), Buffer.from('private-marker'));
    expect(() => checkPublicExport(root, ['assets/logo.png'], ['private-marker'])).toThrow(/restricted/);
    const utf16 = Buffer.from('private-marker', 'utf16le');
    for (const bytes of [utf16, Buffer.from(utf16).swap16()]) {
      writeFileSync(join(root, 'assets', 'logo.png'), Buffer.concat([Buffer.from([0xff]), bytes]));
      expect(() => checkPublicExport(root, ['assets/logo.png'], ['private-marker'])).toThrow(/restricted/);
    }
    writeFileSync(
      join(root, 'assets', 'logo.png'),
      Buffer.concat([Buffer.from([0xff]), Buffer.from(privateAddress, 'utf16le')])
    );
    expect(() => checkPublicExport(root, ['assets/logo.png'], ['private-marker'])).toThrow(/private-network-address/);
    writeFileSync(
      join(root, 'assets', 'logo.png'),
      Buffer.concat([Buffer.from([0xff]), Buffer.from(['D', '042'].join('-'), 'utf16le')])
    );
    expect(() => checkPublicExport(root, ['assets/logo.png'], ['private-marker'])).toThrow(/disclosure marker/);
    writeFileSync(join(root, 'assets', 'payload.zip'), 'safe outer bytes');
    expect(() => checkPublicExport(root, ['assets/payload.zip'], ['private-marker'])).toThrow(/nested archive/);
    writeFileSync(join(root, 'assets', 'renamed.png'), gzipSync('private-marker'));
    expect(() => checkPublicExport(root, ['assets/renamed.png'], ['private-marker'])).toThrow(/nested archive/);
    const fixturePath = 'packages/logger/tests/unit/transform.spec.ts';
    mkdirSync(join(root, 'packages', 'logger', 'tests', 'unit'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'logger', 'package.json'),
      JSON.stringify({ name: '@blackunicorn/logger', license: 'Apache-2.0' })
    );
    writeFileSync(join(root, fixturePath), privateAddress);
    expect(checkPublicExport(root, ['packages/logger/package.json', fixturePath], ['private-marker'])).toBe(2);
    writeFileSync(join(root, 'packages', 'core', 'index.ts'), privateAddress);
    expect(() => checkPublicExport(root, paths, ['private-marker'])).toThrow(/private-network-address/);
  });

  it('requires every exported package root to declare the Apache OSS license', () => {
    const root = fixture();
    const manifestPath = join(root, 'packages', 'core', 'package.json');
    const paths = ['README.md', 'packages/core/index.ts', 'packages/core/package.json'];
    writeFileSync(manifestPath, JSON.stringify({ name: '@blackunicorn/core', license: 'Apache-2.0' }));
    expect(checkPublicExport(root, paths, ['private-marker'])).toBe(3);
    writeFileSync(manifestPath, JSON.stringify({ name: '@blackunicorn/core', license: 'BUSL-1.1' }));
    expect(() => checkPublicExport(root, paths, ['private-marker'])).toThrow(/non-Apache package/);
    writeFileSync(manifestPath, JSON.stringify({ name: '@blackunicorn/core' }));
    expect(() => checkPublicExport(root, paths, ['private-marker'])).toThrow(/non-Apache package/);
    writeFileSync(manifestPath, '{not-json');
    expect(() => checkPublicExport(root, paths, ['private-marker'])).toThrow(/manifest is invalid/);
    expect(() => checkPublicExport(root, ['packages/core/index.ts'], ['private-marker'])).toThrow(
      /manifest is missing/
    );
  });

  it('routes CLI success and failure and lists tracked files without shell interpolation', () => {
    const root = fixture();
    const log = vi.fn();
    const logError = vi.fn();
    const setExitCode = vi.fn();
    expect(
      runCli({
        argv1: '/other',
        scriptPath: '/script',
        repoRoot: root,
        restrictedValue: 'private-marker',
        list: () => ['README.md'],
        log,
        logError,
        setExitCode
      })
    ).toBe(false);
    expect(
      runCli({
        argv1: '/script',
        scriptPath: '/script',
        repoRoot: root,
        restrictedValue: 'private-marker',
        list: () => ['README.md'],
        log,
        logError,
        setExitCode
      })
    ).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('PASS'));
    runCli({
      argv1: '/script',
      scriptPath: '/script',
      repoRoot: root,
      restrictedValue: '',
      list: () => ['README.md'],
      log,
      logError,
      setExitCode
    });
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('FAIL'));

    runCli({
      argv1: '/script',
      scriptPath: '/script',
      repoRoot: root,
      restrictedValue: 'private-marker',
      list: () => {
        throw 'synthetic failure\n::error::forged';
      },
      log,
      logError,
      setExitCode
    });
    expect(logError).toHaveBeenLastCalledWith('check-public-export: FAIL — public export validation failed');

    mkdirSync(join(root, '.git'));
    expect(() => trackedFiles(root)).toThrow();

    rmSync(join(root, '.git'), { recursive: true, force: true });
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', 'README.md'], { cwd: root });
    expect(trackedFiles(root)).toEqual(['README.md']);

    const previousExitCode = process.exitCode;
    setProcessExitCode(7);
    expect(process.exitCode).toBe(7);
    process.exitCode = previousExitCode;
  });
});
