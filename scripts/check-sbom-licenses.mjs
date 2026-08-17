#!/usr/bin/env node
// Fail-closed license policy for the exact platform image SBOMs.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyLicense } from './license-audit.mjs';
import { isValidSemver } from '../tools/semver.js';

const REVIEWED = new Map(
  [
    ['operating-system:alpine@3.24.1', 'operating-system', 'alpine', '3.24.1', ''],
    ['pkg:apk/alpine/alpine-baselayout-data@3.7.2-r1', 'library', 'alpine-baselayout-data', '3.7.2-r1', 'GPL-2.0-only'],
    ['pkg:apk/alpine/alpine-baselayout@3.7.2-r1', 'library', 'alpine-baselayout', '3.7.2-r1', 'GPL-2.0-only'],
    ['pkg:apk/alpine/apk-tools@3.0.6-r0', 'library', 'apk-tools', '3.0.6-r0', 'GPL-2.0-only'],
    ['pkg:apk/alpine/busybox-binsh@1.37.0-r31', 'library', 'busybox-binsh', '1.37.0-r31', 'GPL-2.0-only'],
    ['pkg:apk/alpine/busybox@1.37.0-r31', 'library', 'busybox', '1.37.0-r31', 'GPL-2.0-only'],
    [
      'pkg:apk/alpine/ca-certificates-bundle@20260611-r0',
      'library',
      'ca-certificates-bundle',
      '20260611-r0',
      'MIT\nMPL-2.0'
    ],
    ['pkg:apk/alpine/libapk@3.0.6-r0', 'library', 'libapk', '3.0.6-r0', 'GPL-2.0-only'],
    ['pkg:apk/alpine/libgcc@15.2.0-r5', 'library', 'libgcc', '15.2.0-r5', 'GPL-2.0-or-later\nLGPL-2.1-or-later'],
    [
      'pkg:apk/alpine/libstdc%2B%2B@15.2.0-r5',
      'library',
      'libstdc++',
      '15.2.0-r5',
      'GPL-2.0-or-later\nLGPL-2.1-or-later'
    ],
    ['pkg:apk/alpine/musl-utils@1.2.6-r2', 'library', 'musl-utils', '1.2.6-r2', 'BSD-2-Clause\nGPL-2.0-or-later\nMIT'],
    ['pkg:apk/alpine/scanelf@1.3.9-r1', 'library', 'scanelf', '1.3.9-r1', 'GPL-2.0-only'],
    ['pkg:apk/alpine/ssl_client@1.37.0-r31', 'library', 'ssl_client', '1.37.0-r31', 'GPL-2.0-only'],
    [
      'pkg:npm/benchmarks@1.0.0',
      'library',
      'benchmarks',
      '1.0.0',
      '',
      'app/node_modules/.pnpm/secure-json-parse@2.7.0/node_modules/secure-json-parse/benchmarks/package.json'
    ],
    [
      'pkg:npm/transport@0.0.1',
      'library',
      'transport',
      '0.0.1',
      '',
      'app/node_modules/.pnpm/pino@10.3.1/node_modules/pino/test/fixtures/transport/package.json'
    ]
  ].map(([key, type, name, version, licenses, filePath]) => [key, { type, name, version, licenses, filePath }])
);

function componentKey(component) {
  return typeof component.purl === 'string'
    ? component.purl.split('?')[0]
    : `${component.type}:${component.name}@${component.version}`;
}

function licenseValues(component) {
  if (component.licenses === undefined) return [];
  if (!Array.isArray(component.licenses)) return null;
  const values = component.licenses.map(item => item?.expression ?? item?.license?.id ?? item?.license?.name);
  return values.every(value => typeof value === 'string' && value.length > 0) ? values.sort() : null;
}

function reviewedFilePathMatches(reviewed, component) {
  if (reviewed.filePath === undefined) return true;
  return (
    component.properties?.some(
      property => property?.name === 'aquasecurity:trivy:FilePath' && property.value === reviewed.filePath
    ) === true
  );
}

function hasRequiredAnchors(components, version) {
  const expected = new Set([
    'operating-system:alpine@3.24.1',
    `pkg:npm/%40blackunicorn/bonklm-server@${version}`,
    `pkg:npm/%40blackunicorn/bonklm@${version}`
  ]);
  for (const component of components) expected.delete(componentKey(component));
  return expected.size === 0;
}

function inventoryComponentKey(component) {
  return `${component.ecosystem}:${component.name}@${component.version}`;
}

function purlInventoryKey(component, ecosystem, prefix = `pkg:${ecosystem}/`) {
  const identity = component.purl.split('?')[0].slice(prefix.length);
  const separator = identity.lastIndexOf('@');
  if (separator <= 0) throw new Error('SBOM component purl identity does not match its fields');
  let name;
  let version;
  try {
    name = decodeURIComponent(identity.slice(0, separator));
    version = decodeURIComponent(identity.slice(separator + 1));
  } catch (error) {
    throw new Error('SBOM component purl identity does not match its fields', { cause: error });
  }
  const leafName = name.slice(name.lastIndexOf('/') + 1);
  const canonicalName = ecosystem === 'npm' ? name : leafName;
  if (version !== component.version || ![canonicalName, leafName].includes(component.name)) {
    throw new Error('SBOM component purl identity does not match its fields');
  }
  return `${ecosystem}:${canonicalName}@${version}`;
}

function sbomInventoryRecords(components) {
  const present = new Map();
  for (const component of components) {
    let key = null;
    if (component?.type === 'operating-system') key = `os:${component.name}@${component.version}`;
    else if (typeof component?.purl === 'string' && component.purl.startsWith('pkg:apk/')) {
      key = purlInventoryKey(component, 'apk');
    } else if (typeof component?.purl === 'string' && component.purl.startsWith('pkg:npm/')) {
      key = purlInventoryKey(component, 'npm');
    } else if (typeof component?.purl === 'string' && component.purl.startsWith('pkg:generic/node@')) {
      key = purlInventoryKey(component, 'runtime', 'pkg:generic/');
    }
    if (key !== null && present.has(key)) throw new Error(`SBOM contains duplicate component identity: ${key}`);
    if (key !== null) present.set(key, component);
  }
  return present;
}

function assertCompleteInventory(sbom, inventory) {
  if (
    inventory?.schemaVersion !== 1 ||
    inventory.source !== 'image-filesystem' ||
    !Array.isArray(inventory.components) ||
    inventory.components.length === 0 ||
    inventory.components.some(
      component =>
        !component ||
        !['os', 'apk', 'npm', 'runtime'].includes(component.ecosystem) ||
        ![component.name, component.version].every(value => typeof value === 'string' && value.length > 0) ||
        (component.ecosystem === 'runtime' && !/^[0-9a-f]{64}$/.test(component.sha256 ?? ''))
    )
  ) {
    throw new Error('Image filesystem inventory is invalid');
  }
  const present = sbomInventoryRecords(sbom.components);
  const missing = inventory.components.filter(component => !present.has(inventoryComponentKey(component)));
  if (missing.length > 0)
    throw new Error(`SBOM omits ${missing.length} component(s) from the image filesystem inventory`);
  for (const component of inventory.components.filter(item => item.ecosystem === 'runtime')) {
    const sbomComponent = present.get(inventoryComponentKey(component));
    const digest = sbomComponent.hashes?.find(hash => hash?.alg === 'SHA-256')?.content;
    if (digest !== component.sha256) throw new Error('SBOM Node runtime digest does not match the image filesystem');
  }
}

export function augmentSbomWithRuntime(sbom, inventory) {
  const runtime = inventory?.components?.find(component => component?.ecosystem === 'runtime');
  if (runtime === undefined) throw new Error('Image filesystem inventory is missing the Node runtime');
  if (sbom?.components?.some(component => component?.purl?.startsWith('pkg:generic/node@'))) return sbom;
  const component = {
    type: 'application',
    name: 'node',
    version: runtime.version,
    purl: `pkg:generic/node@${runtime.version}`,
    hashes: [{ alg: 'SHA-256', content: runtime.sha256 }],
    licenses: [{ license: { id: 'MIT' } }]
  };
  return { ...sbom, components: [...(sbom?.components ?? []), component] };
}

export function checkSbomLicenses(sbom, version, inventory) {
  if (
    sbom?.bomFormat !== 'CycloneDX' ||
    !/^1\.[5-7]$/.test(sbom.specVersion ?? '') ||
    !Array.isArray(sbom.components) ||
    sbom.components.length === 0
  ) {
    throw new Error('SBOM is not a non-empty CycloneDX component document');
  }
  if (!isValidSemver(version) || !hasRequiredAnchors(sbom.components, version)) {
    throw new Error('SBOM is missing required image components for the release version');
  }
  assertCompleteInventory(sbom, inventory);
  return sbom.components.flatMap(component => {
    if (
      !component ||
      ![component.type, component.name, component.version].every(
        value => typeof value === 'string' && value.length > 0 && value.length <= 512
      ) ||
      (component.purl !== undefined && (typeof component.purl !== 'string' || component.purl.length > 2048))
    ) {
      return [{ component: '[malformed]', licenses: [], reason: 'invalid component identity' }];
    }
    const licenses = licenseValues(component);
    if (licenses === null) {
      return [{ component: componentKey(component), licenses: [], reason: 'invalid license schema' }];
    }
    if (licenses.length > 0 && licenses.every(license => classifyLicense(license) === 'ok')) return [];
    const key = componentKey(component);
    const reviewed = REVIEWED.get(key);
    return reviewed?.type === component.type &&
      reviewed.name === component.name &&
      reviewed.version === component.version &&
      reviewed.licenses === licenses.join('\n') &&
      reviewedFilePathMatches(reviewed, component)
      ? []
      : [{ component: key, licenses, reason: 'license is not permissive or an exact reviewed image exception' }];
  });
}

export function runCli({
  argv1,
  scriptPath,
  version,
  files,
  read = readFileSync,
  write = writeFileSync,
  log,
  logError,
  setExitCode
}) {
  if (argv1 !== scriptPath) return false;
  try {
    if (files.length !== 2) throw new Error('one image SBOM and its filesystem inventory are required');
    const [file, inventoryFile] = files;
    const original = JSON.parse(read(file, 'utf8'));
    const inventory = JSON.parse(read(inventoryFile, 'utf8'));
    const sbom = augmentSbomWithRuntime(original, inventory);
    if (sbom !== original) write(file, `${JSON.stringify(sbom, null, 2)}\n`);
    const findings = checkSbomLicenses(sbom, version, inventory);
    if (findings.length > 0) {
      throw new Error(`${file}: ${findings.length} unapproved image license component(s)`);
    }
    log('check-sbom-licenses: PASS — image SBOM matches its filesystem inventory and reviewed license policy');
  } catch (error) {
    logError(`check-sbom-licenses: FAIL — ${error instanceof Error ? error.message : String(error)}`);
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
  version: process.argv[2],
  files: process.argv.slice(3),
  log: console.log,
  logError: console.error,
  setExitCode: setProcessExitCode
});
