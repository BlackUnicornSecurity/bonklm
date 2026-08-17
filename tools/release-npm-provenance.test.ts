import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  prepareBundle,
  publishBundle,
  verifyAttestationDocument,
  verifyChannelBundle,
  verifyProvenanceBundle
} from './release-npm.js';
import { attestation, fakePack, fixture, prepared, registryRunner } from './release-npm-test-helpers.js';

const provenanceUrl = 'https://registry.npmjs.org/-/npm/v1/attestations/example';

function integrity(content: string) {
  return `sha512-${createHash('sha512').update(content).digest('base64')}`;
}

function packResponse(args: string[], contents: Map<string, string>) {
  const spec = args[1];
  const content = contents.get(spec);
  if (content === undefined) throw new Error(`unexpected npm pack: ${spec}`);
  const file = `effective-${contents.size}-${Buffer.from(spec).toString('hex')}.tgz`;
  writeFileSync(join(args[args.indexOf('--pack-destination') + 1], file), content);
  return JSON.stringify([{ filename: file }]);
}

describe('npm release provenance', () => {
  it('cryptographically audits the lock and binds every attestation to source, ref, commit, and bytes', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    const documents = state.manifest.packages.map(pkg => attestation(pkg));
    const run = vi.fn((tool: string, args: string[], options: object) => {
      if (tool === 'npm' && ['install', 'audit'].includes(args[0])) return '';
      if (tool === 'curl') return JSON.stringify(documents.shift());
      if (tool === 'cosign') return '';
      return state.run(tool, args, options);
    });
    const source = {
      repository: 'BlackUnicornSecurity/bonklm',
      workflow: '.github/workflows/publish.yml',
      tag: 'v1.0.1',
      sha: 'a'.repeat(40)
    };
    expect(verifyProvenanceBundle({ dir, source, run }).packages).toHaveLength(2);
    expect(run).toHaveBeenCalledWith(
      'npm',
      ['audit', 'signatures', '--registry=https://registry.npmjs.org'],
      expect.objectContaining({ cwd: expect.any(String) })
    );
    expect(run).toHaveBeenCalledWith(
      'curl',
      expect.arrayContaining(['--proto', '=https', '--connect-timeout', '10', '--max-time', '30']),
      {}
    );
    // npm provenance no longer routes through cosign blob attestation
    // (registry greylist regeneration breaks bundle internals); the
    // binding is verified from the SLSA statement directly.
    expect(run).not.toHaveBeenCalledWith('cosign', expect.arrayContaining(['verify-blob-attestation']), {});
    expect(run).not.toHaveBeenCalledWith('curl', expect.arrayContaining(['--location']), {});
  });

  it('rejects a source payload changed after its Sigstore signature was created', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    const source = {
      repository: 'BlackUnicornSecurity/bonklm',
      workflow: '.github/workflows/publish.yml',
      tag: 'v1.0.1',
      sha: 'a'.repeat(40)
    };
    const documents = state.manifest.packages.map(pkg => {
      const document = attestation(pkg, {
        ...source,
        ref: 'refs/tags/v1.0.1',
        sha: 'b'.repeat(40)
      });
      const envelope = document.attestations[0].bundle.dsseEnvelope;
      const signedPayload = envelope.payload;
      const statement = JSON.parse(Buffer.from(signedPayload, 'base64').toString('utf8'));
      statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = source.sha;
      envelope.payload = Buffer.from(JSON.stringify(statement)).toString('base64');
      return { document, signedPayload };
    });
    const run = vi.fn((tool: string, args: string[], options: object) => {
      if (tool === 'npm' && ['install', 'audit'].includes(args[0])) return '';
      if (tool === 'curl') return JSON.stringify(documents[0].document);
      if (tool === 'cosign') {
        const bundle = JSON.parse(readFileSync(args[args.indexOf('--bundle') + 1], 'utf8'));
        if (bundle.dsseEnvelope.payload !== documents.shift()?.signedPayload) throw new Error('signature mismatch');
        return '';
      }
      return state.run(tool, args, options);
    });
    expect(() => verifyProvenanceBundle({ dir, source, run })).toThrow(/provenance (identity mismatch|does not bind)/i);
  });

  it.each([
    'not-a-url',
    'http://registry.npmjs.org/-/npm/v1/attestations/x',
    'https://example.invalid/-/npm/v1/attestations/x',
    'https://registry.npmjs.org:444/-/npm/v1/attestations/x',
    'https://registry.npmjs.org/package.json',
    'https://user@registry.npmjs.org/-/npm/v1/attestations/x',
    'https://registry.npmjs.org/-/npm/v1/attestations/x?redirect=1',
    'https://registry.npmjs.org/-/npm/v1/attestations/x#fragment'
  ])('rejects an unsafe registry-provided attestation URL: %s', provenance => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    for (const pkg of state.manifest.packages) {
      state.registry.get(`${pkg.name}@${pkg.version}`)!.provenance = provenance;
    }
    const run = vi.fn((tool: string, args: string[], options: object) => {
      if (tool === 'npm' && ['install', 'audit'].includes(args[0])) return '';
      return state.run(tool, args, options);
    });
    expect(() =>
      verifyProvenanceBundle({
        dir,
        source: {
          repository: 'BlackUnicornSecurity/bonklm',
          workflow: '.github/workflows/publish.yml',
          tag: 'v1.0.1',
          sha: 'a'.repeat(40)
        },
        run
      })
    ).toThrow(/attestation URL/);
    expect(run).not.toHaveBeenCalledWith('curl', expect.anything(), expect.anything());
  });

  it('cryptographically verifies the effective newer family channel against its own release ref', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    const contents = new Map(
      state.manifest.packages.map(pkg => [`${pkg.name}@1.0.2`, `newer tarball bytes for ${pkg.name}`])
    );
    const effective = state.manifest.packages.map(pkg => ({
      ...pkg,
      version: '1.0.2',
      integrity: integrity(contents.get(`${pkg.name}@1.0.2`)!)
    }));
    for (const pkg of effective) {
      state.registry.set(`${pkg.name}@${pkg.version}`, {
        integrity: pkg.integrity,
        provenance: provenanceUrl,
        tags: {}
      });
      state.registry.set(pkg.name, {
        integrity: pkg.integrity,
        provenance: provenanceUrl,
        tags: { latest: pkg.version }
      });
    }
    const documents = effective.map(pkg =>
      attestation(pkg, {
        repository: 'BlackUnicornSecurity/bonklm',
        workflow: '.github/workflows/publish.yml',
        ref: 'refs/tags/v1.0.2',
        sha: 'b'.repeat(40)
      })
    );
    const run = vi.fn((tool: string, args: string[], options: object) => {
      if (tool === 'npm' && ['install', 'audit'].includes(args[0])) return '';
      if (tool === 'npm' && args[0] === 'pack') return packResponse(args, contents);
      if (tool === 'curl') return JSON.stringify(documents.shift());
      if (tool === 'cosign') return '';
      if (tool === 'gh') {
        return JSON.stringify({
          body: 'Release-Scope: family',
          draft: false,
          prerelease: false,
          published_at: '2026-08-14T00:00:00Z',
          tag_name: 'v1.0.2'
        });
      }
      if (tool === 'git' && args[0] === 'rev-list') return `${'b'.repeat(40)}\n`;
      if (tool === 'git') return '';
      return state.run(tool, args, options);
    });
    expect(
      verifyProvenanceBundle({
        dir,
        channel: 'latest',
        source: {
          repository: 'BlackUnicornSecurity/bonklm',
          workflow: '.github/workflows/publish.yml',
          tag: 'v1.0.1',
          sha: 'a'.repeat(40)
        },
        run
      }).packages.every(pkg => pkg.version === '1.0.2')
    ).toBe(true);
    expect(run).toHaveBeenCalledWith('git', ['merge-base', '--is-ancestor', 'b'.repeat(40), 'origin/main'], {});
    for (const pkg of effective) {
      void pkg;
      expect(run).not.toHaveBeenCalledWith('cosign', expect.anything(), {});
    }
  });

  it('rejects an effective newer tarball whose downloaded bytes do not match registry integrity', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    const contents = new Map(state.manifest.packages.map(pkg => [`${pkg.name}@1.0.2`, `bytes for ${pkg.name}`]));
    for (const pkg of state.manifest.packages) {
      state.registry.set(`${pkg.name}@1.0.2`, {
        integrity: integrity(`different bytes for ${pkg.name}`),
        provenance: provenanceUrl,
        tags: {}
      });
      state.registry.set(pkg.name, {
        integrity: pkg.integrity,
        provenance: provenanceUrl,
        tags: { latest: '1.0.2' }
      });
    }
    const run = vi.fn((tool: string, args: string[], options: object) => {
      if (tool === 'npm' && ['install', 'audit'].includes(args[0])) return '';
      if (tool === 'npm' && args[0] === 'pack') return packResponse(args, contents);
      if (tool === 'curl') return JSON.stringify(attestation(state.manifest.packages[0]));
      return state.run(tool, args, options);
    });
    expect(() =>
      verifyProvenanceBundle({
        dir,
        channel: 'latest',
        source: {
          repository: 'BlackUnicornSecurity/bonklm',
          workflow: '.github/workflows/publish.yml',
          tag: 'v1.0.1',
          sha: 'a'.repeat(40)
        },
        run
      })
    ).toThrow(/Downloaded tarball integrity mismatch/);
    expect(run).not.toHaveBeenCalledWith('cosign', expect.anything(), expect.anything());
  });

  it.each([
    ['non-array output', JSON.stringify({}), /invalid npm pack result/],
    ['empty output', JSON.stringify([]), /invalid npm pack result/],
    ['missing filename', JSON.stringify([{}]), /unsafe tarball name/],
    ['traversal filename', JSON.stringify([{ filename: '../bad.tgz' }]), /unsafe tarball name/],
    ['non-tarball filename', JSON.stringify([{ filename: 'bad.txt' }]), /unsafe tarball name/]
  ])('rejects %s while downloading an effective channel tarball', (_label, packOutput, expected) => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    for (const pkg of state.manifest.packages) {
      state.registry.set(`${pkg.name}@1.0.2`, { integrity: pkg.integrity, provenance: provenanceUrl, tags: {} });
      state.registry.set(pkg.name, { integrity: pkg.integrity, provenance: provenanceUrl, tags: { latest: '1.0.2' } });
    }
    const run = vi.fn((tool: string, args: string[], options: object) => {
      if (tool === 'npm' && ['install', 'audit'].includes(args[0])) return '';
      if (tool === 'npm' && args[0] === 'pack') return packOutput;
      if (tool === 'curl') return JSON.stringify(attestation({ ...state.manifest.packages[0], version: '1.0.2' }));
      return state.run(tool, args, options);
    });
    expect(() =>
      verifyProvenanceBundle({
        dir,
        channel: 'latest',
        source: {
          repository: 'BlackUnicornSecurity/bonklm',
          workflow: '.github/workflows/publish.yml',
          tag: 'v1.0.1',
          sha: 'a'.repeat(40)
        },
        run
      })
    ).toThrow(expected);
  });

  it('rejects a newer channel whose published tag resolves away from the attested commit', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    const contents = new Map(state.manifest.packages.map(pkg => [`${pkg.name}@1.0.2`, `newer ${pkg.name}`]));
    for (const pkg of state.manifest.packages) {
      state.registry.set(`${pkg.name}@1.0.2`, {
        integrity: integrity(contents.get(`${pkg.name}@1.0.2`)!),
        provenance: provenanceUrl,
        tags: {}
      });
      state.registry.set(pkg.name, {
        integrity: pkg.integrity,
        provenance: provenanceUrl,
        tags: { latest: '1.0.2' }
      });
    }
    const run = vi.fn((tool: string, args: string[], options: object) => {
      if (tool === 'npm' && ['install', 'audit'].includes(args[0])) return '';
      if (tool === 'npm' && args[0] === 'pack') return packResponse(args, contents);
      if (tool === 'gh')
        return JSON.stringify({
          body: 'Release-Scope: family',
          draft: false,
          prerelease: false,
          published_at: '2026-08-14T00:00:00Z',
          tag_name: 'v1.0.2'
        });
      if (tool === 'git' && args[0] === 'rev-list') return `${'c'.repeat(40)}\n`;
      if (tool === 'git') return '';
      if (tool === 'curl')
        return JSON.stringify(
          attestation(
            { ...state.manifest.packages[0], version: '1.0.2' },
            { ref: 'refs/tags/v1.0.2', sha: 'b'.repeat(40) }
          )
        );
      if (tool === 'cosign') return '';
      return state.run(tool, args, options);
    });
    expect(() =>
      verifyProvenanceBundle({
        dir,
        channel: 'latest',
        source: {
          repository: 'BlackUnicornSecurity/bonklm',
          workflow: '.github/workflows/publish.yml',
          tag: 'v1.0.1',
          sha: 'a'.repeat(40)
        },
        run
      })
    ).toThrow(/identity mismatch/);
  });

  it('resolves a newer Tier-B channel against its scope-qualified published release', () => {
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
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    const contents = new Map([[`${state.manifest.packages[0].name}@0.4.1`, 'newer Tier-B tarball']]);
    const pkg = {
      ...state.manifest.packages[0],
      version: '0.4.1',
      integrity: integrity(contents.get(`${state.manifest.packages[0].name}@0.4.1`)!)
    };
    state.registry.set(`${pkg.name}@${pkg.version}`, {
      integrity: pkg.integrity,
      provenance: provenanceUrl,
      tags: {}
    });
    state.registry.set(pkg.name, {
      integrity: pkg.integrity,
      provenance: provenanceUrl,
      tags: { latest: pkg.version }
    });
    const run = vi.fn((tool: string, args: string[], options: object) => {
      if (tool === 'npm' && ['install', 'audit'].includes(args[0])) return '';
      if (tool === 'npm' && args[0] === 'pack') return packResponse(args, contents);
      if (tool === 'curl')
        return JSON.stringify(
          attestation(pkg, {
            repository: 'BlackUnicornSecurity/bonklm',
            workflow: '.github/workflows/publish.yml',
            ref: 'refs/tags/eslint-v0.4.1',
            sha: 'd'.repeat(40)
          })
        );
      if (tool === 'cosign') return '';
      if (tool === 'gh')
        return JSON.stringify({
          body: 'Release-Scope: @blackunicorn/eslint',
          draft: false,
          prerelease: false,
          published_at: '2026-08-14T00:00:00Z',
          tag_name: 'eslint-v0.4.1'
        });
      if (tool === 'git' && args[0] === 'rev-list') return `${'d'.repeat(40)}\n`;
      if (tool === 'git') return '';
      return state.run(tool, args, options);
    });
    expect(
      verifyProvenanceBundle({
        dir,
        channel: 'latest',
        source: {
          repository: 'BlackUnicornSecurity/bonklm',
          workflow: '.github/workflows/publish.yml',
          tag: 'eslint-v0.4.0',
          sha: 'a'.repeat(40)
        },
        run
      }).packages[0].version
    ).toBe('0.4.1');
  });

  it('rejects missing, malformed, and mismatched SLSA provenance', () => {
    const pkg = { name: '@blackunicorn/a', version: '1.0.1', integrity: 'sha512-YWJj' };
    const source = {
      repository: 'BlackUnicornSecurity/bonklm',
      workflow: '.github/workflows/publish.yml',
      ref: 'refs/tags/v1.0.1',
      sha: 'a'.repeat(40)
    };
    expect(() => verifyAttestationDocument({ attestations: [] }, pkg, source)).toThrow(/SLSA provenance missing/);
    expect(() =>
      verifyAttestationDocument(
        { attestations: [{ predicateType: 'https://slsa.dev/provenance/v1', bundle: null }] },
        pkg,
        source
      )
    ).toThrow(/bundle is invalid/);
    expect(() =>
      verifyAttestationDocument(
        {
          attestations: [
            { predicateType: 'https://slsa.dev/provenance/v1', bundle: { dsseEnvelope: { payload: '***' } } }
          ]
        },
        pkg,
        source
      )
    ).toThrow(/payload is invalid/);
    expect(() =>
      verifyAttestationDocument(attestation(pkg, { ...source, repository: 'other/repo' }), pkg, source)
    ).toThrow(/identity mismatch/);
    expect(() =>
      verifyAttestationDocument(attestation({ ...pkg, integrity: 'sha512-ZGVm' }, source), pkg, source)
    ).toThrow(/identity mismatch/);
    expect(() => verifyAttestationDocument(attestation(pkg, source), { ...pkg, integrity: 'md5-abc' }, source)).toThrow(
      /not SHA-512/
    );
    const noDependencies = attestation(pkg, source);
    const envelope = noDependencies.attestations[0].bundle.dsseEnvelope;
    const statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
    statement.predicate.buildDefinition.resolvedDependencies = null;
    envelope.payload = Buffer.from(JSON.stringify(statement)).toString('base64');
    expect(() => verifyAttestationDocument(noDependencies, pkg, source)).toThrow(/identity mismatch/);
    const { sha: _sha, ...sourceWithoutSha } = source;
    expect(() => verifyAttestationDocument(attestation(pkg, source), pkg, sourceWithoutSha)).toThrow(
      /Expected release SHA/
    );
    const wrongRepositoryDependency = attestation(pkg, source);
    const wrongEnvelope = wrongRepositoryDependency.attestations[0].bundle.dsseEnvelope;
    const wrongStatement = JSON.parse(Buffer.from(wrongEnvelope.payload, 'base64').toString('utf8'));
    wrongStatement.predicate.buildDefinition.resolvedDependencies[0].uri = `git+https://github.com/other/repository@${source.ref}`;
    wrongEnvelope.payload = Buffer.from(JSON.stringify(wrongStatement)).toString('base64');
    expect(() => verifyAttestationDocument(wrongRepositoryDependency, pkg, source)).toThrow(/identity mismatch/);
  });

  it('rejects incomplete/invalid effective channels and missing effective provenance', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    const source = {
      repository: 'BlackUnicornSecurity/bonklm',
      workflow: '.github/workflows/publish.yml',
      tag: 'v1.0.1',
      sha: 'a'.repeat(40)
    };
    expect(() => verifyProvenanceBundle({ dir, channel: 'beta', source, run: state.run })).toThrow(/Public dist-tag/);
    expect(() => verifyProvenanceBundle({ dir, channel: 'latest', source, run: state.run })).toThrow(/Incomplete/);
    for (const pkg of state.manifest.packages) {
      state.registry.set(`${pkg.name}@1.0.2`, { integrity: pkg.integrity, provenance: '', tags: {} });
      state.registry.set(pkg.name, { integrity: pkg.integrity, provenance: '', tags: { latest: '1.0.2' } });
    }
    const noNetwork = vi.fn((tool: string, args: string[], options: object) => {
      if (tool === 'npm' && ['install', 'audit'].includes(args[0])) return '';
      return state.run(tool, args, options);
    });
    expect(() => verifyProvenanceBundle({ dir, channel: 'latest', source, run: noNetwork })).toThrow(
      /Registry provenance missing/
    );
    expect(() => verifyChannelBundle({ dir, channel: 'latest', run: state.run })).toThrow(/provenance missing/);
  });

  it('rejects a bundle that mixes independently released scopes', () => {
    const { dir } = prepared();
    const manifestPath = join(dir, 'release-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.packages[1].kind = 'tool';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => registryRunner(dir)).toThrow(/package scope/);
  });
});
