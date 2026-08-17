import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import npa from 'npm-package-arg';
import { isValidSemver } from './semver.js';
import { classifyReleaseScope } from './release-scope.js';

const REGISTRY_SPEC_TYPES = new Set(['alias', 'range', 'tag', 'version']);

export function tarballIntegrity(path) {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`;
}

export function embeddedManifest(path) {
  try {
    return JSON.parse(execFileSync('tar', ['-xOf', path, 'package/package.json'], { encoding: 'utf8' }));
  } catch (error) {
    throw new Error(`Tarball package manifest is unreadable: ${basename(path)}`, { cause: error });
  }
}

function isRegistrySpec(name, spec) {
  if (typeof name !== 'string' || name.length === 0 || typeof spec !== 'string' || spec.length === 0) return false;
  if (spec.trim() !== spec) return false;
  try {
    const parsed = npa.resolve(name, spec);
    if (parsed.name !== name || !REGISTRY_SPEC_TYPES.has(parsed.type)) return false;
    return parsed.type !== 'alias' || REGISTRY_SPEC_TYPES.has(parsed.subSpec?.type);
  } catch {
    return false;
  }
}

function assertRegistryOnlyManifest(manifest) {
  if (manifest.bundleDependencies !== undefined || manifest.bundledDependencies !== undefined) {
    throw new Error('Tarball must not contain bundled dependencies');
  }
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    const dependencies = manifest[field];
    if (dependencies === undefined) continue;
    if (dependencies === null || Array.isArray(dependencies) || typeof dependencies !== 'object') {
      throw new Error('Tarball dependency field must be an object');
    }
    for (const [name, spec] of Object.entries(dependencies)) {
      if (!isRegistrySpec(name, spec)) throw new Error('Tarball contains a non-registry dependency spec');
    }
  }
  const publishConfig = manifest.publishConfig;
  if (
    publishConfig !== undefined &&
    (publishConfig === null || Array.isArray(publishConfig) || typeof publishConfig !== 'object')
  ) {
    throw new Error('Tarball publishConfig must be an object');
  }
  const unsupportedPublishKeys = Object.keys(publishConfig ?? {}).filter(key => !['access', 'registry'].includes(key));
  if (unsupportedPublishKeys.length > 0) throw new Error('Tarball publishConfig contains unsupported keys');
  if (publishConfig?.access !== undefined && publishConfig.access !== 'public') {
    throw new Error('Tarball publishConfig.access must be public');
  }
  const registry = publishConfig?.registry;
  if (registry !== undefined && registry !== 'https://registry.npmjs.org') {
    throw new Error('Tarball publishConfig.registry must target https://registry.npmjs.org');
  }
  const installHooks = ['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare'];
  if (installHooks.some(name => typeof manifest.scripts?.[name] === 'string')) {
    throw new Error('Tarball contains an install-time lifecycle script');
  }
}

export function verifyBundle(dir, trusted = {}) {
  const manifest = JSON.parse(readFileSync(join(dir, 'release-manifest.json'), 'utf8'));
  let scope;
  try {
    scope = classifyReleaseScope(manifest.scope);
  } catch {
    scope = null;
  }
  if (
    manifest.schemaVersion !== 1 ||
    !isValidSemver(manifest.version) ||
    !/^[0-9a-f]{40}$/.test(manifest.sourceSha ?? '') ||
    !Number.isInteger(manifest.expectedPackageCount) ||
    manifest.expectedPackageCount < 1 ||
    !Array.isArray(manifest.packages) ||
    manifest.packages.length !== manifest.expectedPackageCount ||
    scope === null
  ) {
    throw new Error('Release bundle manifest is invalid');
  }
  if (
    (trusted.scope !== undefined && manifest.scope !== trusted.scope) ||
    (trusted.sourceSha !== undefined && manifest.sourceSha !== trusted.sourceSha) ||
    (trusted.version !== undefined && manifest.version !== trusted.version) ||
    (scope.kind === 'family' &&
      trusted.expectedFamilySize !== undefined &&
      manifest.packages.length !== trusted.expectedFamilySize) ||
    (scope.kind === 'tool' && manifest.packages.length !== 1)
  ) {
    throw new Error('Release bundle does not match the trusted release context');
  }
  const names = new Set();
  const files = new Set();
  for (const pkg of manifest.packages) {
    if (
      typeof pkg.name !== 'string' ||
      pkg.name.length === 0 ||
      pkg.version !== manifest.version ||
      !['family', 'tool'].includes(pkg.kind) ||
      basename(pkg.file) !== pkg.file ||
      !pkg.file.endsWith('.tgz') ||
      names.has(pkg.name) ||
      files.has(pkg.file)
    ) {
      throw new Error('Release bundle package entry is invalid');
    }
    if (
      (scope.kind === 'family' && pkg.kind !== 'family') ||
      (scope.kind === 'tool' && (pkg.kind !== 'tool' || pkg.name !== manifest.scope))
    ) {
      throw new Error('Release bundle package scope is invalid');
    }
    names.add(pkg.name);
    files.add(pkg.file);
    const path = join(dir, pkg.file);
    if (tarballIntegrity(path) !== pkg.integrity) throw new Error(`Tarball integrity mismatch: ${pkg.name}`);
    const embedded = embeddedManifest(path);
    if (embedded.name !== pkg.name || embedded.version !== pkg.version) {
      throw new Error(`Tarball identity mismatch: ${pkg.name}@${pkg.version}`);
    }
    if (embedded.private === true) throw new Error(`Tarball package must be public: ${pkg.name}`);
    assertRegistryOnlyManifest(embedded);
  }
  const actualTarballs = readdirSync(dir)
    .filter(file => file.endsWith('.tgz'))
    .sort();
  if (actualTarballs.length !== files.size || actualTarballs.some(file => !files.has(file))) {
    throw new Error('Release bundle tarball set does not match its manifest');
  }
  if (
    trusted.expectedPackageNames !== undefined &&
    (trusted.expectedPackageNames.length !== names.size || trusted.expectedPackageNames.some(name => !names.has(name)))
  ) {
    throw new Error('Release bundle package names do not match the trusted release candidates');
  }
  return manifest;
}
