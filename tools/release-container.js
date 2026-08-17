#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function command(commandName, args, options) {
  try {
    return execFileSync(commandName, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
  } catch (error) {
    const detail = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}`.trim();
    if (detail.length > 0) {
      console.error(`release-container: command failed: ${commandName} ${args.join(' ')}\n${detail.slice(0, 4000)}`);
    }
    throw error;
  }
}

function missingManifest(error) {
  const detail = `${error?.stderr ?? ''}\n${error?.message ?? ''}`;
  return /manifest unknown|name unknown|\bE404\b|404 Not Found/i.test(detail);
}

function missingCosignArtifact(error) {
  const detail = `${error?.stderr ?? ''}\n${error?.message ?? ''}`;
  return missingManifest(error) || /no signatures found|no attestations found|no matching signatures/i.test(detail);
}

export function inspectImage(run, reference) {
  try {
    return JSON.parse(run('skopeo', ['inspect', `docker://${reference}`], {}));
  } catch (error) {
    if (missingManifest(error)) return null;
    throw error;
  }
}

export function waitFor(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function assertReleaseIdentity(image, version, revision) {
  if (
    image?.Labels?.['org.opencontainers.image.version'] !== version ||
    image.Labels?.['org.opencontainers.image.revision'] !== revision
  ) {
    throw new Error(`Container release identity label does not match ${version}@${revision}`);
  }
}

export function ensureExactImage({ source, destination, digest, version, revision, run }) {
  let existing = inspectImage(run, destination);
  if (existing === null) existing = inspectImage(run, destination);
  if (existing !== null) {
    assertReleaseIdentity(existing, version, revision);
    if (existing.Digest !== digest) throw new Error('Immutable container tag conflicts with the verified artifact');
    // Idempotent resume: the destination already carries the verified
    // digest and release identity — re-copying over an existing tag fails
    // and gains nothing. The caller signs the exposed digest afterwards.
    return existing;
  }
  run('cosign', ['copy', `${source}@${digest}`, destination], {});
  const copied = inspectImage(run, destination);
  if (copied?.Digest !== digest) {
    throw new Error(
      existing === null
        ? `Copied container tag does not match ${digest}`
        : 'Immutable container tag changed during verification'
    );
  }
  assertReleaseIdentity(copied, version, revision);
  return copied;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function cleanupStagingImage({ reference, run, retries = 3, pause = waitFor }) {
  try {
    run('cosign', ['clean', '--force', reference], {});
  } catch (error) {
    if (!missingCosignArtifact(error)) throw error;
  }
  for (const kind of ['signature', 'attestation']) {
    let output = '';
    try {
      output = String(run('cosign', ['download', kind, reference], {})).trim();
    } catch (error) {
      if (!missingCosignArtifact(error)) throw error;
    }
    if (output) throw new Error('Staging container signature artifacts remain after cleanup');
  }
  try {
    run('skopeo', ['delete', `docker://${reference}`], {});
  } catch (error) {
    if (missingManifest(error)) return;
    // Best-effort cleanup: the workflow token may lack package-version
    // deletion rights on the registry (a token-scope limitation, not a
    // release defect). The staging repository is private and the tag is
    // opaque — warn and let retention policy prune it.
    console.error(`release-container: warning: could not delete ${reference} (${errorMessage(error)})`);
    return;
  }
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (inspectImage(run, reference) === null) return;
    if (attempt + 1 < retries) pause(250 * 2 ** attempt);
  }
  console.error(`release-container: warning: staging reference remains after deletion: ${reference}`);
}

export function main({ argv, run, log }) {
  const [action, source, destination, digest, version, revision, extra] = argv;
  if (action === 'ensure-exact' && source && destination && digest && version && revision && extra === undefined) {
    const image = ensureExactImage({ source, destination, digest, version, revision, run });
    log(image.Digest);
    return image;
  }
  if (action === 'cleanup-staging' && source && destination === undefined) {
    cleanupStagingImage({ reference: source, run });
    log(`release-container: removed ${source}`);
    return null;
  }
  throw new Error(
    'Usage: release-container.js ensure-exact <source-image> <destination-tag> <digest> <version> <revision> | cleanup-staging <image-tag>'
  );
}

export function runCli({ argv1, scriptPath, run, exit }) {
  if (argv1 !== scriptPath) return false;
  try {
    run();
  } catch {
    console.error('release-container: container release command failed');
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
  run: createRunner({ argv: process.argv.slice(2), run: command, log: console.log }),
  exit: process.exit
});
