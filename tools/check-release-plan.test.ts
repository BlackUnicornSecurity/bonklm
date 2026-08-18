import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  formatPlanFailure,
  assertReleaseScopeConsumed,
  main,
  mainConsumed,
  readPrivatePackageNames,
  readChangesetPlan,
  readFamilyChangelogVersions,
  readVersionLockedFamily,
  runCli,
  validateReleasePlan
} from './check-release-plan.js';
import { compareSemver } from './semver.js';

const family = [
  { name: '@blackunicorn/bonklm', version: '1.0.0' },
  { name: '@blackunicorn/bonklm-server', version: '1.0.0' }
];

function validateTestPlan(candidateFamily: typeof family, releases: object[], privatePackageNames: string[] = []) {
  return validateReleasePlan(candidateFamily, releases, privatePackageNames, family.length);
}

describe('validateReleasePlan', () => {
  it('requires the selected release scope to have no unconsumed Changesets plan', () => {
    const familyPlan = family.map(pkg => ({ name: pkg.name, type: 'patch', newVersion: '1.0.1' }));
    expect(() => assertReleaseScopeConsumed(family, familyPlan, 'family')).toThrow(/unconsumed Changesets/);
    expect(() =>
      assertReleaseScopeConsumed(
        family,
        [{ name: '@blackunicorn/eslint-plugin-edge', type: 'patch', newVersion: '0.4.1' }],
        '@blackunicorn/eslint-plugin-edge'
      )
    ).toThrow(/unconsumed Changesets/);
    expect(assertReleaseScopeConsumed(family, [], 'family')).toBe(true);
    expect(assertReleaseScopeConsumed(family, familyPlan, '@blackunicorn/eslint-plugin-edge')).toBe(true);
  });
  it('rejects family-count drift before a release is planned', () => {
    expect(validateReleasePlan(family, [], [], 52)).toMatchObject({ ok: false, familyCount: 2 });
    expect(validateReleasePlan(family, [])).toMatchObject({ ok: false, familyCount: 2 });
  });
  it('passes when no package in the version-locked family is being released', () => {
    expect(validateTestPlan(family, [])).toMatchObject({ ok: true });
    expect(validateTestPlan(family, [{ name: '@blackunicorn/eslint-plugin-edge', newVersion: '2.0.0' }])).toMatchObject(
      { ok: true }
    );
  });

  it('fails when current family manifests are already split', () => {
    expect(validateTestPlan([family[0], { ...family[1], version: '1.0.1' }], [])).toMatchObject({
      ok: false,
      currentVersions: ['1.0.0', '1.0.1']
    });
  });

  it('fails when Changesets plans a private package release', () => {
    const releases = [
      ...family.map(pkg => ({ name: pkg.name, newVersion: '1.0.1' })),
      { name: '@blackunicorn/bonklm-openclaw', newVersion: '1.0.1' }
    ];

    const result = validateTestPlan(family, releases, ['@blackunicorn/bonklm-openclaw']);
    expect(result).toMatchObject({
      ok: false,
      privateReleases: ['@blackunicorn/bonklm-openclaw']
    });
    expect(formatPlanFailure(result)).toContain('PRIVATE packages must not be released');
  });

  it('allows Changesets to report an explicitly suppressed private package', () => {
    expect(
      validateTestPlan(
        family,
        [{ name: '@blackunicorn/bonklm-openclaw', type: 'none', newVersion: '1.0.0' }],
        ['@blackunicorn/bonklm-openclaw']
      )
    ).toMatchObject({ ok: true, privateReleases: [] });
  });

  it('fails when the current family version is not semver', () => {
    expect(
      validateTestPlan(
        family.map(pkg => ({ ...pkg, version: 'latest' })),
        []
      )
    ).toMatchObject({ ok: false });
  });

  it('fails when an active family release omits another family package', () => {
    const result = validateTestPlan(family, [{ name: '@blackunicorn/bonklm-server', newVersion: '1.0.1' }]);

    expect(result).toMatchObject({ ok: false, missing: ['@blackunicorn/bonklm'], targetVersions: ['1.0.1'] });
    expect(formatPlanFailure(result)).toContain('MISSING from release plan');
  });

  it('fails when the family is planned at more than one target version', () => {
    const result = validateTestPlan(family, [
      { name: '@blackunicorn/bonklm', newVersion: '1.1.0' },
      { name: '@blackunicorn/bonklm-server', newVersion: '1.0.1' }
    ]);

    expect(result).toMatchObject({ ok: false, missing: [], targetVersions: ['1.0.1', '1.1.0'] });
  });

  it.each([
    {
      label: 'missing target version',
      releases: family.map(pkg => ({ name: pkg.name, newVersion: undefined }))
    },
    {
      label: 'duplicate family member',
      releases: [
        { name: family[0].name, newVersion: '1.0.1' },
        { name: family[0].name, newVersion: '1.0.1' },
        { name: family[1].name, newVersion: '1.0.1' }
      ]
    },
    {
      label: 'non-advancing target',
      releases: family.map(pkg => ({ name: pkg.name, newVersion: '1.0.0' }))
    },
    {
      label: 'invalid semver target',
      releases: family.map(pkg => ({ name: pkg.name, newVersion: 'next' }))
    },
    {
      label: 'malformed prerelease target',
      releases: family.map(pkg => ({ name: pkg.name, newVersion: '1.0.1-rc..1' }))
    },
    {
      label: 'numeric prerelease with a leading zero',
      releases: family.map(pkg => ({ name: pkg.name, newVersion: '1.0.1-rc.01' }))
    }
  ])('fails for $label', ({ releases }) => {
    expect(validateTestPlan(family, releases)).toMatchObject({ ok: false });
  });

  it('passes when every family package advances to one target version', () => {
    expect(
      validateTestPlan(family, [
        { name: '@blackunicorn/bonklm', newVersion: '1.0.1' },
        { name: '@blackunicorn/bonklm-server', newVersion: '1.0.1' }
      ])
    ).toMatchObject({ ok: true, missing: [], targetVersions: ['1.0.1'] });
  });

  it.each([
    ['prerelease to stable', '1.0.0-rc.1', '1.0.0', true],
    ['prerelease increment', '1.0.0-rc.1', '1.0.0-rc.2', true],
    ['prerelease decrement', '1.0.0-rc.2', '1.0.0-rc.1', false],
    ['large numeric prerelease increment', '1.0.0-9', '1.0.0-10', true],
    ['equal numeric identifier precedes another identifier', '1.0.0-1', '1.0.0-1.1', true],
    ['numeric prerelease precedes text', '1.0.0-1', '1.0.0-alpha', true],
    ['text prerelease does not precede numeric', '1.0.0-alpha', '1.0.0-1', false],
    ['text prerelease follows lexical precedence', '1.0.0-alpha', '1.0.0-beta', true],
    ['text prerelease rejects reverse lexical precedence', '1.0.0-beta', '1.0.0-alpha', false],
    ['alphanumeric identifier is valid', '1.0.0-1a', '1.0.0-1b', true],
    ['short prerelease precedes a longer one', '1.0.0-rc', '1.0.0-rc.1', true],
    ['stable to same-number prerelease', '1.0.0', '1.0.0-rc.1', false],
    ['build metadata does not change precedence', '1.0.0+build.1', '1.0.0+build.2', false],
    ['large core increment', '9007199254740992.0.0', '9007199254740993.0.0', true],
    ['minor increment', '1.0.0', '1.1.0', true],
    ['major increment', '1.0.0', '2.0.0', true]
  ])('%s semver ordering', (_label, currentVersion, targetVersion, ok) => {
    const versionedFamily = family.map(pkg => ({ ...pkg, version: currentVersion }));
    const releases = family.map(pkg => ({ name: pkg.name, newVersion: targetVersion }));
    expect(validateTestPlan(versionedFamily, releases).ok).toBe(ok);
  });

  it('rejects invalid values passed directly to the SemVer comparator', () => {
    expect(() => compareSemver('invalid', '1.0.0')).toThrow(/valid SemVer/);
    expect(() => compareSemver('1.0.0', 'invalid')).toThrow(/valid SemVer/);
  });
});

describe('release-plan inputs and CLI', () => {
  it('derives the sorted public family and excludes private manifests', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-release-family-'));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    for (const [directory, manifest] of [
      ['z', { name: '@x/z', version: '1.0.0' }],
      ['a', { name: '@x/a', version: '1.0.0' }],
      ['private', { name: '@x/private', version: '1.0.0', private: true }],
      ['nameless', { version: '1.0.0' }]
    ] as const) {
      mkdirSync(join(root, directory), { recursive: true });
      writeFileSync(join(root, directory, 'package.json'), JSON.stringify(manifest));
    }
    mkdirSync(join(root, 'no-manifest'));
    writeFileSync(join(root, 'not-a-directory'), 'ignored');

    expect(readVersionLockedFamily(root)).toEqual([
      { name: '@x/a', version: '1.0.0' },
      { name: '@x/z', version: '1.0.0' }
    ]);
    expect(readPrivatePackageNames(root)).toEqual(['@x/private']);
  });

  it('reads a generated Changesets plan and always removes its temporary directory', () => {
    let capturedPath = '';
    const releases = readChangesetPlan('/fixture', (_repoRoot, outputPath) => {
      capturedPath = outputPath;
      writeFileSync(outputPath, JSON.stringify({ releases: [{ name: '@x/a', newVersion: '1.0.1' }] }));
    });

    expect(releases).toEqual([{ name: '@x/a', newVersion: '1.0.1' }]);
    expect(existsSync(capturedPath)).toBe(false);
  });

  it('accepts a complete version cut after Changesets consumes its release notes', () => {
    const consumed = Object.assign(new Error('no changesets'), {
      status: 1,
      stderr: 'Some packages have been changed but no changesets were found.'
    });

    expect(
      readChangesetPlan(
        '/fixture',
        () => {
          throw consumed;
        },
        {
          baseRef: 'base-sha',
          family: family.map(pkg => ({ ...pkg, version: '1.0.1' })),
          expectedFamilySize: 2,
          readBaseVersion: () => '1.0.0',
          readChangelogVersions: () => ['1.0.1', '1.0.1']
        }
      )
    ).toEqual([]);

    const fullFamily = Array.from({ length: 52 }, (_, index) => ({ name: `@x/package-${index}`, version: '1.0.1' }));
    expect(
      readChangesetPlan(
        '/fixture',
        () => {
          throw consumed;
        },
        {
          family: fullFamily,
          readBaseVersion: () => '1.0.0',
          readChangelogVersions: () => fullFamily.map(pkg => pkg.version)
        }
      )
    ).toEqual([]);
  });

  it('derives a consumed version cut from package changelogs and ignores non-package entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-release-cut-'));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'packages'));
    for (const [directory, manifest, changelog] of [
      ['a', { name: '@x/a', version: '1.0.1' }, '# A\n\n## 1.0.1\n'],
      ['b', { name: '@x/b', version: '1.0.1' }, '# B\n\n## 1.0.1\n'],
      ['private', { name: '@x/private', version: '1.0.1', private: true }, '# Private\n'],
      ['nameless', { version: '1.0.1' }, '# Nameless\n']
    ] as const) {
      mkdirSync(join(root, 'packages', directory));
      writeFileSync(join(root, 'packages', directory, 'package.json'), JSON.stringify(manifest));
      writeFileSync(join(root, 'packages', directory, 'CHANGELOG.md'), changelog);
    }
    writeFileSync(join(root, 'packages', 'not-a-directory'), 'ignored');
    const consumed = Object.assign(new Error('no changesets'), {
      status: 1,
      stderr: 'Some packages have been changed but no changesets were found.'
    });

    expect(
      readChangesetPlan(
        root,
        () => {
          throw consumed;
        },
        { expectedFamilySize: 2, readBaseVersion: () => '1.0.0' }
      )
    ).toEqual([]);

    writeFileSync(join(root, 'packages', 'a', 'CHANGELOG.md'), '# A\n');
    expect(readFamilyChangelogVersions(join(root, 'packages')).sort()).toEqual(['', '1.0.1']);
  });

  it('reads the base family version from the exact git ref', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-release-base-'));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'packages', 'core'), { recursive: true });
    writeFileSync(join(root, 'packages', 'core', 'package.json'), JSON.stringify({ version: '1.0.0' }));
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', 'packages/core/package.json'], { cwd: root });
    execFileSync(
      'git',
      ['-c', 'user.name=BonkLM Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'base'],
      {
        cwd: root
      }
    );
    const baseRef = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const consumed = Object.assign(new Error('no changesets'), {
      status: 1,
      stderr: 'Some packages have been changed but no changesets were found.'
    });

    expect(
      readChangesetPlan(
        root,
        () => {
          throw consumed;
        },
        {
          baseRef,
          family: family.map(pkg => ({ ...pkg, version: '1.0.1' })),
          expectedFamilySize: 2,
          readChangelogVersions: () => ['1.0.1', '1.0.1']
        }
      )
    ).toEqual([]);
  });

  it('fails closed on non-Changesets errors and malformed generated changelogs', () => {
    const ordinaryError = Object.assign(new Error('command failed'), { status: 2 });
    expect(() =>
      readChangesetPlan('/fixture', () => {
        throw ordinaryError;
      })
    ).toThrow(ordinaryError);

    const missingDetail = Object.assign(new Error('command failed'), { status: 1 });
    expect(() =>
      readChangesetPlan('/fixture', () => {
        throw missingDetail;
      })
    ).toThrow(missingDetail);

    const consumed = Object.assign(new Error('no changesets'), {
      status: 1,
      stderr: 'Some packages have been changed but no changesets were found.'
    });
    expect(() =>
      readChangesetPlan(
        '/fixture',
        () => {
          throw consumed;
        },
        {
          family: family.map(pkg => ({ ...pkg, version: '1.0.1' })),
          expectedFamilySize: 2,
          readBaseVersion: () => '1.0.0',
          readChangelogVersions: () => ['', '1.0.1']
        }
      )
    ).toThrow(consumed);
  });

  it.each([
    ['the version did not advance', '1.0.1', ['1.0.1', '1.0.1']],
    ['a generated changelog is missing', '1.0.0', ['1.0.1']],
    ['a generated changelog has the wrong version', '1.0.0', ['1.0.1', '1.0.0']],
    ['the base version is invalid', 'invalid', ['1.0.1', '1.0.1']],
    ['the current version is invalid', '1.0.0', ['invalid', 'invalid']],
    ['the current family is split', '1.0.0', ['1.0.1', '1.0.1']],
    ['the family count is incomplete', '1.0.0', ['1.0.1', '1.0.1']]
  ])('fails closed after consumed notes when %s', (label, baseVersion, changelogVersions) => {
    const consumed = Object.assign(new Error('no changesets'), {
      status: 1,
      stderr: 'Some packages have been changed but no changesets were found.'
    });

    expect(() =>
      readChangesetPlan(
        '/fixture',
        () => {
          throw consumed;
        },
        {
          baseRef: 'base-sha',
          family:
            label === 'the current family is split'
              ? [family[0], { ...family[1], version: '1.0.1' }]
              : family.map(pkg => ({
                  ...pkg,
                  version: label === 'the current version is invalid' ? 'invalid' : '1.0.1'
                })),
          expectedFamilySize: label === 'the family count is incomplete' ? 3 : 2,
          readBaseVersion: () => baseVersion,
          readChangelogVersions: () => changelogVersions
        }
      )
    ).toThrow(/no changesets/);
  });

  it('fails closed when Changesets output has no releases array', () => {
    expect(() => readChangesetPlan('/fixture', (_repoRoot, outputPath) => writeFileSync(outputPath, '{}'))).toThrow(
      /releases array/
    );
  });

  it('reports a failed plan through an injected exit', () => {
    const error = vi.fn();
    const exit = vi.fn();
    const result = main({
      family,
      releases: [{ name: '@blackunicorn/bonklm', newVersion: '1.0.1' }],
      expectedFamilySize: 2,
      error,
      exit
    });

    expect(result.ok).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('MISSING from release plan'));
    expect(exit).toHaveBeenCalledWith(1);
    expect(
      formatPlanFailure({
        familyCount: 2,
        releaseCount: 1,
        currentVersions: [],
        targetVersions: [],
        missing: [],
        privateReleases: []
      })
    ).toContain('target versions: (none)');
  });

  it('prints both successful plan states and only runs as its own entrypoint', () => {
    const log = vi.fn();
    expect(main({ family, releases: [], expectedFamilySize: 2, log }).ok).toBe(true);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('no active family release'));
    expect(
      main({
        family,
        releases: family.map(pkg => ({ name: pkg.name, newVersion: '1.0.1' })),
        expectedFamilySize: 2,
        log
      }).ok
    ).toBe(true);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('advances together to 1.0.1'));

    const run = vi.fn();
    expect(runCli({ argv1: '/other.js', scriptPath: '/check.js', argv: [], run })).toBe(false);
    expect(runCli({ argv1: '/check.js', scriptPath: '/check.js', argv: [], run })).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(runCli({ argv1: '/check.js', scriptPath: '/check.js', run })).toBe(true);

    const runConsumed = vi.fn();
    expect(
      runCli({
        argv1: '/check.js',
        scriptPath: '/check.js',
        argv: ['--assert-consumed', 'family'],
        run,
        runConsumed
      })
    ).toBe(true);
    expect(runConsumed).toHaveBeenCalledWith('family');
    expect(() => runCli({ argv1: '/check.js', scriptPath: '/check.js', argv: ['--bad'], run, runConsumed })).toThrow(
      /Usage/
    );
  });

  it('runs against the repository with default inputs', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(main().ok).toBe(true);
    expect(log).toHaveBeenCalled();
    expect(mainConsumed('@blackunicorn/no-pending-release', { log })).toBe(true);
    expect(mainConsumed('@blackunicorn/no-pending-release')).toBe(true);

    log.mockRestore();
  });
});
