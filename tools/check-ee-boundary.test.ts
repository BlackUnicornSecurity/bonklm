/**
 * tools/check-ee-boundary.test.ts
 * ================================
 *
 * Unit + integration coverage for the OSS↔EE license-boundary gate
 * (`tools/check-ee-boundary.js`; design: docs/contributing/adr/0007-ee-license-boundary-guard.md).
 * The gate (a) classifies every workspace package under `packages/` OSS
 * (Apache-2.0) vs EE (BUSL-1.1) and errors on an unclassifiable one, and (b) fails
 * if an OSS package depends on an EE package via a source import OR a declared
 * manifest dependency. At v1.0 (zero ee packages) it passes trivially — these
 * tests prove both the green-today path and that the tripwire fires once an ee
 * package exists (including the nested `packages/bonklm-ee/<sub>/` layout).
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  EE_LICENSES,
  OSS_LICENSES,
  buildPackageIndex,
  checkEeBoundary,
  classifyEdge,
  classifyLicense,
  computeBoundaryViolations,
  computeDependencyViolations,
  extractDynamicImports,
  extractStaticImports,
  formatFailure,
  isSourceFile,
  listSourceFiles,
  main,
  maskSource,
  packageContaining,
  packageNameOfSpecifier,
  readJson,
  resolveSpecifierToPackage,
  runCli
} from './check-ee-boundary.js';

type Manifest = Record<string, unknown> | string | null;

interface RepoFixture {
  root: string;
  packagesDir: string;
}

/**
 * Build a throwaway repo-shaped fixture under the OS temp dir and register its
 * cleanup with the running test. `pkgs` describes `packages/<dir>/package.json`
 * manifests (json === null -> create the dir but no manifest; `dir` may be nested
 * like `bonklm-ee/doctor-pro`) plus optional `files` (relative-path -> source
 * text) written under the package dir.
 */
function makeRepo(pkgs: Array<{ dir: string; json: Manifest; files?: Record<string, string> }>): RepoFixture {
  const root = mkdtempSync(join(tmpdir(), 'bonklm-eeb-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));

  const packagesDir = join(root, 'packages');
  mkdirSync(packagesDir, { recursive: true });
  for (const pkg of pkgs) {
    const dir = join(packagesDir, pkg.dir);
    mkdirSync(dir, { recursive: true });
    if (pkg.json !== null) {
      const body = typeof pkg.json === 'string' ? pkg.json : JSON.stringify(pkg.json, null, 2);
      writeFileSync(join(dir, 'package.json'), body);
    }
    for (const [rel, content] of Object.entries(pkg.files ?? {})) {
      const fp = join(dir, rel);
      mkdirSync(dirname(fp), { recursive: true });
      writeFileSync(fp, content);
    }
  }
  return { root, packagesDir };
}

/** Build an in-memory package index (no fs) for pure-function unit tests. */
function makeIndex(records: Array<{ name: string; dir: string; absDir: string; tier: string; deps?: string[] }>) {
  const list = records.map(r => ({ license: null, deps: [], ...r }));
  const byName = new Map(list.map(r => [r.name, r]));
  return { byName, list, errors: [] as object[] };
}

describe('license tier constants', () => {
  it('marks Apache-2.0 OSS and BUSL-1.1 EE', () => {
    expect(OSS_LICENSES.has('Apache-2.0')).toBe(true);
    expect(EE_LICENSES.has('BUSL-1.1')).toBe(true);
    expect(EE_LICENSES.has('LicenseRef-BSL-1.1')).toBe(true);
  });
});

describe('classifyLicense', () => {
  it('classifies Apache-2.0 as oss', () => {
    expect(classifyLicense('Apache-2.0')).toBe('oss');
  });
  it('classifies BSL spellings as ee', () => {
    expect(classifyLicense('BUSL-1.1')).toBe('ee');
    expect(classifyLicense('LicenseRef-BSL-1.1')).toBe('ee');
  });
  it('treats a non-string, empty, or unrecognized license as unknown', () => {
    expect(classifyLicense(undefined)).toBe('unknown');
    expect(classifyLicense('')).toBe('unknown');
    expect(classifyLicense('MIT')).toBe('unknown');
    // The prose name "BSL-1.1" is NOT a valid SPDX token and must be rejected.
    expect(classifyLicense('BSL-1.1')).toBe('unknown');
  });
});

describe('readJson', () => {
  it('returns null when the file is absent', () => {
    expect(readJson(join(tmpdir(), 'bonklm-eeb-missing-xyz.json'))).toBeNull();
  });
  it('parses a valid JSON file', () => {
    const { packagesDir } = makeRepo([{ dir: 'a', json: { name: '@x/a', license: 'Apache-2.0' } }]);
    expect(readJson(join(packagesDir, 'a', 'package.json'))).toEqual({ name: '@x/a', license: 'Apache-2.0' });
  });
  it('throws a descriptive error on malformed JSON', () => {
    const { packagesDir } = makeRepo([{ dir: 'a', json: '{ not valid json' }]);
    expect(() => readJson(join(packagesDir, 'a', 'package.json'))).toThrow(/Failed to parse/);
  });
});

describe('isSourceFile', () => {
  it('is true for source extensions and false otherwise', () => {
    expect(isSourceFile('x.ts')).toBe(true);
    expect(isSourceFile('x.mjs')).toBe(true);
    expect(isSourceFile('x.md')).toBe(false);
    expect(isSourceFile('package.json')).toBe(false);
  });
});

describe('maskSource', () => {
  it('blanks line comments in both views', () => {
    const { noComments, codeMask } = maskSource('a // bcd\ne');
    expect(noComments).toBe('a       \ne');
    expect(codeMask).toBe('a       \ne');
    expect(noComments).toHaveLength('a // bcd\ne'.length);
  });

  it('blanks block comments including their newlines', () => {
    const { codeMask } = maskSource('a /* b\nc */ d');
    expect(codeMask).toBe('a     \n     d');
  });

  it('keeps single-quoted string content in noComments but blanks it in codeMask', () => {
    const masked = maskSource("x = 'ab'");
    expect(masked.noComments).toBe("x = 'ab'");
    expect(masked.codeMask).toBe("x = '  '");
  });

  it('handles double-quoted and template strings', () => {
    expect(maskSource('x = "ab"').codeMask).toBe('x = "  "');
    expect(maskSource('x = `ab`').codeMask).toBe('x = `  `');
  });

  it('consumes an escaped char inside a string', () => {
    const masked = maskSource("'a\\nb'");
    expect(masked.noComments).toBe("'a\\nb'");
    // opening + closing quote kept; the 3 inner chars (\ n b) blanked
    expect(masked.codeMask).toBe("'    '");
  });

  it('keeps both views length-stable when a backslash is the final char (EOF)', () => {
    const src = "y = '" + '\\';
    const masked = maskSource(src);
    expect(masked.noComments).toHaveLength(src.length);
    expect(masked.codeMask).toHaveLength(src.length);
  });

  it('preserves a newline that appears inside a string', () => {
    // "'a\nb'" -> codeMask keeps the quotes + the literal newline, blanks a and b.
    const masked = maskSource("'a\nb'");
    expect(masked.codeMask).toBe("' \n '");
  });
});

describe('extractStaticImports', () => {
  it('extracts from-clauses and side-effect imports, de-duplicated', () => {
    const src = "import {a} from 'x';\nimport 'y';\nexport {b} from 'x';";
    expect(extractStaticImports(maskSource(src))).toEqual(['x', 'y']);
  });
  it('catches `import type` and `export * from` (the boundary covers type-only + star re-exports)', () => {
    expect(extractStaticImports(maskSource("import type { T } from '@x/ee';"))).toEqual(['@x/ee']);
    expect(extractStaticImports(maskSource("export * from '@x/ee';"))).toEqual(['@x/ee']);
  });
  it('does not match a `from` token buried in a string', () => {
    const src = 'const s = \'from "z"\';';
    expect(extractStaticImports(maskSource(src))).toEqual([]);
  });
  it('skips an unterminated string opener (no closing quote)', () => {
    expect(extractStaticImports(maskSource("import 'unterminated"))).toEqual([]);
  });
});

describe('extractDynamicImports', () => {
  it('separates string-literal targets from non-literal arguments', () => {
    const src = "await import('x'); await import(dynamicName);";
    const { literals, nonLiteral } = extractDynamicImports(maskSource(src));
    expect(literals).toEqual(['x']);
    expect(nonLiteral).toEqual(['dynamicName']);
  });
  it('strips a trailing TS `as Type` cast before the literal test', () => {
    const { literals } = extractDynamicImports(maskSource("import('x' as string)"));
    expect(literals).toEqual(['x']);
  });
  it('does not match `import(` that lives inside a string', () => {
    const { literals, nonLiteral } = extractDynamicImports(maskSource('const s = \'import("x")\';'));
    expect(literals).toEqual([]);
    expect(nonLiteral).toEqual([]);
  });
  it('does not match a `.import(` member access', () => {
    expect(extractDynamicImports(maskSource("obj.import('x')")).literals).toEqual([]);
  });
  it('skips an import( with no closing paren', () => {
    expect(extractDynamicImports(maskSource('import(')).literals).toEqual([]);
  });
  it('truncates an over-long non-literal argument with an ellipsis', () => {
    const longArg = 'a'.repeat(60);
    const { nonLiteral } = extractDynamicImports(maskSource(`import(${longArg})`));
    expect(nonLiteral[0]).toMatch(/…$/);
    expect(nonLiteral[0].length).toBeLessThan(longArg.length);
  });
  it('de-duplicates repeated literals and non-literals', () => {
    expect(extractDynamicImports(maskSource("import('x'); import('x');")).literals).toEqual(['x']);
    expect(extractDynamicImports(maskSource('import(z); import(z);')).nonLiteral).toEqual(['z']);
  });
});

describe('packageNameOfSpecifier', () => {
  it('returns null for relative and node: specifiers', () => {
    expect(packageNameOfSpecifier('./x')).toBeNull();
    expect(packageNameOfSpecifier('node:fs')).toBeNull();
  });
  it('returns the scoped name (first two segments)', () => {
    expect(packageNameOfSpecifier('@blackunicorn/bonklm-ee/sub')).toBe('@blackunicorn/bonklm-ee');
  });
  it('returns the whole spec for a single-segment scoped specifier', () => {
    expect(packageNameOfSpecifier('@onlyscope')).toBe('@onlyscope');
  });
  it('returns the first segment for an unscoped specifier', () => {
    expect(packageNameOfSpecifier('lodash/merge')).toBe('lodash');
  });
});

describe('packageContaining', () => {
  const list = [
    { name: '@x/a', dir: 'a', absDir: '/r/packages/a', tier: 'oss' },
    { name: '@x/a-sub', dir: 'a/sub', absDir: '/r/packages/a/sub', tier: 'oss' }
  ];
  it('matches an exact directory path', () => {
    expect(packageContaining(list, '/r/packages/a')?.name).toBe('@x/a');
  });
  it('returns null when the path is outside every package dir', () => {
    expect(packageContaining(list, '/r/packages/zzz/x.ts')).toBeNull();
  });
  it('prefers the longest matching prefix (nested wins)', () => {
    expect(packageContaining(list, '/r/packages/a/sub/x.ts')?.name).toBe('@x/a-sub');
  });
  it('keeps the longer match when a shorter one is seen afterwards', () => {
    const reordered = [list[1], list[0]];
    expect(packageContaining(reordered, '/r/packages/a/sub/x.ts')?.name).toBe('@x/a-sub');
  });
});

describe('buildPackageIndex', () => {
  it('returns empty when the packages dir does not exist', () => {
    const index = buildPackageIndex(join(tmpdir(), 'bonklm-eeb-nopkgs-xyz'));
    expect(index.list).toEqual([]);
    expect(index.errors).toEqual([]);
  });

  it('classifies oss/ee, records unclassifiable, captures deps, and skips non-package + build dirs', () => {
    const { packagesDir } = makeRepo([
      {
        dir: 'core',
        json: {
          name: '@x/core',
          license: 'Apache-2.0',
          dependencies: { '@x/util': 'workspace:*' },
          peerDependencies: { '@x/peer': '*' },
          optionalDependencies: { '@x/opt': '*' }
        }
      },
      { dir: 'ee', json: { name: '@x/ee', license: 'BUSL-1.1', private: true } },
      { dir: 'mystery', json: { name: '@x/mystery', license: 'MIT' } },
      { dir: 'no-manifest', json: null }
    ]);
    writeFileSync(join(packagesDir, '.DS_Store'), 'not a directory');
    mkdirSync(join(packagesDir, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(packagesDir, 'node_modules', 'dep', 'package.json'), '{"name":"dep"}');

    const index = buildPackageIndex(packagesDir);
    expect(index.byName.get('@x/core')?.tier).toBe('oss');
    // dependencyNames unions dependencies + peerDependencies + optionalDependencies
    expect(new Set(index.byName.get('@x/core')?.deps)).toEqual(new Set(['@x/util', '@x/peer', '@x/opt']));
    expect(index.byName.get('@x/ee')?.tier).toBe('ee');
    // unknown-license package is still indexed but recorded as an error
    expect(index.byName.get('@x/mystery')?.tier).toBe('unknown');
    expect(index.errors.map(e => (e as { dir: string }).dir)).toEqual(['mystery']);
    // a `packages/node_modules/` directory is never treated as a package
    expect(index.byName.has('dep')).toBe(false);
  });

  it('discovers a NESTED package under a manifest-less grouping dir (the packages/bonklm-ee/<sub>/ layout)', () => {
    const { packagesDir } = makeRepo([
      { dir: 'core', json: { name: '@x/core', license: 'Apache-2.0' } },
      { dir: 'bonklm-ee/doctor-pro', json: { name: '@x/ee-doctor', license: 'BUSL-1.1', private: true } },
      // a grouping child literally named `examples` is a REAL package during
      // discovery (only the source-WALK skips `examples`), so it must be classified
      { dir: 'bonklm-ee/examples', json: { name: '@x/ee-examples', license: 'BUSL-1.1', private: true } },
      { dir: 'bonklm-ee/not-a-pkg', json: null } // child dir with no manifest → skipped
    ]);
    // stray file + build/hidden children directly under the grouping dir → skipped
    writeFileSync(join(packagesDir, 'bonklm-ee', 'README.md'), '# group');
    mkdirSync(join(packagesDir, 'bonklm-ee', 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(packagesDir, 'bonklm-ee', 'node_modules', 'dep', 'package.json'), '{"name":"dep"}');
    mkdirSync(join(packagesDir, 'bonklm-ee', '.cache'), { recursive: true });

    const index = buildPackageIndex(packagesDir);
    const ee = index.byName.get('@x/ee-doctor');
    expect(ee?.tier).toBe('ee');
    expect(ee?.dir).toBe('bonklm-ee/doctor-pro');
    // a nested capability named `examples` is still discovered (discovery ≠ walk-skip)
    expect(index.byName.get('@x/ee-examples')?.tier).toBe('ee');
    // a build dir under the grouping dir is never treated as a package
    expect(index.byName.has('dep')).toBe(false);
    expect(index.list.some(p => p.tier === 'ee')).toBe(true); // arms the tripwire
  });

  it('records a manifest with no name as an error and normalizes a non-string license to null', () => {
    const { packagesDir } = makeRepo([{ dir: 'nameless', json: { version: '1.0.0', license: 123 } }]);
    const index = buildPackageIndex(packagesDir);
    expect(index.list).toEqual([]);
    expect(index.errors[0]).toMatchObject({ dir: 'nameless', name: null, license: null, reason: /no "name"/ });
  });
});

describe('computeDependencyViolations', () => {
  const index = makeIndex([
    { name: '@x/core', dir: 'core', absDir: '/r/packages/core', tier: 'oss', deps: ['@x/ee', '@x/util', 'lodash'] },
    { name: '@x/util', dir: 'util', absDir: '/r/packages/util', tier: 'oss', deps: [] },
    { name: '@x/ee', dir: 'bonklm-ee/x', absDir: '/r/packages/bonklm-ee/x', tier: 'ee', deps: ['@x/ee-inner'] },
    { name: '@x/ee-inner', dir: 'bonklm-ee/y', absDir: '/r/packages/bonklm-ee/y', tier: 'ee', deps: [] }
  ]);

  it('flags an OSS package that declares an EE package as a dependency', () => {
    const v = computeDependencyViolations(index);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ from: '@x/core', target: '@x/ee', kind: 'oss-depends-ee', via: 'manifest' });
  });
  it('does not flag OSS→OSS, OSS→external, or EE→EE dependency edges', () => {
    // @x/core→@x/util (oss) and @x/core→lodash (external) are not flagged;
    // @x/ee→@x/ee-inner (ee source) is skipped because the source is not OSS.
    const targets = computeDependencyViolations(index).map(x => x.target);
    expect(targets).toEqual(['@x/ee']);
  });
});

describe('resolveSpecifierToPackage', () => {
  const index = makeIndex([
    { name: '@x/core', dir: 'core', absDir: '/r/packages/core', tier: 'oss' },
    { name: '@x/ee', dir: 'ee', absDir: '/r/packages/ee', tier: 'ee' }
  ]);

  it('resolves a relative specifier into the package whose dir contains it', () => {
    const r = resolveSpecifierToPackage('../../ee/src/x', '/r/packages/core/src/a.ts', index);
    expect(r).toEqual({ kind: 'package', pkg: index.byName.get('@x/ee') });
  });
  it('marks a relative specifier outside every package dir as unresolved', () => {
    expect(resolveSpecifierToPackage('../../../elsewhere/x', '/r/packages/core/src/a.ts', index)).toEqual({
      kind: 'unresolved'
    });
  });
  it('treats node: builtins as external', () => {
    expect(resolveSpecifierToPackage('node:fs', '/r/packages/core/src/a.ts', index)).toEqual({ kind: 'external' });
  });
  it('resolves a bare workspace specifier to its package record', () => {
    expect(resolveSpecifierToPackage('@x/ee/sub', '/r/packages/core/src/a.ts', index)).toMatchObject({
      kind: 'package'
    });
  });
  it('treats an unknown bare specifier as external', () => {
    expect(resolveSpecifierToPackage('lodash', '/r/packages/core/src/a.ts', index)).toEqual({ kind: 'external' });
  });
});

describe('classifyEdge', () => {
  const index = makeIndex([
    { name: '@x/core', dir: 'core', absDir: '/r/packages/core', tier: 'oss' },
    { name: '@x/other', dir: 'other', absDir: '/r/packages/other', tier: 'oss' },
    { name: '@x/ee', dir: 'ee', absDir: '/r/packages/ee', tier: 'ee' }
  ]);
  const core = index.byName.get('@x/core')!;
  const fromFileAbs = '/r/packages/core/src/a.ts';

  it('flags an OSS package importing an EE package', () => {
    expect(classifyEdge({ spec: '@x/ee', fromPkg: core, fromFileAbs, index })).toMatchObject({
      from: '@x/core',
      target: '@x/ee',
      kind: 'oss-imports-ee'
    });
  });
  it('returns null for an external specifier', () => {
    expect(classifyEdge({ spec: 'lodash', fromPkg: core, fromFileAbs, index })).toBeNull();
  });
  it('returns null for an intra-package relative import', () => {
    expect(classifyEdge({ spec: './sibling', fromPkg: core, fromFileAbs, index })).toBeNull();
  });
  it('returns null for an OSS→OSS cross-package edge', () => {
    expect(classifyEdge({ spec: '@x/other', fromPkg: core, fromFileAbs, index })).toBeNull();
  });
});

describe('computeBoundaryViolations', () => {
  const index = makeIndex([
    { name: '@x/core', dir: 'core', absDir: '/r/packages/core', tier: 'oss' },
    { name: '@x/ee', dir: 'ee', absDir: '/r/packages/ee', tier: 'ee' }
  ]);
  const core = index.byName.get('@x/core')!;
  const file = (text: string) => ({ pkg: core, fileAbs: '/r/packages/core/src/a.ts', text });

  it('flags a static side-effect OSS→EE import and a star re-export, each as exactly one violation', () => {
    const sideEffect = computeBoundaryViolations({ index, files: [file("import '@x/ee';")], eeExists: true });
    expect(sideEffect).toHaveLength(1);
    expect(sideEffect[0]).toMatchObject({ via: 'static', from: '@x/core', target: '@x/ee', kind: 'oss-imports-ee' });

    const reExport = computeBoundaryViolations({ index, files: [file("export * from '@x/ee';")], eeExists: true });
    expect(reExport).toHaveLength(1);
    expect(reExport[0]).toMatchObject({ via: 'static', target: '@x/ee' });
  });
  it('flags a type-only import (the core must not even name a Pro package)', () => {
    const v = computeBoundaryViolations({ index, files: [file("import type { T } from '@x/ee';")], eeExists: true });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ via: 'static', target: '@x/ee' });
  });
  it('flags a dynamic-literal OSS→EE import', () => {
    const v = computeBoundaryViolations({ index, files: [file("await import('@x/ee');")], eeExists: true });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ via: 'dynamic', target: '@x/ee', kind: 'oss-imports-ee' });
  });
  it('fail-closes a non-literal dynamic import only when an ee package exists', () => {
    const armed = computeBoundaryViolations({ index, files: [file('await import(name);')], eeExists: true });
    expect(armed).toHaveLength(1);
    expect(armed[0]).toMatchObject({
      kind: 'dynamic-nonliteral',
      target: null,
      spec: 'name',
      file: '/r/packages/core/src/a.ts'
    });

    const disarmed = computeBoundaryViolations({ index, files: [file('await import(name);')], eeExists: false });
    expect(disarmed).toEqual([]);
  });
  it('de-duplicates repeated non-literal dynamic imports into a single violation', () => {
    const v = computeBoundaryViolations({
      index,
      files: [file('await import(name); await import(name);')],
      eeExists: true
    });
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe('dynamic-nonliteral');
  });
  it('returns nothing for a file with no boundary-crossing imports', () => {
    expect(computeBoundaryViolations({ index, files: [file("import 'node:fs';")], eeExists: true })).toEqual([]);
  });
});

describe('listSourceFiles', () => {
  it('walks source files, skipping build/dep/example/hidden dirs and non-source files', () => {
    const { packagesDir } = makeRepo([
      {
        dir: 'core',
        json: { name: '@x/core', license: 'Apache-2.0' },
        files: {
          'src/index.ts': '',
          'src/nested/deep.tsx': '',
          'README.md': '',
          'node_modules/dep/index.js': '',
          'dist/index.js': '',
          'examples/demo/app.ts': '',
          '.hidden/secret.ts': ''
        }
      }
    ]);
    const found = listSourceFiles(join(packagesDir, 'core')).map(p => p.slice(packagesDir.length + 1));
    expect(found.sort()).toEqual([join('core', 'src', 'index.ts'), join('core', 'src', 'nested', 'deep.tsx')].sort());
  });

  it('fails closed when a source directory cannot be read', () => {
    // root readable (yields one subdir), then that subdir throws → the warn names it
    const readdir = vi
      .fn()
      .mockReturnValueOnce([{ name: 'locked', isDirectory: () => true, isFile: () => false }])
      .mockImplementationOnce(() => {
        throw new Error('EACCES');
      });
    expect(() => listSourceFiles('/root', { readdir: readdir as never })).toThrow(/unreadable directory.*locked/);
  });

  it('ignores a dirent that is neither a file nor a directory (even with a source extension)', () => {
    const fakeReaddir = (() => [{ name: 'a.ts', isDirectory: () => false, isFile: () => false }]) as never;
    expect(listSourceFiles('/whatever', { readdir: fakeReaddir })).toEqual([]);
  });
});

describe('checkEeBoundary', () => {
  it('is ok on an all-OSS fixture with no cross-package imports', () => {
    const { packagesDir } = makeRepo([
      { dir: 'core', json: { name: '@x/core', license: 'Apache-2.0' }, files: { 'src/i.ts': "import 'node:fs';" } },
      { dir: 'util', json: { name: '@x/util', license: 'Apache-2.0' }, files: { 'src/i.ts': '' } }
    ]);
    const result = checkEeBoundary({ packagesDir });
    expect(result).toMatchObject({ ok: true, ossCount: 2, eeCount: 0, packageCount: 2 });
    expect(result.violations).toEqual([]);
  });

  it('fails when an OSS package imports an EE package (source-import facet)', () => {
    const { packagesDir } = makeRepo([
      {
        dir: 'core',
        json: { name: '@x/core', license: 'Apache-2.0' },
        files: { 'src/leak.ts': "import { p } from '@x/ee';\nexport const q = p;" }
      },
      { dir: 'ee', json: { name: '@x/ee', license: 'BUSL-1.1', private: true }, files: { 'src/i.ts': '' } }
    ]);
    const result = checkEeBoundary({ packagesDir });
    expect(result.ok).toBe(false);
    expect(result.eeCount).toBe(1);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ from: '@x/core', target: '@x/ee', via: 'static' })
    );
  });

  it('fails when an OSS package declares an EE dependency with NO source import (manifest facet)', () => {
    const { packagesDir } = makeRepo([
      {
        dir: 'core',
        json: { name: '@x/core', license: 'Apache-2.0', dependencies: { '@x/ee': 'workspace:*' } },
        files: { 'src/i.ts': 'export const x = 1;' } // no import of @x/ee anywhere
      },
      { dir: 'bonklm-ee/x', json: { name: '@x/ee', license: 'BUSL-1.1', private: true }, files: { 'src/i.ts': '' } }
    ]);
    const result = checkEeBoundary({ packagesDir });
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ from: '@x/core', target: '@x/ee', kind: 'oss-depends-ee', via: 'manifest' })
    );
  });

  it('fails on an unclassifiable license even with no import violations', () => {
    const { packagesDir } = makeRepo([{ dir: 'core', json: { name: '@x/core', license: 'MIT' } }]);
    const result = checkEeBoundary({ packagesDir });
    expect(result.ok).toBe(false);
    expect(result.licenseErrors).toHaveLength(1);
    expect(result.violations).toEqual([]);
  });

  it('honours injected readSource + listFiles', () => {
    const { packagesDir } = makeRepo([
      { dir: 'core', json: { name: '@x/core', license: 'Apache-2.0' } },
      { dir: 'ee', json: { name: '@x/ee', license: 'BUSL-1.1', private: true } }
    ]);
    const fakeFile = join(packagesDir, 'core', 'src', 'virtual.ts');
    const result = checkEeBoundary({
      packagesDir,
      listFiles: (absDir: string) => (absDir.endsWith('core') ? [fakeFile] : []),
      readSource: () => "import '@x/ee';"
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatchObject({ from: '@x/core', target: '@x/ee' });
  });

  it('defaults to the real repo paths and finds the all-Apache tree clean', () => {
    const result = checkEeBoundary();
    expect(result.eeCount).toBe(0);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.ossCount).toBeGreaterThan(0);
  });
});

describe('formatFailure', () => {
  const packagesDir = join('/r', 'packages');

  it('renders unclassifiable packages with and without a name', () => {
    const report = formatFailure({
      packagesDir,
      licenseErrors: [
        { dir: 'a', name: '@x/a', license: 'MIT', reason: 'unrecognized or missing "license"' },
        { dir: 'b', name: null, license: null, reason: 'manifest has no "name"' }
      ],
      violations: [],
      ok: false,
      packageCount: 2,
      ossCount: 0,
      eeCount: 0
    });
    expect(report).toMatch(/UNCLASSIFIABLE packages/);
    expect(report).toContain('packages/a: name: @x/a,');
    expect(report).toContain('"MIT"');
    expect(report).toContain('packages/b:');
    expect(report).toContain('<none>');
  });

  it('renders import, dependency, and non-literal violation kinds with repo-relative paths', () => {
    const report = formatFailure({
      packagesDir,
      licenseErrors: [],
      violations: [
        {
          from: '@x/core',
          target: '@x/ee',
          spec: '@x/ee',
          via: 'static',
          kind: 'oss-imports-ee',
          file: '/r/packages/core/src/a.ts'
        },
        { from: '@x/core', target: '@x/ee', spec: '@x/ee', via: 'manifest', kind: 'oss-depends-ee', fromDir: 'core' },
        {
          from: '@x/core',
          target: null,
          spec: 'name',
          via: 'dynamic',
          kind: 'dynamic-nonliteral',
          file: '/r/packages/core/src/b.ts'
        }
      ],
      ok: false,
      packageCount: 2,
      ossCount: 1,
      eeCount: 1
    });
    expect(report).toMatch(/OSS→EE boundary violations/);
    expect(report).toContain('packages/core/src/a.ts: OSS package @x/core imports EE package @x/ee (static)');
    expect(report).toContain(
      'packages/core/package.json: OSS package @x/core declares EE package @x/ee as a dependency'
    );
    expect(report).toContain('non-literal dynamic import()');
    expect(report).not.toContain('/r/packages'); // shown relative, not absolute
  });
});

describe('main', () => {
  it('logs success and does not exit when the tree is clean', () => {
    const { packagesDir } = makeRepo([{ dir: 'core', json: { name: '@x/core', license: 'Apache-2.0' } }]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    onTestFinished(() => vi.restoreAllMocks());

    main({ packagesDir });

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/no OSS→EE boundary violations/));
    expect(exit).not.toHaveBeenCalled();
  });

  it('prints the failure report and exits 1 on a violation', () => {
    const { packagesDir } = makeRepo([
      {
        dir: 'core',
        json: { name: '@x/core', license: 'Apache-2.0' },
        files: { 'src/leak.ts': "import '@x/ee';" }
      },
      { dir: 'ee', json: { name: '@x/ee', license: 'BUSL-1.1', private: true } }
    ]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    onTestFinished(() => vi.restoreAllMocks());

    main({ packagesDir });

    expect(error).toHaveBeenCalledWith(expect.stringMatching(/license-boundary check failed/));
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('runCli', () => {
  it('returns false (no-op) when argv1 is not this script', () => {
    expect(runCli({ argv1: '/some/other/file.js', scriptUrl: 'file:///x/script.js' })).toBe(false);
  });

  it('runs and returns true when argv1 matches the script path', () => {
    const run = vi.fn();
    const ran = runCli({ argv1: '/x/script.js', scriptUrl: 'file:///x/script.js', run, exit: vi.fn() });
    expect(ran).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it('catches an Error thrown by run and exits 1', () => {
    const exit = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => vi.restoreAllMocks());
    runCli({
      argv1: '/x/script.js',
      scriptUrl: 'file:///x/script.js',
      run: () => {
        throw new Error('boom');
      },
      exit
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('stringifies a non-Error thrown value', () => {
    const exit = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => vi.restoreAllMocks());
    runCli({
      argv1: '/x/script.js',
      scriptUrl: 'file:///x/script.js',
      run: () => {
        throw 'plain-string-failure';
      },
      exit
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('plain-string-failure'));
  });
});
