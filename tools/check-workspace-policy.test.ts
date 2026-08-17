/**
 * tools/check-workspace-policy.test.ts
 * =====================================
 *
 * Unit + integration coverage for the `tools/*` Tier A / Tier B workspace-policy
 * gate. The gate asserts every `tools/<name>/package.json` is either Tier A
 * (`private: true`, internal-only) or an explicit Tier B publishable package
 * (`workspacePolicy: 'tier-b-publishable'` + `publishJustification` + non-empty
 * `files` + `@blackunicorn/` name), and that no Tier A tool leaks into a
 * `packages/*` consumer's runtime deps. See tools/check-workspace-policy.js +
 * tools/WORKSPACE-POLICY.md.
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
  checkWorkspacePolicy,
  enumerateToolPackages,
  main,
  readJson,
  runCli,
  validateConsumerLinks,
  validateToolsPackage
} from './check-workspace-policy.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
// realpath so the script's `import.meta.url` matches the argv[1] we pass it
// when it is spawned as a child process (macOS /var -> /private/var symlink).
const SCRIPT = realpathSync(join(HERE, 'check-workspace-policy.js'));

type Manifest = Record<string, unknown> | string | null;

interface RepoFixture {
  root: string;
  toolsDir: string;
  packagesDir: string;
}

/**
 * Build a throwaway repo-shaped fixture under the OS temp dir and register its
 * cleanup with the running test (no shared mutable registry). `tools` and
 * `packages` describe `<area>/<dir>/package.json` entries (json === null ->
 * create the dir but no manifest; a string is written verbatim so malformed
 * JSON can be exercised). Both `tools/` and `packages/` dirs are always created
 * so the gate's `existsSync` probes hit the present-path.
 */
function makeRepo(
  tools: Array<{ dir: string; json: Manifest }> = [],
  packages: Array<{ dir: string; json: Manifest }> = []
): RepoFixture {
  const root = mkdtempSync(join(tmpdir(), 'bonklm-wspolicy-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));

  const writeArea = (area: string, entries: Array<{ dir: string; json: Manifest }>): string => {
    const areaDir = join(root, area);
    mkdirSync(areaDir, { recursive: true });
    for (const entry of entries) {
      const dir = join(areaDir, entry.dir);
      mkdirSync(dir, { recursive: true });
      if (entry.json !== null) {
        const body = typeof entry.json === 'string' ? entry.json : JSON.stringify(entry.json, null, 2);
        writeFileSync(join(dir, 'package.json'), body);
      }
    }
    return areaDir;
  };

  return {
    root,
    toolsDir: writeArea('tools', tools),
    packagesDir: writeArea('packages', packages)
  };
}

describe('readJson', () => {
  it('returns null when the file is absent', () => {
    expect(readJson(join(tmpdir(), 'bonklm-wspolicy-missing-xyz.json'))).toBeNull();
  });

  it('parses a valid JSON file', () => {
    const { toolsDir } = makeRepo([{ dir: 'a', json: { name: '@x/a', private: true } }]);
    expect(readJson(join(toolsDir, 'a', 'package.json'))).toEqual({ name: '@x/a', private: true });
  });

  it('throws a descriptive error on malformed JSON', () => {
    const { toolsDir } = makeRepo([{ dir: 'a', json: '{ not valid json' }]);
    expect(() => readJson(join(toolsDir, 'a', 'package.json'))).toThrow(/Failed to parse/);
  });
});

describe('enumerateToolPackages', () => {
  it('returns [] when the tools dir does not exist', () => {
    expect(enumerateToolPackages(join(tmpdir(), 'bonklm-wspolicy-no-tools-xyz'))).toEqual([]);
  });

  it('includes dirs with a package.json; skips dotfiles, plain files, and manifest-less dirs', () => {
    const { toolsDir } = makeRepo([
      { dir: 'with-manifest', json: { name: '@x/a', private: true } },
      { dir: 'no-manifest', json: null }
    ]);
    // A dotfile dir and a plain file sitting directly under tools/ must both be skipped.
    mkdirSync(join(toolsDir, '.hidden'), { recursive: true });
    writeFileSync(join(toolsDir, '.hidden', 'package.json'), '{}');
    writeFileSync(join(toolsDir, 'WORKSPACE-POLICY.md'), '# not a package');

    expect(enumerateToolPackages(toolsDir)).toEqual([join(toolsDir, 'with-manifest')]);
  });
});

describe('validateToolsPackage', () => {
  it('returns a missing-manifest diagnostic when package.json is absent at the path', () => {
    const { toolsDir } = makeRepo([{ dir: 'gone', json: null }]);
    const result = validateToolsPackage(join(toolsDir, 'gone'));
    expect(result.tier).toBe('A');
    expect(result.name).toBeUndefined();
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatch(/missing or unreadable/);
  });

  it('Tier A: flags a package missing `private: true`', () => {
    const { toolsDir } = makeRepo([{ dir: 'a', json: { name: '@x/a' } }]);
    const result = validateToolsPackage(join(toolsDir, 'a'));
    expect(result.tier).toBe('A');
    expect(result.violations[0]).toMatch(/Tier A package missing/);
  });

  it('Tier A: clean when `private: true`', () => {
    const { toolsDir } = makeRepo([{ dir: 'a', json: { name: '@x/a', private: true } }]);
    expect(validateToolsPackage(join(toolsDir, 'a'))).toMatchObject({
      tier: 'A',
      name: '@x/a',
      violations: []
    });
  });

  it('Tier A: flags a truthy-but-not-`true` private value (strict-equality bypass guard)', () => {
    // npm/pnpm only honor the literal boolean `true` to block publish, so the
    // gate uses strict `!== true`. Pin it: a future loosening to `!pkg.private`
    // would wrongly pass `private: 1` and silently open a publish-leak bypass.
    const { toolsDir } = makeRepo([{ dir: 'a', json: { name: '@x/a', private: 1 } }]);
    expect(validateToolsPackage(join(toolsDir, 'a')).violations).toEqual([
      expect.stringMatching(/Tier A package missing/)
    ]);
  });

  it('Tier B: clean when all required fields are present', () => {
    const { toolsDir } = makeRepo([
      {
        dir: 'b',
        json: {
          name: '@blackunicorn/plugin',
          workspacePolicy: 'tier-b-publishable',
          publishJustification: 'consumed by downstream connector authors',
          files: ['dist'],
          repository: {
            type: 'git',
            url: 'git+https://github.com/BlackUnicornSecurity/bonklm.git',
            directory: 'tools/b'
          }
        }
      }
    ]);
    expect(validateToolsPackage(join(toolsDir, 'b'))).toMatchObject({ tier: 'B', violations: [] });
  });

  it('Tier B: rejects missing or mismatched trusted-publishing repository metadata', () => {
    const { toolsDir } = makeRepo([
      {
        dir: 'b',
        json: {
          name: '@blackunicorn/plugin',
          workspacePolicy: 'tier-b-publishable',
          publishJustification: 'reason',
          files: ['dist']
        }
      }
    ]);
    expect(validateToolsPackage(join(toolsDir, 'b')).violations).toEqual([
      expect.stringMatching(/repository metadata/)
    ]);
  });

  it('Tier B: flags a non-string publishJustification', () => {
    const { toolsDir } = makeRepo([
      {
        dir: 'b',
        json: {
          name: '@blackunicorn/plugin',
          workspacePolicy: 'tier-b-publishable',
          publishJustification: 42,
          files: ['dist']
        }
      }
    ]);
    expect(validateToolsPackage(join(toolsDir, 'b')).violations).toEqual([
      expect.stringMatching(/publishJustification/)
    ]);
  });

  it('Tier B: flags an empty-string publishJustification', () => {
    const { toolsDir } = makeRepo([
      {
        dir: 'b',
        json: {
          name: '@blackunicorn/plugin',
          workspacePolicy: 'tier-b-publishable',
          publishJustification: '',
          files: ['dist']
        }
      }
    ]);
    expect(validateToolsPackage(join(toolsDir, 'b')).violations).toEqual([
      expect.stringMatching(/publishJustification/)
    ]);
  });

  it('Tier B: flags a missing files array', () => {
    const { toolsDir } = makeRepo([
      {
        dir: 'b',
        json: {
          name: '@blackunicorn/plugin',
          workspacePolicy: 'tier-b-publishable',
          publishJustification: 'reason'
        }
      }
    ]);
    expect(validateToolsPackage(join(toolsDir, 'b')).violations).toEqual([expect.stringMatching(/"files"/)]);
  });

  it('Tier B: flags an empty files array', () => {
    const { toolsDir } = makeRepo([
      {
        dir: 'b',
        json: {
          name: '@blackunicorn/plugin',
          workspacePolicy: 'tier-b-publishable',
          publishJustification: 'reason',
          files: []
        }
      }
    ]);
    expect(validateToolsPackage(join(toolsDir, 'b')).violations).toEqual([expect.stringMatching(/"files"/)]);
  });

  it('Tier B: flags a non-string name', () => {
    const { toolsDir } = makeRepo([
      {
        dir: 'b',
        json: {
          name: 123,
          workspacePolicy: 'tier-b-publishable',
          publishJustification: 'reason',
          files: ['dist']
        }
      }
    ]);
    expect(validateToolsPackage(join(toolsDir, 'b')).violations).toEqual([
      expect.stringMatching(/MUST start with `@blackunicorn\/`/)
    ]);
  });

  it('Tier B: flags a name outside the @blackunicorn scope', () => {
    const { toolsDir } = makeRepo([
      {
        dir: 'b',
        json: {
          name: '@other/plugin',
          workspacePolicy: 'tier-b-publishable',
          publishJustification: 'reason',
          files: ['dist']
        }
      }
    ]);
    expect(validateToolsPackage(join(toolsDir, 'b')).violations).toEqual([
      expect.stringMatching(/MUST start with `@blackunicorn\/`/)
    ]);
  });

  it('Tier B: rejects scoped names that cannot form a release tag', () => {
    const { toolsDir } = makeRepo([
      {
        dir: 'b',
        json: {
          name: '@blackunicorn/foo.bar',
          workspacePolicy: 'tier-b-publishable',
          publishJustification: 'reason',
          files: ['dist']
        }
      }
    ]);
    expect(validateToolsPackage(join(toolsDir, 'b')).violations).toEqual([expect.stringMatching(/release-compatible/)]);
  });

  it('Tier B: accumulates multiple violations from one manifest (independent `if`s, not `else if`)', () => {
    // Two independent Tier B failures (missing files AND wrong-scope name) must
    // BOTH surface — guards against a refactor collapsing the checks into a
    // single `else if` chain that would report only the first.
    const { toolsDir } = makeRepo([
      {
        dir: 'b',
        json: {
          name: '@other/plugin',
          workspacePolicy: 'tier-b-publishable',
          publishJustification: 'reason'
        }
      }
    ]);
    const { violations } = validateToolsPackage(join(toolsDir, 'b'));
    expect(violations).toHaveLength(2);
    expect(violations.join('\n')).toMatch(/"files"/);
    expect(violations.join('\n')).toMatch(/MUST start with `@blackunicorn\/`/);
  });

  it('Tier B: flags the private + publishable contradiction', () => {
    const { toolsDir } = makeRepo([
      {
        dir: 'b',
        json: {
          name: '@blackunicorn/plugin',
          workspacePolicy: 'tier-b-publishable',
          publishJustification: 'reason',
          files: ['dist'],
          private: true
        }
      }
    ]);
    expect(validateToolsPackage(join(toolsDir, 'b')).violations).toEqual([expect.stringMatching(/contradictory/)]);
  });
});

describe('validateConsumerLinks', () => {
  const toolsByName = new Map([
    ['@tool/a', { tier: 'A' }],
    ['@tool/b', { tier: 'B' }]
  ]);

  it('returns [] when the packages dir does not exist', () => {
    expect(validateConsumerLinks(toolsByName, join(tmpdir(), 'bonklm-wspolicy-no-packages-xyz'))).toEqual([]);
  });

  it('skips a packages/ entry that has no manifest', () => {
    const { packagesDir } = makeRepo([], [{ dir: 'no-manifest', json: null }]);
    expect(validateConsumerLinks(toolsByName, packagesDir)).toEqual([]);
  });

  it('flags a Tier A tool listed as dependencies / peer / optional', () => {
    const { packagesDir } = makeRepo(
      [],
      [
        {
          dir: 'consumer',
          json: {
            name: '@x/consumer',
            dependencies: { '@tool/a': 'workspace:*' },
            peerDependencies: { '@tool/a': 'workspace:*' },
            optionalDependencies: { '@tool/a': 'workspace:*' }
          }
        }
      ]
    );
    const violations = validateConsumerLinks(toolsByName, packagesDir);
    expect(violations).toHaveLength(3);
    expect(violations.join('\n')).toMatch(/listed as dependencies/);
    expect(violations.join('\n')).toMatch(/listed as peerDependencies/);
    expect(violations.join('\n')).toMatch(/listed as optionalDependencies/);
  });

  it('allows a Tier A tool as devDependency and ignores non-tool + Tier B runtime deps', () => {
    const { packagesDir } = makeRepo(
      [],
      [
        {
          dir: 'consumer',
          json: {
            name: '@x/consumer',
            // devDependencies are NOT checked; lodash is not a tool; @tool/b is Tier B.
            devDependencies: { '@tool/a': 'workspace:*' },
            dependencies: { lodash: '^4', '@tool/b': 'workspace:*' }
          }
        }
      ]
    );
    expect(validateConsumerLinks(toolsByName, packagesDir)).toEqual([]);
  });
});

describe('checkWorkspacePolicy', () => {
  it('is ok against a clean Tier A fixture', () => {
    const { toolsDir, packagesDir } = makeRepo([{ dir: 'a', json: { name: '@tool/a', private: true } }]);
    expect(checkWorkspacePolicy({ toolsDir, packagesDir })).toMatchObject({
      ok: true,
      toolCount: 1,
      checkedCount: 1,
      violations: []
    });
  });

  it('counts a nameless-but-valid Tier A tool without indexing it by name', () => {
    // A `{ private: true }` tool with no `name` is compliant Tier A, but has no
    // name to index — exercises the `result.name === undefined` skip path.
    const { toolsDir, packagesDir } = makeRepo([{ dir: 'nameless', json: { private: true } }]);
    expect(checkWorkspacePolicy({ toolsDir, packagesDir })).toMatchObject({
      ok: true,
      toolCount: 1,
      checkedCount: 0,
      violations: []
    });
  });

  it('reports toolCount 0 and stays ok when no tools/* packages exist', () => {
    const { toolsDir, packagesDir } = makeRepo([], []);
    expect(checkWorkspacePolicy({ toolsDir, packagesDir })).toMatchObject({
      ok: true,
      toolCount: 0,
      checkedCount: 0,
      violations: []
    });
  });

  it('aggregates a tier violation', () => {
    const { toolsDir, packagesDir } = makeRepo([{ dir: 'a', json: { name: '@x/a' } }]);
    const result = checkWorkspacePolicy({ toolsDir, packagesDir });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatch(/Tier A package missing/);
  });

  it('aggregates a consumer-link violation from a clean Tier A tool', () => {
    const { toolsDir, packagesDir } = makeRepo(
      [{ dir: 'a', json: { name: '@tool/a', private: true } }],
      [{ dir: 'consumer', json: { name: '@x/consumer', dependencies: { '@tool/a': 'workspace:*' } } }]
    );
    const result = checkWorkspacePolicy({ toolsDir, packagesDir });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([expect.stringMatching(/Tier A tool `@tool\/a` listed as dependencies/)]);
  });

  it('defaults to the real repo paths and finds them compliant', () => {
    const result = checkWorkspacePolicy();
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.toolCount).toBeGreaterThan(0);
  });
});

describe('main', () => {
  it('logs the nothing-to-check line when no tools are found', () => {
    const { toolsDir, packagesDir } = makeRepo([], []);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    onTestFinished(() => vi.restoreAllMocks());

    main({ toolsDir, packagesDir });

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/nothing to check/));
    expect(exit).not.toHaveBeenCalled();
  });

  it('logs all-compliant and does not exit when the tree is clean', () => {
    const { toolsDir, packagesDir } = makeRepo([{ dir: 'a', json: { name: '@tool/a', private: true } }]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    onTestFinished(() => vi.restoreAllMocks());

    main({ toolsDir, packagesDir });

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/all compliant/));
    expect(exit).not.toHaveBeenCalled();
  });

  it('prints each violation and exits 1 on a policy breach', () => {
    const { toolsDir, packagesDir } = makeRepo([{ dir: 'a', json: { name: '@x/a' } }]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    onTestFinished(() => vi.restoreAllMocks());

    main({ toolsDir, packagesDir });

    expect(error).toHaveBeenCalledWith(expect.stringMatching(/Workspace-policy violations/));
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/Tier A package missing/));
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/1 violation\(s\)/));
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

describe('CLI (real child process)', () => {
  it('exits 0 and reports compliant against the real repo', () => {
    const output = execFileSync('node', [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf-8' });
    expect(output).toMatch(/all compliant/);
  });

  it('exits 1 with a violations diagnostic when run against a non-compliant tree', () => {
    // A Tier A tool missing `private: true`, in a fixture repo whose tools/ dir
    // the copied script resolves relative to its own location (../tools -> root).
    const { root } = makeRepo([{ dir: 'offender', json: { name: '@x/offender' } }]);
    const toolsDir = join(root, 'tools');
    const fixtureScript = join(toolsDir, 'check-workspace-policy.js');
    cpSync(SCRIPT, fixtureScript);
    cpSync(join(HERE, 'release-scope.js'), join(toolsDir, 'release-scope.js'));

    let status: number | null = 0;
    let stderr = '';
    try {
      execFileSync('node', [realpathSync(fixtureScript)], { encoding: 'utf-8' });
    } catch (err) {
      const e = err as { status?: number | null; stderr?: Buffer | string };
      status = e.status ?? null;
      stderr = String(e.stderr ?? '');
    }
    expect(status).toBe(1);
    expect(stderr).toMatch(/Workspace-policy violations/);
    // The Tier A diagnostic names the offending manifest path, not its `name`.
    expect(stderr).toMatch(/offender[/\\]package\.json/);
    expect(stderr).toMatch(/Tier A package missing/);
  });
});
