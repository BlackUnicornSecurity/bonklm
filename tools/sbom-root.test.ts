import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function temporaryDirectory(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

describe('package-scoped SBOM generation', () => {
  it('describes an explicitly selected Tier-B package rather than core', () => {
    const output = join(temporaryDirectory('bonklm-sbom-'), 'tool.sbom.json');
    execFileSync(
      process.execPath,
      ['scripts/gen-sbom.mjs', '--root', 'tools/eslint-plugin-bonklm-edge', '--out', output],
      { cwd: root }
    );
    const sbom = JSON.parse(readFileSync(output, 'utf8')) as {
      metadata: { component: { name: string; version: string } };
      components: Array<{ name: string }>;
    };
    expect(sbom.metadata.component).toMatchObject({
      name: '@blackunicorn/eslint-plugin-edge',
      version: '0.4.1'
    });
    expect(sbom.components.some(component => component.name === 'eslint')).toBe(true);
    expect(sbom.components.some(component => component.name === '@blackunicorn/bonklm')).toBe(false);
  });

  it('captures a dependency unique to a non-core family package reproducibly', () => {
    const directory = temporaryDirectory('bonklm-server-sbom-');
    const first = join(directory, 'first.json');
    const second = join(directory, 'second.json');
    const options = { cwd: root, env: { ...process.env, SOURCE_DATE_EPOCH: '1700000000' } };
    execFileSync(
      process.execPath,
      ['scripts/gen-sbom.mjs', '--root', 'packages/bonklm-server', '--out', first],
      options
    );
    execFileSync(
      process.execPath,
      ['scripts/gen-sbom.mjs', '--root', 'packages/bonklm-server', '--out', second],
      options
    );
    const sbom = JSON.parse(readFileSync(first, 'utf8')) as { components: Array<{ name: string }> };
    expect(sbom.components.some(component => component.name === 'fastify')).toBe(true);
    expect(readFileSync(first, 'utf8')).toBe(readFileSync(second, 'utf8'));
  });

  it('includes the root package identity in the deterministic serial', () => {
    const directory = temporaryDirectory('bonklm-sbom-roots-');
    const roots = ['one', 'two'].map((name, index) => {
      const packageDir = join(directory, name);
      return { name, index, packageDir };
    });
    for (const item of roots) {
      mkdirSync(item.packageDir, { recursive: true });
      writeFileSync(
        join(item.packageDir, 'package.json'),
        JSON.stringify({ name: `@blackunicorn/${item.name}`, version: `1.0.${item.index}`, license: 'MIT' })
      );
      execFileSync(
        process.execPath,
        ['scripts/gen-sbom.mjs', '--root', item.packageDir, '--out', join(directory, `${item.name}.json`)],
        { cwd: root, env: { ...process.env, SOURCE_DATE_EPOCH: '1700000000' } }
      );
    }
    const serials = roots.map(
      item => JSON.parse(readFileSync(join(directory, `${item.name}.json`), 'utf8')).serialNumber
    );
    expect(new Set(serials).size).toBe(2);
  });
});
