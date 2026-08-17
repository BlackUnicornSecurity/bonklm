import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  attachConsumerIntegrities,
  cleanConsumerIntegrities,
  cleanConsumerLicenseReport,
  packageEntrypointFiles,
  preflightConsumerBundle,
  rootImportablePackages,
  validateInstalledEntrypoints
} from './release-npm-consumer.js';
import { command, prepareBundle } from './release-npm.js';
import { main } from './release-npm-cli.js';
import { fakePack, fixture, prepared } from './release-npm-test-helpers.js';

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('retained npm bundle consumer preflight', () => {
  it.each([
    ['inngest-connector', 'inngest'],
    ['langchain-connector', '@langchain/core'],
    ['livekit-connector', '@livekit/agents'],
    ['livekit-connector', '@livekit/rtc-node'],
    ['nestjs-module', '@nestjs/common'],
    ['nestjs-module', '@nestjs/core'],
    ['nestjs-module', 'reflect-metadata'],
    ['nestjs-module', 'rxjs'],
    ['temporal-middleware', '@temporalio/workflow'],
    ['trigger-connector', '@trigger.dev/sdk']
  ])('keeps the statically imported %s peer %s opt-in', (packageDir, peer) => {
    const manifest = JSON.parse(readFileSync(join(WORKSPACE_ROOT, 'packages', packageDir, 'package.json'), 'utf8'));
    expect(manifest.peerDependenciesMeta?.[peer]?.optional).toBe(true);
  });

  it('installs every exact tarball, validates every entrypoint, and imports peer-free roots', () => {
    const root = fixture();
    for (const name of ['a', 'b']) {
      const manifestPath = join(root, 'packages', name, 'package.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.type = 'module';
      manifest.exports = './dist/index.js';
      if (name === 'b') {
        manifest.peerDependencies = { host: '^1.0.0' };
        manifest.peerDependenciesMeta = { host: { optional: true } };
      }
      writeFileSync(manifestPath, JSON.stringify(manifest));
    }
    const dir = join(root, 'bundle');
    prepareBundle({
      root,
      outputDir: dir,
      version: '1.0.1',
      scope: 'family',
      sourceSha: 'a'.repeat(40),
      expectedFamilySize: 2,
      run: fakePack
    });

    const evidenceDir = mkdtempSync(join(tmpdir(), 'bonklm-consumer-evidence-'));
    const manifest = preflightConsumerBundle({ dir, evidenceDir, run: command });
    expect(manifest.packages).toHaveLength(2);
    expect(rootImportablePackages(dir, manifest.packages).map(pkg => pkg.name)).toEqual([
      '@blackunicorn/a',
      '@blackunicorn/b'
    ]);
    expect(existsSync(join(evidenceDir, 'clean-consumer-inventory.json'))).toBe(true);
    const inventory = JSON.parse(readFileSync(join(evidenceDir, 'clean-consumer-inventory.json'), 'utf8'));
    expect(inventory.packages).toEqual(
      expect.arrayContaining([expect.objectContaining({ integrity: expect.stringMatching(/^sha512-/) })])
    );
    expect(JSON.parse(readFileSync(join(evidenceDir, 'blackunicorn-a.sbom.json'), 'utf8'))).toMatchObject({
      metadata: {
        component: {
          name: '@blackunicorn/a',
          hashes: [expect.objectContaining({ alg: 'SHA-512', content: expect.stringMatching(/^[0-9a-f]{128}$/) })]
        },
        properties: expect.arrayContaining([
          { name: 'bonklm:release:source-sha', value: 'a'.repeat(40) },
          { name: 'bonklm:npm:integrity', value: expect.stringMatching(/^sha512-/) }
        ])
      }
    });
    rmSync(evidenceDir, { recursive: true, force: true });
  });

  it('rejects a missing entrypoint even when an optional peer makes the root non-importable', () => {
    const root = fixture();
    for (const name of ['a', 'b']) {
      const manifestPath = join(root, 'packages', name, 'package.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.type = 'module';
      manifest.exports = name === 'b' ? './dist/missing.js' : './dist/index.js';
      if (name === 'b') {
        manifest.peerDependencies = { host: '^1.0.0' };
        manifest.peerDependenciesMeta = { host: { optional: true } };
      }
      writeFileSync(manifestPath, JSON.stringify(manifest));
    }
    const dir = join(root, 'bundle');
    prepareBundle({
      root,
      outputDir: dir,
      version: '1.0.1',
      scope: 'family',
      sourceSha: 'a'.repeat(40),
      expectedFamilySize: 2,
      run: fakePack
    });

    expect(() =>
      preflightConsumerBundle({
        dir,
        evidenceDir: join(root, 'consumer-evidence'),
        run: command
      })
    ).toThrow(/entrypoint/);
  });

  it('enumerates conditional exports, declaration files, and bins', () => {
    expect(
      packageEntrypointFiles({
        main: './dist/main.js',
        module: './dist/module.js',
        types: './dist/index.d.ts',
        bin: { tool: './dist/bin.js' },
        exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } }
      })
    ).toEqual(['./dist/bin.js', './dist/index.d.ts', './dist/index.js', './dist/main.js', './dist/module.js']);
    expect(
      packageEntrypointFiles({
        exports: ['./dist/index.js', 'dist/plain.js', '../outside.js', '/absolute.js', null, 42]
      })
    ).toEqual(['../outside.js', './dist/index.js', './dist/plain.js', '/absolute.js']);
  });

  it('fails closed on absent, escaped, and non-file entrypoints while checking JavaScript syntax', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-consumer-entrypoints-'));
    const packageDir = join(root, 'package');
    mkdirSync(join(packageDir, 'dist', 'directory.js'), { recursive: true });
    writeFileSync(join(packageDir, 'dist', 'index.js'), 'export const ok = true;\n');
    writeFileSync(join(packageDir, 'dist', 'index.d.ts'), 'export declare const ok: true;\n');
    const run = vi.fn();
    const writeManifest = (value: object) => writeFileSync(join(packageDir, 'package.json'), JSON.stringify(value));

    writeManifest({ name: 'fixture', version: '1.0.0' });
    expect(() => validateInstalledEntrypoints([{ name: 'fixture', dir: packageDir }], run)).toThrow(/no entrypoint/);
    for (const main of ['../outside.js', './dist/missing.js', './dist/directory.js']) {
      writeManifest({ name: 'fixture', version: '1.0.0', main });
      expect(() => validateInstalledEntrypoints([{ name: 'fixture', dir: packageDir }], run)).toThrow(
        /invalid entrypoint/
      );
    }
    writeManifest({
      name: 'fixture',
      version: '1.0.0',
      main: './dist/index.js',
      types: './dist/index.d.ts'
    });
    expect(() => validateInstalledEntrypoints([{ name: 'fixture', dir: packageDir }], run)).not.toThrow();
    expect(run).toHaveBeenCalledOnce();
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects an entrypoint whose relative runtime graph is incomplete', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-consumer-module-graph-'));
    const packageDir = join(root, 'package');
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0', type: 'module', main: './dist/index.js' })
    );
    writeFileSync(join(packageDir, 'dist', 'index.js'), "export { missing } from './missing.js';\n");

    expect(() => validateInstalledEntrypoints([{ name: 'fixture', dir: packageDir }], vi.fn())).toThrow(
      /relative module graph/
    );
    writeFileSync(join(packageDir, 'dist', 'index.js'), 'export const lazy = import(`./missing.js`);\n');
    expect(() => validateInstalledEntrypoints([{ name: 'fixture', dir: packageDir }], vi.fn())).toThrow(
      /relative module graph/
    );
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ["export const lazy = import('./' + 'missing.js');\n", './dist/index.js'],
    ["const suffix = 'missing.js'; export const lazy = import('./' + suffix);\n", './dist/index.js'],
    ["export const lazy = import('./missing.json', { with: { type: 'json' } });\n", './dist/index.js'],
    ["const target = './missing.js'; export const lazy = import(target);\n", './dist/index.js'],
    ["export type Missing = import('./missing.js').Missing;\n", './dist/index.d.ts']
  ])('rejects an incomplete statically knowable or unverifiable module edge', (source, entrypoint) => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-consumer-static-edge-'));
    const packageDir = join(root, 'package');
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        type: 'module',
        main: './dist/index.js',
        types: entrypoint.endsWith('.d.ts') ? entrypoint : undefined
      })
    );
    writeFileSync(join(packageDir, 'dist', 'index.js'), entrypoint.endsWith('.d.ts') ? 'export {};\n' : source);
    if (entrypoint.endsWith('.d.ts')) writeFileSync(join(packageDir, 'dist', 'index.d.ts'), source);

    expect(() => validateInstalledEntrypoints([{ name: 'fixture', dir: packageDir }], vi.fn())).toThrow(
      /module graph|dynamic module specifier/
    );
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects undeclared bare imports even when another installed package could satisfy them', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-consumer-bare-import-'));
    const packageDir = join(root, 'package');
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'hoisted'), { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0', type: 'module', main: './dist/index.js' })
    );
    writeFileSync(join(packageDir, 'dist', 'index.js'), "export * from 'hoisted';\n");

    expect(() => validateInstalledEntrypoints([{ name: 'fixture', dir: packageDir }], vi.fn())).toThrow(
      /undeclared package import/
    );
    writeFileSync(join(packageDir, 'dist', 'index.js'), "export * from 'fixture/not-exported';\n");
    expect(() => validateInstalledEntrypoints([{ name: 'fixture', dir: packageDir }], vi.fn())).toThrow(
      /unexported self import/
    );
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects parse-invalid shipped declarations', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-consumer-invalid-types-'));
    const packageDir = join(root, 'package');
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0', main: './dist/index.js', types: './dist/index.d.ts' })
    );
    writeFileSync(join(packageDir, 'dist', 'index.js'), "import 'fixture'; export {};\n");
    writeFileSync(join(packageDir, 'dist', 'index.d.ts'), 'export type Broken = ;\n');

    expect(() => validateInstalledEntrypoints([{ name: 'fixture', dir: packageDir }], vi.fn())).toThrow(
      /invalid source syntax/
    );
    rmSync(root, { recursive: true, force: true });
  });

  it('syntax-checks every JavaScript file in the relative runtime graph', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-consumer-child-syntax-'));
    const packageDir = join(root, 'package');
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0', type: 'module', main: './dist/index.js' })
    );
    writeFileSync(join(packageDir, 'dist', 'index.js'), "export * from './broken.js';\n");
    writeFileSync(join(packageDir, 'dist', 'broken.js'), 'export const = ;\n');

    expect(() => validateInstalledEntrypoints([{ name: 'fixture', dir: packageDir }], command)).toThrow();
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects extensionless and directory ESM imports even when matching files exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-consumer-esm-resolution-'));
    const packageDir = join(root, 'package');
    mkdirSync(join(packageDir, 'dist', 'directory'), { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0', type: 'module', main: './dist/index.js' })
    );
    writeFileSync(join(packageDir, 'dist', 'dependency.js'), 'export const value = true;\n');
    writeFileSync(join(packageDir, 'dist', 'directory', 'index.js'), 'export const value = true;\n');

    for (const source of [
      "import './dependency';\n",
      "export * from './directory';\n",
      "require('./dependency.js');\n"
    ]) {
      writeFileSync(join(packageDir, 'dist', 'index.js'), source);
      expect(() => validateInstalledEntrypoints([{ name: 'fixture', dir: packageDir }], vi.fn())).toThrow(
        /relative module graph/
      );
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('walks every supported relative module form, extension, directory index, and cycle', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-consumer-complete-graph-'));
    const packageDir = join(root, 'package');
    mkdirSync(join(packageDir, 'dist', 'directory'), { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        main: './dist/index.js',
        types: './dist/index.d.ts',
        bin: './dist/bin.cjs',
        dependencies: { declared: '^1.0.0', '@scope/declared': '^1.0.0' },
        exports: { './data': './dist/data.json' }
      })
    );
    writeFileSync(
      join(packageDir, 'dist', 'index.js'),
      [
        "import './dependency.js';",
        "export * from './directory/index.js';",
        "export const lazy = import('./lazy.mjs');",
        "import 'node:path';",
        "import 'declared/subpath';",
        "import '@scope/declared/subpath';",
        "import 'fixture';",
        "import 'fixture/data';",
        'const local = true; export { local };'
      ].join('\n')
    );
    writeFileSync(join(packageDir, 'dist', 'dependency.js'), "export { value } from './index.js';\n");
    writeFileSync(join(packageDir, 'dist', 'directory', 'index.js'), 'export const directory = true;\n');
    writeFileSync(join(packageDir, 'dist', 'lazy.mjs'), 'export const lazy = true;\n');
    writeFileSync(join(packageDir, 'dist', 'index.d.ts'), "export type { Value } from './types';\n");
    writeFileSync(join(packageDir, 'dist', 'types.d.ts'), 'export type Value = true;\n');
    writeFileSync(join(packageDir, 'dist', 'data.json'), '{}\n');
    mkdirSync(join(packageDir, 'dist', 'cjs-directory'));
    writeFileSync(join(packageDir, 'dist', 'bin.cjs'), "require('./cjs-dependency'); require('./cjs-directory');\n");
    writeFileSync(join(packageDir, 'dist', 'cjs-dependency.js'), 'module.exports = {};\n');
    writeFileSync(join(packageDir, 'dist', 'cjs-directory', 'index.js'), 'module.exports = {};\n');

    expect(() => validateInstalledEntrypoints([{ name: 'fixture', dir: packageDir }], vi.fn())).not.toThrow();
    writeFileSync(join(packageDir, 'dist', 'index.js'), "export * from '../../../outside.js';\n");
    writeFileSync(join(root, 'outside.js'), 'export const escaped = true;\n');
    expect(() => validateInstalledEntrypoints([{ name: 'fixture', dir: packageDir }], vi.fn())).toThrow(
      /relative module graph/
    );
    rmSync(root, { recursive: true, force: true });
  });

  it('fails closed on malformed or incomplete clean-consumer lock integrity evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-consumer-lock-'));
    const manifest = {
      packages: [
        { name: '@blackunicorn/a', version: '1.0.1', integrity: `sha512-${Buffer.alloc(64).toString('base64')}` }
      ]
    };
    expect(() => cleanConsumerIntegrities(root, manifest)).toThrow(/missing or invalid/);
    writeFileSync(join(root, 'package-lock.json'), '{invalid');
    expect(() => cleanConsumerIntegrities(root, manifest)).toThrow(/missing or invalid/);
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ packages: [] }));
    expect(() => cleanConsumerIntegrities(root, manifest)).toThrow(/missing or invalid/);
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({
        packages: { 'node_modules/dependency': { name: 'dependency', version: '1.0.0', integrity: 'bad' } }
      })
    );
    expect(() => cleanConsumerIntegrities(root, manifest)).toThrow(/invalid integrity/);
    for (const integrity of [
      `sha512-${Buffer.alloc(4).toString('base64')}`,
      `sha512-${Buffer.alloc(64).toString('base64').replace(/=+$/, '')}`
    ]) {
      writeFileSync(
        join(root, 'package-lock.json'),
        JSON.stringify({ packages: { 'node_modules/dependency': { name: 'dependency', version: '1.0.0', integrity } } })
      );
      expect(() => cleanConsumerIntegrities(root, manifest)).toThrow(/invalid integrity/);
    }
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({
        packages: {
          '': {},
          'node_modules/a': {
            name: '@blackunicorn/a',
            version: '1.0.1',
            integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`
          }
        }
      })
    );
    expect(() => cleanConsumerIntegrities(root, manifest)).toThrow(/conflicting integrities/);
    const dependencyIntegrity = `sha512-${Buffer.alloc(64, 2).toString('base64')}`;
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({
        packages: {
          '': {},
          'node_modules/dependency': {
            version: '1.0.0',
            integrity: dependencyIntegrity
          },
          'node_modules/@scope/scoped': {
            version: '2.0.0',
            integrity: dependencyIntegrity
          },
          'node_modules/@incomplete': {
            version: '3.0.0',
            integrity: dependencyIntegrity
          }
        }
      })
    );
    const integrities = cleanConsumerIntegrities(root, manifest);
    expect(integrities.get('dependency@1.0.0')).toBe(dependencyIntegrity);
    expect(integrities.get('@scope/scoped@2.0.0')).toBe(dependencyIntegrity);
    expect(integrities.has('@incomplete/@3.0.0')).toBe(false);
    expect(attachConsumerIntegrities([{ name: 'dependency', version: '1.0.0', license: 'MIT' }], integrities)).toEqual([
      { name: 'dependency', version: '1.0.0', license: 'MIT', integrity: dependencyIntegrity }
    ]);
    expect(() => attachConsumerIntegrities([{ name: 'missing', version: '1.0.0', license: 'MIT' }], new Map())).toThrow(
      /integrity is missing/
    );
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects a non-permissive clean-consumer resolution and reports a permissive one', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-consumer-license-'));
    const packageDir = join(root, 'package');
    const dependencyDir = join(packageDir, 'node_modules', 'dependency');
    mkdirSync(dependencyDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        license: 'MIT',
        dependencies: { dependency: '^1.0.0', second: '^2.0.0' }
      })
    );
    const secondDir = join(packageDir, 'node_modules', 'second');
    mkdirSync(secondDir, { recursive: true });
    writeFileSync(
      join(secondDir, 'package.json'),
      JSON.stringify({ name: 'second', version: '2.0.0', license: 'MIT' })
    );
    writeFileSync(
      join(dependencyDir, 'package.json'),
      JSON.stringify({ name: 'dependency', version: '1.0.0', license: 'GPL-3.0-only' })
    );
    expect(() => cleanConsumerLicenseReport([{ name: 'root', dir: packageDir }])).toThrow(/non-permissive/);
    writeFileSync(
      join(dependencyDir, 'package.json'),
      JSON.stringify({ name: 'dependency', version: '1.0.0', license: 'Apache-2.0' })
    );
    expect(cleanConsumerLicenseReport([{ name: 'root', dir: packageDir }])).toEqual([
      { name: 'dependency', version: '1.0.0', license: 'Apache-2.0' },
      { name: 'second', version: '2.0.0', license: 'MIT' }
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it('requires a retained evidence destination before installing', () => {
    const { dir } = prepared();
    expect(() => preflightConsumerBundle({ dir, run: vi.fn() })).toThrow(/evidence directory/);
  });

  it('exposes the clean-consumer preflight through the release CLI', () => {
    const { root } = (() => {
      const fixtureRoot = fixture();
      for (const name of ['a', 'b']) {
        const manifestPath = join(fixtureRoot, 'packages', name, 'package.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        manifest.type = 'module';
        manifest.exports = './dist/index.js';
        writeFileSync(manifestPath, JSON.stringify(manifest));
      }
      prepareBundle({
        root: fixtureRoot,
        outputDir: join(fixtureRoot, 'bundle'),
        version: '1.0.1',
        scope: 'family',
        sourceSha: 'a'.repeat(40),
        expectedFamilySize: 2,
        run: fakePack
      });
      return { root: fixtureRoot };
    })();
    const run = vi.fn(command);

    expect(
      main({
        argv: ['preflight-consumer', 'bundle', 'consumer-evidence'],
        root,
        run,
        log: vi.fn(),
        expectedFamilySize: 2
      }).packages
    ).toHaveLength(2);
    expect(run).toHaveBeenCalledWith(
      'npm',
      expect.arrayContaining(['install', '--ignore-scripts', '--registry=https://registry.npmjs.org']),
      expect.any(Object)
    );
    expect(run).toHaveBeenCalledWith(
      'npm',
      ['audit', '--omit=dev', '--audit-level=high', '--registry=https://registry.npmjs.org'],
      expect.any(Object)
    );
  });
});
