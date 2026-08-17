import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkReleaseTarballs,
  checkWorkspaceTarballs,
  decodedTextValues,
  hasArchiveMagic,
  hasUnsafePathCharacter,
  parseRestrictedTerms,
  rejectSpecialFiles,
  runCli,
  scanPublicTextValue,
  scanRestrictedTermValue,
  setProcessExitCode,
  validateTarballEntries,
  validateShippedLicense
} from '../scripts/check-release-tarballs.js';

const manifest = {
  name: '@blackunicorn/example',
  version: '1.0.1',
  license: 'Apache-2.0',
  files: ['dist', 'README.md', 'LICENSE']
};
const temporary: string[] = [];
const canonicalApacheLicense = readFileSync(join(process.cwd(), 'packages/core/LICENSE'), 'utf8');

function writeMetadata(packageDir: string, packageManifest = manifest) {
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify(packageManifest));
  writeFileSync(join(packageDir, 'README.md'), '# Example\n');
  writeFileSync(join(packageDir, 'LICENSE'), canonicalApacheLicense);
}

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('public-safe exact tarball surface gate', () => {
  it('handles empty binary text and non-buffer archive probes', () => {
    expect(decodedTextValues(Buffer.alloc(0))).toEqual(['']);
    expect(hasArchiveMagic('not-bytes')).toBe(false);
  });

  it('recognizes prefixed ZIP and checksum-valid V7 TAR payloads by content', () => {
    expect(hasArchiveMagic(Buffer.concat([Buffer.from('prefix'), Buffer.from('504b0304', 'hex')]))).toBe(true);
    expect(hasArchiveMagic(Buffer.concat([Buffer.from('prefix'), Buffer.from('377abcaf271c', 'hex')]))).toBe(true);
    expect(hasArchiveMagic(Buffer.concat([Buffer.from('prefix'), Buffer.from('526172211a070100', 'hex')]))).toBe(true);
    const tar = Buffer.alloc(512);
    tar.write('payload.txt', 0, 'ascii');
    tar.write('0000644\0', 100, 'ascii');
    tar.write('0000000\0', 108, 'ascii');
    tar.write('0000000\0', 116, 'ascii');
    tar.write('00000000000\0', 124, 'ascii');
    tar.write('00000000000\0', 136, 'ascii');
    tar.fill(0x20, 148, 156);
    tar[156] = '0'.charCodeAt(0);
    const checksum = tar.reduce((sum, byte) => sum + byte, 0);
    tar.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
    expect(hasArchiveMagic(tar)).toBe(true);
  });

  it('accepts only manifest-allowlisted package files with compiled code', () => {
    expect(() =>
      validateTarballEntries(manifest, [
        'package/package.json',
        'package/README.md',
        'package/LICENSE',
        'package/dist/index.js',
        'package/dist/index.d.ts'
      ])
    ).not.toThrow();
    expect(() =>
      validateTarballEntries(manifest, [
        'package/package.json',
        'package/README.md',
        'package/LICENSE',
        'package/dist/index.js',
        ['package', 'team', 'private.md'].join('/')
      ])
    ).toThrow(/not allowlisted/);
  });

  it.each([
    ['path traversal', ['package/package.json', 'package/../outside.js']],
    ['path traversal directory', ['package/', 'package/../outside/', 'package/package.json', 'package/dist/index.js']],
    ['absolute path', ['/package/package.json']],
    ['backslash path', ['package/package.json', 'package/dist\\index.js']],
    ['glob path', ['package/package.json', 'package/dist/*.js']],
    ['duplicate manifest', ['package/package.json', 'package/package.json', 'package/dist/index.js']],
    ['missing manifest', ['package/dist/index.js']],
    ['missing README', ['package/package.json', 'package/LICENSE', 'package/dist/index.js']],
    ['missing LICENSE', ['package/package.json', 'package/README.md', 'package/dist/index.js']],
    ['missing compiled code', ['package/package.json', 'package/README.md', 'package/LICENSE']]
  ])('rejects %s', (_label, entries) => {
    expect(() => validateTarballEntries(manifest, entries)).toThrow();
  });

  it.each([
    'package/node_modules/embedded/index.js',
    'package/examples/Node_Modules/embedded/index.js',
    'package/npm-shrinkwrap.json',
    'package/examples/NPM-SHRINKWRAP.JSON',
    'package/package-lock.json',
    'package/examples/package-lock.json',
    'package/pnpm-lock.yaml',
    'package/yarn.lock',
    'package/bun.lock'
  ])('rejects dependency bytes or resolution metadata at %s even when allowlisted', entry => {
    expect(() =>
      validateTarballEntries(
        { ...manifest, files: [...manifest.files, 'node_modules', entry.slice('package/'.length)] },
        ['package/package.json', 'package/README.md', 'package/LICENSE', 'package/dist/index.js', entry]
      )
    ).toThrow(/dependency tree or lockfile/);
  });

  it('rejects case-fold path collisions and non-portable archive names', () => {
    for (const character of ['\n', '\u007f', '\u061c', '\u200b', '\u202e', '\u2060', '\ufeff']) {
      expect(hasUnsafePathCharacter(character)).toBe(true);
    }
    expect(hasUnsafePathCharacter('portable-name')).toBe(false);
    expect(() =>
      validateTarballEntries(manifest, [
        'package/package.json',
        'package/README.md',
        'package/LICENSE',
        'package/dist/index.js',
        'package/dist/INDEX.js'
      ])
    ).toThrow(/unsafe/);
    for (const entry of [
      'package/dist/CON.js',
      'package/dist/COM¹.js',
      'package/dist/LPT³.js',
      'package/dist/control\nname.js',
      'package/dist/bidi\u202ename.js',
      'package/dist/cafe\u0301.js'
    ]) {
      expect(() =>
        validateTarballEntries(manifest, [
          'package/package.json',
          'package/README.md',
          'package/LICENSE',
          'package/dist/index.js',
          entry
        ])
      ).toThrow(/unsafe/);
    }
  });

  it('rejects a tampered bundled dependency from an exact tarball', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'release-tarball-bundled-dependency-'));
    temporary.push(workspace);
    const packageDir = join(workspace, 'content', 'package');
    const tarballs = join(workspace, 'tarballs');
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    mkdirSync(join(packageDir, 'node_modules', 'embedded'), { recursive: true });
    mkdirSync(tarballs);
    writeMetadata(packageDir, {
      ...manifest,
      bundleDependencies: ['embedded'],
      dependencies: { embedded: '^1.0.0' },
      files: [...manifest.files, 'node_modules']
    });
    writeFileSync(join(packageDir, 'dist', 'index.js'), 'export const ok = true;\n');
    writeFileSync(join(packageDir, 'node_modules', 'embedded', 'index.js'), 'export const tampered = true;\n');
    execFileSync('tar', ['-czf', join(tarballs, 'bundled.tgz'), '-C', join(workspace, 'content'), 'package']);

    expect(() => checkReleaseTarballs(tarballs)).toThrow(/dependency tree or lockfile/);
  });

  it.each([
    null,
    { version: '1.0.1', files: ['dist'] },
    { name: '@blackunicorn/example', files: ['dist'] },
    { name: '@blackunicorn/example', version: '1.0.1', files: 'dist' },
    { name: '@blackunicorn/example', version: '1.0.1', files: [] },
    { name: '@blackunicorn/example', version: '1.0.1', files: ['../dist'] },
    { name: '@blackunicorn/example', version: '1.0.1', files: [42] }
  ])('rejects a manifest without a safe explicit allowlist', invalid => {
    expect(() => validateTarballEntries(invalid, ['package/package.json', 'package/dist/index.js'])).toThrow(
      /manifest/
    );
  });

  it('checks the retained tarball directory without repacking', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'release-tarball-surface-'));
    temporary.push(workspace);
    const content = join(workspace, 'content', 'package', 'dist');
    const tarballs = join(workspace, 'tarballs');
    mkdirSync(content, { recursive: true });
    mkdirSync(tarballs);
    writeFileSync(join(content, 'index.js'), 'export const ok = true;\n');
    writeFileSync(join(content, 'asset.dat'), 'binary');
    writeMetadata(join(workspace, 'content', 'package'));
    execFileSync('tar', ['-czf', join(tarballs, 'fixture.tgz'), '-C', join(workspace, 'content'), 'package']);
    const result = spawnSync(process.execPath, ['scripts/check-release-tarballs.js'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, BONKLM_TARBALL_DIR: tarballs }
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('1 exact tarball');
    expect(checkReleaseTarballs(tarballs)).toBe(1);
  });

  it('rejects a symlink archive before extraction touches its target', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'release-tarball-link-'));
    temporary.push(workspace);
    const packageDir = join(workspace, 'content', 'package');
    const tarballs = join(workspace, 'tarballs');
    const sentinel = join(workspace, 'sentinel');
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    mkdirSync(tarballs);
    writeMetadata(packageDir);
    writeFileSync(sentinel, 'unchanged');
    symlinkSync(sentinel, join(packageDir, 'dist', 'link.js'));
    execFileSync('tar', ['-czf', join(tarballs, 'link.tgz'), '-C', join(workspace, 'content'), 'package']);
    expect(() => checkReleaseTarballs(tarballs)).toThrow(/link or special file/);
    expect(readFileSync(sentinel, 'utf8')).toBe('unchanged');
  });

  it('rejects generic internal-environment markers in exact compiled bytes', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'release-tarball-deny-'));
    temporary.push(workspace);
    const packageDir = join(workspace, 'content', 'package');
    const tarballs = join(workspace, 'tarballs');
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    mkdirSync(tarballs);
    writeMetadata(packageDir);
    const privateAddress = ['http://10', '23', '45', '67'].join('.');
    writeFileSync(join(packageDir, 'dist', 'index.js'), `export const endpoint = "${privateAddress}";\n`);
    execFileSync('tar', ['-czf', join(tarballs, 'deny.tgz'), '-C', join(workspace, 'content'), 'package']);
    expect(() => checkReleaseTarballs(tarballs)).toThrow(/private-network-address/);
  });

  it('rejects restricted terms supplied privately without embedding fingerprints', () => {
    const terms = parseRestrictedTerms('synthetic restricted\nsecond marker', true);
    expect(() => scanPublicTextValue('safe synthetic restricted text', terms)).toThrow(/restricted-internal-term/);
    expect(() => scanPublicTextValue('ordinary public text', terms)).not.toThrow();
    expect(() => scanPublicTextValue('')).not.toThrow();
    expect(() => scanRestrictedTermValue('ordinary public text')).not.toThrow();
    expect(() => parseRestrictedTerms('', true)).toThrow(/Private deny policy/);
    expect(parseRestrictedTerms('', false)).toEqual([]);
    expect(() => parseRestrictedTerms('x'.repeat(129), false)).toThrow(/invalid/);
    expect(() => parseRestrictedTerms(Array(1001).fill('x').join('\n'), false)).toThrow(/invalid/);
    expect(() => scanPublicTextValue('example cwd: /home/daytona')).not.toThrow();
    const operatorPath = ['', 'home', 'realoperator', 'project'].join('/');
    expect(() => scanPublicTextValue(`built at ${operatorPath}`)).toThrow(/operator-home-path/);
  });

  it('rejects a restricted term in a tarball entry name even when file bytes are clean', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'release-tarball-path-deny-'));
    temporary.push(workspace);
    const packageDir = join(workspace, 'content', 'package');
    const tarballs = join(workspace, 'tarballs');
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    mkdirSync(tarballs);
    writeMetadata(packageDir);
    writeFileSync(join(packageDir, 'dist', 'synthetic-restricted.js'), 'export const ok = true;\n');
    execFileSync('tar', ['-czf', join(tarballs, 'path-deny.tgz'), '-C', join(workspace, 'content'), 'package']);

    expect(() => checkReleaseTarballs(tarballs, ['synthetic-restricted'])).toThrow(/restricted-internal-term/);
  });

  it('rejects a restricted term hidden in binary bytes', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'release-tarball-binary-deny-'));
    temporary.push(workspace);
    const packageDir = join(workspace, 'content', 'package');
    const tarballs = join(workspace, 'tarballs');
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    mkdirSync(tarballs);
    writeMetadata(packageDir);
    writeFileSync(join(packageDir, 'dist', 'index.js'), 'export const ok = true;\n');
    writeFileSync(join(packageDir, 'dist', 'asset.dat'), Buffer.from('metadata: synthetic-restricted'));
    execFileSync('tar', ['-czf', join(tarballs, 'binary-deny.tgz'), '-C', join(workspace, 'content'), 'package']);

    expect(() => checkReleaseTarballs(tarballs, ['synthetic-restricted'])).toThrow(/restricted-internal-term/);
  });

  it('rejects opaque binary assets even when their raw bytes look safe', () => {
    expect(() =>
      validateTarballEntries(manifest, [
        'package/package.json',
        'package/README.md',
        'package/LICENSE',
        'package/dist/index.js',
        'package/dist/asset.png'
      ])
    ).toThrow(/opaque binary/);
  });

  it.each([
    ['private-network-address', `metadata: ${['192', '168', '10', '20'].join('.')}`],
    ['scanner-version', ['gitleaks', 'v8.30.1'].join(' ')]
  ])('applies the %s generic public rule to binary bytes', (_rule, content) => {
    const workspace = mkdtempSync(join(tmpdir(), 'release-tarball-binary-generic-'));
    temporary.push(workspace);
    const packageDir = join(workspace, 'content', 'package');
    const tarballs = join(workspace, 'tarballs');
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    mkdirSync(tarballs);
    writeMetadata(packageDir);
    writeFileSync(join(packageDir, 'dist', 'index.js'), 'export const ok = true;\n');
    writeFileSync(
      join(packageDir, 'dist', 'asset.dat'),
      Buffer.concat([Buffer.from([0xff]), Buffer.from(content, 'utf16le')])
    );
    execFileSync('tar', ['-czf', join(tarballs, 'binary-generic.tgz'), '-C', join(workspace, 'content'), 'package']);

    expect(() => checkReleaseTarballs(tarballs, [])).toThrow();
  });

  it.each(['utf16le', 'utf16be'])('rejects a restricted term encoded as %s binary bytes', encoding => {
    const workspace = mkdtempSync(join(tmpdir(), 'release-tarball-encoded-deny-'));
    temporary.push(workspace);
    const packageDir = join(workspace, 'content', 'package');
    const tarballs = join(workspace, 'tarballs');
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    mkdirSync(tarballs);
    writeMetadata(packageDir);
    writeFileSync(join(packageDir, 'dist', 'index.js'), 'export const ok = true;\n');
    const bytes = Buffer.from('metadata: synthetic-restricted', 'utf16le');
    const encoded = encoding === 'utf16be' ? bytes.swap16() : bytes;
    writeFileSync(join(packageDir, 'dist', 'asset.dat'), Buffer.concat([Buffer.from([0xff]), encoded]));
    execFileSync('tar', ['-czf', join(tarballs, 'encoded-deny.tgz'), '-C', join(workspace, 'content'), 'package']);

    expect(() => checkReleaseTarballs(tarballs, ['synthetic-restricted'])).toThrow(/restricted-internal-term/);
  });

  it('rejects a nested archive even when it is explicitly allowlisted', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'release-tarball-nested-archive-'));
    temporary.push(workspace);
    const packageDir = join(workspace, 'content', 'package');
    const tarballs = join(workspace, 'tarballs');
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    mkdirSync(tarballs);
    writeMetadata(packageDir);
    writeFileSync(join(packageDir, 'dist', 'index.js'), 'export const ok = true;\n');
    writeFileSync(join(packageDir, 'dist', 'payload.zip'), 'safe outer bytes');
    execFileSync('tar', ['-czf', join(tarballs, 'nested.tgz'), '-C', join(workspace, 'content'), 'package']);

    expect(() => checkReleaseTarballs(tarballs, [])).toThrow(/nested archive/);
  });

  it('rejects nested archive magic hidden behind a non-archive extension', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'release-tarball-renamed-archive-'));
    temporary.push(workspace);
    const packageDir = join(workspace, 'content', 'package');
    const tarballs = join(workspace, 'tarballs');
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    mkdirSync(tarballs);
    writeMetadata(packageDir);
    writeFileSync(join(packageDir, 'dist', 'index.js'), 'export const ok = true;\n');
    writeFileSync(join(packageDir, 'dist', 'asset.dat'), gzipSync('synthetic-restricted'));
    execFileSync('tar', ['-czf', join(tarballs, 'renamed.tgz'), '-C', join(workspace, 'content'), 'package']);

    expect(() => checkReleaseTarballs(tarballs, ['synthetic-restricted'])).toThrow(/nested archive/);
  });

  it('packs and checks every publishable workspace root when no retained bundle exists', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'release-tarball-workspace-'));
    temporary.push(workspace);
    for (const [area, name, policy] of [
      ['packages', 'family', {}],
      ['tools', 'public-tool', { workspacePolicy: 'tier-b-publishable' }]
    ] as const) {
      const packageDir = join(workspace, area, name);
      mkdirSync(join(packageDir, 'dist'), { recursive: true });
      writeFileSync(
        join(packageDir, 'package.json'),
        JSON.stringify({
          name: `@blackunicorn/${name}`,
          version: '1.0.0',
          license: 'Apache-2.0',
          files: ['dist', 'README.md', 'LICENSE'],
          ...policy
        })
      );
      writeFileSync(join(packageDir, 'dist', 'index.js'), 'export const ok = true;\n');
      writeFileSync(join(packageDir, 'README.md'), '# Example\n');
      writeFileSync(join(packageDir, 'LICENSE'), canonicalApacheLicense);
    }
    expect(checkWorkspaceTarballs(workspace, [])).toBe(2);
    expect(() => checkWorkspaceTarballs(join(workspace, 'empty'))).toThrow(/empty/);
  });

  it('fails closed for missing, non-directory, and empty supplied paths', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'release-tarball-input-'));
    temporary.push(workspace);
    const file = join(workspace, 'file');
    const empty = join(workspace, 'empty');
    writeFileSync(file, 'x');
    mkdirSync(empty);
    expect(() => checkReleaseTarballs(join(workspace, 'missing'))).toThrow(/does not exist/);
    expect(() => checkReleaseTarballs(file)).toThrow(/does not exist/);
    expect(() => checkReleaseTarballs(empty)).toThrow(/empty/);
  });

  it('rejects extracted special files as defense in depth', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'release-tarball-special-'));
    temporary.push(workspace);
    const file = join(workspace, 'file');
    const link = join(workspace, 'link');
    writeFileSync(file, 'x');
    symlinkSync(file, link);
    expect(() => rejectSpecialFiles(workspace)).toThrow(/symbolic link/);
    rmSync(link);
    execFileSync('mkfifo', [join(workspace, 'pipe')]);
    expect(() => rejectSpecialFiles(workspace)).toThrow(/non-regular/);
  });

  it('requires the shipped license text to match package metadata', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'release-tarball-license-'));
    temporary.push(workspace);
    const packageDir = join(workspace, 'package');
    mkdirSync(packageDir);
    const apache = readFileSync(join(process.cwd(), 'packages/core/LICENSE'), 'utf8');
    const mit = readFileSync(join(process.cwd(), 'tools/eslint-plugin-bonklm-edge/LICENSE'), 'utf8');
    writeFileSync(join(packageDir, 'LICENSE'), apache);
    expect(() => validateShippedLicense(manifest, workspace)).not.toThrow();
    writeFileSync(join(packageDir, 'LICENSE'), `${apache}\nAdditional restrictive terms.`);
    expect(() => validateShippedLicense(manifest, workspace)).toThrow(/does not match/);
    writeFileSync(join(packageDir, 'LICENSE'), mit);
    expect(() => validateShippedLicense({ ...manifest, license: 'MIT' }, workspace)).not.toThrow();
    writeFileSync(join(packageDir, 'LICENSE'), `${mit}\nAdditional restrictive terms.`);
    expect(() => validateShippedLicense({ ...manifest, license: 'MIT' }, workspace)).toThrow(/does not match/);
    expect(() => validateShippedLicense({ ...manifest, license: 'BSD-3-Clause' }, workspace)).toThrow(/does not match/);
    rmSync(join(packageDir, 'LICENSE'));
    expect(() => validateShippedLicense(manifest, workspace)).toThrow(/incomplete/);
  });

  it('routes CLI success and failure without running on import', () => {
    const log = vi.fn();
    const logError = vi.fn();
    const setExitCode = vi.fn();
    expect(runCli({ argv1: '/other', scriptPath: '/script', directory: '', log, logError, setExitCode })).toBe(false);
    expect(runCli({ argv1: '/script', scriptPath: '/script', directory: '', log, logError, setExitCode })).toBe(true);
    expect(logError).toHaveBeenCalledWith('check-release-tarballs: FAIL — exact tarball validation failed');
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(
      runCli({
        argv1: '/script',
        scriptPath: '/script',
        directory: '/bundle',
        log,
        logError,
        setExitCode,
        check: () => 2
      })
    ).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('2 exact tarball'));
    expect(
      runCli({
        argv1: '/script',
        scriptPath: '/script',
        directory: '',
        workspace: true,
        repoRoot: '/repo',
        restrictedValue: 'private-marker',
        requireRestricted: true,
        log,
        logError,
        setExitCode,
        checkWorkspace: (root: string, terms: string[]) => {
          expect(root).toBe('/repo');
          expect(terms).toEqual(['private-marker']);
          return 3;
        }
      })
    ).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('3 exact tarball'));
    runCli({
      argv1: '/script',
      scriptPath: '/script',
      directory: '/bundle',
      log,
      logError,
      setExitCode,
      check: () => {
        throw 'non-error\n::error::forged';
      }
    });
    expect(logError).toHaveBeenLastCalledWith('check-release-tarballs: FAIL — exact tarball validation failed');
    setProcessExitCode(0);
    process.exitCode = undefined;
  });
});
