#!/usr/bin/env node
/**
 * Fail when an active Changesets plan would split BonkLM's version-locked
 * publishable package family. The linked group keeps released packages aligned
 * to the highest requested bump, but it does not add untouched packages to the
 * plan; this gate closes that gap before version manifests are written.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './check-changeset-linked.js';
import { compareSemver, isValidSemver } from './semver.js';
import { classifyReleaseScope, FAMILY_SIZE } from './release-scope.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = join(ROOT, 'packages');

export function readVersionLockedFamily(packagesDir = PACKAGES_DIR) {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => readJson(join(packagesDir, entry.name, 'package.json')))
    .filter(manifest => manifest?.private !== true && typeof manifest?.name === 'string')
    .map(manifest => ({ name: manifest.name, version: manifest.version }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function readPrivatePackageNames(packagesDir = PACKAGES_DIR) {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => readJson(join(packagesDir, entry.name, 'package.json')))
    .filter(manifest => manifest?.private === true && typeof manifest?.name === 'string')
    .map(manifest => manifest.name)
    .sort();
}

export function validateReleasePlan(family, releases, privatePackageNames = [], expectedFamilySize = FAMILY_SIZE) {
  const familyNames = new Set(family.map(pkg => pkg.name));
  const privateNames = new Set(privatePackageNames);
  const activeReleases = releases.filter(release => release.type !== 'none');
  const familyReleases = activeReleases.filter(release => familyNames.has(release.name));
  const privateReleases = activeReleases.filter(release => privateNames.has(release.name)).map(release => release.name);
  const currentVersions = [...new Set(family.map(pkg => pkg.version))].sort();
  const currentVersion = currentVersions[0];
  const currentVersionsValid = currentVersions.length === 1 && isValidSemver(currentVersion);
  const familySizeValid = family.length === expectedFamilySize;
  if (familyReleases.length === 0) {
    return {
      ok: familySizeValid && currentVersionsValid && privateReleases.length === 0,
      missing: [],
      privateReleases,
      targetVersions: [],
      currentVersions,
      familyCount: family.length,
      releaseCount: 0
    };
  }

  const plannedNames = new Set(familyReleases.map(release => release.name));
  const missing = family.map(pkg => pkg.name).filter(name => !plannedNames.has(name));
  const targetVersions = [...new Set(familyReleases.map(release => release.newVersion))].sort();
  const releaseNamesUnique = plannedNames.size === familyReleases.length;
  const targetVersion = targetVersions[0];
  const targetValid = targetVersions.length === 1 && isValidSemver(targetVersion);

  return {
    ok:
      currentVersionsValid &&
      familySizeValid &&
      missing.length === 0 &&
      privateReleases.length === 0 &&
      releaseNamesUnique &&
      targetValid &&
      compareSemver(targetVersion, currentVersion) > 0,
    missing,
    privateReleases,
    targetVersions,
    currentVersions,
    familyCount: family.length,
    releaseCount: familyReleases.length
  };
}

export function assertReleaseScopeConsumed(family, releases, scope) {
  const classification = classifyReleaseScope(scope);
  const familyNames = new Set(family.map(pkg => pkg.name));
  const pending = releases.filter(
    release =>
      release.type !== 'none' &&
      (classification.kind === 'family' ? familyNames.has(release.name) : release.name === classification.scope)
  );
  if (pending.length > 0) {
    throw new Error(`Release scope ${classification.scope} has an unconsumed Changesets release plan`);
  }
  return true;
}

export function formatPlanFailure(result) {
  const lines = [
    'Changesets release plan would split the version-locked BonkLM package family.',
    `  family packages: ${result.familyCount}`,
    `  current versions: ${result.currentVersions.join(', ') || '(none)'}`,
    `  planned family releases: ${result.releaseCount}`,
    `  target versions: ${result.targetVersions.join(', ') || '(none)'}`
  ];
  if (result.missing.length > 0) {
    lines.push('', `  MISSING from release plan: ${result.missing.length}`);
    for (const name of result.missing) lines.push(`    + ${name}`);
  }
  if (result.privateReleases.length > 0) {
    lines.push('', '  PRIVATE packages must not be released:');
    for (const name of result.privateReleases) lines.push(`    - ${name}`);
  }
  lines.push('', 'Fix: include every publishable packages/* member in the changeset at the same bump level.');
  return lines.join('\n');
}

function runChangesetStatus(repoRoot, outputPath) {
  execFileSync('pnpm', ['exec', 'changeset', 'status', '--output', outputPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function readBaseFamilyVersion(repoRoot, baseRef) {
  const raw = execFileSync('git', ['show', `${baseRef}:packages/core/package.json`], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return JSON.parse(raw).version;
}

export function readFamilyChangelogVersions(packagesDir) {
  return readdirSync(packagesDir, { withFileTypes: true }).flatMap(entry => {
    if (!entry.isDirectory()) return [];
    const packageDir = join(packagesDir, entry.name);
    const manifest = readJson(join(packageDir, 'package.json'));
    if (manifest?.private === true || typeof manifest?.name !== 'string') return [];
    const match = readFileSync(join(packageDir, 'CHANGELOG.md'), 'utf8').match(/^## ([^\s]+)\s*$/m);
    return [match?.[1] ?? ''];
  });
}

function isConsumedChangesetsError(error) {
  return (
    error?.status === 1 &&
    String(error?.stderr ?? '').includes('Some packages have been changed but no changesets were found')
  );
}

function isCompleteVersionCut({ family, baseVersion, changelogVersions, expectedFamilySize }) {
  const currentVersions = [...new Set(family.map(pkg => pkg.version))];
  if (family.length !== expectedFamilySize || currentVersions.length !== 1) return false;
  const currentVersion = currentVersions[0];
  if (!isValidSemver(baseVersion) || !isValidSemver(currentVersion)) return false;
  return (
    compareSemver(currentVersion, baseVersion) > 0 &&
    changelogVersions.length === expectedFamilySize &&
    changelogVersions.every(version => version === currentVersion)
  );
}

export function readChangesetPlan(repoRoot = ROOT, runStatus = runChangesetStatus, options = {}) {
  const outputDir = mkdtempSync(join(tmpdir(), 'bonklm-release-plan-'));
  const outputPath = join(outputDir, 'status.json');
  try {
    try {
      runStatus(repoRoot, outputPath);
    } catch (error) {
      if (!isConsumedChangesetsError(error)) throw error;
      const family = options.family ?? readVersionLockedFamily(join(repoRoot, 'packages'));
      const expectedFamilySize = options.expectedFamilySize ?? FAMILY_SIZE;
      const baseRef = options.baseRef ?? process.env.CHANGESET_BASE_REF ?? 'main';
      const baseVersion = (options.readBaseVersion ?? readBaseFamilyVersion)(repoRoot, baseRef);
      const changelogVersions = (options.readChangelogVersions ?? readFamilyChangelogVersions)(
        join(repoRoot, 'packages')
      );
      if (!isCompleteVersionCut({ family, baseVersion, changelogVersions, expectedFamilySize })) throw error;
      return [];
    }
    const plan = readJson(outputPath);
    if (!plan || !Array.isArray(plan.releases)) throw new Error('Changesets status did not produce a releases array');
    return plan.releases;
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

export function main({
  family,
  releases,
  privatePackageNames,
  expectedFamilySize = FAMILY_SIZE,
  log = console.log,
  error = console.error,
  exit = process.exit
} = {}) {
  const result = validateReleasePlan(
    family ?? readVersionLockedFamily(),
    releases ?? readChangesetPlan(),
    privatePackageNames ?? readPrivatePackageNames(),
    expectedFamilySize
  );
  if (!result.ok) {
    error(`\n${formatPlanFailure(result)}\n`);
    exit(1);
    return result;
  }
  log(
    result.releaseCount === 0
      ? `check-release-plan: ${result.familyCount} package family; no active family release.`
      : `check-release-plan: ${result.familyCount} package family advances together to ${result.targetVersions[0]}.`
  );
  return result;
}

export function mainConsumed(scope, { family, releases, log = console.log } = {}) {
  assertReleaseScopeConsumed(family ?? readVersionLockedFamily(), releases ?? readChangesetPlan(), scope);
  log(`check-release-plan: ${scope} has no unconsumed Changesets release.`);
  return true;
}

export function runCli({ argv1, scriptPath, argv = [], run = main, runConsumed = mainConsumed }) {
  if (argv1 !== scriptPath) return false;
  if (argv.length === 0) run();
  else if (argv.length === 2 && argv[0] === '--assert-consumed') runConsumed(argv[1]);
  else throw new Error('Usage: check-release-plan.js [--assert-consumed <scope>]');
  return true;
}

runCli({ argv1: process.argv[1], scriptPath: fileURLToPath(import.meta.url), argv: process.argv.slice(2) });
