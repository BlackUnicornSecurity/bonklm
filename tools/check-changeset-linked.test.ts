/**
 * tools/check-changeset-linked.test.ts
 * =====================================
 *
 * Unit + integration coverage for the changeset `linked`-group drift gate.
 * The gate asserts that `.changeset/config.json`'s linked group equals the set
 * of publishable `packages/*` manifests (those with `private !== true`). See
 * tools/check-changeset-linked.js + CONTRIBUTING.md "Versioning, Changesets,
 * and Releases".
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
  checkChangesetLinked,
  derivePublishableSet,
  diffLinked,
  formatFailure,
  main,
  readJson,
  readLinkedGroup,
  runCli
} from './check-changeset-linked.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
// realpath so the script's `import.meta.url` matches the argv[1] we pass it
// when it is spawned as a child process (macOS /var -> /private/var symlink).
const SCRIPT = realpathSync(join(HERE, 'check-changeset-linked.js'));

type Manifest = Record<string, unknown> | string | null;

interface RepoFixture {
  root: string;
  packagesDir: string;
  changesetConfigPath: string;
}

/**
 * Build a throwaway repo-shaped fixture under the OS temp dir and register its
 * cleanup with the running test (no shared mutable registry). `pkgs` describes
 * packages/<dir>/package.json entries (json === null -> create the dir but no
 * manifest). `linked` is the raw value for the changeset config's `linked` key
 * (undefined -> omit the key entirely).
 */
function makeRepo(pkgs: Array<{ dir: string; json: Manifest }>, linked?: unknown): RepoFixture {
  const root = mkdtempSync(join(tmpdir(), 'bonklm-linked-'));
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
  }

  const changesetDir = join(root, '.changeset');
  mkdirSync(changesetDir, { recursive: true });
  const config = linked === undefined ? {} : { linked };
  const changesetConfigPath = join(changesetDir, 'config.json');
  writeFileSync(changesetConfigPath, JSON.stringify(config, null, 2));

  return { root, packagesDir, changesetConfigPath };
}

describe('readJson', () => {
  it('returns null when the file is absent', () => {
    expect(readJson(join(tmpdir(), 'bonklm-does-not-exist-xyz.json'))).toBeNull();
  });

  it('parses a valid JSON file', () => {
    const { changesetConfigPath } = makeRepo([], []);
    expect(readJson(changesetConfigPath)).toEqual({ linked: [] });
  });

  it('throws a descriptive error on malformed JSON', () => {
    const { packagesDir } = makeRepo([{ dir: 'a', json: '{ not valid json' }], []);
    expect(() => readJson(join(packagesDir, 'a', 'package.json'))).toThrow(/Failed to parse/);
  });
});

describe('derivePublishableSet', () => {
  it('returns [] when the packages dir does not exist', () => {
    expect(derivePublishableSet(join(tmpdir(), 'bonklm-no-packages-xyz'))).toEqual([]);
  });

  it('includes named non-private manifests, excludes private/nameless, returns sorted', () => {
    const { packagesDir } = makeRepo([
      { dir: 'b-pub', json: { name: '@x/b' } },
      { dir: 'a-pub', json: { name: '@x/a', private: false } },
      { dir: 'priv', json: { name: '@x/p', private: true } },
      { dir: 'nameless', json: { version: '1.0.0' } },
      { dir: 'empty-name', json: { name: '' } },
      { dir: 'no-manifest', json: null }
    ]);
    expect(derivePublishableSet(packagesDir)).toEqual(['@x/a', '@x/b']);
  });

  it('skips a non-directory entry sitting directly under packages/', () => {
    const { packagesDir } = makeRepo([{ dir: 'real', json: { name: '@x/real' } }]);
    writeFileSync(join(packagesDir, '.DS_Store'), 'not a package directory');
    expect(derivePublishableSet(packagesDir)).toEqual(['@x/real']);
  });
});

describe('readLinkedGroup', () => {
  it('returns [] when the config file is absent', () => {
    expect(readLinkedGroup(join(tmpdir(), 'bonklm-no-config-xyz.json'))).toEqual([]);
  });

  it('returns [] when the linked key is absent', () => {
    const { changesetConfigPath } = makeRepo([], undefined);
    expect(readLinkedGroup(changesetConfigPath)).toEqual([]);
  });

  it('returns [] when linked is an empty array', () => {
    const { changesetConfigPath } = makeRepo([], []);
    expect(readLinkedGroup(changesetConfigPath)).toEqual([]);
  });

  it('returns [] when the first linked entry is not an array', () => {
    const { changesetConfigPath } = makeRepo([], ['not-a-group']);
    expect(readLinkedGroup(changesetConfigPath)).toEqual([]);
  });

  it('returns the first linked group when present', () => {
    const { changesetConfigPath } = makeRepo([], [['@x/a', '@x/b']]);
    expect(readLinkedGroup(changesetConfigPath)).toEqual(['@x/a', '@x/b']);
  });

  it('throws (fails loud) when the config declares more than one linked group', () => {
    const { changesetConfigPath } = makeRepo([], [['@x/a'], ['@x/b']]);
    expect(() => readLinkedGroup(changesetConfigPath)).toThrow(/single publishable family/);
  });
});

describe('diffLinked', () => {
  it('is empty when the sets are equal (order-independent)', () => {
    expect(diffLinked(['@x/a', '@x/b'], ['@x/b', '@x/a'])).toEqual({ missing: [], extra: [] });
  });

  it('reports publishable-but-not-linked as missing', () => {
    expect(diffLinked(['@x/a', '@x/b'], ['@x/a'])).toEqual({ missing: ['@x/b'], extra: [] });
  });

  it('reports linked-but-not-publishable as extra', () => {
    expect(diffLinked(['@x/a'], ['@x/a', '@x/z'])).toEqual({ missing: [], extra: ['@x/z'] });
  });

  it('reports both, each sorted', () => {
    expect(diffLinked(['@x/c', '@x/a'], ['@x/b', '@x/a'])).toEqual({ missing: ['@x/c'], extra: ['@x/b'] });
  });
});

describe('checkChangesetLinked', () => {
  it('is ok when the fixture linked group matches the publishable set', () => {
    const fixture = makeRepo(
      [
        { dir: 'a', json: { name: '@x/a' } },
        { dir: 'p', json: { name: '@x/p', private: true } }
      ],
      [['@x/a']]
    );
    const result = checkChangesetLinked({
      packagesDir: fixture.packagesDir,
      changesetConfigPath: fixture.changesetConfigPath
    });
    expect(result).toMatchObject({ ok: true, publishable: ['@x/a'], linked: ['@x/a'], missing: [], extra: [] });
  });

  it('is not ok and surfaces the diff when the fixture drifts', () => {
    const fixture = makeRepo(
      [
        { dir: 'a', json: { name: '@x/a' } },
        { dir: 'b', json: { name: '@x/b' } }
      ],
      [['@x/a', '@x/stale']]
    );
    const result = checkChangesetLinked({
      packagesDir: fixture.packagesDir,
      changesetConfigPath: fixture.changesetConfigPath
    });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['@x/b']);
    expect(result.extra).toEqual(['@x/stale']);
  });

  it('defaults to the real repo paths and finds them in sync', () => {
    const result = checkChangesetLinked();
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('regression: catches the stale-linked drift this gate exists to prevent', () => {
  // The exact `linked` group that shipped on `main` while the publishable
  // surface grew to 52 — the drift PR #54 corrected and this gate now blocks.
  const HISTORICAL_LINKED = [
    '@blackunicorn/bonklm',
    '@blackunicorn/bonklm-anthropic',
    '@blackunicorn/bonklm-chroma',
    '@blackunicorn/bonklm-copilotkit',
    '@blackunicorn/bonklm-express',
    '@blackunicorn/bonklm-fastify',
    '@blackunicorn/bonklm-genkit',
    '@blackunicorn/bonklm-huggingface',
    '@blackunicorn/bonklm-langchain',
    '@blackunicorn/bonklm-llamaindex',
    '@blackunicorn/bonklm-logger',
    '@blackunicorn/bonklm-mastra',
    '@blackunicorn/bonklm-mcp',
    '@blackunicorn/bonklm-nestjs',
    '@blackunicorn/bonklm-ollama',
    '@blackunicorn/bonklm-openai',
    '@blackunicorn/bonklm-openclaw',
    '@blackunicorn/bonklm-pinecone',
    '@blackunicorn/bonklm-qdrant',
    '@blackunicorn/bonklm-vercel',
    '@blackunicorn/bonklm-weaviate'
  ];

  it('flags the unlinked connectors as missing and now-private openclaw as extra', () => {
    const publishable = derivePublishableSet(join(REPO_ROOT, 'packages'));
    const { missing, extra } = diffLinked(publishable, HISTORICAL_LINKED);

    // `bonklm-openclaw` was linked historically but is now private -> extra.
    const stalePublishable = HISTORICAL_LINKED.filter(name => !publishable.includes(name));
    expect(extra).toEqual(stalePublishable);
    expect(extra).toContain('@blackunicorn/bonklm-openclaw');

    // Connectors added after the list went stale must be reported missing.
    expect(missing).toEqual(
      expect.arrayContaining([
        '@blackunicorn/bonklm-mistral',
        '@blackunicorn/bonklm-temporal',
        '@blackunicorn/bonklm-zep'
      ])
    );
    const stillLinked = HISTORICAL_LINKED.filter(name => publishable.includes(name));
    expect(missing).toHaveLength(publishable.length - stillLinked.length);
    expect(missing.length).toBeGreaterThan(0);
  });
});

describe('formatFailure', () => {
  it('lists missing names only', () => {
    const report = formatFailure({
      publishable: ['@x/a', '@x/b'],
      linked: ['@x/a'],
      missing: ['@x/b'],
      extra: [],
      ok: false
    });
    expect(report).toMatch(/MISSING from linked/);
    expect(report).toContain('+ @x/b');
    expect(report).not.toMatch(/EXTRA in linked/);
  });

  it('lists extra names only', () => {
    const report = formatFailure({
      publishable: ['@x/a'],
      linked: ['@x/a', '@x/z'],
      missing: [],
      extra: ['@x/z'],
      ok: false
    });
    expect(report).toMatch(/EXTRA in linked/);
    expect(report).toContain('- @x/z');
    expect(report).not.toMatch(/MISSING from linked/);
  });

  it('lists both missing and extra', () => {
    const report = formatFailure({
      publishable: ['@x/a', '@x/c'],
      linked: ['@x/a', '@x/b'],
      missing: ['@x/c'],
      extra: ['@x/b'],
      ok: false
    });
    expect(report).toMatch(/MISSING from linked/);
    expect(report).toMatch(/EXTRA in linked/);
  });
});

describe('main', () => {
  it('logs success and does not exit when the linked group is in sync', () => {
    const fixture = makeRepo([{ dir: 'a', json: { name: '@x/a' } }], [['@x/a']]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    onTestFinished(() => vi.restoreAllMocks());

    main({ packagesDir: fixture.packagesDir, changesetConfigPath: fixture.changesetConfigPath });

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/linked group in sync/));
    expect(exit).not.toHaveBeenCalled();
  });

  it('prints the failure report and exits 1 on drift', () => {
    const fixture = makeRepo([{ dir: 'a', json: { name: '@x/a' } }], [[]]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    onTestFinished(() => vi.restoreAllMocks());

    main({ packagesDir: fixture.packagesDir, changesetConfigPath: fixture.changesetConfigPath });

    expect(error).toHaveBeenCalledWith(expect.stringMatching(/out of sync/));
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
  it('exits 0 and reports in-sync against the real repo', () => {
    const output = execFileSync('node', [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf-8' });
    expect(output).toMatch(/linked group in sync/);
  });

  it('exits 1 with a drift diagnostic when run against a drifted tree', () => {
    const fixture = makeRepo(
      [
        { dir: 'a', json: { name: '@x/a' } },
        { dir: 'b', json: { name: '@x/b' } }
      ],
      [['@x/a']]
    );
    const toolsDir = join(fixture.root, 'tools');
    mkdirSync(toolsDir, { recursive: true });
    const fixtureScript = join(toolsDir, 'check-changeset-linked.js');
    cpSync(SCRIPT, fixtureScript);

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
    expect(stderr).toMatch(/out of sync/);
    expect(stderr).toContain('@x/b');
  });
});
