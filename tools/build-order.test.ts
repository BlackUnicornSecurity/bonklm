import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('root build orchestration', () => {
  const readManifest = (path: string) =>
    JSON.parse(readFileSync(path, 'utf8')) as { name?: string; scripts?: Record<string, string> };

  it('keeps workspace package names unique so pnpm can order dependency builds', () => {
    const manifestPaths = [
      join(REPO_ROOT, 'package.json'),
      ...['packages', 'tools'].flatMap(directory =>
        readdirSync(join(REPO_ROOT, directory), { withFileTypes: true })
          .filter(entry => entry.isDirectory())
          .map(entry => join(REPO_ROOT, directory, entry.name, 'package.json'))
          .filter(existsSync)
      )
    ];
    const names = manifestPaths.map(path => readManifest(path).name).filter((name): name is string => Boolean(name));

    expect(new Set(names).size).toBe(names.length);
  });

  it("delegates ordering to pnpm's workspace dependency graph", () => {
    const manifest = readManifest(join(REPO_ROOT, 'package.json'));

    expect(manifest.scripts?.build).toBe('pnpm -r run build');
  });
});
