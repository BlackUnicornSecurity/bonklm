import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, expect, vi } from 'vitest';
import { prepareBundle, verifyBundle } from './release-npm.js';

const roots = [];

export function fixture({ familyVersion = '1.0.1', toolVersion = '0.4.0', unnamed = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bonklm-release-npm-'));
  roots.push(root);
  for (const name of ['a', 'b', 'private']) mkdirSync(join(root, 'packages', name), { recursive: true });
  mkdirSync(join(root, 'tools', 'eslint'), { recursive: true });
  mkdirSync(join(root, 'tools', 'private'), { recursive: true });
  writeFileSync(
    join(root, 'packages', 'a', 'package.json'),
    JSON.stringify({
      name: unnamed ? '' : '@blackunicorn/a',
      version: familyVersion,
      license: 'Apache-2.0',
      repository: {
        type: 'git',
        url: 'git+https://github.com/BlackUnicornSecurity/bonklm.git',
        directory: 'packages/a'
      }
    })
  );
  writeFileSync(
    join(root, 'packages', 'b', 'package.json'),
    JSON.stringify({
      name: '@blackunicorn/b',
      version: familyVersion,
      license: 'Apache-2.0',
      repository: {
        type: 'git',
        url: 'git+https://github.com/BlackUnicornSecurity/bonklm.git',
        directory: 'packages/b'
      }
    })
  );
  writeFileSync(
    join(root, 'packages', 'private', 'package.json'),
    JSON.stringify({ name: '@blackunicorn/private', version: familyVersion, private: true })
  );
  writeFileSync(
    join(root, 'tools', 'eslint', 'package.json'),
    JSON.stringify({
      name: '@blackunicorn/eslint',
      version: toolVersion,
      license: 'MIT',
      workspacePolicy: 'tier-b-publishable',
      repository: {
        type: 'git',
        url: 'git+https://github.com/BlackUnicornSecurity/bonklm.git',
        directory: 'tools/eslint'
      }
    })
  );
  writeFileSync(
    join(root, 'tools', 'private', 'package.json'),
    JSON.stringify({ name: '@blackunicorn/tool-private', version: toolVersion, private: true })
  );
  return root;
}

export function fakePack(command, args) {
  expect(command).toBe('pnpm');
  const packageDir = args[1];
  const outputDir = args[args.indexOf('--pack-destination') + 1];
  const stage = mkdtempSync(join(tmpdir(), 'bonklm-fake-pack-'));
  roots.push(stage);
  const packedPackage = join(stage, 'package');
  mkdirSync(join(packedPackage, 'dist'), { recursive: true });
  writeFileSync(join(packedPackage, 'package.json'), readFileSync(join(packageDir, 'package.json')));
  writeFileSync(join(packedPackage, 'dist', 'index.js'), 'export const fixture = true;\n');
  execFileSync('tar', ['-czf', join(outputDir, `${basename(packageDir)}.tgz`), '-C', stage, 'package']);
  return '';
}

export function prepared(options = {}) {
  const root = fixture(options);
  const dir = join(root, 'bundle');
  const version = options.familyVersion ?? '1.0.1';
  const manifest = prepareBundle({
    root,
    outputDir: dir,
    version,
    scope: 'family',
    sourceSha: 'a'.repeat(40),
    expectedFamilySize: 2,
    run: fakePack
  });
  return { root, dir, manifest };
}

export function registryRunner(dir) {
  const registry = new Map();
  const calls = [];
  const manifest = verifyBundle(dir);
  const run = vi.fn((command, args) => {
    calls.push([command, ...args]);
    if (command !== 'npm') throw new Error('unexpected command');
    if (args[0] === 'view') {
      const [, spec, field] = args;
      const entry = registry.get(spec) ?? registry.get(spec.split('@').slice(0, -1).join('@'));
      if (field.startsWith('dist-tags.')) return JSON.stringify(entry?.tags[field.slice(10)] ?? null);
      if (!entry) throw Object.assign(new Error('not found'), { status: 1, stderr: 'npm error code E404' });
      if (field === 'name') return JSON.stringify(spec);
      if (field === 'dist.integrity') return JSON.stringify(entry.integrity);
      if (field === 'dist.attestations.url') return JSON.stringify(entry.provenance);
    }
    if (args[0] === 'publish') {
      const file = basename(args[1]);
      const pkg = manifest.packages.find(item => item.file === file);
      registry.set(`${pkg.name}@${pkg.version}`, {
        integrity: pkg.integrity,
        provenance: 'https://registry.npmjs.org/-/npm/v1/attestations/example',
        tags: {}
      });
      return '';
    }
    if (args[0] === 'dist-tag') {
      if (args[1] === 'rm') {
        const entry = registry.get(args[2]);
        if (entry) delete entry.tags[args[3]];
        return '';
      }
      const spec = args[2];
      const name = spec.split('@').slice(0, -1).join('@');
      const entry = registry.get(spec) ?? registry.get(name);
      entry.tags[args[3]] = spec.slice(name.length + 1);
      registry.set(name, entry);
      return '';
    }
    throw new Error(`unexpected npm call: ${args.join(' ')}`);
  });
  return { calls, manifest, registry, run };
}

export function attestation(
  pkg,
  source = {
    repository: 'BlackUnicornSecurity/bonklm',
    workflow: '.github/workflows/publish.yml',
    ref: 'refs/tags/v1.0.1',
    sha: 'a'.repeat(40)
  }
) {
  const sha512 = Buffer.from(pkg.integrity.slice('sha512-'.length), 'base64').toString('hex');
  const payload = {
    subject: [
      { name: `pkg:npm/${encodeURIComponent(pkg.name).replace('%2F', '/')}@${pkg.version}`, digest: { sha512 } }
    ],
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: { repository: `https://github.com/${source.repository}`, path: source.workflow, ref: source.ref }
        },
        resolvedDependencies: [
          {
            uri: `git+https://github.com/${source.repository}@${source.ref}`,
            digest: { gitCommit: source.sha }
          }
        ]
      },
      runDetails: { builder: { id: 'https://github.com/actions/runner/github-hosted' } }
    }
  };
  return {
    attestations: [
      {
        predicateType: 'https://slsa.dev/provenance/v1',
        bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(payload)).toString('base64') } }
      }
    ]
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
