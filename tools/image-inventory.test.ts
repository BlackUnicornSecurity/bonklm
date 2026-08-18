import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — dependency-free container script has no declaration file
import { buildImageInventory, runCli, setProcessExitCode } from '../scripts/image-inventory.mjs';

const roots: string[] = [];

function imageRoot() {
  const root = mkdtempSync(join(tmpdir(), 'bonklm-image-inventory-'));
  roots.push(root);
  mkdirSync(join(root, 'etc'), { recursive: true });
  mkdirSync(join(root, 'lib', 'apk', 'db'), { recursive: true });
  mkdirSync(join(root, 'app', 'node_modules', 'fastify'), { recursive: true });
  mkdirSync(join(root, 'usr', 'local', 'bin'), { recursive: true });
  writeFileSync(join(root, 'etc', 'alpine-release'), '3.24.1\n');
  writeFileSync(join(root, 'lib', 'apk', 'db', 'installed'), 'P:musl\nV:1.2.6-r2\n\nP:busybox\nV:1.37.0-r31\n');
  writeFileSync(join(root, 'app', 'package.json'), JSON.stringify({ name: '@blackunicorn/server', version: '1.0.1' }));
  writeFileSync(
    join(root, 'app', 'node_modules', 'fastify', 'package.json'),
    JSON.stringify({ name: 'fastify', version: '5.12.0' })
  );
  writeFileSync(join(root, 'usr', 'local', 'bin', 'node'), 'synthetic node runtime');
  return root;
}

const runtime = { version: 'v24.19.0', executable: '/usr/local/bin/node' };

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('image filesystem inventory', () => {
  it('enumerates the OS, installed APKs, and physical npm manifests deterministically', () => {
    const root = imageRoot();
    mkdirSync(join(root, 'app', 'subpath'), { recursive: true });
    writeFileSync(join(root, 'app', 'subpath', 'package.json'), '{}');
    symlinkSync(join(root, 'app'), join(root, 'app', 'node_modules', 'loop'));
    expect(buildImageInventory(root, runtime)).toEqual({
      schemaVersion: 1,
      source: 'image-filesystem',
      components: [
        { ecosystem: 'apk', name: 'busybox', version: '1.37.0-r31' },
        { ecosystem: 'apk', name: 'musl', version: '1.2.6-r2' },
        { ecosystem: 'npm', name: '@blackunicorn/server', version: '1.0.1' },
        { ecosystem: 'npm', name: 'fastify', version: '5.12.0' },
        { ecosystem: 'os', name: 'alpine', version: '3.24.1' },
        {
          ecosystem: 'runtime',
          name: 'node',
          version: '24.19.0',
          sha256: '73b30df224d198e43ab4a68bd265a2350ab13d99b0df14566c4a24e88d6b8276'
        }
      ]
    });
  });

  it('fails closed on malformed filesystem metadata', () => {
    const root = imageRoot();
    writeFileSync(join(root, 'app', 'package.json'), '{');
    expect(() => buildImageInventory(root, runtime)).toThrow(/package manifest/);
    writeFileSync(join(root, 'app', 'package.json'), JSON.stringify({ name: 'server', version: '1.0.1' }));
    writeFileSync(
      join(root, 'app', 'node_modules', 'fastify', 'package.json'),
      JSON.stringify({ name: '', version: '1.0.0' })
    );
    expect(() => buildImageInventory(root, runtime)).toThrow(/invalid package manifest/);
    writeFileSync(
      join(root, 'app', 'node_modules', 'fastify', 'package.json'),
      JSON.stringify({ name: 'fastify', version: '5.12.0' })
    );
    writeFileSync(join(root, 'lib', 'apk', 'db', 'installed'), 'P:musl\n');
    expect(() => buildImageInventory(root, runtime)).toThrow(/APK database/);
    writeFileSync(join(root, 'lib', 'apk', 'db', 'installed'), 'P:musl\nV:1.2.6-r2\n');
    writeFileSync(join(root, 'etc', 'alpine-release'), '\n');
    expect(() => buildImageInventory(root, runtime)).toThrow(/Alpine version/);
    writeFileSync(join(root, 'etc', 'alpine-release'), '3.24.1\n');
    expect(() => buildImageInventory(root, { version: 'v24.19.0', executable: 'node' })).toThrow(/absolute path/);
  });

  it('writes JSON only when invoked as the CLI and reports failures', () => {
    const root = imageRoot();
    const log = vi.fn();
    const logError = vi.fn();
    const setExitCode = vi.fn();
    expect(runCli({ argv1: '/other', scriptPath: '/script', root, log, logError, setExitCode })).toBe(false);
    const build = (value: string) => buildImageInventory(value, runtime);
    expect(runCli({ argv1: '/script', scriptPath: '/script', root, build, log, logError, setExitCode })).toBe(true);
    expect(JSON.parse(log.mock.calls[0][0]).components).toHaveLength(6);
    writeFileSync(join(root, 'app', 'package.json'), '{');
    expect(runCli({ argv1: '/script', scriptPath: '/script', root, build, log, logError, setExitCode })).toBe(true);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('FAIL'));
    expect(setExitCode).toHaveBeenCalledWith(1);
    runCli({
      argv1: '/script',
      scriptPath: '/script',
      root,
      build: () => {
        throw 'non-error failure';
      },
      log,
      logError,
      setExitCode
    });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('non-error failure'));
    expect(() => buildImageInventory()).toThrow();
    const previous = process.exitCode;
    setProcessExitCode(7);
    expect(process.exitCode).toBe(7);
    process.exitCode = previous;
  });
});
