#!/usr/bin/env node
// Enumerate the exact package inventory visible in a built runtime image.

import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function metadataValue(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new Error(`Image ${label} is missing or invalid`);
  }
  return value;
}

function apkComponents(root) {
  const contents = readFileSync(join(root, 'lib', 'apk', 'db', 'installed'), 'utf8');
  return contents
    .split(/\n\n+/)
    .filter(block => block.trim().length > 0)
    .map(block => {
      const fields = Object.fromEntries(block.split('\n').map(line => [line.slice(0, 1), line.slice(2)]));
      try {
        return {
          ecosystem: 'apk',
          name: metadataValue(fields.P, 'APK package name'),
          version: metadataValue(fields.V, 'APK package version')
        };
      } catch (error) {
        throw new Error('Image APK database contains an invalid package record', { cause: error });
      }
    });
}

function packageComponent(path) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error('Image contains an unreadable package manifest', { cause: error });
  }
  if (manifest.name === undefined || manifest.version === undefined) return null;
  try {
    return {
      ecosystem: 'npm',
      name: metadataValue(manifest.name, 'npm package name'),
      version: metadataValue(manifest.version, 'npm package version')
    };
  } catch (error) {
    throw new Error('Image contains an invalid package manifest', { cause: error });
  }
}

function npmComponents(root) {
  const pending = [join(root, 'app')];
  const components = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name === 'package.json') {
        const component = packageComponent(path);
        if (component !== null) components.push(component);
      }
    }
  }
  return components;
}

function runtimeComponent(root, runtime) {
  const version = metadataValue(runtime.version, 'Node runtime version').replace(/^v/, '');
  const executable = metadataValue(runtime.executable, 'Node runtime executable');
  if (!executable.startsWith('/')) throw new Error('Image Node runtime executable must be an absolute path');
  const sha256 = createHash('sha256')
    .update(readFileSync(join(root, executable.slice(1))))
    .digest('hex');
  return { ecosystem: 'runtime', name: 'node', version, sha256 };
}

export function buildImageInventory(root = '/', runtime = { version: process.version, executable: process.execPath }) {
  const alpineVersion = metadataValue(
    readFileSync(join(root, 'etc', 'alpine-release'), 'utf8').trim(),
    'Alpine version'
  );
  const components = [
    { ecosystem: 'os', name: 'alpine', version: alpineVersion },
    ...apkComponents(root),
    ...npmComponents(root),
    runtimeComponent(root, runtime)
  ];
  const unique = [
    ...new Map(components.map(item => [`${item.ecosystem}:${item.name}@${item.version}`, item])).values()
  ];
  unique.sort((left, right) =>
    `${left.ecosystem}:${left.name}@${left.version}`.localeCompare(`${right.ecosystem}:${right.name}@${right.version}`)
  );
  return { schemaVersion: 1, source: 'image-filesystem', components: unique };
}

export function runCli({ argv1, scriptPath, root = '/', build = buildImageInventory, log, logError, setExitCode }) {
  if (argv1 !== scriptPath) return false;
  try {
    log(JSON.stringify(build(root)));
  } catch (error) {
    logError(`image-inventory: FAIL — ${error instanceof Error ? error.message : String(error)}`);
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
  log: console.log,
  logError: console.error,
  setExitCode: setProcessExitCode
});
