/**
 * Tests for the shared project dependency reader.
 *
 * The security guards (path traversal, file size, prototype pollution) are
 * exercised end-to-end through `framework.test.ts`; this suite pins the parts
 * that only this module owns — untrusted field narrowing and the
 * dependencies-before-devDependencies lookup order.
 *
 * @module detection/project-deps.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lookupDependency, MAX_PACKAGE_JSON_SIZE, readProjectDependencies } from './project-deps.js';
import { WizardError } from '../utils/error.js';

let workingDir: string;

/** Writes a package.json into the temp project and reads it back. */
async function read(contents: string) {
  writeFileSync(join(workingDir, 'package.json'), contents);
  return readProjectDependencies({ workingDir });
}

beforeEach(() => {
  workingDir = mkdtempSync(join(tmpdir(), 'bonklm-deps-'));
});

afterEach(() => {
  rmSync(workingDir, { recursive: true, force: true });
});

describe('readProjectDependencies', () => {
  it('returns both dependency maps', async () => {
    const result = await read(
      JSON.stringify({ dependencies: { express: '^4.18.0' }, devDependencies: { vitest: '^1.0.0' } })
    );
    expect(result).toEqual({ dependencies: { express: '^4.18.0' }, devDependencies: { vitest: '^1.0.0' } });
  });

  it('returns empty maps when package.json is absent', async () => {
    expect(await readProjectDependencies({ workingDir })).toEqual({ dependencies: {}, devDependencies: {} });
  });

  it('returns empty maps when the file has no dependency fields', async () => {
    expect(await read(JSON.stringify({ name: 'app' }))).toEqual({ dependencies: {}, devDependencies: {} });
  });

  it('returns empty maps for unparseable JSON rather than leaking the parse error', async () => {
    expect(await read('{ not json')).toEqual({ dependencies: {}, devDependencies: {} });
  });

  it('discards a dependencies field that is not an object', async () => {
    expect(await read(JSON.stringify({ dependencies: 'express', devDependencies: ['vitest'] }))).toEqual({
      dependencies: {},
      devDependencies: {}
    });
  });

  it('drops non-string version values', async () => {
    const result = await read(JSON.stringify({ dependencies: { express: '^4.18.0', bad: { nested: true }, n: 3 } }));
    expect(result.dependencies).toEqual({ express: '^4.18.0' });
  });

  it('rejects a package.json that resolves outside the working directory', async () => {
    const project = join(workingDir, 'project');
    mkdirSync(project);
    // The manifest exists, but one level above the declared project root.
    writeFileSync(join(workingDir, 'package.json'), JSON.stringify({ dependencies: {} }));

    await expect(
      readProjectDependencies({ workingDir: project, packageJsonPath: '../package.json' })
    ).rejects.toBeInstanceOf(WizardError);
  });
});

describe('readProjectDependencies — guards', () => {
  it('returns empty maps for a broken symlink', async () => {
    symlinkSync(join(workingDir, 'nowhere.json'), join(workingDir, 'package.json'));
    expect(await readProjectDependencies({ workingDir })).toEqual({ dependencies: {}, devDependencies: {} });
  });

  it('rejects a package.json over the size cap', async () => {
    const padding = 'x'.repeat(MAX_PACKAGE_JSON_SIZE);
    writeFileSync(join(workingDir, 'package.json'), JSON.stringify({ name: padding }));

    await expect(readProjectDependencies({ workingDir })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('rejects a package.json carrying a prototype-pollution marker', async () => {
    writeFileSync(join(workingDir, 'package.json'), '{"constructor": {"x": 1}, "dependencies": {}}');

    await expect(readProjectDependencies({ workingDir })).rejects.toMatchObject({ code: 'INVALID_PACKAGE_JSON' });
  });

  it('returns empty maps when package.json is a JSON scalar', async () => {
    expect(await read('"not-an-object"')).toEqual({ dependencies: {}, devDependencies: {} });
  });

  it('returns empty maps when package.json parses to null', async () => {
    expect(await read('null')).toEqual({ dependencies: {}, devDependencies: {} });
  });

  it('returns empty maps when the path is unreadable', async () => {
    // A directory named package.json stats fine but cannot be read as a file.
    mkdirSync(join(workingDir, 'package.json'));
    expect(await readProjectDependencies({ workingDir })).toEqual({ dependencies: {}, devDependencies: {} });
  });

  it.skipIf(process.platform === 'win32')(
    'does not block on a FIFO named package.json',
    async () => {
      // A FIFO reports size 0, so it sails under the 1MB cap; readFile then
      // blocks until a writer closes. Without the isFile() guard this test
      // hangs and times out rather than failing an assertion — which is the
      // point: the failure mode is an unbounded hang, not a wrong value.
      execFileSync('mkfifo', [join(workingDir, 'package.json')]);

      await expect(readProjectDependencies({ workingDir })).resolves.toEqual({
        dependencies: {},
        devDependencies: {}
      });
    },
    5000
  );

  it('defaults to process.cwd() when no working directory is given', async () => {
    // Runs against this repository's own root manifest.
    const result = await readProjectDependencies();
    expect(result).toHaveProperty('dependencies');
    expect(result).toHaveProperty('devDependencies');
  });
});

describe('lookupDependency', () => {
  const deps = { dependencies: { express: '^4.18.0' }, devDependencies: { express: '^5.0.0', vitest: '^1.0.0' } };

  it('prefers dependencies over devDependencies', () => {
    expect(lookupDependency(deps, 'express')).toBe('^4.18.0');
  });

  it('falls back to devDependencies', () => {
    expect(lookupDependency(deps, 'vitest')).toBe('^1.0.0');
  });

  it('returns undefined for an absent package', () => {
    expect(lookupDependency(deps, 'fastify')).toBeUndefined();
  });

  it('does not resolve a package named after an Object.prototype member', () => {
    expect(lookupDependency({ dependencies: {}, devDependencies: {} }, 'constructor')).toBeUndefined();
    expect(lookupDependency({ dependencies: {}, devDependencies: {} }, 'toString')).toBeUndefined();
  });
});
