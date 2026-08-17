#!/usr/bin/env node
// Bind the container's npm filesystem inventory to pnpm's frozen production graph.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REVIEWED_EMBEDDED_FIXTURES = new Set(['benchmark@1.0.0', 'benchmarks@1.0.0', 'transport@0.0.1']);

function identity(name, version) {
  if (![name, version].every(value => typeof value === 'string' && value.length > 0 && value.length <= 512)) {
    throw new Error('pnpm production graph contains an invalid package identity');
  }
  return `${name}@${version}`;
}

function readPackageManifest(directory) {
  try {
    return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  } catch (error) {
    throw new Error('pnpm production graph contains an unreadable workspace dependency', { cause: error });
  }
}

function dependencyIdentity(name, dependency, readManifest) {
  if (!dependency || typeof dependency !== 'object') {
    throw new Error('pnpm production graph contains an invalid dependency record');
  }
  if (/^(?:file|link):/.test(dependency.version ?? '')) {
    if (typeof dependency.path !== 'string' || dependency.path.length === 0) {
      throw new Error('pnpm production graph contains an invalid workspace dependency');
    }
    const manifest = readManifest(dependency.path);
    return identity(manifest?.name, manifest?.version);
  }
  return identity(dependency.from ?? name, dependency.version);
}

export function expectedNpmIdentities(listOutput, readManifest = readPackageManifest) {
  if (!Array.isArray(listOutput) || listOutput.length === 0) {
    throw new Error('pnpm list did not return a production package graph');
  }
  const expected = new Set();
  const pending = [];
  for (const root of listOutput) {
    expected.add(identity(root?.name, root?.version));
    pending.push(root?.dependencies ?? {});
  }
  while (pending.length > 0) {
    const dependencies = pending.pop();
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
      throw new Error('pnpm production graph contains an invalid dependency map');
    }
    for (const [name, dependency] of Object.entries(dependencies)) {
      expected.add(dependencyIdentity(name, dependency, readManifest));
      pending.push(dependency.dependencies ?? {});
    }
  }
  return expected;
}

export function assertRuntimeInventory(inventory, expected) {
  if (
    inventory?.schemaVersion !== 1 ||
    inventory.source !== 'image-filesystem' ||
    !Array.isArray(inventory.components) ||
    !(expected instanceof Set) ||
    expected.size === 0
  ) {
    throw new Error('Image filesystem inventory or expected production graph is invalid');
  }
  const actual = new Set(
    inventory.components
      .filter(component => component?.ecosystem === 'npm')
      .map(component => identity(component.name, component.version))
  );
  const missing = [...expected].filter(item => !actual.has(item));
  if (missing.length > 0) throw new Error(`Image is missing frozen runtime package(s): ${missing.join(', ')}`);
  const unexpected = [...actual].filter(item => !expected.has(item) && !REVIEWED_EMBEDDED_FIXTURES.has(item));
  if (unexpected.length > 0) throw new Error(`Image contains unexpected runtime package(s): ${unexpected.join(', ')}`);
}

export function listInstalledRuntime() {
  return execFileSync(
    'pnpm',
    ['--filter', '@blackunicorn/bonklm-server...', 'list', '--prod', '--json', '--depth', 'Infinity'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
}

export function runCli({
  argv1,
  scriptPath,
  files,
  list = listInstalledRuntime,
  read = readFileSync,
  readManifest = readPackageManifest,
  log,
  logError,
  setExitCode
}) {
  if (argv1 !== scriptPath) return false;
  try {
    if (files.length === 0) throw new Error('at least one image filesystem inventory is required');
    const expected = expectedNpmIdentities(JSON.parse(list()), readManifest);
    for (const file of files) assertRuntimeInventory(JSON.parse(read(file, 'utf8')), expected);
    log('check-image-runtime: PASS — image npm inventory matches the frozen pnpm production graph');
  } catch (error) {
    logError(`check-image-runtime: FAIL — ${error instanceof Error ? error.message : String(error)}`);
    setExitCode(1);
  }
  return true;
}

export function setProcessExitCode(code) {
  process.exitCode = code;
}

runCli({
  argv1: process.argv[1],
  scriptPath: fileURLToPath(import.meta.url),
  files: process.argv.slice(2),
  log: console.log,
  logError: console.error,
  setExitCode: setProcessExitCode
});
