import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error — dependency-free release script has no declaration file
import {
  augmentSbomWithRuntime,
  checkSbomLicenses,
  runCli,
  setProcessExitCode
} from '../scripts/check-sbom-licenses.mjs';

const runtimeSha = '73b30df224d198e43ab4a68bd265a2350ab13d99b0df14566c4a24e88d6b8276';

function sbom(components: object[], version = '1.0.1') {
  const anchors = [
    { type: 'operating-system', name: 'alpine', version: '3.24.1' },
    {
      type: 'library',
      name: 'bonklm-server',
      version,
      purl: `pkg:npm/%40blackunicorn/bonklm-server@${version}`,
      licenses: [{ license: { id: 'Apache-2.0' } }]
    },
    {
      type: 'application',
      name: 'node',
      version: '24.19.0',
      purl: 'pkg:generic/node@24.19.0',
      hashes: [{ alg: 'SHA-256', content: runtimeSha }],
      licenses: [{ license: { id: 'MIT' } }]
    },
    {
      type: 'library',
      name: 'bonklm',
      version,
      purl: `pkg:npm/%40blackunicorn/bonklm@${version}`,
      licenses: [{ license: { id: 'Apache-2.0' } }]
    }
  ];
  return { bomFormat: 'CycloneDX', specVersion: '1.6', components: [...anchors, ...components] };
}

function inventory(components: Array<{ ecosystem: string; name: string; version: string }> = []) {
  return {
    schemaVersion: 1,
    source: 'image-filesystem',
    components: [
      { ecosystem: 'os', name: 'alpine', version: '3.24.1' },
      { ecosystem: 'npm', name: '@blackunicorn/bonklm-server', version: '1.0.1' },
      { ecosystem: 'npm', name: '@blackunicorn/bonklm', version: '1.0.1' },
      { ecosystem: 'runtime', name: 'node', version: '24.19.0', sha256: runtimeSha },
      ...components
    ]
  };
}

describe('container SBOM license policy', () => {
  it('accepts permissive components and the exact reviewed Alpine runtime exceptions', () => {
    expect(
      checkSbomLicenses(
        sbom([
          {
            type: 'library',
            name: 'fastify',
            version: '5.12.0',
            purl: 'pkg:npm/fastify@5.12.0',
            licenses: [{ license: { id: 'MIT' } }]
          },
          {
            type: 'library',
            name: 'busybox',
            version: '1.37.0-r31',
            purl: 'pkg:apk/alpine/busybox@1.37.0-r31?arch=amd64&distro=3.24.1',
            licenses: [{ license: { id: 'GPL-2.0-only' } }]
          },
          {
            type: 'library',
            name: 'musl-utils',
            version: '1.2.6-r2',
            purl: 'pkg:apk/alpine/musl-utils@1.2.6-r2?arch=amd64',
            licenses: [
              { license: { id: 'MIT' } },
              { license: { id: 'BSD-2-Clause' } },
              { license: { id: 'GPL-2.0-or-later' } }
            ]
          },
          {
            type: 'library',
            name: 'benchmarks',
            version: '1.0.0',
            purl: 'pkg:npm/benchmarks@1.0.0',
            licenses: [],
            properties: [
              {
                name: 'aquasecurity:trivy:FilePath',
                value:
                  'app/node_modules/.pnpm/secure-json-parse@2.7.0/node_modules/secure-json-parse/benchmarks/package.json'
              }
            ]
          },
          {
            type: 'library',
            name: 'transport',
            version: '0.0.1',
            purl: 'pkg:npm/transport@0.0.1',
            properties: [
              {
                name: 'aquasecurity:trivy:FilePath',
                value: 'app/node_modules/.pnpm/pino@10.3.1/node_modules/pino/test/fixtures/transport/package.json'
              }
            ]
          }
        ]),
        '1.0.1',
        inventory([
          { ecosystem: 'npm', name: 'fastify', version: '5.12.0' },
          { ecosystem: 'apk', name: 'busybox', version: '1.37.0-r31' },
          { ecosystem: 'apk', name: 'musl-utils', version: '1.2.6-r2' },
          { ecosystem: 'npm', name: 'benchmarks', version: '1.0.0' },
          { ecosystem: 'npm', name: 'transport', version: '0.0.1' }
        ])
      )
    ).toEqual([]);
  });

  it('fails closed on unreviewed, missing, malformed, or changed exception licenses', () => {
    expect(
      checkSbomLicenses(
        sbom([
          {
            type: 'library',
            name: 'unreviewed',
            version: '1.0.0',
            purl: 'pkg:apk/alpine/unreviewed@1.0.0',
            licenses: [{ license: { id: 'GPL-3.0-only' } }]
          },
          { type: 'library', name: 'unknown', version: '1.0.0', purl: 'pkg:npm/unknown@1.0.0', licenses: [] },
          { type: 'library', name: 'absent', version: '1.0.0', purl: 'pkg:npm/absent@1.0.0' },
          {
            type: 'library',
            name: 'busybox',
            version: '1.37.0-r31',
            purl: 'pkg:apk/alpine/busybox@1.37.0-r31',
            licenses: [{ license: { id: 'GPL-3.0-only' } }]
          },
          {
            type: 'library',
            name: 'mixed',
            version: '1.0.0',
            purl: 'pkg:npm/mixed@1.0.0',
            licenses: [{ license: { id: 'MIT' } }, { license: { id: 'GPL-3.0-only' } }]
          },
          {
            type: 'library',
            name: 'malformed',
            version: '1.0.0',
            licenses: [{}]
          },
          { type: 'library', name: 'bad-array', version: '1.0.0', licenses: 'MIT' },
          {
            type: 'library',
            name: 'benchmarks',
            version: '1.0.0',
            purl: 'pkg:npm/benchmarks@1.0.0',
            licenses: [],
            properties: [{ name: 'aquasecurity:trivy:FilePath', value: 'wrong/package.json' }]
          },
          { type: 'library', name: 'transport', version: '0.0.1', purl: 'pkg:npm/transport@0.0.1' },
          { type: '', name: '', version: '', licenses: [{ license: { id: 'MIT' } }] }
        ]),
        '1.0.1',
        inventory()
      )
    ).toHaveLength(10);
    expect(() => checkSbomLicenses({}, '1.0.1')).toThrow(/CycloneDX/);
    expect(() => checkSbomLicenses({ bomFormat: 'CycloneDX', components: [] }, '1.0.1')).toThrow(/CycloneDX/);
  });

  it('rejects a non-empty but truncated image SBOM and version-drifted anchors', () => {
    const oneComponent = {
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      components: [{ type: 'library', name: 'fastify', version: '5.12.0', licenses: [{ license: { id: 'MIT' } }] }]
    };
    expect(() => checkSbomLicenses(oneComponent, '1.0.1')).toThrow(/required image components/);
    expect(() => checkSbomLicenses(sbom([], '1.0.0'), '1.0.1')).toThrow(/required image components/);
    expect(() => checkSbomLicenses(sbom([]), '1.0.1')).toThrow(/filesystem inventory/);
    expect(() =>
      checkSbomLicenses(sbom([]), '1.0.1', inventory([{ ecosystem: 'npm', name: 'fastify', version: '5.12.0' }]))
    ).toThrow(/filesystem inventory/);
    expect(() =>
      checkSbomLicenses(sbom([]), '1.0.1', { schemaVersion: 1, source: 'image-filesystem', components: [] })
    ).toThrow(/filesystem inventory/);
    const missingRuntimeDigest = inventory();
    delete (missingRuntimeDigest.components[3] as { sha256?: string }).sha256;
    expect(() => checkSbomLicenses(sbom([]), '1.0.1', missingRuntimeDigest)).toThrow(/filesystem inventory/);
    const wrongIdentity = sbom([
      {
        type: 'library',
        name: 'not-fastify',
        version: '5.12.0',
        purl: 'pkg:npm/fastify@5.12.0',
        licenses: [{ license: { id: 'MIT' } }]
      }
    ]);
    expect(() =>
      checkSbomLicenses(wrongIdentity, '1.0.1', inventory([{ ecosystem: 'npm', name: 'fastify', version: '5.12.0' }]))
    ).toThrow(/identity does not match/);
    const duplicate = sbom([
      {
        type: 'library',
        name: 'fastify',
        version: '5.12.0',
        purl: 'pkg:npm/fastify@5.12.0',
        licenses: [{ license: { id: 'MIT' } }]
      },
      {
        type: 'library',
        name: 'fastify',
        version: '5.12.0',
        purl: 'pkg:npm/fastify@5.12.0',
        licenses: [{ license: { id: 'MIT' } }]
      }
    ]);
    expect(() =>
      checkSbomLicenses(duplicate, '1.0.1', inventory([{ ecosystem: 'npm', name: 'fastify', version: '5.12.0' }]))
    ).toThrow(/duplicate component identity/);
    const malformedPurl = sbom([
      {
        type: 'library',
        name: 'purl-without-version',
        version: '1.0.0',
        purl: 'pkg:npm/no-version-separator',
        licenses: [{ license: { id: 'MIT' } }]
      }
    ]);
    expect(() => checkSbomLicenses(malformedPurl, '1.0.1', inventory())).toThrow(/identity does not match/);
    (malformedPurl.components.at(-1) as { purl: string }).purl = 'pkg:npm/%ZZ@1.0.0';
    expect(() => checkSbomLicenses(malformedPurl, '1.0.1', inventory())).toThrow(/identity does not match/);
    const mismatchedApk = sbom([
      {
        type: 'library',
        name: 'not-busybox',
        version: '1.37.0-r31',
        purl: 'pkg:apk/alpine/busybox@1.37.0-r31',
        licenses: [{ license: { id: 'GPL-2.0-only' } }]
      }
    ]);
    expect(() => checkSbomLicenses(mismatchedApk, '1.0.1', inventory())).toThrow(/identity does not match/);
    const withoutRuntime = sbom([]);
    withoutRuntime.components = withoutRuntime.components.filter(
      component => component.purl !== 'pkg:generic/node@24.19.0'
    );
    expect(() => checkSbomLicenses(withoutRuntime, '1.0.1', inventory())).toThrow(/filesystem inventory/);
    const augmented = augmentSbomWithRuntime(withoutRuntime, inventory());
    expect(checkSbomLicenses(augmented, '1.0.1', inventory())).toEqual([]);
    (augmented.components.at(-1) as { hashes: Array<{ content: string }> }).hashes[0].content = '0'.repeat(64);
    expect(() => checkSbomLicenses(augmented, '1.0.1', inventory())).toThrow(/runtime digest/);
  });

  it('routes CLI success and failure without running on import', () => {
    const log = vi.fn();
    const logError = vi.fn();
    const setExitCode = vi.fn();
    expect(
      runCli({ argv1: '/other', scriptPath: '/script', version: '1.0.1', files: [], log, logError, setExitCode })
    ).toBe(false);
    expect(
      runCli({
        argv1: '/script',
        scriptPath: '/script',
        version: '1.0.1',
        files: ['good.json', 'inventory.json'],
        read: file =>
          JSON.stringify(
            file === 'inventory.json'
              ? inventory([{ ecosystem: 'npm', name: 'fastify', version: '5.12.0' }])
              : sbom([
                  {
                    type: 'library',
                    name: 'fastify',
                    version: '5.12.0',
                    purl: 'pkg:npm/fastify@5.12.0',
                    licenses: [{ expression: 'MIT' }]
                  }
                ])
          ),
        log,
        logError,
        setExitCode
      })
    ).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('PASS'));
    const write = vi.fn();
    const runtimeLess = sbom([]);
    runtimeLess.components = runtimeLess.components.filter(component => component.purl !== 'pkg:generic/node@24.19.0');
    runCli({
      argv1: '/script',
      scriptPath: '/script',
      version: '1.0.1',
      files: ['runtime-less.json', 'inventory.json'],
      read: file => JSON.stringify(file === 'inventory.json' ? inventory() : runtimeLess),
      write,
      log,
      logError,
      setExitCode
    });
    expect(write).toHaveBeenCalledWith('runtime-less.json', expect.stringContaining('pkg:generic/node@24.19.0'));
    expect(() => augmentSbomWithRuntime(runtimeLess, { components: [] })).toThrow(/missing the Node runtime/);
    expect(augmentSbomWithRuntime({}, inventory()).components).toHaveLength(1);
    runCli({ argv1: '/script', scriptPath: '/script', version: '1.0.1', files: [], log, logError, setExitCode });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('one image SBOM'));
    expect(setExitCode).toHaveBeenCalledWith(1);
    runCli({
      argv1: '/script',
      scriptPath: '/script',
      version: '1.0.1',
      files: ['bad.json', 'inventory.json'],
      read: () => '{',
      log,
      logError,
      setExitCode
    });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('FAIL'));
    runCli({
      argv1: '/script',
      scriptPath: '/script',
      version: '1.0.1',
      files: ['blocked.json', 'inventory.json'],
      read: file =>
        JSON.stringify(
          file === 'inventory.json'
            ? inventory()
            : sbom([
                {
                  type: 'library',
                  name: 'blocked',
                  version: '1.0.0',
                  licenses: [{ license: { id: 'GPL-3.0-only' } }]
                }
              ])
        ),
      log,
      logError,
      setExitCode
    });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('1 unapproved'));
    runCli({
      argv1: '/script',
      scriptPath: '/script',
      version: '1.0.1',
      files: ['bad.json', 'inventory.json'],
      read: () => {
        throw 'non-error failure';
      },
      log,
      logError,
      setExitCode
    });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('non-error failure'));
    const previous = process.exitCode;
    setProcessExitCode(7);
    expect(process.exitCode).toBe(7);
    process.exitCode = previous;
  });
});
