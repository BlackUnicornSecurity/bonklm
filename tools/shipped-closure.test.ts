import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
// @ts-expect-error — dependency-free release scripts have no declaration files
import { publishableRoots, selectPublishableRoots, shippedClosure } from '../scripts/lib-shipped-closure.mjs';
// @ts-expect-error — dependency-free release scripts have no declaration files
import { classifyLicense, rootLicenseFindings } from '../scripts/license-audit.mjs';
// @ts-expect-error — dependency-free release scripts have no declaration files
import { classifyPath, loadWorkspace, parseAuditJson } from '../scripts/supply-chain-audit.mjs';

function temporaryDirectory(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function manifest(path: string, value: object) {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'package.json'), JSON.stringify(value));
}

describe('exact shipped-root supply-chain selection', () => {
  it.each([
    ['MIT OR GPL-3.0-only', 'ok'],
    ['LGPL-3.0-only OR GPL-3.0-only', 'lgpl'],
    ['GPL-2.0-only OR GPL-3.0-only', 'flagged'],
    ['MIT AND Apache-2.0', 'ok'],
    ['MIT AND GPL-3.0-only', 'flagged'],
    ['MIT', 'ok'],
    ['LGPL-3.0-only', 'lgpl'],
    ['GPL-3.0-only', 'flagged'],
    ['(MIT OR GPL-3.0-only) AND ISC', 'flagged']
  ])('classifies license expression %s as %s', (expression, verdict) => {
    expect(classifyLicense(expression)).toBe(verdict);
  });

  it('selects every publishable root when no explicit paths are supplied', () => {
    expect(selectPublishableRoots(process.cwd(), undefined)).toEqual(publishableRoots(process.cwd()));
  });

  it('keeps third-party connector hosts opt-in rather than auto-installing their trees', () => {
    for (const directory of execFileSync('git', ['ls-files', 'packages/*/package.json'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    })
      .trim()
      .split('\n')) {
      const packageJson = JSON.parse(readFileSync(join(process.cwd(), directory), 'utf8'));
      for (const name of Object.keys(packageJson.peerDependencies || {})) {
        if (!name.startsWith('@blackunicorn/')) {
          const optional = packageJson.peerDependenciesMeta?.[name]?.optional === true;
          expect(optional, `${packageJson.name} -> ${name}`).toBe(true);
        }
      }
    }
  });

  it('includes explicit Tier-B tools and their runtime dependency closure', () => {
    const root = temporaryDirectory('bonklm-shipped-roots-');
    const family = join(root, 'packages', 'core');
    const tool = join(root, 'tools', 'public-tool');
    const internal = join(root, 'tools', 'internal-tool');
    manifest(family, { name: '@blackunicorn/core', version: '1.0.0', license: 'Apache-2.0' });
    manifest(tool, {
      name: '@blackunicorn/public-tool',
      version: '1.0.0',
      license: 'MIT',
      workspacePolicy: 'tier-b-publishable',
      dependencies: { 'gpl-dep': '1.0.0' }
    });
    manifest(internal, { name: '@blackunicorn/internal-tool', version: '1.0.0', private: true });
    manifest(join(tool, 'node_modules', 'gpl-dep'), { name: 'gpl-dep', version: '1.0.0', license: 'GPL-3.0' });

    expect(publishableRoots(root).map((item: { name: string }) => item.name)).toEqual([
      '@blackunicorn/core',
      '@blackunicorn/public-tool'
    ]);
    const selected = selectPublishableRoots(root, ['tools/public-tool']);
    const closure = shippedClosure({ roots: selected, repoRoot: root });
    expect(closure.get('gpl-dep@1.0.0')?.license).toBe('GPL-3.0');
    expect(classifyLicense(closure.get('gpl-dep@1.0.0')?.license)).toBe('flagged');
    expect(() => selectPublishableRoots(root, ['tools/internal-tool'])).toThrow(/not publishable/);
  });

  it('does not exempt external packages that share the BlackUnicorn npm scope', () => {
    const root = temporaryDirectory('bonklm-external-scope-');
    const family = join(root, 'packages', 'core');
    manifest(family, {
      name: '@blackunicorn/core',
      version: '1.0.0',
      license: 'Apache-2.0',
      dependencies: { '@blackunicorn/external': '1.0.0' }
    });
    manifest(join(family, 'node_modules', '@blackunicorn', 'external'), {
      name: '@blackunicorn/external',
      version: '1.0.0',
      license: 'GPL-3.0-only'
    });
    const closure = shippedClosure({ roots: [{ name: '@blackunicorn/core', dir: family }], repoRoot: root });
    expect(closure.get('@blackunicorn/external@1.0.0')).toMatchObject({
      license: 'GPL-3.0-only',
      viaWorkspace: false
    });
  });

  it('recognizes a workspace dependency resolved through a pnpm-style symlink', () => {
    const root = temporaryDirectory('bonklm-workspace-symlink-');
    const core = join(root, 'packages', 'core');
    const server = join(root, 'packages', 'server');
    manifest(core, { name: '@blackunicorn/core', version: '1.0.0', license: 'Apache-2.0' });
    manifest(server, {
      name: '@blackunicorn/server',
      version: '1.0.0',
      license: 'Apache-2.0',
      dependencies: { '@blackunicorn/core': '1.0.0' }
    });
    mkdirSync(join(server, 'node_modules', '@blackunicorn'), { recursive: true });
    symlinkSync(core, join(server, 'node_modules', '@blackunicorn', 'core'), 'dir');

    const closure = shippedClosure({ roots: [{ name: '@blackunicorn/server', dir: server }], repoRoot: root });
    expect(closure.get('@blackunicorn/core@1.0.0')?.viaWorkspace).toBe(true);
  });

  it('fails a publishable root with no license', () => {
    const root = temporaryDirectory('bonklm-root-license-');
    const tool = join(root, 'tool');
    manifest(tool, { name: '@blackunicorn/no-license', version: '1.0.0' });
    expect(rootLicenseFindings([{ name: '@blackunicorn/no-license', dir: tool }])).toMatchObject([
      { name: '@blackunicorn/no-license', license: 'Unknown', verdict: 'flagged', root: true }
    ]);
    expect(() =>
      execFileSync(process.execPath, ['scripts/gen-sbom.mjs', '--root', tool, '--out', join(root, 'bad.sbom.json')], {
        cwd: process.cwd(),
        stdio: 'pipe'
      })
    ).toThrow();
  });

  it('fails closed for unknown audit roots while ignoring positively known unselected roots', () => {
    const roots = selectPublishableRoots(process.cwd(), ['tools/eslint-plugin-bonklm-edge']);
    const workspace = loadWorkspace(roots);
    expect(classifyPath('tools/eslint-plugin-bonklm-edge > eslint@10.0.0', workspace).kind).toBe('install-surface');
    expect(classifyPath('packages/bonklm-server > fastify@5.12.0', workspace).kind).toBe('not-shipped');
    expect(classifyPath('unrecognized/root > vulnerable@1.0.0', workspace).kind).toBe('unknown');
    expect(classifyPath('', workspace).kind).toBe('unknown');
    expect(
      classifyPath('tools/eslint-plugin-bonklm-edge > development-only', {
        'tools/eslint-plugin-bonklm-edge': {
          name: '@blackunicorn/eslint-plugin-edge',
          private: false,
          selected: true,
          deps: {},
          opt: {},
          peers: {},
          peerMeta: {},
          devs: { 'development-only': '1.0.0' }
        }
      }).kind
    ).toBe('dev');
  });

  it('loads a minimal workspace when optional package areas and manifests are absent', () => {
    const root = temporaryDirectory('bonklm-minimal-audit-workspace-');
    manifest(root, { name: '@blackunicorn/root', version: '1.0.1', private: true });
    mkdirSync(join(root, 'packages', 'not-a-package'), { recursive: true });
    expect(loadWorkspace([], root)).toMatchObject({ '.': { private: true, selected: false } });
  });

  it('distinguishes optional peer SDKs from peers npm installs by default', () => {
    const optionalRoots = selectPublishableRoots(process.cwd(), ['packages/chroma-connector']);
    const optionalWorkspace = loadWorkspace(optionalRoots);
    expect(classifyPath('packages/chroma-connector > chromadb@3.5.0', optionalWorkspace).kind).toBe('peer');
    const requiredRoots = selectPublishableRoots(process.cwd(), ['tools/eslint-plugin-bonklm-edge']);
    const requiredWorkspace = loadWorkspace(requiredRoots);
    expect(classifyPath('tools/eslint-plugin-bonklm-edge > eslint@10.0.0', requiredWorkspace).kind).toBe(
      'install-surface'
    );
    expect(classifyPath('. > @blackunicorn/eslint-plugin-edge@0.4.0 > eslint@10.0.0', requiredWorkspace).kind).toBe(
      'install-surface'
    );
  });

  it('includes required peers in the default npm install closure and excludes optional peers', () => {
    const root = temporaryDirectory('bonklm-peer-closure-');
    const adapter = join(root, 'packages', 'adapter');
    manifest(adapter, {
      name: '@blackunicorn/adapter',
      version: '1.0.0',
      license: 'Apache-2.0',
      peerDependencies: { required: '1.0.0', optional: '1.0.0' },
      peerDependenciesMeta: { optional: { optional: true } }
    });
    manifest(join(adapter, 'node_modules', 'required'), {
      name: 'required',
      version: '1.0.0',
      license: 'MIT',
      dependencies: { transitive: '1.0.0' }
    });
    manifest(join(adapter, 'node_modules', 'required', 'node_modules', 'transitive'), {
      name: 'transitive',
      version: '1.0.0',
      license: 'ISC'
    });
    manifest(join(adapter, 'node_modules', 'optional'), {
      name: 'optional',
      version: '1.0.0',
      license: 'MIT'
    });

    const closure = shippedClosure({ roots: [{ name: '@blackunicorn/adapter', dir: adapter }], repoRoot: root });
    expect([...closure.keys()].sort()).toEqual(['required@1.0.0', 'transitive@1.0.0']);
  });

  it('keeps an optional connector SDK out of a clean default npm install', () => {
    const root = temporaryDirectory('bonklm-peer-install-');
    const adapter = join(root, 'adapter');
    const consumer = join(root, 'consumer');
    mkdirSync(adapter);
    mkdirSync(consumer);
    const source = JSON.parse(readFileSync(join(process.cwd(), 'packages/chroma-connector/package.json'), 'utf8'));
    manifest(adapter, {
      name: '@blackunicorn/install-surface-fixture',
      version: '1.0.0',
      peerDependencies: { chromadb: source.peerDependencies.chromadb },
      peerDependenciesMeta: { chromadb: source.peerDependenciesMeta.chromadb }
    });
    manifest(consumer, {
      name: 'consumer',
      version: '1.0.0',
      private: true,
      dependencies: { '@blackunicorn/install-surface-fixture': 'file:../adapter' }
    });
    execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--offline'], {
      cwd: consumer,
      stdio: 'pipe'
    });
    const lock = JSON.parse(readFileSync(join(consumer, 'package-lock.json'), 'utf8'));
    expect(lock.packages['node_modules/chromadb']).toBeUndefined();
  });

  it('accepts only the expected pnpm advisory schema and rejects tool/registry error JSON', () => {
    expect(
      parseAuditJson(
        JSON.stringify({
          advisories: {},
          metadata: { vulnerabilities: { critical: 0, high: 0, info: 0, low: 0, moderate: 0 } }
        })
      )
    ).toMatchObject({ advisories: {} });
    expect(() => parseAuditJson('{"error":{"code":"EAI_AGAIN"}}')).toThrow(/schema/);
    expect(() => parseAuditJson('{"metadata":{"vulnerabilities":{}}}')).toThrow(/schema/);
    expect(() => parseAuditJson('{"advisories":{},"metadata":{"vulnerabilities":null}}')).toThrow(/schema/);
    expect(() => parseAuditJson('{"advisories":{},"metadata":{"vulnerabilities":[]}}')).toThrow(/schema/);
    expect(() =>
      parseAuditJson(
        JSON.stringify({
          advisories: {},
          metadata: { vulnerabilities: { critical: 0, high: 1, info: 0, low: 0, moderate: 0 } }
        })
      )
    ).toThrow(/schema/);
    expect(
      parseAuditJson(
        JSON.stringify({
          advisories: {
            one: {
              module_name: 'dependency',
              severity: 'high',
              patched_versions: '>=2',
              vulnerable_versions: '<2',
              findings: [
                { paths: ['packages/root>dependency'], version: '1.0.0' },
                { paths: ['packages/other>dependency'], version: '1.0.0' }
              ]
            }
          },
          metadata: { vulnerabilities: { critical: 0, high: 2, info: 0, low: 0, moderate: 0 } }
        })
      )
    ).toMatchObject({ metadata: { vulnerabilities: { high: 2 } } });
    for (const unsafe of ['line\nforgery', '\u001b[31mforgery']) {
      expect(() =>
        parseAuditJson(
          JSON.stringify({
            advisories: {
              1: {
                severity: 'high',
                module_name: 'x',
                findings: [{ paths: [`packages/core > ${unsafe}`], version: '1.0.0' }],
                patched_versions: unsafe,
                vulnerable_versions: '<2'
              }
            },
            metadata: { vulnerabilities: { critical: 0, high: 1, info: 0, low: 0, moderate: 0 } }
          })
        )
      ).toThrow(/schema/);
    }
    expect(() =>
      parseAuditJson(
        JSON.stringify({
          advisories: {
            1: {
              severity: 'high',
              module_name: 'x',
              findings: [{ paths: ['packages/core > x'], version: '1.0.0' }],
              patched_versions: '>=2',
              vulnerable_versions: '<2',
              title: 'line\nforgery'
            }
          },
          metadata: { vulnerabilities: { critical: 0, high: 1, info: 0, low: 0, moderate: 0 } }
        })
      )
    ).toThrow(/schema/);
    expect(
      parseAuditJson(
        JSON.stringify({
          advisories: {
            1: {
              severity: 'high',
              module_name: 'x',
              findings: [{ paths: [], version: '1.0.0' }],
              patched_versions: '>=2',
              vulnerable_versions: '<2'
            }
          },
          metadata: { vulnerabilities: { critical: 0, high: 1, info: 0, low: 0, moderate: 0 } }
        })
      )
    ).toMatchObject({ advisories: { 1: { findings: [{ paths: [] }] } } });
    expect(() =>
      parseAuditJson(
        JSON.stringify({
          advisories: {
            1: {
              severity: 'high',
              module_name: 'x',
              findings: [{ paths: ['packages/core > x'] }],
              patched_versions: '>=2',
              vulnerable_versions: '<2'
            }
          },
          metadata: { vulnerabilities: { critical: 0, high: 1, info: 0, low: 0, moderate: 0 } }
        })
      )
    ).toThrow(/schema/);
    expect(() =>
      parseAuditJson(
        JSON.stringify({
          advisories: {
            1: { severity: 'high', module_name: 'x', findings: 'not-an-array', patched_versions: '>=2' }
          },
          metadata: { vulnerabilities: { high: 1 } }
        })
      )
    ).toThrow(/schema/);
  });

  it('fails closed for unresolved required dependencies and malformed manifests while tolerating absent optional ones', () => {
    const root = temporaryDirectory('bonklm-shipped-resolution-');
    const required = join(root, 'required');
    const optional = join(root, 'optional');
    const malformed = join(root, 'malformed');
    manifest(required, { name: '@blackunicorn/required', version: '1.0.0', dependencies: { missing: '1.0.0' } });
    manifest(optional, {
      name: '@blackunicorn/optional',
      version: '1.0.0',
      optionalDependencies: { missing: '1.0.0' }
    });
    manifest(malformed, {
      name: '@blackunicorn/malformed',
      version: '1.0.0',
      dependencies: { broken: '1.0.0' }
    });
    const brokenDir = join(malformed, 'node_modules', 'broken');
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, 'package.json'), '{broken');

    expect(() => shippedClosure({ roots: [{ name: '@blackunicorn/required', dir: required }] })).toThrow(
      /Required dependency missing/
    );
    expect(shippedClosure({ roots: [{ name: '@blackunicorn/optional', dir: optional }] }).size).toBe(0);
    expect(() => shippedClosure({ roots: [{ name: '@blackunicorn/malformed', dir: malformed }] })).toThrow(
      /manifest.*broken/
    );
  });
});
