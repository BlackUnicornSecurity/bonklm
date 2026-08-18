import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  discoverReleaseCandidates,
  discoverReleasePolicyAtRef,
  discoverReleasePackageNamesAtRef,
  discoverReleasePackageNames,
  command,
  prepareBundle,
  tagFor,
  verifyBundle
} from './release-npm.js';
import { createRunner, main } from './release-npm-cli.js';
import { attestation, fakePack, fixture, prepared, registryRunner } from './release-npm-test-helpers.js';
import { FAMILY_SIZE } from './release-scope.js';

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('release candidate discovery and packing', () => {
  it('rejects missing trusted-publishing repository metadata before packing', () => {
    const root = fixture();
    const path = join(root, 'packages', 'a', 'package.json');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    delete value.repository;
    writeFileSync(path, JSON.stringify(value));
    expect(() => discoverReleaseCandidates(root, '1.0.1', 2, 'family')).toThrow(/repository metadata/);
  });
  it('selects only the explicitly scoped complete family', () => {
    const root = fixture({ toolVersion: '1.0.1' });
    expect(discoverReleaseCandidates(root, '1.0.1', 2, 'family').map(item => [item.name, item.kind])).toEqual([
      ['@blackunicorn/a', 'family'],
      ['@blackunicorn/b', 'family']
    ]);
  });

  it('rejects a workspace whose public family size is incomplete', () => {
    const root = fixture();
    const path = join(root, 'packages', 'b', 'package.json');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    value.private = true;
    writeFileSync(path, JSON.stringify(value));
    expect(() => discoverReleasePackageNames(root, 2, 'family')).toThrow(/partial/);
  });

  it('accepts repository metadata for every real family candidate', () => {
    const core = JSON.parse(readFileSync(join(WORKSPACE_ROOT, 'packages/core/package.json'), 'utf8'));
    expect(discoverReleaseCandidates(WORKSPACE_ROOT, core.version, FAMILY_SIZE, 'family')).toHaveLength(FAMILY_SIZE);
  });

  it('supports an explicitly named tool-only release and ignores unrelated files', () => {
    const root = fixture();
    writeFileSync(join(root, 'packages', 'README'), 'not a manifest');
    mkdirSync(join(root, 'packages', 'empty'));
    expect(discoverReleaseCandidates(root, '0.4.0', 2, '@blackunicorn/eslint').map(item => item.name)).toEqual([
      '@blackunicorn/eslint'
    ]);
    rmSync(join(root, 'packages'), { recursive: true });
    expect(discoverReleaseCandidates(root, '0.4.0', 2, '@blackunicorn/eslint').map(item => item.name)).toEqual([
      '@blackunicorn/eslint'
    ]);
  });

  it('derives recovery package names independently of current manifest versions', () => {
    const root = fixture({ toolVersion: '9.9.9' });
    expect(discoverReleasePackageNames(root, 2, 'family')).toEqual(['@blackunicorn/a', '@blackunicorn/b']);
    expect(discoverReleasePackageNames(root, 2, '@blackunicorn/eslint')).toEqual(['@blackunicorn/eslint']);
  });

  it('derives recovery package names from the failed commit instead of current main', () => {
    const root = fixture();
    const run = vi.fn((_command: string, args: string[]) => {
      if (args[0] === 'ls-tree') return 'packages/a/package.json\npackages/b/package.json\n';
      const path = args[1].split(':').slice(1).join(':');
      return JSON.stringify({
        name: path.includes('/a/') ? '@blackunicorn/old-a' : '@blackunicorn/old-b',
        version: '1.0.1',
        repository: {
          type: 'git',
          url: 'git+https://github.com/BlackUnicornSecurity/bonklm.git',
          directory: path.slice(0, -'/package.json'.length)
        }
      });
    });

    expect(discoverReleasePackageNamesAtRef(root, 2, 'family', 'a'.repeat(40), run)).toEqual([
      '@blackunicorn/old-a',
      '@blackunicorn/old-b'
    ]);
    expect(run).toHaveBeenCalledWith(
      'git',
      ['ls-tree', '-r', '--name-only', 'a'.repeat(40), '--', 'packages', 'tools'],
      {
        cwd: root
      }
    );
    expect(discoverReleasePolicyAtRef(root, 'family', 'a'.repeat(40), run)).toEqual({
      schemaVersion: 1,
      expectedPackageCount: 2,
      packageNames: ['@blackunicorn/old-a', '@blackunicorn/old-b'],
      scope: 'family',
      sourceSha: 'a'.repeat(40),
      version: '1.0.1'
    });
    expect(discoverReleasePackageNamesAtRef(root, 99, 'family', 'a'.repeat(40), run)).toHaveLength(2);
  });

  it('derives collision-free family and Tier-B release tags', () => {
    expect(tagFor({ kind: 'family', name: '@blackunicorn/a' }, '1.0.1')).toBe('v1.0.1');
    expect(tagFor({ kind: 'tool', name: '@blackunicorn/eslint' }, '1.0.1')).toBe('eslint-v1.0.1');
  });

  it.each([
    ['invalid SemVer', () => discoverReleaseCandidates(fixture(), 'latest', 2, 'family'), /valid SemVer/],
    [
      'partial family',
      () => {
        const root = fixture();
        const path = join(root, 'packages', 'b', 'package.json');
        const value = JSON.parse(readFileSync(path, 'utf8'));
        value.version = '1.0.2';
        writeFileSync(path, JSON.stringify(value));
        return discoverReleaseCandidates(root, '1.0.1', 2, 'family');
      },
      /partial/
    ],
    [
      'unknown tool',
      () => discoverReleaseCandidates(fixture(), '0.4.0', 2, '@blackunicorn/other'),
      /does not uniquely/
    ],
    [
      'wrong tool version',
      () => discoverReleaseCandidates(fixture(), '0.4.1', 2, '@blackunicorn/eslint'),
      /does not uniquely/
    ],
    [
      'unnamed package',
      () => discoverReleaseCandidates(fixture({ unnamed: true }), '1.0.1', 2, 'family'),
      /package name/
    ]
  ])('fails closed for %s', (_label, action, error) => expect(action).toThrow(error));

  it('packs exactly one immutable tarball per candidate', () => {
    const { dir, manifest } = prepared();
    expect(manifest.packages).toHaveLength(2);
    expect(verifyBundle(dir)).toEqual(JSON.parse(readFileSync(join(dir, 'release-manifest.json'), 'utf8')));
    expect(() =>
      verifyBundle(dir, {
        scope: 'family',
        sourceSha: 'a'.repeat(40),
        version: '1.0.1',
        expectedFamilySize: 52
      })
    ).toThrow(/trusted release context/);
    expect(() => verifyBundle(dir, { sourceSha: 'b'.repeat(40) })).toThrow(/trusted release context/);
  });

  it('executes pinned pnpm pack with lifecycle scripts disabled', () => {
    const root = fixture();
    const packageDir = join(root, 'packages', 'a');
    const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    packageJson.scripts = { prepack: 'node prepack.cjs' };
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify(packageJson));
    writeFileSync(join(packageDir, 'prepack.cjs'), "require('node:fs').writeFileSync('../../prepack-ran', 'ran')\n");
    expect(() =>
      prepareBundle({
        root,
        outputDir: join(root, 'real-bundle'),
        version: '1.0.1',
        scope: 'family',
        sourceSha: 'a'.repeat(40),
        expectedFamilySize: 2,
        run: command
      })
    ).not.toThrow();
    expect(() => readFileSync(join(root, 'prepack-ran'))).toThrow();
  });

  it('rejects pack commands that produce zero or multiple tarballs', () => {
    const root = fixture();
    const outputDir = join(root, 'bundle');
    expect(() =>
      prepareBundle({
        root,
        outputDir,
        version: '1.0.1',
        scope: 'family',
        sourceSha: undefined,
        expectedFamilySize: 2,
        run: fakePack
      })
    ).toThrow(/source SHA/);
    expect(() =>
      prepareBundle({
        root,
        outputDir,
        version: '1.0.1',
        scope: 'family',
        sourceSha: 'a'.repeat(40),
        expectedFamilySize: 2,
        run: vi.fn()
      })
    ).toThrow(/produced 0/);
  });
});

describe('bundle validation', () => {
  type MutablePackage = { name: string; version: string; kind: string; file: string };
  type MutableManifest = {
    schemaVersion: number;
    version: string;
    scope: string;
    sourceSha: string;
    expectedPackageCount: number;
    packages: MutablePackage[] | null;
  };

  it.each([
    'workspace:*',
    'file:../b',
    'link:../b',
    'git+https://example.invalid/repo.git',
    'https://example.invalid/archive.tgz',
    'github:user/repo',
    'user/repo',
    'C:/temp/pkg',
    'C:\\temp\\pkg',
    'C:relative',
    'D:archive.tgz',
    'foo.tgz',
    'foo.tar.gz',
    'foo/bar/baz',
    'github.com/user/repo',
    '@scope/pkg',
    ' ^1.0.0',
    42
  ])('rejects a retained tarball dependency spec %s', spec => {
    const root = fixture();
    const packagePath = join(root, 'packages/a/package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    packageJson.dependencies = { '@blackunicorn/b': spec };
    writeFileSync(packagePath, JSON.stringify(packageJson));
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

    expect(() => verifyBundle(dir)).toThrow(/non-registry dependency/);
  });

  it('accepts registry-compatible dependency specs in retained tarballs', () => {
    const root = fixture();
    const packagePath = join(root, 'packages/a/package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    packageJson.dependencies = {
      alias: 'npm:semver@^7.7.3',
      exact: '7.7.3',
      range: '^7.7.3',
      tag: 'latest'
    };
    writeFileSync(packagePath, JSON.stringify(packageJson));
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

    expect(() => verifyBundle(dir)).not.toThrow();
  });

  it.each([null, [], ['^1.0.0'], 'latest', 42])('rejects a malformed retained dependency map %j', dependencies => {
    const root = fixture();
    const packagePath = join(root, 'packages/a/package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    packageJson.dependencies = dependencies;
    writeFileSync(packagePath, JSON.stringify(packageJson));
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

    expect(() => verifyBundle(dir)).toThrow(/dependency field/);
  });

  it('rejects an empty retained dependency name', () => {
    const root = fixture();
    const packagePath = join(root, 'packages/a/package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    packageJson.dependencies = { '': '^1.0.0' };
    writeFileSync(packagePath, JSON.stringify(packageJson));
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

    expect(() => verifyBundle(dir)).toThrow(/non-registry dependency/);
  });

  it.each([
    ['bundleDependencies', true],
    ['bundleDependencies', ['safe-registry-dependency']],
    ['bundledDependencies', true],
    ['bundledDependencies', ['safe-registry-dependency']]
  ])('rejects retained tarballs with npm %s metadata', (field, value) => {
    const root = fixture();
    const packagePath = join(root, 'packages/a/package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    packageJson.dependencies = { 'safe-registry-dependency': '^1.0.0' };
    packageJson[field] = value;
    writeFileSync(packagePath, JSON.stringify(packageJson));
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

    expect(() => verifyBundle(dir)).toThrow(/bundled dependencies/);
  });

  it('rejects a retained tarball that redirects publication to another registry', () => {
    const root = fixture();
    const packagePath = join(root, 'packages/a/package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    packageJson.publishConfig = { registry: 'https://packages.example.invalid' };
    writeFileSync(packagePath, JSON.stringify(packageJson));
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

    expect(() => verifyBundle(dir)).toThrow(/publishConfig\.registry.*npmjs/);
  });

  it.each([
    [null, /publishConfig must be an object/],
    [[], /publishConfig must be an object/],
    ['public', /publishConfig must be an object/],
    [{ access: 'restricted' }, /publishConfig\.access.*public/],
    [{ 'https-proxy': 'https://proxy.example' }, /publishConfig contains unsupported keys/],
    [{ strictSsl: false }, /publishConfig contains unsupported keys/]
  ])('rejects unsafe retained publish configuration %j', (publishConfig, message) => {
    const root = fixture();
    const packagePath = join(root, 'packages/a/package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    packageJson.publishConfig = publishConfig;
    writeFileSync(packagePath, JSON.stringify(packageJson));
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

    expect(() => verifyBundle(dir)).toThrow(message);
  });

  it('rejects install-time lifecycle scripts in a retained tarball', () => {
    const root = fixture();
    const packagePath = join(root, 'packages/a/package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    packageJson.scripts = { install: 'node install.js' };
    writeFileSync(packagePath, JSON.stringify(packageJson));
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

    expect(() => verifyBundle(dir)).toThrow(/install-time lifecycle script/);
  });

  it.each([
    [
      'schema',
      (value: MutableManifest) => {
        value.schemaVersion = 2;
      }
    ],
    [
      'version',
      (value: MutableManifest) => {
        value.version = 'latest';
      }
    ],
    [
      'packages',
      (value: MutableManifest) => {
        value.packages = null;
      }
    ],
    [
      'scope',
      (value: MutableManifest) => {
        value.scope = 'unknown';
      }
    ],
    [
      'source SHA',
      (value: MutableManifest) => {
        value.sourceSha = 'short';
      }
    ],
    [
      'missing source SHA',
      (value: MutableManifest) => {
        delete (value as Partial<MutableManifest>).sourceSha;
      }
    ],
    [
      'expected package count',
      (value: MutableManifest) => {
        value.expectedPackageCount = 1;
      }
    ],
    [
      'name',
      (value: MutableManifest) => {
        value.packages![0].name = '';
      }
    ],
    [
      'package version',
      (value: MutableManifest) => {
        value.packages![0].version = '1.0.0';
      }
    ],
    [
      'kind',
      (value: MutableManifest) => {
        value.packages![0].kind = 'private';
      }
    ],
    [
      'filename',
      (value: MutableManifest) => {
        value.packages![0].file = '../a.tgz';
      }
    ],
    [
      'duplicate',
      (value: MutableManifest) => {
        value.packages![1].name = value.packages![0].name;
      }
    ],
    [
      'empty',
      (value: MutableManifest) => {
        value.packages = [];
      }
    ]
  ])('rejects invalid %s metadata', (_label, mutate) => {
    const { dir } = prepared();
    const path = join(dir, 'release-manifest.json');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    mutate(value);
    writeFileSync(path, JSON.stringify(value));
    expect(() => verifyBundle(dir)).toThrow(/bundle|package entry|empty/i);
  });

  it('rejects modified tarball bytes', () => {
    const { dir, manifest } = prepared();
    writeFileSync(join(dir, manifest.packages[0].file), 'tampered');
    expect(() => verifyBundle(dir)).toThrow(/integrity mismatch/);
  });

  it('rejects package entries whose kind disagrees with the release scope', () => {
    const { dir } = prepared();
    const path = join(dir, 'release-manifest.json');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    value.packages[0].kind = 'tool';
    writeFileSync(path, JSON.stringify(value));
    expect(() => verifyBundle(dir)).toThrow(/package scope/);
  });

  it('validates tool bundle cardinality, kind, and exact scoped name', () => {
    const root = fixture();
    const dir = join(root, 'tool-bundle');
    prepareBundle({
      root,
      outputDir: dir,
      version: '0.4.0',
      scope: '@blackunicorn/eslint',
      sourceSha: 'a'.repeat(40),
      expectedFamilySize: 2,
      run: fakePack
    });
    expect(verifyBundle(dir).packages).toHaveLength(1);
    const path = join(dir, 'release-manifest.json');
    const original = JSON.parse(readFileSync(path, 'utf8'));
    for (const mutation of [
      value => {
        value.packages[0].kind = 'family';
      },
      value => {
        value.packages[0].name = '@blackunicorn/other';
      }
    ]) {
      const value = structuredClone(original);
      mutation(value);
      writeFileSync(path, JSON.stringify(value));
      expect(() => verifyBundle(dir)).toThrow(/package scope/);
    }
    const multiple = structuredClone(original);
    multiple.packages.push({ ...multiple.packages[0], name: '@blackunicorn/other', file: 'other.tgz' });
    multiple.expectedPackageCount = 2;
    writeFileSync(path, JSON.stringify(multiple));
    expect(() => verifyBundle(dir)).toThrow(/trusted release context/);
  });

  it.each([
    ['name', { name: '@blackunicorn/substituted' }, /identity mismatch/],
    ['version', { version: '9.9.9' }, /identity mismatch/],
    ['private flag', { private: true }, /must be public/]
  ])('rejects a tarball whose embedded %s does not match before publication', (_label, mutation, error) => {
    const { dir, manifest } = prepared();
    const pkg = manifest.packages[0];
    const stage = join(dir, 'rewrite');
    mkdirSync(join(stage, 'package', 'dist'), { recursive: true });
    writeFileSync(
      join(stage, 'package', 'package.json'),
      JSON.stringify({ name: pkg.name, version: pkg.version, ...mutation })
    );
    writeFileSync(join(stage, 'package', 'dist', 'index.js'), 'export {};\n');
    execFileSync('tar', ['-czf', join(dir, pkg.file), '-C', stage, 'package']);
    const manifestPath = join(dir, 'release-manifest.json');
    const value = JSON.parse(readFileSync(manifestPath, 'utf8'));
    value.packages[0].integrity = `sha512-${createHash('sha512')
      .update(readFileSync(join(dir, pkg.file)))
      .digest('base64')}`;
    writeFileSync(manifestPath, JSON.stringify(value));
    expect(() => verifyBundle(dir)).toThrow(error);
  });

  it('rejects duplicate or unmanifested tarballs in the retained bundle', () => {
    const { dir, manifest } = prepared();
    writeFileSync(join(dir, 'extra.tgz'), readFileSync(join(dir, manifest.packages[0].file)));
    expect(() => verifyBundle(dir)).toThrow(/tarball set/);
  });

  it('binds a family bundle to the trusted canonical package-name set', () => {
    const { dir, manifest } = prepared();
    expect(() =>
      verifyBundle(dir, { expectedPackageNames: [manifest.packages[0].name, '@blackunicorn/substituted'] })
    ).toThrow(/trusted release candidates/);
    expect(verifyBundle(dir, { expectedPackageNames: manifest.packages.map(pkg => pkg.name) }).packages).toHaveLength(
      2
    );
  });

  it('rejects a hash-matched file that is not a readable npm tarball', () => {
    const { dir, manifest } = prepared();
    const path = join(dir, manifest.packages[0].file);
    writeFileSync(path, 'not a tarball');
    const manifestPath = join(dir, 'release-manifest.json');
    const value = JSON.parse(readFileSync(manifestPath, 'utf8'));
    value.packages[0].integrity = `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`;
    writeFileSync(manifestPath, JSON.stringify(value));
    expect(() => verifyBundle(dir)).toThrow(/manifest is unreadable/);
  });
});
describe('release npm CLI', () => {
  it('writes recovery package names from the failed SHA and consumes only a valid retained policy', () => {
    const root = fixture();
    const output = join(root, 'failed-package-names.json');
    const run = vi.fn((_command: string, args: string[]) => {
      if (args[0] === 'ls-tree') return 'packages/a/package.json\npackages/b/package.json\n';
      const path = args[1].split(':').slice(1).join(':');
      return JSON.stringify({
        name: path.includes('/a/') ? '@blackunicorn/a' : '@blackunicorn/b',
        version: '1.0.1',
        repository: {
          type: 'git',
          url: 'git+https://github.com/BlackUnicornSecurity/bonklm.git',
          directory: path.slice(0, -'/package.json'.length)
        }
      });
    });
    expect(
      main({
        argv: ['names-at-ref', 'family', 'a'.repeat(40), output],
        root,
        run,
        log: vi.fn(),
        expectedFamilySize: 2
      }).packages
    ).toEqual([{ name: '@blackunicorn/a' }, { name: '@blackunicorn/b' }]);
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({
      schemaVersion: 1,
      expectedPackageCount: 2,
      packageNames: ['@blackunicorn/a', '@blackunicorn/b'],
      scope: 'family',
      sourceSha: 'a'.repeat(40),
      version: '1.0.1'
    });

    const bundle = join(root, 'bundle');
    prepareBundle({
      root,
      outputDir: bundle,
      version: '1.0.1',
      scope: 'family',
      sourceSha: 'a'.repeat(40),
      expectedFamilySize: 2,
      run: fakePack
    });
    vi.stubEnv('RELEASE_PACKAGE_NAMES_FILE', output);
    vi.stubEnv('RELEASE_SCOPE', 'family');
    vi.stubEnv('RELEASE_SHA', 'a'.repeat(40));
    vi.stubEnv('RELEASE_VERSION', '1.0.1');
    expect(
      main({ argv: ['verify-local', 'bundle'], root, run, log: vi.fn(), expectedFamilySize: 2 }).packages
    ).toHaveLength(2);
  });

  it.each([
    ['missing schema', { schemaVersion: undefined }, 'family'],
    ['wrong scope', { scope: '@blackunicorn/other' }, 'family'],
    ['wrong source', { sourceSha: 'b'.repeat(40) }, 'family'],
    ['wrong version', { version: '1.0.2' }, 'family'],
    ['wrong count', { expectedPackageCount: 3 }, 'family'],
    ['non-array', { expectedPackageCount: undefined, packageNames: {} }, 'family'],
    ['empty', { expectedPackageCount: 0, packageNames: [] }, 'family'],
    ['duplicates', { packageNames: ['@blackunicorn/a', '@blackunicorn/a'] }, 'family'],
    ['invalid name', { packageNames: ['@blackunicorn/a', 42] }, 'family'],
    [
      'wrong tool',
      { scope: '@blackunicorn/eslint', expectedPackageCount: 1, packageNames: ['@blackunicorn/other'] },
      '@blackunicorn/eslint'
    ]
  ])('rejects a %s recovery package-name policy', (_label, mutation, scope) => {
    const { root } = prepared();
    const path = join(root, 'names.json');
    const policy = {
      schemaVersion: 1,
      scope: 'family',
      sourceSha: 'a'.repeat(40),
      version: '1.0.1',
      expectedPackageCount: 2,
      packageNames: ['@blackunicorn/a', '@blackunicorn/b'],
      ...mutation
    };
    writeFileSync(path, JSON.stringify(policy));
    vi.stubEnv('RELEASE_PACKAGE_NAMES_FILE', path);
    vi.stubEnv('RELEASE_SCOPE', scope);
    vi.stubEnv('RELEASE_SHA', 'a'.repeat(40));
    vi.stubEnv('RELEASE_VERSION', '1.0.1');
    expect(() =>
      main({ argv: ['verify-local', 'bundle'], root, run: vi.fn(), log: vi.fn(), expectedFamilySize: 2 })
    ).toThrow(/name policy/);
  });

  it('routes every command and rejects invalid usage', () => {
    const { root, dir } = prepared();
    const state = registryRunner(dir);
    const log = vi.fn();
    vi.stubEnv('RELEASE_SHA', 'a'.repeat(40));
    expect(
      main({ argv: ['candidates', 'family', '1.0.1'], root, run: state.run, log, expectedFamilySize: 2 }).packages
    ).toHaveLength(2);
    expect(
      main({ argv: ['prepare', 'another', 'family', '1.0.1'], root, run: fakePack, log, expectedFamilySize: 2 })
        .packages
    ).toHaveLength(2);
    expect(
      main({ argv: ['publish', 'bundle', 'staging-1-1'], root, run: state.run, log, expectedFamilySize: 2 }).packages
    ).toHaveLength(2);
    writeFileSync(
      join(root, 'npm-access.json'),
      JSON.stringify({ '@blackunicorn/a': 'read-write', '@blackunicorn/b': 'read-write' })
    );
    expect(
      main({
        argv: ['preflight-access', 'bundle', 'npm-access.json'],
        root,
        run: state.run,
        log,
        expectedFamilySize: 2
      }).packages
    ).toHaveLength(2);
    expect(
      main({ argv: ['verify', 'bundle'], root, run: state.run, log, expectedFamilySize: 2 }).packages
    ).toHaveLength(2);
    expect(
      main({ argv: ['verify-local', 'bundle'], root, run: state.run, log, expectedFamilySize: 2 }).packages
    ).toHaveLength(2);
    const provenanceDocuments = state.manifest.packages.map(pkg => attestation(pkg));
    const provenanceRun = vi.fn((tool: string, args: string[], options: object) => {
      if (tool === 'npm' && ['install', 'audit'].includes(args[0])) return '';
      if (tool === 'curl') return JSON.stringify(provenanceDocuments.shift());
      if (tool === 'cosign') return '';
      return state.run(tool, args, options);
    });
    vi.stubEnv('GITHUB_REPOSITORY', 'BlackUnicornSecurity/bonklm');
    vi.stubEnv('RELEASE_SCOPE', 'family');
    vi.stubEnv('RELEASE_VERSION', '1.0.1');
    vi.stubEnv('RELEASE_TAG', 'v1.0.1');
    vi.stubEnv('RELEASE_SHA', 'a'.repeat(40));
    expect(
      main({
        argv: ['verify-provenance', 'bundle'],
        root,
        run: provenanceRun,
        log,
        expectedFamilySize: 2
      }).packages
    ).toHaveLength(2);
    expect(
      main({
        argv: ['snapshot', 'bundle', 'latest', 'npm-recovery.json'],
        root,
        run: state.run,
        log,
        expectedFamilySize: 2
      }).packages
    ).toHaveLength(2);
    expect(
      main({
        argv: ['promote', 'bundle', 'latest', 'npm-recovery.json'],
        root,
        run: state.run,
        log,
        expectedFamilySize: 2
      }).packages
    ).toHaveLength(2);
    expect(
      main({ argv: ['verify-channel', 'bundle', 'latest'], root, run: state.run, log, expectedFamilySize: 2 }).packages
    ).toHaveLength(2);
    expect(
      main({ argv: ['channel-version', 'bundle', 'latest'], root, run: state.run, log, expectedFamilySize: 2 })
        .channelVersion
    ).toBe('1.0.1');
    expect(
      main({
        argv: ['cleanup-staging', 'bundle', 'staging-1-1'],
        root,
        run: state.run,
        log,
        expectedFamilySize: 2
      }).packages
    ).toHaveLength(2);
    expect(
      main({ argv: ['restore', 'bundle', 'npm-recovery.json'], root, run: state.run, log, expectedFamilySize: 2 })
        .packages
    ).toHaveLength(2);
    expect(log).toHaveBeenCalledTimes(13);
    expect(() => main({ argv: [], root, run: state.run, log, expectedFamilySize: 2 })).toThrow(/Usage/);
    const runner = createRunner({ argv: ['verify', 'bundle'], root, run: state.run, log, expectedFamilySize: 2 });
    expect(runner().packages).toHaveLength(2);
    expect(command(process.execPath, ['--version'], {})).toMatch(/^v/);
  });
});
