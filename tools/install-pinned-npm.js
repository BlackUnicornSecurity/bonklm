#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NPM_VERSION = '10.9.9';
const NPM_INTEGRITY = 'sha512-1g+6jLQvaIuB4zwvHL7yrXuXcWZwDsCtBX8bbWDqbvJSSr9nPiDDWTHNgwXR27iIcTTW7v3A57hDW9RYv2W4Yg==';
const NPM_TAR_RANGE = '^7.5.22';
const NPM_TAR_VERSION = '7.5.22';
const REGISTRY = 'https://registry.npmjs.org';
const SCRIPT_PATH = fileURLToPath(import.meta.url);

export function command(name, args) {
  return execFileSync(name, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function packedFilename(output) {
  let records;
  try {
    records = JSON.parse(output);
  } catch (error) {
    throw new Error('npm pack output is invalid', { cause: error });
  }
  const filename = records?.length === 1 ? records[0]?.filename : undefined;
  if (typeof filename !== 'string' || basename(filename) !== filename || filename !== `npm-${NPM_VERSION}.tgz`) {
    throw new Error('npm pack output is invalid');
  }
  return filename;
}

function tarballIntegrity(path) {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`;
}

export function inspectNpmTarball(path, run) {
  let manifest;
  let bundledTarManifest;
  try {
    manifest = JSON.parse(run('tar', ['-xOf', path, 'package/package.json']));
    bundledTarManifest = JSON.parse(run('tar', ['-xOf', path, 'package/node_modules/tar/package.json']));
  } catch (error) {
    throw new Error('Pinned npm package manifest is invalid', { cause: error });
  }
  if (
    manifest.version !== NPM_VERSION ||
    manifest.dependencies?.tar !== NPM_TAR_RANGE ||
    bundledTarManifest.name !== 'tar' ||
    bundledTarManifest.version !== NPM_TAR_VERSION
  ) {
    throw new Error('Pinned npm package does not contain the reviewed runtime dependency set');
  }
}

export function installPinnedNpm({ run, directory, expectedIntegrity }) {
  const output = run('npm', [
    'pack',
    `npm@${NPM_VERSION}`,
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    directory,
    `--registry=${REGISTRY}`
  ]);
  const tarball = join(directory, packedFilename(output));
  if (tarballIntegrity(tarball) !== expectedIntegrity) throw new Error('Pinned npm tarball integrity mismatch');
  inspectNpmTarball(tarball, run);
  run('npm', ['install', '--global', tarball, '--ignore-scripts', '--audit=false', '--fund=false']);
  if (run('npm', ['--version']).trim() !== NPM_VERSION) {
    throw new Error(`Pinned npm install did not produce active npm version ${NPM_VERSION}`);
  }
}

export function makeTemporaryDirectory() {
  return mkdtempSync(join(tmpdir(), 'bonklm-pinned-npm-'));
}

export function removeTemporaryDirectory(path) {
  rmSync(path, { recursive: true, force: true });
}

export function installFromRegistry({ run, makeDirectory, removeDirectory, expectedIntegrity }) {
  const directory = makeDirectory();
  try {
    installPinnedNpm({ run, directory, expectedIntegrity });
  } finally {
    removeDirectory(directory);
  }
}

export function createInstaller(options) {
  return () => installFromRegistry(options);
}

export function runCli({ argv1, scriptPath, install, logError, setExitCode }) {
  if (argv1 !== scriptPath) return false;
  try {
    install();
  } catch {
    logError('install-pinned-npm: pinned npm installation failed');
    setExitCode(1);
  }
  return true;
}

export function setProcessExitCode(code) {
  process.exitCode = code;
}

runCli({
  argv1: process.argv[1],
  scriptPath: SCRIPT_PATH,
  install: createInstaller({
    run: command,
    makeDirectory: makeTemporaryDirectory,
    removeDirectory: removeTemporaryDirectory,
    expectedIntegrity: NPM_INTEGRITY
  }),
  logError: console.error,
  setExitCode: setProcessExitCode
});
