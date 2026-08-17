#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanupStagingTag,
  command,
  discoverReleaseCandidates,
  discoverReleasePackageNames,
  discoverReleasePolicyAtRef,
  prepareBundle,
  promoteBundle,
  publishBundle,
  restoreChannelSnapshot,
  snapshotChannel,
  verifyBundle,
  verifyChannelBundle,
  verifyProvenanceBundle,
  verifyPublishAccess,
  verifyRegistryBundle
} from './release-npm.js';
import { FAMILY_SIZE } from './release-scope.js';
import { preflightConsumerBundle } from './release-npm-consumer.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function releaseSource() {
  return {
    repository: process.env.GITHUB_REPOSITORY,
    workflow: '.github/workflows/publish.yml',
    tag: process.env.RELEASE_TAG,
    sha: process.env.RELEASE_SHA
  };
}

function trustedPackagePolicy(root, expectedFamilySize) {
  if (!process.env.RELEASE_SCOPE) return {};
  if (!process.env.RELEASE_PACKAGE_NAMES_FILE) {
    return {
      expectedFamilySize,
      expectedPackageNames: discoverReleasePackageNames(root, expectedFamilySize, process.env.RELEASE_SCOPE)
    };
  }
  const policy = JSON.parse(readFileSync(process.env.RELEASE_PACKAGE_NAMES_FILE, 'utf8'));
  const names = policy?.packageNames;
  if (
    policy?.schemaVersion !== 1 ||
    policy.scope !== process.env.RELEASE_SCOPE ||
    policy.sourceSha !== process.env.RELEASE_SHA ||
    policy.version !== process.env.RELEASE_VERSION ||
    policy.expectedPackageCount !== names?.length ||
    !Array.isArray(names) ||
    names.length < 1 ||
    new Set(names).size !== names.length ||
    names.some(name => typeof name !== 'string' || name.length === 0) ||
    (process.env.RELEASE_SCOPE !== 'family' && names[0] !== process.env.RELEASE_SCOPE)
  ) {
    throw new Error('Recovery package name policy is invalid');
  }
  return { expectedFamilySize: policy.expectedPackageCount, expectedPackageNames: names };
}

export function main({ argv, root, run, log, expectedFamilySize }) {
  const [action, dirArg, value, extra] = argv;
  const dir = dirArg === undefined ? undefined : resolve(root, dirArg);
  let manifest;
  const packagePolicy = action === 'names-at-ref' ? {} : trustedPackagePolicy(root, expectedFamilySize);
  const trusted = {
    scope: process.env.RELEASE_SCOPE,
    sourceSha: process.env.RELEASE_SHA,
    version: process.env.RELEASE_VERSION,
    expectedFamilySize: packagePolicy.expectedFamilySize ?? expectedFamilySize,
    expectedPackageNames: packagePolicy.expectedPackageNames
  };
  if (action === 'names-at-ref' && dirArg && value && extra) {
    const policy = discoverReleasePolicyAtRef(root, dirArg, value, run);
    writeFileSync(resolve(root, extra), `${JSON.stringify(policy)}\n`);
    manifest = { version: policy.version, packages: policy.packageNames.map(name => ({ name })) };
  } else if (action === 'candidates' && dirArg && value && extra === undefined) {
    manifest = { version: value, packages: discoverReleaseCandidates(root, value, expectedFamilySize, dirArg) };
  } else if (action === 'prepare' && dir && value && extra) {
    manifest = prepareBundle({
      root,
      outputDir: dir,
      scope: value,
      version: extra,
      sourceSha: process.env.RELEASE_SHA,
      run,
      expectedFamilySize
    });
  } else if (action === 'publish' && dir && value) {
    manifest = publishBundle({ dir, stagingTag: value, run, trusted, source: releaseSource() });
  } else if (action === 'preflight-consumer' && dir && value && extra === undefined) {
    manifest = preflightConsumerBundle({ dir, evidenceDir: resolve(root, value), run, trusted });
  } else if (action === 'preflight-access' && dir && value && extra === undefined) {
    manifest = verifyPublishAccess({ dir, accessPath: resolve(root, value), run, trusted });
  } else if (action === 'promote' && dir && value && extra)
    manifest = promoteBundle({ dir, channel: value, snapshotPath: resolve(root, extra), run, trusted });
  else if (action === 'snapshot' && dir && value && extra) {
    manifest = snapshotChannel({ dir, channel: value, outputPath: resolve(root, extra), run, trusted });
  } else if (action === 'restore' && dir && value && extra === undefined) {
    manifest = restoreChannelSnapshot({ dir, snapshotPath: resolve(root, value), run, trusted });
  } else if (action === 'cleanup-staging' && dir && value && extra === undefined) {
    manifest = cleanupStagingTag({ dir, stagingTag: value, run, trusted });
  } else if (action === 'verify-provenance' && dir && extra === undefined) {
    manifest = verifyProvenanceBundle({
      dir,
      channel: value,
      source: releaseSource(),
      run,
      trusted
    });
  } else if (action === 'verify' && dir && value === undefined) {
    manifest = verifyRegistryBundle({ dir, run, requireProvenance: true, trusted });
  } else if (action === 'verify-local' && dir && value === undefined) {
    manifest = verifyBundle(dir, trusted);
  } else if (action === 'verify-channel' && dir && value)
    manifest = verifyChannelBundle({ dir, channel: value, run, trusted });
  else if (action === 'channel-version' && dir && value) {
    manifest = verifyChannelBundle({ dir, channel: value, run, trusted });
    log(manifest.channelVersion);
    return manifest;
  } else {
    throw new Error(
      'Usage: release-npm-cli.js names-at-ref <scope> <sha> <output> | candidates <scope> <version> | prepare <bundle-dir> <scope> <version> | preflight-consumer <bundle-dir> <evidence-dir> | snapshot <bundle-dir> <channel> <snapshot> | promote <bundle-dir> <channel> <snapshot> | restore <bundle-dir> <snapshot> | preflight-access <bundle-dir> <access-json> | <publish|verify|verify-local|verify-channel|channel-version|cleanup-staging|verify-provenance> <bundle-dir> [tag]'
    );
  }
  log(`release-npm: ${action} verified ${manifest.packages.length} package(s) at ${manifest.version}`);
  return manifest;
}

export function runCli({ argv1, scriptPath, run, exit }) {
  if (argv1 !== scriptPath) return false;
  try {
    run();
  } catch {
    console.error('release-npm: release command failed');
    exit(1);
  }
  return true;
}

export function createRunner(options) {
  return () => main(options);
}

runCli({
  argv1: process.argv[1],
  scriptPath: fileURLToPath(import.meta.url),
  run: createRunner({
    argv: process.argv.slice(2),
    root: ROOT,
    run: command,
    log: console.log,
    expectedFamilySize: FAMILY_SIZE
  }),
  exit: process.exit
});
