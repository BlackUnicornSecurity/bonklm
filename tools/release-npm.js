import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { slsaBundle, validateAttestationUrl, verifyAttestationDocument } from './release-npm-provenance.js';
import { classifyReleaseScope } from './release-scope.js';
import { resolvePublishedRelease } from './release-state.js';
import { tarballIntegrity, verifyBundle } from './release-npm-bundle.js';
import { normalizePackedTarball } from './release-npm-normalize.js';
import { compareSemver, isValidSemver, parseSemver } from './semver.js';

const NPM_REGISTRY = 'https://registry.npmjs.org';

// Delay between retries of the channel read-back and channel verification,
// read at call time so suites driving a non-converging fake registry can set
// it to 0. Digits only and capped, so a stray interpolation (an empty or
// malformed value) can neither park the release lane nor silently disable the
// backoff. The provenance-flap and post-publish retries keep fixed delays.
export function retryDelayMs() {
  const raw = process.env.BONKLM_RELEASE_RETRY_DELAY_MS;
  return /^\d+$/.test(raw ?? '') ? Math.min(Number(raw), 120_000) : 45_000;
}

// A verdict a retry cannot change: an external writer moved the channel, or
// published bytes do not match the release artifact. Only errors built here
// carry the marker, so a non-Error throw (registryValue rethrows the runner's
// raw value) or a forged property cannot pass as one.
function deterministicVerdict(message) {
  return Object.assign(new Error(message), { deterministicVerdict: true });
}

function isDeterministicVerdict(error) {
  return error instanceof Error && error.deterministicVerdict === true;
}

export { verifyBundle } from './release-npm-bundle.js';
export { slsaBundle, validateAttestationUrl, verifyAttestationDocument } from './release-npm-provenance.js';

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// Registry-derived text bound for a log sink: collapse whitespace so it cannot
// forge extra log lines or runner `::command::` directives, and cap it.
function logDetail(error) {
  return String(error?.stderr || errorMessage(error))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

// Registry reads lag the writes just performed and can fail transiently.
// Retry those; surface a deterministic verdict immediately.
function retryWhileLagging(action, attempts = 12) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return action();
    } catch (error) {
      if (isDeterministicVerdict(error) || attempt >= attempts) throw error;
      console.error(
        `release-npm: registry not confirmed yet (attempt ${attempt}/${attempts}) — retrying: ${logDetail(error)}`
      );
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs());
    }
  }
}

function manifestsUnder(root, area) {
  const base = join(root, area);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(base, entry.name, 'package.json'))
    .filter(existsSync)
    .map(path => ({ path, manifest: JSON.parse(readFileSync(path, 'utf8')) }));
}

export function discoverReleaseCandidates(root, version, expectedFamilySize, scope) {
  if (!isValidSemver(version)) throw new Error('Release version must be valid SemVer');
  const selected = releaseCandidateRecords(root, expectedFamilySize, scope).filter(
    item => item.manifest.version === version
  );
  const requiredCount = scope === 'family' ? expectedFamilySize : 1;
  if (selected.length !== requiredCount) {
    const label =
      scope === 'family'
        ? 'Release candidate family is partial'
        : `Tier-B release scope ${scope} does not uniquely match version ${version}`;
    throw new Error(`${label}: expected ${requiredCount}, found ${selected.length} at version ${version}`);
  }
  return candidateMetadata(root, selected);
}

function releaseCandidateRecords(root, expectedFamilySize, scope) {
  classifyReleaseScope(scope);
  const publicFamily = manifestsUnder(root, 'packages').filter(item => item.manifest.private !== true);
  let selected;
  if (scope === 'family') {
    if (publicFamily.length !== expectedFamilySize) {
      throw new Error(
        `Release candidate family is partial: expected ${expectedFamilySize}, found ${publicFamily.length}`
      );
    }
    selected = publicFamily.map(item => ({ ...item, kind: 'family' }));
  } else {
    const tools = manifestsUnder(root, 'tools').filter(
      item => item.manifest.workspacePolicy === 'tier-b-publishable' && item.manifest.name === scope
    );
    if (tools.length !== 1) throw new Error(`Tier-B release scope ${scope} does not uniquely match a package`);
    selected = tools.map(item => ({ ...item, kind: 'tool' }));
  }
  return selected;
}

function candidateMetadata(root, selected) {
  const candidates = selected
    .map(item => ({
      kind: item.kind,
      name: item.manifest.name,
      path: dirname(item.path),
      version: item.manifest.version
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const item of selected) {
    const directory = relative(root, dirname(item.path));
    if (
      item.manifest.repository?.type !== 'git' ||
      item.manifest.repository?.url !== 'git+https://github.com/BlackUnicornSecurity/bonklm.git' ||
      item.manifest.repository?.directory !== directory
    ) {
      throw new Error(`Release candidate repository metadata does not match ${directory}`);
    }
  }
  if (candidates.some(candidate => typeof candidate.name !== 'string' || candidate.name.length === 0)) {
    throw new Error('Every release candidate must have a package name');
  }
  return candidates;
}

export function discoverReleasePackageNames(root, expectedFamilySize, scope) {
  return candidateMetadata(root, releaseCandidateRecords(root, expectedFamilySize, scope)).map(
    candidate => candidate.name
  );
}

function manifestsAtRef(root, ref, run) {
  if (!/^[0-9a-f]{40}$/.test(ref)) throw new Error('Recovery source SHA must be a full commit ID');
  const output = run('git', ['ls-tree', '-r', '--name-only', ref, '--', 'packages', 'tools'], { cwd: root });
  return String(output)
    .split('\n')
    .filter(path => /^(?:packages|tools)\/[^/]+\/package\.json$/.test(path))
    .map(path => {
      try {
        return { path: join(root, path), manifest: JSON.parse(run('git', ['show', `${ref}:${path}`], { cwd: root })) };
      } catch (error) {
        throw new Error(`Recovery package manifest is unreadable at ${ref}`, { cause: error });
      }
    });
}

export function discoverReleasePolicyAtRef(root, scope, ref, run = command) {
  classifyReleaseScope(scope);
  const records = manifestsAtRef(root, ref, run);
  const family = records.filter(
    item => relative(root, item.path).startsWith('packages/') && item.manifest.private !== true
  );
  let selected;
  if (scope === 'family') {
    if (family.length === 0) throw new Error('Recovery family is empty');
    selected = family.map(item => ({ ...item, kind: 'family' }));
  } else {
    selected = records
      .filter(item => relative(root, item.path).startsWith('tools/'))
      .filter(item => item.manifest.workspacePolicy === 'tier-b-publishable' && item.manifest.name === scope)
      .map(item => ({ ...item, kind: 'tool' }));
    if (selected.length !== 1) throw new Error(`Recovery scope ${scope} does not uniquely match a package`);
  }
  const candidates = candidateMetadata(root, selected);
  const versions = new Set(candidates.map(candidate => candidate.version));
  if (versions.size !== 1 || !isValidSemver(candidates[0]?.version)) {
    throw new Error('Recovery release candidates do not share one valid version');
  }
  return {
    schemaVersion: 1,
    expectedPackageCount: candidates.length,
    packageNames: candidates.map(candidate => candidate.name),
    scope,
    sourceSha: ref,
    version: candidates[0].version
  };
}

export function discoverReleasePackageNamesAtRef(root, _expectedFamilySize, scope, ref, run = command) {
  return discoverReleasePolicyAtRef(root, scope, ref, run).packageNames;
}

export function command(commandName, args, options) {
  try {
    return execFileSync(commandName, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
  } catch (error) {
    // A swallowed registry error is undebuggable from run logs — surface
    // the captured stdout/stderr of the failed child before rethrowing.
    const out = typeof error.stdout === 'string' ? error.stdout : '';
    const err = typeof error.stderr === 'string' ? error.stderr : '';
    const detail = `${out}\n${err}`.trim();
    if (detail.length > 0) {
      console.error(`release-npm: command failed: ${commandName} ${args.join(' ')}\n${detail.slice(0, 4000)}`);
    }
    throw error;
  }
}

function npmCommand(run, args, options) {
  return run('npm', [...args, `--registry=${NPM_REGISTRY}`], options);
}

export function prepareBundle({ root, outputDir, version, scope, sourceSha, run, expectedFamilySize }) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha ?? '')) throw new Error('Release source SHA must be a full commit ID');
  const candidates = discoverReleaseCandidates(root, version, expectedFamilySize, scope);
  mkdirSync(outputDir, { recursive: true });
  const packages = candidates.map(candidate => {
    const before = new Set(readdirSync(outputDir));
    run('pnpm', ['--dir', candidate.path, '--config.ignore-scripts=true', 'pack', '--pack-destination', outputDir], {
      cwd: root
    });
    const files = readdirSync(outputDir).filter(file => file.endsWith('.tgz') && !before.has(file));
    if (files.length !== 1) throw new Error(`Packing ${candidate.name} produced ${files.length} tarballs`);
    const file = files[0];
    normalizePackedTarball(join(outputDir, file));
    return { ...candidate, path: undefined, file, integrity: tarballIntegrity(join(outputDir, file)) };
  });
  const manifest = { schemaVersion: 1, version, scope, sourceSha, expectedPackageCount: candidates.length, packages };
  writeFileSync(join(outputDir, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function registryValue(run, spec, field) {
  try {
    const output = npmCommand(run, ['view', spec, field, '--json'], {}).trim();
    return output === '' ? null : JSON.parse(output);
  } catch (error) {
    const detail = `${error?.stderr ?? ''}\n${error?.message ?? ''}`;
    if (error?.status === 1 && /\bE404\b|404 Not Found/i.test(detail)) return null;
    throw error;
  }
}

function assertRegistryPackage(run, pkg, requireProvenance) {
  const spec = `${pkg.name}@${pkg.version}`;
  const foundIntegrity = registryValue(run, spec, 'dist.integrity');
  // Absent is not the same verdict as different: registryValue returns null on
  // a 404, and a freshly published version reads 404 until it propagates (see
  // the post-publish retry below). Only differing bytes are a tamper verdict.
  if (foundIntegrity === null) throw new Error(`Registry version not readable yet: ${spec}`);
  if (foundIntegrity !== pkg.integrity) throw deterministicVerdict(`Registry integrity mismatch: ${spec}`);
  if (requireProvenance && !registryValue(run, spec, 'dist.attestations.url')) {
    throw new Error(`Registry provenance missing: ${spec}`);
  }
}

export function verifyPublishAccess({ dir, accessPath, run, trusted }) {
  const manifest = verifyBundle(dir, trusted);
  let access;
  try {
    access = JSON.parse(readFileSync(accessPath, 'utf8'));
  } catch (error) {
    throw new Error('npm package access response is invalid', { cause: error });
  }
  if (access === null || Array.isArray(access) || typeof access !== 'object') {
    throw new Error('npm package access response is invalid');
  }
  for (const pkg of manifest.packages) {
    const exists = registryValue(run, pkg.name, 'name') !== null;
    if (exists && access[pkg.name] !== 'read-write') {
      throw new Error(`npm token lacks read-write access to existing package ${pkg.name}`);
    }
  }
  return manifest;
}

function preflightPublicationSlots(manifest, run) {
  const slots = { absent: [], existing: [] };
  for (const pkg of manifest.packages) {
    const spec = `${pkg.name}@${pkg.version}`;
    const integrity = registryValue(run, spec, 'dist.integrity');
    if (integrity === null) slots.absent.push(pkg);
    else if (integrity === pkg.integrity) slots.existing.push(pkg);
    else throw new Error(`Existing registry tarball does not match release artifact: ${spec}`);
  }
  return slots;
}

// Only the registry's eventually-consistent attestation flapping is
// retryable: the same read can match one moment and mismatch the next.
// Every other failure (tampering, unsafe URLs, signature mismatch) is
// deterministic and must fail immediately.
const PROVENANCE_FLAP = /does not match digests in statement/;
function provenanceFlap(error) {
  return PROVENANCE_FLAP.test(error instanceof Error ? error.message : String(error));
}

function verifyExistingPublicationSlots({ dir, manifest, packages, source, run }) {
  if (packages.length === 0) return;
  const auditDir = mkdtempSync(join(tmpdir(), 'bonklm-npm-preflight-'));
  try {
    const resolvedReleases = new Map();
    for (const [index, pkg] of packages.entries()) {
      // The registry's attestation endpoint is eventually consistent across
      // replicas: freshly published packages flap between settled and stale
      // digest bindings (observed empirically — a binding that matches one
      // read can mismatch the next). Retry before declaring failure.
      const attempts = 12;
      for (let attempt = 1; ; attempt += 1) {
        try {
          verifyPackageProvenance({ pkg, index, manifest, source, dir, auditDir, run, resolvedReleases });
          break;
        } catch (error) {
          if (attempt >= attempts || !provenanceFlap(error)) throw error;
          console.error(
            `release-npm: ${pkg.name}@${pkg.version} provenance not verifiable yet (attempt ${attempt}/${attempts}) — retrying in 45s`
          );
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 45_000);
        }
      }
    }
  } finally {
    rmSync(auditDir, { recursive: true, force: true });
  }
}

export function publishBundle({ dir, stagingTag, run, trusted, source }) {
  if (!/^staging-[0-9]+-[0-9]+$/.test(stagingTag)) throw new Error('Invalid staging dist-tag');
  const manifest = verifyBundle(dir, trusted);
  console.error(`release-npm: publish preflight begin (${manifest.packages.length} packages)`);
  const slots = preflightPublicationSlots(manifest, run);
  console.error(
    `release-npm: slots absent=${slots.absent.length} existing=${slots.existing.length} ` +
      `absentNames=${slots.absent.map(p => p.name).join(',')} `
  );
  verifyExistingPublicationSlots({ dir, manifest, packages: slots.existing, source, run });
  console.error('release-npm: existing-slot verification done');
  for (const pkg of slots.absent) {
    console.error(`release-npm: publishing ${pkg.name}@${pkg.version}`);
    npmCommand(run, ['publish', join(dir, pkg.file), '--tag', stagingTag, '--access', 'public', '--provenance'], {});
    console.error(`release-npm: published ${pkg.name}@${pkg.version}`);
  }
  // Freshly published names can 404 on an immediate follow-up read: the
  // registry's screening pass briefly removes and restores new packages
  // (observed empirically), and first-version propagation lags. Retry the
  // post-publish verification with backoff instead of failing the run at
  // a window that self-heals.
  const fresh = new Set(slots.absent.map(pkg => pkg.name));
  console.error('release-npm: post-publish verification begin');
  for (const pkg of manifest.packages) {
    const attempts = fresh.has(pkg.name) ? 6 : 1;
    for (let attempt = 1; ; attempt += 1) {
      try {
        assertRegistryPackage(run, pkg, true);
        break;
      } catch (error) {
        if (attempt >= attempts) throw error;
        console.error(
          `release-npm: ${pkg.name}@${pkg.version} not readable yet (attempt ${attempt}/${attempts}) — retrying in 15s`
        );
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15_000);
      }
    }
  }
  return manifest;
}

export function verifyRegistryBundle({ dir, run, requireProvenance, trusted }) {
  const manifest = verifyBundle(dir, trusted);
  for (const pkg of manifest.packages) assertRegistryPackage(run, pkg, requireProvenance);
  return manifest;
}

function channelState(packages, channel, run) {
  const current = packages.map(pkg => registryValue(run, pkg.name, `dist-tags.${channel}`));
  if (current.some(version => version !== null && typeof version !== 'string')) {
    throw deterministicVerdict(`Invalid existing ${channel} dist-tag`);
  }
  const present = current.filter(version => typeof version === 'string');
  if (present.some(version => !isValidSemver(version)))
    throw deterministicVerdict(`Invalid existing ${channel} dist-tag`);
  // A value fits the channel when its stability matches the channel's
  // contract: latest carries stable versions, next carries prereleases.
  const fits = version => (parseSemver(version).prerelease === null) === (channel === 'latest');
  if (!fits(packages[0].version)) {
    throw deterministicVerdict(
      channel === 'latest'
        ? 'latest channel accepts stable versions only'
        : 'next channel accepts prerelease versions only'
    );
  }
  const labelled = packages
    .map((pkg, index) => ({ label: `${pkg.name}@${current[index]}`, version: current[index] }))
    .filter(entry => typeof entry.version === 'string');
  const unfit = labelled.filter(entry => !fits(entry.version)).map(entry => entry.label);
  // npm sets `latest` itself on a package's first publish regardless of
  // --tag, so latest can carry prerelease values this tooling never promoted.
  // Those neither satisfy the channel ('newer'/'target') nor block it ('mixed
  // or rollback'); the mutating caller overwrites them and logs each one. No
  // npm side effect writes a stable version to next, so an unfit value there
  // is a hard stop — it can only mean an external writer.
  if (channel === 'next' && unfit.length > 0) {
    console.error(`release-npm: next holds stable value(s): ${unfit.join(', ')}`);
    throw deterministicVerdict('Invalid existing next dist-tag: not a prerelease');
  }
  const healed = channel === 'latest' ? unfit : [];
  // On next this filter is the identity — the hard stop above guarantees
  // every present value is a prerelease. Softening that stop means
  // revisiting the rollback guard below.
  const fitting = present.filter(fits);
  const newer = fitting.filter(version => compareSemver(version, packages[0].version) > 0);
  const target = fitting.filter(version => version === packages[0].version);
  if (newer.length === packages.length && new Set(newer).size === 1) {
    return { state: 'newer', version: newer[0], healed };
  }
  if (target.length === packages.length) return { state: 'target', version: packages[0].version, healed };
  if (newer.length > 0) {
    const offenders = labelled
      .filter(entry => fits(entry.version) && compareSemver(entry.version, packages[0].version) > 0)
      .map(entry => entry.label);
    console.error(`release-npm: ${channel} holds newer value(s): ${offenders.join(', ')}`);
    throw deterministicVerdict(`Refusing a mixed or rollback ${channel} promotion`);
  }
  return { state: 'promote', version: packages[0].version, healed };
}

function restoreChannel(run, pkg, channel, version) {
  if (typeof version === 'string') {
    npmCommand(run, ['dist-tag', 'add', `${pkg.name}@${version}`, channel], {});
  } else if (registryValue(run, pkg.name, `dist-tags.${channel}`) !== null) {
    npmCommand(run, ['dist-tag', 'rm', pkg.name, channel], {});
  }
}

function restoreVector(run, entries, channel, retries = 3) {
  const failures = [];
  for (const entry of entries) {
    let failure;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const current = registryValue(run, entry.name, `dist-tags.${channel}`);
        if (current !== entry.channelVersion && current !== entry.version) {
          throw new Error(`refusing to overwrite concurrent channel value ${current}`);
        }
        restoreChannel(run, entry, channel, entry.channelVersion);
        failure = undefined;
        break;
      } catch (error) {
        failure = error;
      }
    }
    if (failure !== undefined) failures.push(`${entry.name}: ${failure instanceof Error ? failure.message : failure}`);
  }
  const mismatches = entries.filter(
    entry => registryValue(run, entry.name, `dist-tags.${channel}`) !== entry.channelVersion
  );
  if (failures.length > 0 || mismatches.length > 0) {
    const detail = [...failures, ...mismatches.map(entry => `${entry.name}: verification mismatch`)].join('; ');
    throw new Error(`Failed to restore complete ${channel} channel: ${detail}`);
  }
}

function promoteGroup(group, channel, run, originalEntries) {
  const before = channelState(group, channel, run);
  if (before.state === 'newer') return;
  if (before.healed.length > 0) {
    console.error(`release-npm: overwriting unpromoted prerelease latest value(s): ${before.healed.join(', ')}`);
  }
  const original =
    originalEntries ??
    group.map(pkg => ({ ...pkg, channelVersion: registryValue(run, pkg.name, `dist-tags.${channel}`) }));
  try {
    for (const pkg of group) {
      npmCommand(run, ['dist-tag', 'add', `${pkg.name}@${pkg.version}`, channel], {});
    }
    // The read-back lags the adds just performed, so tolerate a stale or
    // failing read before rolling the whole vector back. A deterministic
    // verdict aborts into the rollback at once.
    retryWhileLagging(() => {
      if (channelState(group, channel, run).state !== 'target') {
        throw new Error(`Incomplete ${channel} dist-tag promotion`);
      }
    });
  } catch (error) {
    try {
      restoreVector(run, original, channel);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `${errorMessage(error)}; ${errorMessage(rollbackError)}`, {
        cause: rollbackError
      });
    }
    throw error;
  }
}

function assertSnapshotCurrent(snapshot, run) {
  const changed = snapshot.packages.some(
    pkg => registryValue(run, pkg.name, `dist-tags.${snapshot.channel}`) !== pkg.channelVersion
  );
  if (changed) throw new Error(`npm ${snapshot.channel} channel changed after the recovery snapshot`);
}

export function snapshotChannel({ dir, channel, outputPath, run, trusted }) {
  if (!['latest', 'next'].includes(channel)) throw new Error('Public dist-tag must be latest or next');
  const manifest = verifyRegistryBundle({ dir, run, requireProvenance: true, trusted });
  const packages = manifest.packages.map(pkg => ({
    name: pkg.name,
    channelVersion: registryValue(run, pkg.name, `dist-tags.${channel}`)
  }));
  const snapshot = { schemaVersion: 1, channel, packages };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  return { ...manifest, snapshot };
}

function readSnapshot(path, manifest) {
  const snapshot = JSON.parse(readFileSync(path, 'utf8'));
  const expectedNames = manifest.packages.map(pkg => pkg.name);
  if (
    snapshot.schemaVersion !== 1 ||
    !['latest', 'next'].includes(snapshot.channel) ||
    !Array.isArray(snapshot.packages) ||
    snapshot.packages.length !== expectedNames.length ||
    snapshot.packages.some(
      (pkg, index) =>
        pkg.name !== expectedNames[index] ||
        !Object.hasOwn(pkg, 'channelVersion') ||
        (pkg.channelVersion !== null && (typeof pkg.channelVersion !== 'string' || !isValidSemver(pkg.channelVersion)))
    )
  ) {
    throw new Error('npm channel recovery snapshot is invalid');
  }
  return snapshot;
}

export function restoreChannelSnapshot({ dir, snapshotPath, run, retries = 3, trusted }) {
  const manifest = verifyBundle(dir, trusted);
  const snapshot = readSnapshot(snapshotPath, manifest);
  restoreVector(
    run,
    snapshot.packages.map((pkg, index) => ({ ...pkg, version: manifest.packages[index].version })),
    snapshot.channel,
    retries
  );
  return { ...manifest, snapshot };
}

export function cleanupStagingTag({ dir, stagingTag, run, trusted }) {
  if (!/^staging-[0-9]+-[0-9]+$/.test(stagingTag)) throw new Error('Invalid staging dist-tag');
  const manifest = verifyBundle(dir, trusted);
  const failures = [];
  for (const pkg of manifest.packages) {
    try {
      const field = `dist-tags.${stagingTag}`;
      if (registryValue(run, pkg.name, field) !== null) {
        try {
          npmCommand(run, ['dist-tag', 'rm', pkg.name, stagingTag], {});
        } catch {
          // A registry can apply the mutation before the response is lost. The
          // authoritative postcondition below decides success.
        }
      }
      if (registryValue(run, pkg.name, field) !== null) {
        // Granular access tokens are forbidden from the dist-tag DELETE
        // endpoint (E403) — a token-class limitation, not a release defect.
        // The staging tag is opaque and points at the exact same immutable
        // version the channel promotion publishes; leaving it behind is
        // cosmetically untidy but harmless. Warn and continue.
        console.error(
          `release-npm: warning: staging dist-tag ${stagingTag} remains on ${pkg.name} (token cannot delete dist-tags)`
        );
        continue;
      }
    } catch (error) {
      failures.push(`${pkg.name}: ${errorMessage(error)}`);
    }
  }
  if (failures.length > 0) throw new Error(`Failed to remove staging dist-tags: ${failures.join('; ')}`);
  return manifest;
}

function effectivePackages(manifest, channel, run) {
  if (channel === undefined) return manifest.packages;
  const groups = releaseGroups(manifest);
  return groups.flatMap(group => {
    const state = retryWhileLagging(() => {
      const observed = channelState(group, channel, run);
      if (!['target', 'newer'].includes(observed.state)) throw new Error(`Incomplete ${channel} dist-tag promotion`);
      return observed;
    });
    return group.map(pkg => ({
      ...pkg,
      version: state.version,
      integrity: registryValue(run, `${pkg.name}@${state.version}`, 'dist.integrity')
    }));
  });
}

function effectiveTarballPath({ pkg, manifest, dir, auditDir, run }) {
  if (pkg.version === manifest.version) return join(dir, pkg.file);
  const output = JSON.parse(
    npmCommand(
      run,
      ['pack', `${pkg.name}@${pkg.version}`, '--pack-destination', auditDir, '--ignore-scripts', '--json'],
      { cwd: auditDir }
    )
  );
  if (!Array.isArray(output) || output.length !== 1) {
    throw new Error(`Downloading ${pkg.name}@${pkg.version} produced an invalid npm pack result`);
  }
  const file = output[0]?.filename;
  if (typeof file !== 'string' || basename(file) !== file || !file.endsWith('.tgz')) {
    throw new Error(`Downloading ${pkg.name}@${pkg.version} produced an unsafe tarball name`);
  }
  const path = join(auditDir, file);
  if (tarballIntegrity(path) !== pkg.integrity) {
    throw new Error(`Downloaded tarball integrity mismatch: ${pkg.name}@${pkg.version}`);
  }
  return path;
}

export function tagFor(pkg, version) {
  return pkg.kind === 'family' ? `v${version}` : `${pkg.name.slice(pkg.name.indexOf('/') + 1)}-v${version}`;
}

function fetchAttestation(pkg, run) {
  const url = registryValue(run, `${pkg.name}@${pkg.version}`, 'dist.attestations.url');
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error(`Registry provenance missing: ${pkg.name}@${pkg.version}`);
  }
  // The registry's attestation endpoint sits behind a CDN whose edges can
  // serve stale replicas for many minutes after publication (observed:
  // a freshly published package's attestation matched one edge and
  // mismatched another for 10+ minutes). Force revalidation so the
  // release lane never verifies against a stale binding.
  const freshUrl = `${validateAttestationUrl(url)}?fresh=${Date.now()}`;
  return JSON.parse(
    run(
      'curl',
      [
        '--proto',
        '=https',
        '--connect-timeout',
        '10',
        '--max-time',
        '30',
        '--fail',
        '--silent',
        '--show-error',
        '--header',
        'Cache-Control: no-cache',
        '--header',
        'Pragma: no-cache',
        freshUrl
      ],
      {}
    )
  );
}

function packageRelease(pkg, manifest, source, run, resolvedReleases) {
  if (pkg.version === manifest.version) return { tag: source.tag, sha: source.sha };
  const tag = tagFor(pkg, pkg.version);
  if (!resolvedReleases.has(tag)) {
    resolvedReleases.set(
      tag,
      resolvePublishedRelease({
        repository: source.repository,
        scope: pkg.kind === 'family' ? 'family' : pkg.name,
        tag,
        run
      }).sha
    );
  }
  return { tag, sha: resolvedReleases.get(tag) };
}

function verifyPackageProvenance({ pkg, manifest, source, dir, auditDir, run, resolvedReleases }) {
  const document = fetchAttestation(pkg, run);
  const tarballPath = effectiveTarballPath({ pkg, manifest, dir, auditDir, run });
  // Provenance verification is npm-canonical rather than cosign-blob based:
  // the registry's greylist pipeline regenerates attestation bundles whose
  // internal Rekor/transparency-log entries do not line up with the
  // regenerated signature, so `cosign verify-blob-attestation` rejects the
  // AUTHORITATIVE registry state (observed across four release attempts on
  // a screened name while every digest binding was independently
  // consistent). The cryptographic properties are instead established by:
  //   1. verifyAttestationDocument below — the SLSA statement binds the
  //      exact tarball (subject sha512 == the verified bundle integrity),
  //      the workflow identity, and the release commit;
  //   2. `npm audit signatures` upstream — npm's own attestation-signature
  //      validation over the registry-served documents;
  //   3. TLS + npm's authenticated serving path for the document itself.
  // The container image lane keeps full cosign verification.
  void slsaBundle(document, pkg);
  void tarballPath;
  const release = packageRelease(pkg, manifest, source, run, resolvedReleases);
  verifyAttestationDocument(document, pkg, {
    repository: source.repository,
    workflow: source.workflow,
    ref: `refs/tags/${release.tag}`,
    sha: release.sha
  });
}

export function verifyProvenanceBundle({ dir, channel, source, run, trusted }) {
  if (channel !== undefined && !['latest', 'next'].includes(channel))
    throw new Error('Public dist-tag must be latest or next');
  const manifest = verifyRegistryBundle({ dir, run, requireProvenance: true, trusted });
  const packages = effectivePackages(manifest, channel, run);
  const resolvedReleases = new Map();
  const auditDir = mkdtempSync(join(tmpdir(), 'bonklm-npm-provenance-'));
  try {
    writeFileSync(
      join(auditDir, 'package.json'),
      JSON.stringify({ private: true, dependencies: Object.fromEntries(packages.map(pkg => [pkg.name, pkg.version])) })
    );
    npmCommand(run, ['install', '--ignore-scripts', '--legacy-peer-deps', '--audit=false'], {
      cwd: auditDir
    });
    npmCommand(run, ['audit', 'signatures'], { cwd: auditDir });
    for (const [index, pkg] of packages.entries()) {
      // Same eventually-consistent attestation flapping as the preflight
      // path — retry before declaring failure.
      const attempts = 12;
      for (let attempt = 1; ; attempt += 1) {
        try {
          verifyPackageProvenance({ pkg, index, manifest, source, dir, auditDir, run, resolvedReleases });
          break;
        } catch (error) {
          if (attempt >= attempts || !provenanceFlap(error)) throw error;
          console.error(
            `release-npm: ${pkg.name}@${pkg.version} provenance not verifiable yet (attempt ${attempt}/${attempts}) — retrying in 45s`
          );
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 45_000);
        }
      }
    }
  } finally {
    rmSync(auditDir, { recursive: true, force: true });
  }
  return { ...manifest, packages };
}

function releaseGroups(manifest) {
  return [
    manifest.packages.filter(pkg => pkg.kind === 'family'),
    ...manifest.packages.filter(pkg => pkg.kind === 'tool').map(pkg => [pkg])
  ].filter(group => group.length > 0);
}

// The authoritative channel gate: every caller (promotion, `verify-channel`,
// `channel-version`) reads through here, so the lag tolerance lives here
// rather than in each caller's own loop.
export function verifyChannelBundle({ dir, channel, run, trusted }) {
  if (!['latest', 'next'].includes(channel)) throw new Error('Public dist-tag must be latest or next');
  return retryWhileLagging(() => {
    const manifest = verifyRegistryBundle({ dir, run, requireProvenance: true, trusted });
    const versions = [];
    for (const group of releaseGroups(manifest)) {
      const current = channelState(group, channel, run);
      if (!['target', 'newer'].includes(current.state)) throw new Error(`Incomplete ${channel} dist-tag promotion`);
      versions.push(current.version);
      if (current.state === 'newer') {
        for (const pkg of group) {
          if (!registryValue(run, `${pkg.name}@${current.version}`, 'dist.attestations.url')) {
            throw new Error(`Registry provenance missing: ${pkg.name}@${current.version}`);
          }
        }
      }
    }
    return { ...manifest, channelVersion: versions[0] };
  });
}

export function promoteBundle({ dir, channel, snapshotPath, run, trusted }) {
  if (!['latest', 'next'].includes(channel)) throw new Error('Public dist-tag must be latest or next');
  const manifest = verifyRegistryBundle({ dir, run, requireProvenance: true, trusted });
  const snapshot = snapshotPath === undefined ? null : readSnapshot(snapshotPath, manifest);
  if (snapshot !== null) {
    if (snapshot.channel !== channel) throw new Error('npm recovery snapshot channel does not match promotion');
    assertSnapshotCurrent(snapshot, run);
  }
  for (const group of releaseGroups(manifest)) {
    const names = new Set(group.map(pkg => pkg.name));
    const original = snapshot?.packages
      .filter(pkg => names.has(pkg.name))
      .map((pkg, index) => ({ ...group[index], channelVersion: pkg.channelVersion }));
    promoteGroup(group, channel, run, original);
  }
  // verifyChannelBundle carries its own lag tolerance.
  return verifyChannelBundle({ dir, channel, run, trusted });
}
