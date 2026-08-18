import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { discoverReleasePackageNamesAtRef, discoverReleasePolicyAtRef } from './release-npm.js';
import { fixture } from './release-npm-test-helpers.js';

describe('release recovery policy discovery', () => {
  it('fails closed on malformed recovery commits and supports a Tier-B policy', () => {
    const root = fixture();
    expect(() => discoverReleasePolicyAtRef(root, 'family', 'short', vi.fn())).toThrow(/full commit/);
    expect(() =>
      discoverReleasePolicyAtRef(
        root,
        'family',
        'a'.repeat(40),
        vi.fn((_tool: string, args: string[]) => {
          if (args[0] === 'ls-tree') return 'packages/a/package.json\n';
          return '{invalid';
        })
      )
    ).toThrow(/unreadable/);
    expect(() =>
      discoverReleasePolicyAtRef(
        root,
        'family',
        'a'.repeat(40),
        vi.fn((_tool: string, args: string[]) => (args[0] === 'ls-tree' ? '' : '{}'))
      )
    ).toThrow(/empty/);

    const toolRun = vi.fn((_tool: string, args: string[]) => {
      if (args[0] === 'ls-tree') return 'tools/eslint/package.json\n';
      return JSON.stringify({
        name: '@blackunicorn/eslint',
        version: '0.4.1',
        workspacePolicy: 'tier-b-publishable',
        repository: {
          type: 'git',
          url: 'git+https://github.com/BlackUnicornSecurity/bonklm.git',
          directory: 'tools/eslint'
        }
      });
    });
    expect(discoverReleasePolicyAtRef(root, '@blackunicorn/eslint', 'a'.repeat(40), toolRun)).toMatchObject({
      expectedPackageCount: 1,
      packageNames: ['@blackunicorn/eslint'],
      version: '0.4.1'
    });
    expect(() => discoverReleasePolicyAtRef(root, '@blackunicorn/other', 'a'.repeat(40), toolRun)).toThrow(
      /does not uniquely/
    );
  });

  it('rejects mixed or invalid recovery versions and supports the default git runner', () => {
    const root = fixture();
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'test'],
      { cwd: root }
    );
    const ref = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    expect(discoverReleasePolicyAtRef(root, 'family', ref)).toMatchObject({ expectedPackageCount: 2 });
    expect(discoverReleasePackageNamesAtRef(root, 200, 'family', ref)).toHaveLength(2);

    const versionRun = vi.fn((_tool: string, args: string[]) => {
      if (args[0] === 'ls-tree') return 'packages/a/package.json\npackages/b/package.json\n';
      const path = args[1].split(':').at(-1);
      return JSON.stringify({
        name: path.includes('/a/') ? '@blackunicorn/a' : '@blackunicorn/b',
        version: path.includes('/a/') ? '1.0.1' : 'invalid',
        repository: {
          type: 'git',
          url: 'git+https://github.com/BlackUnicornSecurity/bonklm.git',
          directory: path.slice(0, -'/package.json'.length)
        }
      });
    });
    expect(() => discoverReleasePolicyAtRef(root, 'family', 'a'.repeat(40), versionRun)).toThrow(/one valid version/);
  });
});
