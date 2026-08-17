import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — dependency-free release script has no declaration file
import {
  assertRuntimeInventory,
  expectedNpmIdentities,
  listInstalledRuntime,
  runCli,
  setProcessExitCode
} from '../scripts/check-image-runtime.mjs';

const rootList = [
  {
    name: '@blackunicorn/bonklm-server',
    version: '1.0.0',
    dependencies: {
      '@blackunicorn/bonklm': {
        from: '@blackunicorn/bonklm',
        version: 'link:../core',
        path: '/workspace/packages/core',
        dependencies: { dotenv: { from: 'dotenv', version: '17.3.1' } }
      },
      fastify: { from: 'fastify', version: '5.12.0' }
    }
  }
];

const inventory = (versions = { dotenv: '17.3.1', fastify: '5.12.0' }) => ({
  schemaVersion: 1,
  source: 'image-filesystem',
  components: [
    { ecosystem: 'npm', name: '@blackunicorn/bonklm-server', version: '1.0.0' },
    { ecosystem: 'npm', name: '@blackunicorn/bonklm', version: '1.0.0' },
    { ecosystem: 'npm', name: 'dotenv', version: versions.dotenv },
    { ecosystem: 'npm', name: 'fastify', version: versions.fastify },
    { ecosystem: 'npm', name: 'benchmark', version: '1.0.0' },
    { ecosystem: 'npm', name: 'benchmarks', version: '1.0.0' },
    { ecosystem: 'npm', name: 'transport', version: '0.0.1' }
  ]
});

const readManifest = () => ({ name: '@blackunicorn/bonklm', version: '1.0.0' });
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('container runtime lock binding', () => {
  it('derives the complete production identity set from pnpm list output', () => {
    expect([...expectedNpmIdentities(rootList, readManifest)].sort()).toEqual([
      '@blackunicorn/bonklm-server@1.0.0',
      '@blackunicorn/bonklm@1.0.0',
      'dotenv@17.3.1',
      'fastify@5.12.0'
    ]);
    expect(() => expectedNpmIdentities({}, readManifest)).toThrow(/pnpm list/);
    expect(() => expectedNpmIdentities([{ name: '', version: '1.0.0' }], readManifest)).toThrow(/identity/);
    expect(() =>
      expectedNpmIdentities(
        [{ name: 'root', version: '1.0.0', dependencies: { bad: { from: 'bad', version: 'link:../bad' } } }],
        readManifest
      )
    ).toThrow(/workspace dependency/);
    expect(() =>
      expectedNpmIdentities([{ name: 'root', version: '1.0.0', dependencies: { bad: null } }], readManifest)
    ).toThrow(/dependency record/);
    expect(() =>
      expectedNpmIdentities([{ name: 'root', version: '1.0.0', dependencies: { bad: {} } }], readManifest)
    ).toThrow(/identity/);
    expect(() => expectedNpmIdentities([{ name: 'root', version: '1.0.0', dependencies: [] }], readManifest)).toThrow(
      /dependency map/
    );
    expect(expectedNpmIdentities([{ name: 'root', version: '1.0.0' }], readManifest)).toEqual(new Set(['root@1.0.0']));
    expect(
      expectedNpmIdentities(
        [{ name: 'root', version: '1.0.0', dependencies: { child: { version: '2.0.0' } } }],
        readManifest
      )
    ).toEqual(new Set(['root@1.0.0', 'child@2.0.0']));
    expect(() =>
      expectedNpmIdentities(
        [
          {
            name: 'root',
            version: '1.0.0',
            dependencies: { child: { version: 'link:../child', path: '/child' } }
          }
        ],
        () => null
      )
    ).toThrow(/identity/);
  });

  it('loads workspace identities from package manifests and fails closed when unreadable', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-image-runtime-'));
    roots.push(root);
    const child = join(root, 'child');
    mkdirSync(child);
    writeFileSync(join(child, 'package.json'), JSON.stringify({ name: 'child', version: '2.0.0' }));
    const graph = [{ name: 'root', version: '1.0.0', dependencies: { child: { version: 'link:child', path: child } } }];
    expect(expectedNpmIdentities(graph)).toEqual(new Set(['root@1.0.0', 'child@2.0.0']));
    writeFileSync(join(child, 'package.json'), '{');
    expect(() => expectedNpmIdentities(graph)).toThrow(/unreadable workspace dependency/);
    expect(JSON.parse(listInstalledRuntime())).toEqual(expect.any(Array));
  });

  it('accepts the frozen graph plus only the reviewed embedded fixture manifests', () => {
    const expected = expectedNpmIdentities(rootList, readManifest);
    expect(assertRuntimeInventory(inventory(), expected)).toBeUndefined();
    expect(() => assertRuntimeInventory(inventory({ dotenv: '17.4.2', fastify: '5.12.0' }), expected)).toThrow(
      /missing.*dotenv@17\.3\.1/i
    );
    const withUnexpected = inventory();
    withUnexpected.components.push({ ecosystem: 'npm', name: 'surprise', version: '9.9.9' });
    expect(() => assertRuntimeInventory(withUnexpected, expected)).toThrow(/unexpected.*surprise@9\.9\.9/i);
    expect(() => assertRuntimeInventory({}, expected)).toThrow(/inventory/);
  });

  it('routes CLI success and failure without running on import', () => {
    const log = vi.fn();
    const logError = vi.fn();
    const setExitCode = vi.fn();
    const list = vi.fn(() => JSON.stringify(rootList));
    const read = vi.fn(() => JSON.stringify(inventory()));
    expect(
      runCli({
        argv1: '/other',
        scriptPath: '/script',
        files: [],
        list,
        read,
        readManifest,
        log,
        logError,
        setExitCode
      })
    ).toBe(false);
    expect(
      runCli({
        argv1: '/script',
        scriptPath: '/script',
        files: ['one', 'two'],
        list,
        read,
        readManifest,
        log,
        logError,
        setExitCode
      })
    ).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('PASS'));
    expect(read).toHaveBeenCalledTimes(2);
    expect(
      runCli({
        argv1: '/script',
        scriptPath: '/script',
        files: [],
        list,
        read,
        readManifest,
        log,
        logError,
        setExitCode
      })
    ).toBe(true);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('FAIL'));
    expect(setExitCode).toHaveBeenCalledWith(1);
    runCli({
      argv1: '/script',
      scriptPath: '/script',
      files: ['one'],
      list: () => {
        throw 'non-error failure';
      },
      read,
      readManifest,
      log,
      logError,
      setExitCode
    });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('non-error failure'));
    const previous = process.exitCode;
    setProcessExitCode(7);
    expect(process.exitCode).toBe(7);
    process.exitCode = previous;
  });
});
