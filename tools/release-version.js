#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSemver } from './semver.js';

export function classifyReleaseVersion(version) {
  const parsed = parseSemver(version);
  if (parsed === null || version.includes('+') || version.length > 128) {
    throw new Error('Release version must be OCI-compatible SemVer without build metadata');
  }
  return { version, prerelease: parsed.prerelease !== null };
}

export function validateChangesetsPreState(version, preState) {
  const release = classifyReleaseVersion(version);
  if (!release.prerelease) {
    if (preState?.mode === 'pre') throw new Error('Stable release cannot run while Changesets pre mode is active');
    return release;
  }
  const expectedTag = parseSemver(version).prerelease[0];
  if (preState?.mode !== 'pre' || preState.tag !== expectedTag) {
    throw new Error(`Prerelease requires active Changesets pre mode with tag ${expectedTag}`);
  }
  return release;
}

export function validateChangesetsPreFile(version, path) {
  const preState = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  return validateChangesetsPreState(version, preState);
}

export function runCli({ argv1, scriptPath, version, preStatePath, log = console.log }) {
  if (argv1 !== scriptPath) return false;
  const release = preStatePath ? validateChangesetsPreFile(version, preStatePath) : classifyReleaseVersion(version);
  log(String(release.prerelease));
  return true;
}

runCli({
  argv1: process.argv[1],
  scriptPath: fileURLToPath(import.meta.url),
  version: process.argv[2],
  preStatePath: process.argv[3]
});
