import { describe, expect, it, vi } from 'vitest';
import {
  assertNoMutableContainerTags,
  assertPackageVisibility,
  command,
  createRunner,
  ghcrBootstrap,
  main,
  parseReleaseScope,
  resolvePublishedRelease,
  runCli,
  validateRelease
} from './release-state.js';

const sha = 'a'.repeat(40);
const stableRelease = {
  body: 'Release-Scope: family',
  draft: false,
  prerelease: false,
  published_at: '2026-08-14T00:00:00Z',
  tag_name: 'v1.0.1'
};

function releaseRunner({ release = stableRelease, resolvedSha = sha } = {}) {
  return vi.fn((tool: string, args: string[]) => {
    if (tool === 'gh') return JSON.stringify(release);
    if (tool === 'git' && args[0] === 'rev-list') return `${resolvedSha}\n`;
    if (tool === 'git') return '';
    throw new Error(`unexpected ${tool}`);
  });
}

describe('published Release identity', () => {
  it('classifies a release body through the CLI boundary', () => {
    const log = vi.fn();
    expect(main({ argv: ['classify-body', 'notes\nRelease-Scope: family'], env: {}, run: vi.fn(), log })).toBe(
      'family\tfamily\tv'
    );
    expect(log).toHaveBeenCalledWith('family\tfamily\tv');
  });

  it('parses exactly one explicit release scope', () => {
    expect(parseReleaseScope('notes\nRelease-Scope: family\n')).toBe('family');
    expect(parseReleaseScope('notes\r\nRelease-Scope: family\r\n')).toBe('family');
    expect(parseReleaseScope('Release-Scope: @blackunicorn/eslint-plugin-edge')).toBe(
      '@blackunicorn/eslint-plugin-edge'
    );
    expect(() => parseReleaseScope('notes')).toThrow(/exactly one/);
    expect(() => parseReleaseScope(null)).toThrow(/exactly one/);
    expect(() => parseReleaseScope('Release-Scope: family\nRelease-Scope: family')).toThrow(/exactly one/);
    expect(() => parseReleaseScope('Release-Scope: @blackunicorn/foo.bar')).toThrow(/release-compatible/);
  });

  it('validates published state, scope, channel, tag, SHA, and main ancestry', () => {
    const run = releaseRunner();
    expect(
      validateRelease({
        release: stableRelease,
        expected: { prerelease: false, scope: 'family', sha, tag: 'v1.0.1' },
        run
      })
    ).toBe(sha);
    expect(run).toHaveBeenCalledWith('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], {});
  });

  it.each([
    ['tag', { tag_name: 'v2.0.0' }],
    ['draft', { draft: true }],
    ['channel', { prerelease: true }],
    ['publication', { published_at: null }],
    ['scope', { body: 'Release-Scope: @blackunicorn/tool' }]
  ])('rejects mismatched %s state', (_label, mutation) => {
    expect(() =>
      validateRelease({
        release: { ...stableRelease, ...mutation },
        expected: { prerelease: false, scope: 'family', sha, tag: 'v1.0.1' },
        run: releaseRunner()
      })
    ).toThrow(/Release identity mismatch/);
  });

  it('rejects a tag that resolves to another commit', () => {
    expect(() =>
      validateRelease({
        release: stableRelease,
        expected: { prerelease: false, scope: 'family', sha, tag: 'v1.0.1' },
        run: releaseRunner({ resolvedSha: 'b'.repeat(40) })
      })
    ).toThrow(/Release identity mismatch/);
    expect(() =>
      validateRelease({
        release: stableRelease,
        expected: { prerelease: false, scope: 'family', sha, tag: 'v1.0.1' },
        run: releaseRunner({ resolvedSha: 'not-a-sha' })
      })
    ).toThrow(/did not resolve/);
  });

  it('resolves a current published release by tag for provenance reconciliation', () => {
    const run = releaseRunner();
    expect(
      resolvePublishedRelease({ repository: 'BlackUnicornSecurity/bonklm', scope: 'family', tag: 'v1.0.1', run })
    ).toEqual({ sha, tag: 'v1.0.1' });
    expect(run).toHaveBeenCalledWith('gh', ['api', 'repos/BlackUnicornSecurity/bonklm/releases/tags/v1.0.1'], {});
    expect(() =>
      resolvePublishedRelease({ repository: 'BlackUnicornSecurity/bonklm', scope: 'family', tag: 'invalid', run })
    ).toThrow(/valid SemVer/);
    const prereleaseRun = releaseRunner({
      release: { ...stableRelease, prerelease: true, tag_name: 'v1.0.2-rc.1' },
      resolvedSha: 'b'.repeat(40)
    });
    expect(
      resolvePublishedRelease({
        repository: 'BlackUnicornSecurity/bonklm',
        scope: 'family',
        tag: 'v1.0.2-rc.1',
        run: prereleaseRun
      }).sha
    ).toBe('b'.repeat(40));

    for (const [scope, tag] of [
      ['family', 'v1.0.3-preview.1'],
      ['@blackunicorn/eslint-plugin-edge', 'eslint-plugin-edge-v0.4.1-preview.1']
    ]) {
      const previewRun = releaseRunner({
        release: { ...stableRelease, body: `Release-Scope: ${scope}`, prerelease: true, tag_name: tag }
      });
      expect(
        resolvePublishedRelease({ repository: 'BlackUnicornSecurity/bonklm', scope, tag, run: previewRun })
      ).toEqual({ sha, tag });
    }
  });

  it('resolves the recovery scope and version through the published Release CLI', () => {
    const run = releaseRunner();
    const log = vi.fn();
    expect(
      main({
        argv: ['resolve-published', 'BlackUnicornSecurity/bonklm', 'family', 'v1.0.1'],
        env: {},
        run,
        log
      })
    ).toEqual({ sha, tag: 'v1.0.1' });
    expect(log).toHaveBeenCalledWith(sha);
  });
});

describe('GHCR visibility preconditions', () => {
  it('rejects legacy mutable GHCR channel tags', () => {
    const clean = vi.fn(() => JSON.stringify([[{ metadata: { container: { tags: ['1.0.1'] } } }]]));
    expect(assertNoMutableContainerTags({ owner: 'Org', packageName: 'server', run: clean })).toBe(true);
    expect(clean).toHaveBeenCalledWith(
      'gh',
      ['api', '--paginate', '--slurp', 'orgs/Org/packages/container/server/versions?per_page=100'],
      {}
    );
    expect(() =>
      assertNoMutableContainerTags({
        owner: 'Org',
        packageName: 'server',
        run: vi.fn(() => JSON.stringify([[{ metadata: { container: { tags: ['latest'] } } }]]))
      })
    ).toThrow(/latest/);
    expect(() => assertNoMutableContainerTags({ owner: 'Org', packageName: 'server', run: vi.fn(() => '{}') })).toThrow(
      /malformed/
    );
    expect(() =>
      assertNoMutableContainerTags({
        owner: 'Org',
        packageName: 'server',
        run: vi.fn(() => JSON.stringify([[{ metadata: { container: { tags: [1] } } }]]))
      })
    ).toThrow(/malformed/);
  });

  it('accepts the expected visibility and optionally accepts an absent package', () => {
    expect(
      assertPackageVisibility({
        owner: 'Org',
        packageName: 'stage',
        expected: 'private',
        allowMissing: false,
        run: vi.fn(() => '{"visibility":"private"}')
      })
    ).toBe('private');
    const missing = Object.assign(new Error('HTTP 404: Not Found'), { status: 1, stderr: 'HTTP 404' });
    expect(
      assertPackageVisibility({
        owner: 'Org',
        packageName: 'stage',
        expected: 'private',
        allowMissing: true,
        run: () => {
          throw missing;
        }
      })
    ).toBeNull();
    expect(
      assertPackageVisibility({
        owner: 'Org',
        packageName: 'stage',
        expected: 'private',
        allowMissing: true,
        run: () => {
          throw { status: 1, stderr: 'HTTP 404' };
        }
      })
    ).toBeNull();
    expect(
      assertPackageVisibility({
        owner: 'Org',
        packageName: 'stage',
        expected: 'private',
        allowMissing: true,
        run: () => {
          throw { status: 1, message: '404 Not Found' };
        }
      })
    ).toBeNull();
    expect(() =>
      assertPackageVisibility({
        owner: 'Org',
        packageName: 'stage',
        expected: 'private',
        allowMissing: false,
        run: () => {
          throw missing;
        }
      })
    ).toThrow(missing);
  });

  it('fails closed on visibility drift and non-404 API errors', () => {
    expect(() =>
      assertPackageVisibility({
        owner: 'Org',
        packageName: 'stage',
        expected: 'private',
        allowMissing: true,
        run: vi.fn(() => '{"visibility":"public"}')
      })
    ).toThrow(/visibility/);
    const denied = Object.assign(new Error('HTTP 403'), { status: 1, stderr: 'HTTP 403' });
    expect(() =>
      assertPackageVisibility({
        owner: 'Org',
        packageName: 'stage',
        expected: 'private',
        allowMissing: true,
        run: () => {
          throw denied;
        }
      })
    ).toThrow(denied);
  });

  it('classifies first-package bootstrap while requiring private staging', () => {
    const missing = Object.assign(new Error('HTTP 404'), { status: 1, stderr: 'HTTP 404' });
    const responses: Array<string | Error> = [missing, missing];
    const run = vi.fn(() => {
      const value = responses.shift();
      if (value instanceof Error) throw value;
      return value!;
    });
    expect(ghcrBootstrap({ owner: 'Org', publicPackage: 'server', stagingPackage: 'server-staging', run })).toBe(true);
  });
});

describe('release-state CLI', () => {
  it('routes revalidation, visibility, mutable-tag, and bootstrap actions', () => {
    const log = vi.fn();
    const releaseRun = releaseRunner();
    expect(
      main({
        argv: ['revalidate'],
        env: {
          GITHUB_REPOSITORY: 'BlackUnicornSecurity/bonklm',
          RELEASE_ID: '1',
          RELEASE_PRERELEASE: 'false',
          RELEASE_SCOPE: 'family',
          RELEASE_SHA: sha,
          RELEASE_TAG: 'v1.0.1'
        },
        run: releaseRun,
        log
      })
    ).toBe(sha);
    expect(() => main({ argv: ['revalidate'], env: {}, run: releaseRun, log })).toThrow(/GITHUB_REPOSITORY/);
    const visibilityRun = vi.fn(() => '{"visibility":"private"}');
    expect(
      main({ argv: ['assert-package', 'Org', 'stage', 'private', 'allow-missing'], env: {}, run: visibilityRun, log })
    ).toBe('private');
    const absent = Object.assign(new Error('HTTP 404'), { status: 1, stderr: 'HTTP 404' });
    expect(
      main({
        argv: ['assert-package', 'Org', 'stage', 'private', 'allow-missing'],
        env: {},
        run: () => {
          throw absent;
        },
        log
      })
    ).toBeNull();
    const bootstrapRun = vi.fn((_: string, args: string[]) => {
      if (args.includes('--paginate')) return JSON.stringify([[{ metadata: { container: { tags: ['1.0.1'] } } }]]);
      return JSON.stringify({ visibility: args[1].endsWith('server') ? 'public' : 'private' });
    });
    expect(main({ argv: ['ghcr-bootstrap', 'Org', 'server', 'stage'], env: {}, run: bootstrapRun, log })).toBe(false);
    expect(main({ argv: ['assert-no-mutable-tags', 'Org', 'server'], env: {}, run: bootstrapRun, log })).toBe(true);
    expect(
      createRunner({ argv: ['assert-package', 'Org', 'stage', 'private'], env: {}, run: visibilityRun, log })()
    ).toBe('private');
    expect(() => main({ argv: [], env: {}, run: releaseRun, log })).toThrow(/Usage/);
    expect(command(process.execPath, ['--version'], {})).toMatch(/^v/);
  });

  it('runs only for its entrypoint and reports failures', () => {
    expect(runCli({ argv1: '/other', scriptPath: '/script', run: vi.fn(), exit: vi.fn() })).toBe(false);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.fn();
    expect(
      runCli({
        argv1: '/script',
        scriptPath: '/script',
        run: () => {
          throw new Error('\u001b[31mboom\nsecret\u202e' + 'x'.repeat(600));
        },
        exit
      })
    ).toBe(true);
    expect(exit).toHaveBeenCalledWith(1);
    runCli({
      argv1: '/script',
      scriptPath: '/script',
      run: () => {
        throw 'plain\nsecret';
      },
      exit
    });
    expect(exit).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenNthCalledWith(1, 'release-state: release state command failed');
    expect(error).toHaveBeenNthCalledWith(2, 'release-state: release state command failed');
    error.mockRestore();
  });
});
