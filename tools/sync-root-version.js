#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_SYNC_OPTIONS = Object.freeze({
  rootPath: join(ROOT, 'package.json'),
  corePath: join(ROOT, 'packages', 'core', 'package.json'),
  read: readFileSync,
  write: writeFileSync
});

export function syncRootVersion({ rootPath, corePath, read, write }) {
  const root = JSON.parse(read(rootPath, 'utf8'));
  const core = JSON.parse(read(corePath, 'utf8'));
  if (typeof core.version !== 'string' || core.version.length === 0) {
    throw new Error('Core package manifest has no valid version');
  }
  write(rootPath, `${JSON.stringify({ ...root, version: core.version }, null, 2)}\n`);
  return core.version;
}

export function runCli({ argv1, scriptPath, run, log = console.log }) {
  if (argv1 !== scriptPath) return false;
  const version = run();
  log(`sync-root-version: root metadata aligned to ${version}.`);
  return true;
}

runCli({
  argv1: process.argv[1],
  scriptPath: fileURLToPath(import.meta.url),
  run: syncRootVersion.bind(undefined, REPOSITORY_SYNC_OPTIONS)
});
