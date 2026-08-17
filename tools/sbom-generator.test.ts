import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
// @ts-expect-error — dependency-free release scripts have no declaration files
import { main, parseArgs, runCli } from '../scripts/gen-sbom.mjs';

function fixture(license: string | null = 'MIT') {
  const repoRoot = mkdtempSync(join(tmpdir(), 'bonklm-sbom-generator-'));
  onTestFinished(() => rmSync(repoRoot, { recursive: true, force: true }));
  const root = join(repoRoot, 'packages', 'fixture');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(repoRoot, 'package.json'), JSON.stringify({ name: 'repo', version: '1.0.1' }));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: '@blackunicorn/fixture', version: '1.0.1', ...(license ? { license } : {}) })
  );
  return { repoRoot, root };
}

describe('SBOM generator unit boundary', () => {
  it('parses explicit output, root, print, and help options', () => {
    expect(parseArgs(['--out', 'out.json', '--root', 'packages/tool', '--print'], '/repo')).toEqual({
      out: 'out.json',
      print: true,
      root: expect.stringMatching(/packages\/tool$/)
    });
    expect(parseArgs(['--help'], '/repo')).toMatchObject({ help: true });
    expect(parseArgs([], '/repo')).toMatchObject({ out: '/repo/bonklm-core.sbom.json', print: false });
    expect(parseArgs([])).toMatchObject({ out: expect.stringMatching(/bonklm-core\.sbom\.json$/), print: false });
    const error = vi.fn();
    const exit = vi.fn();
    expect(parseArgs(['--unknown'], '/repo', { error, exit })).toBeNull();
    expect(exit).toHaveBeenCalledWith(2);
  });

  it('generates a deterministic package-scoped BOM through the direct main seam', () => {
    const { repoRoot, root } = fixture();
    const output = join(repoRoot, 'fixture.sbom.json');
    const log = vi.fn();

    expect(
      main({
        argv: ['--root', root, '--out', output, '--print'],
        env: { SOURCE_DATE_EPOCH: '1700000000' },
        log,
        repoRoot
      })
    ).toMatchObject({ metadata: { component: { name: '@blackunicorn/fixture', version: '1.0.1' } } });
    expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({ bomFormat: 'CycloneDX', specVersion: '1.5' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('license mix'), '{}');
  });

  it('generates without printing the optional license summary', () => {
    const { repoRoot, root } = fixture();
    const log = vi.fn();
    const bom = main({ argv: ['--root', root, '--out', join(repoRoot, 'quiet.sbom.json')], env: {}, log, repoRoot });
    expect(bom).toMatchObject({ metadata: { component: { name: '@blackunicorn/fixture' } } });
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('license mix'), expect.anything());
  });

  it('binds an exact consumer SBOM to release and tarball identities', () => {
    const { repoRoot, root } = fixture();
    const integrity = `sha512-${Buffer.alloc(64, 1).toString('base64')}`;
    const properties = [
      { name: 'bonklm:release:source-sha', value: 'a'.repeat(40) },
      { name: 'bonklm:npm:integrity', value: integrity }
    ];
    const bom = main({
      argv: ['--root', root, '--out', join(repoRoot, 'bound.sbom.json')],
      env: { SOURCE_DATE_EPOCH: '1700000000' },
      log: vi.fn(),
      integrities: new Map([['@blackunicorn/fixture@1.0.1', integrity]]),
      properties,
      repoRoot
    });
    expect(bom.metadata.properties).toEqual(properties);
    expect(bom.metadata.component.hashes).toEqual([{ alg: 'SHA-512', content: Buffer.alloc(64, 1).toString('hex') }]);
    const changed = main({
      argv: ['--root', root, '--out', join(repoRoot, 'changed.sbom.json')],
      env: { SOURCE_DATE_EPOCH: '1700000000' },
      integrities: new Map([['@blackunicorn/fixture@1.0.1', integrity]]),
      log: vi.fn(),
      properties: [{ ...properties[0], value: 'b'.repeat(40) }, properties[1]],
      repoRoot
    });
    expect(changed.serialNumber).not.toBe(bom.serialNumber);
    const malformed = main({
      argv: ['--root', root, '--out', join(repoRoot, 'malformed.sbom.json')],
      env: { SOURCE_DATE_EPOCH: '1700000000' },
      integrities: new Map([['@blackunicorn/fixture@1.0.1', `sha512-${Buffer.alloc(4).toString('base64')}`]]),
      log: vi.fn(),
      repoRoot
    });
    expect(malformed.metadata.component).not.toHaveProperty('hashes');
  });

  it('encodes scoped packages and every supported license node shape', () => {
    const { repoRoot, root } = fixture();
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: '@blackunicorn/fixture',
        version: '1.0.1',
        license: 'MIT',
        dependencies: {
          '@scope/scoped': '1.0.0',
          compound: '1.0.0',
          custom: '1.0.0',
          unknown: '1.0.0'
        }
      })
    );
    for (const [name, license] of [
      ['@scope/scoped', 'Apache-2.0'],
      ['compound', 'MIT OR Apache-2.0'],
      ['custom', 'Custom-License'],
      ['unknown', null]
    ] as const) {
      const directory = join(root, 'node_modules', ...name.split('/'));
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({ name, version: '1.0.0', ...(license ? { license } : {}) })
      );
    }
    const output = join(repoRoot, 'licenses.sbom.json');
    const log = vi.fn();
    const bom = main({ argv: ['--root', root, '--out', output, '--print'], env: {}, log, repoRoot });
    expect(bom.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          purl: 'pkg:npm/%40scope/scoped@1.0.0',
          licenses: [{ license: { id: 'Apache-2.0' } }]
        }),
        expect.objectContaining({ name: 'compound', licenses: [{ expression: 'MIT OR Apache-2.0' }] }),
        expect.objectContaining({ name: 'custom', licenses: [{ license: { name: 'Custom-License' } }] }),
        expect.not.objectContaining({ licenses: expect.anything() })
      ])
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining('license mix'), expect.stringContaining('Unknown'));
  });

  it('prints help without generating a BOM', () => {
    const log = vi.fn();
    const exit = vi.fn();
    expect(main({ argv: ['--help'], log, exit, repoRoot: '/repo' })).toBeNull();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('stops when argument parsing fails through the main seam', () => {
    const exit = vi.fn();
    expect(main({ argv: ['--unknown'], exit, log: vi.fn(), repoRoot: '/repo' })).toBeNull();
    expect(exit).toHaveBeenCalledWith(2);
  });

  it('rejects an unlicensed selected root', () => {
    const { repoRoot, root } = fixture(null);
    expect(() => main({ argv: ['--root', root], repoRoot, log: vi.fn() })).toThrow(/recognized license/);
  });

  it('runs only for its own CLI entrypoint', () => {
    const run = vi.fn();
    expect(runCli({ argv1: '/other', scriptPath: '/script', run })).toBe(false);
    expect(runCli({ argv1: '/script', scriptPath: '/script', run })).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });
});
