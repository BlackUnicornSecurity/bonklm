import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  cleanupStagingTag,
  prepareBundle,
  promoteBundle,
  publishBundle,
  restoreChannelSnapshot,
  retryDelayMs,
  snapshotChannel,
  verifyChannelBundle,
  verifyPublishAccess,
  verifyRegistryBundle
} from './release-npm.js';
import { attestation, fakePack, fixture, prepared, registryRunner } from './release-npm-test-helpers.js';

const source = {
  repository: 'BlackUnicornSecurity/bonklm',
  workflow: '.github/workflows/publish.yml',
  tag: 'v1.0.1',
  sha: 'a'.repeat(40)
};

function withProvenance(state: ReturnType<typeof registryRunner>) {
  const documents = state.manifest.packages.map(pkg => attestation(pkg));
  return vi.fn((tool: string, args: string[], options: object) => {
    if (tool === 'curl') return JSON.stringify(documents.shift());
    if (tool === 'cosign') return '';
    return state.run(tool, args, options);
  });
}

describe('staged npm publication and promotion', () => {
  it('requires read-write access for every candidate that already exists', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    const [existing, unpublished] = state.manifest.packages;
    state.registry.set(existing.name, { integrity: existing.integrity, provenance: '', tags: {} });
    const accessPath = join(dir, 'npm-access.json');
    writeFileSync(accessPath, JSON.stringify({ [existing.name]: 'read-write' }));

    expect(verifyPublishAccess({ dir, accessPath, run: state.run }).packages).toHaveLength(2);

    state.registry.set(unpublished.name, { integrity: unpublished.integrity, provenance: '', tags: {} });
    expect(() => verifyPublishAccess({ dir, accessPath, run: state.run })).toThrow(
      new RegExp(`read-write access.*${unpublished.name}`)
    );
    writeFileSync(accessPath, JSON.stringify({ [existing.name]: 'read-write', [unpublished.name]: 'read-only' }));
    expect(() => verifyPublishAccess({ dir, accessPath, run: state.run })).toThrow(/read-write access/);
  });

  it('applies the same access preflight to an existing Tier-B package', () => {
    const root = fixture({ toolVersion: '0.4.1' });
    const dir = join(root, 'tool-access-bundle');
    prepareBundle({
      root,
      outputDir: dir,
      version: '0.4.1',
      scope: '@blackunicorn/eslint',
      sourceSha: 'a'.repeat(40),
      expectedFamilySize: 2,
      run: fakePack
    });
    const state = registryRunner(dir);
    const tool = state.manifest.packages[0];
    state.registry.set(tool.name, { integrity: tool.integrity, provenance: '', tags: {} });
    const accessPath = join(dir, 'npm-access.json');
    writeFileSync(accessPath, '{}');

    expect(() => verifyPublishAccess({ dir, accessPath, run: state.run })).toThrow(
      new RegExp(`read-write access.*${tool.name}`)
    );
  });

  it.each(['not-json', 'null', '[]', '"invalid"'])('rejects malformed npm access data %j', value => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    const accessPath = join(dir, 'npm-access.json');
    writeFileSync(accessPath, value);

    expect(() => verifyPublishAccess({ dir, accessPath, run: state.run })).toThrow(/access response is invalid/);
  });

  it('pins every registry operation to npmjs.org', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);

    publishBundle({ dir, stagingTag: 'staging-123-1', run: state.run });

    expect(state.calls.filter(call => call[0] === 'npm')).not.toHaveLength(0);
    expect(
      state.calls
        .filter(call => call[0] === 'npm')
        .every(call => call.includes('--registry=https://registry.npmjs.org'))
    ).toBe(true);
  });

  it('publishes exact tarballs under staging and verifies provenance', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    expect(publishBundle({ dir, stagingTag: 'staging-123-1', run: state.run }).packages).toHaveLength(2);
    expect(verifyRegistryBundle({ dir, run: state.run, requireProvenance: true }).packages).toHaveLength(2);
    expect(state.calls.filter(call => call[1] === 'publish')).toHaveLength(2);
  });

  it('is retry-safe for matching bytes and rejects mismatched existing bytes', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-123-1', run: state.run });
    publishBundle({ dir, stagingTag: 'staging-123-2', run: withProvenance(state), source });
    expect(state.calls.filter(call => call[1] === 'publish')).toHaveLength(2);
    const pkg = state.manifest.packages[0];
    state.registry.get(`${pkg.name}@${pkg.version}`)!.integrity = 'sha512-wrong';
    expect(() => publishBundle({ dir, stagingTag: 'staging-123-3', run: state.run })).toThrow(/does not match/);
    expect(() => publishBundle({ dir, stagingTag: 'latest', run: state.run })).toThrow(/staging dist-tag/);
  });

  it('preflights every immutable slot before publishing any absent package', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    const conflicting = state.manifest.packages[1];
    state.registry.set(`${conflicting.name}@${conflicting.version}`, {
      integrity: 'sha512-conflict',
      provenance: 'https://registry.npmjs.org/-/npm/v1/attestations/example',
      tags: {}
    });

    expect(() => publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run, source })).toThrow(/does not match/);
    expect(state.calls.filter(call => call[1] === 'publish')).toHaveLength(0);
  });

  it('verifies existing provenance before publishing any absent package', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    const existing = state.manifest.packages[1];
    state.registry.set(`${existing.name}@${existing.version}`, {
      integrity: existing.integrity,
      provenance: '',
      tags: {}
    });

    expect(() => publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run, source })).toThrow(
      /provenance missing/
    );
    state.registry.get(`${existing.name}@${existing.version}`)!.provenance =
      'https://registry.npmjs.org/-/npm/v1/attestations/example';
    const wrongSource = vi.fn((tool: string, args: string[], options: object) => {
      if (tool === 'curl') {
        return JSON.stringify(attestation(existing, { ...source, ref: 'refs/tags/v1.0.1', sha: 'b'.repeat(40) }));
      }
      if (tool === 'cosign') return '';
      return state.run(tool, args, options);
    });
    expect(() => publishBundle({ dir, stagingTag: 'staging-1-2', run: wrongSource, source })).toThrow(
      /provenance identity mismatch/
    );
    expect(state.calls.filter(call => call[1] === 'publish')).toHaveLength(0);
  });

  it('treats empty registry output as absent and propagates registry failures', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    let emptyOnce = true;
    const empty = vi.fn((cmd: string, args: string[], options: object) => {
      if (args[0] === 'view' && emptyOnce) {
        emptyOnce = false;
        return '';
      }
      return state.run(cmd, args, options);
    });
    publishBundle({ dir, stagingTag: 'staging-1-1', run: empty });
    const failure = Object.assign(new Error('registry unavailable'), { status: 2 });
    expect(() =>
      publishBundle({
        dir,
        stagingTag: 'staging-1-2',
        run: () => {
          throw failure;
        }
      })
    ).toThrow(failure);
    const statusOneFailure = Object.assign(new Error('authentication failed'), {
      status: 1,
      stderr: 'npm error code E401'
    });
    expect(() =>
      publishBundle({
        dir,
        stagingTag: 'staging-1-3',
        run: () => {
          throw statusOneFailure;
        }
      })
    ).toThrow(statusOneFailure);
    const freshState = registryRunner(dir);
    let bareMissingOnce = true;
    const bareMissing = vi.fn((command: string, args: string[], options: object) => {
      if (args[0] === 'view' && bareMissingOnce) {
        bareMissingOnce = false;
        throw { status: 1, stderr: 'npm error code E404' };
      }
      return freshState.run(command, args, options);
    });
    expect(() => publishBundle({ dir, stagingTag: 'staging-1-4', run: bareMissing })).not.toThrow();
  });

  it('does not move public tags after a mid-family publish failure', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    let publishCount = 0;
    const failing = vi.fn((command: string, args: string[]) => {
      if (args[0] === 'publish' && ++publishCount === 2) throw new Error('registry failed');
      return state.run(command, args);
    });
    expect(() => publishBundle({ dir, stagingTag: 'staging-1-1', run: failing })).toThrow('registry failed');
    expect(state.calls.some(call => call[1] === 'dist-tag')).toBe(false);
  });

  it('promotes only after registry integrity/provenance verification', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    expect(promoteBundle({ dir, channel: 'latest', run: state.run }).channelVersion).toBe('1.0.1');
    expect(state.calls.filter(call => call[1] === 'dist-tag')).toHaveLength(2);
    expect(() => promoteBundle({ dir, channel: 'beta', run: state.run })).toThrow(/dist-tag/);
  });

  it('publishes and promotes a Tier-B-only release', () => {
    const root = fixture();
    const dir = join(root, 'tool-bundle');
    prepareBundle({
      root,
      outputDir: dir,
      version: '0.4.0',
      scope: '@blackunicorn/eslint',
      sourceSha: 'a'.repeat(40),
      expectedFamilySize: 2,
      run: fakePack
    });
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-2-1', run: state.run });
    expect(promoteBundle({ dir, channel: 'latest', run: state.run }).channelVersion).toBe('0.4.0');
    expect(state.manifest.packages.map(pkg => pkg.kind)).toEqual(['tool']);
    expect(state.calls.filter(call => call[1] === 'dist-tag')).toHaveLength(1);
  });

  it('never rolls a family channel backward and fails mixed rollback state', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    for (const pkg of state.manifest.packages)
      state.registry.set(pkg.name, { ...state.registry.get(`${pkg.name}@${pkg.version}`)!, tags: { latest: '1.0.2' } });
    promoteBundle({ dir, channel: 'latest', run: state.run });
    expect(state.calls.filter(call => call[1] === 'dist-tag')).toHaveLength(0);
    state.registry.delete(state.manifest.packages[0].name);
    expect(() => promoteBundle({ dir, channel: 'latest', run: state.run })).toThrow(/rollback/);
    state.registry.set(state.manifest.packages[0].name, {
      ...state.registry.get(`${state.manifest.packages[0].name}@1.0.1`)!,
      tags: { latest: '1.0.2' }
    });
    state.registry.get(state.manifest.packages[0].name)!.tags.latest = '1.0.0';
    expect(() => promoteBundle({ dir, channel: 'latest', run: state.run })).toThrow(/rollback/);
  });

  it('rejects a family channel split across different newer versions', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    state.registry.set(state.manifest.packages[0].name, {
      ...state.registry.get(`${state.manifest.packages[0].name}@1.0.1`)!,
      tags: { latest: '1.0.2' }
    });
    state.registry.set(state.manifest.packages[1].name, {
      ...state.registry.get(`${state.manifest.packages[1].name}@1.0.1`)!,
      tags: { latest: '1.0.3' }
    });
    expect(() => promoteBundle({ dir, channel: 'latest', run: state.run })).toThrow(/mixed/);
  });

  it('rejects a stable or prerelease promotion target on the wrong public channel', () => {
    const prerelease = prepared({ familyVersion: '1.0.1-preview.1' });
    const prereleaseState = registryRunner(prerelease.dir);
    publishBundle({ dir: prerelease.dir, stagingTag: 'staging-1-2', run: prereleaseState.run });
    expect(() => promoteBundle({ dir: prerelease.dir, channel: 'latest', run: prereleaseState.run })).toThrow(
      /accepts stable versions only/
    );

    const stable = prepared();
    const stableState = registryRunner(stable.dir);
    publishBundle({ dir: stable.dir, stagingTag: 'staging-1-1', run: stableState.run });
    expect(() => promoteBundle({ dir: stable.dir, channel: 'next', run: stableState.run })).toThrow(
      /accepts prerelease versions only/
    );
  });

  it('heals channel values that do not fit the channel instead of bricking promotion', () => {
    // npm sets `latest` itself on a package's first publish even under
    // --tag, so a family can carry prerelease latest values it never
    // promoted. Those must not block a stable promotion, must not count
    // as a newer promoted release, and must be overwritten by the adds.
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    const [first, second] = state.manifest.packages;
    state.registry.set(first.name, {
      ...state.registry.get(`${first.name}@${first.version}`)!,
      tags: { latest: '1.0.5-probe.0' }
    });
    state.registry.set(second.name, {
      ...state.registry.get(`${second.name}@${second.version}`)!,
      tags: { latest: '1.0.0' }
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(promoteBundle({ dir, channel: 'latest', run: state.run }).channelVersion).toBe('1.0.1');
    expect(state.registry.get(first.name)?.tags.latest).toBe('1.0.1');
    expect(state.registry.get(second.name)?.tags.latest).toBe('1.0.1');
    // The overwrite is logged exactly once, by the mutating caller.
    const healLines = errors.mock.calls.flat().filter(line => String(line).includes('overwriting unpromoted'));
    expect(healLines).toEqual([
      `release-npm: overwriting unpromoted prerelease latest value(s): ${first.name}@1.0.5-probe.0`
    ]);
    errors.mockRestore();

    // Even when every existing value is unfit garbage newer than the
    // target, the promotion proceeds rather than skipping as 'newer'.
    for (const pkg of state.manifest.packages) {
      state.registry.set(pkg.name, {
        ...state.registry.get(`${pkg.name}@${pkg.version}`)!,
        tags: { latest: '1.1.0-probe.0' }
      });
    }
    expect(promoteBundle({ dir, channel: 'latest', run: state.run }).channelVersion).toBe('1.0.1');
    expect(state.manifest.packages.every(pkg => state.registry.get(pkg.name)?.tags.latest === '1.0.1')).toBe(true);

    // An unfit value must not unlock a rollback either: a channel-fitting
    // newer value elsewhere in the family still refuses the promotion.
    state.registry.set(first.name, {
      ...state.registry.get(`${first.name}@${first.version}`)!,
      tags: { latest: '2.0.0-evil.1' }
    });
    state.registry.set(second.name, {
      ...state.registry.get(`${second.name}@${second.version}`)!,
      tags: { latest: '1.0.2' }
    });
    const refusalErrors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => promoteBundle({ dir, channel: 'latest', run: state.run })).toThrow(/mixed or rollback/);
    expect(state.registry.get(second.name)?.tags.latest).toBe('1.0.2');
    // The refusal names the fitting newer offender and claims no overwrite.
    const refusalLines = refusalErrors.mock.calls.flat().map(String);
    expect(refusalLines.some(line => line.includes(`latest holds newer value(s): ${second.name}@1.0.2`))).toBe(true);
    expect(refusalLines.some(line => line.includes('overwriting unpromoted'))).toBe(false);
    refusalErrors.mockRestore();
  });

  it('retries a lagging or transiently failing post-add read-back instead of rolling back', () => {
    const lagging = prepared();
    const laggingState = registryRunner(lagging.dir);
    publishBundle({ dir: lagging.dir, stagingTag: 'staging-1-1', run: laggingState.run });
    let addsSeen = 0;
    let staleReads = 0;
    const lagsThenConverges = vi.fn((command: string, args: string[]) => {
      if (args[0] === 'dist-tag' && args[1] === 'add') addsSeen += 1;
      if (addsSeen === 2 && args[0] === 'view' && args[2] === 'dist-tags.latest' && staleReads < 2) {
        staleReads += 1;
        return JSON.stringify(null);
      }
      return laggingState.run(command, args);
    });
    expect(promoteBundle({ dir: lagging.dir, channel: 'latest', run: lagsThenConverges }).channelVersion).toBe('1.0.1');
    expect(staleReads).toBe(2);
    expect(
      laggingState.manifest.packages.every(pkg => laggingState.registry.get(pkg.name)?.tags.latest === '1.0.1')
    ).toBe(true);

    const flaky = prepared();
    const flakyState = registryRunner(flaky.dir);
    publishBundle({ dir: flaky.dir, stagingTag: 'staging-1-2', run: flakyState.run });
    let flakyAdds = 0;
    let thrown = false;
    const throwsOnce = vi.fn((command: string, args: string[]) => {
      if (args[0] === 'dist-tag' && args[1] === 'add') flakyAdds += 1;
      if (flakyAdds === 2 && !thrown && args[0] === 'view' && args[2] === 'dist-tags.latest') {
        thrown = true;
        throw { status: 2, stderr: 'registry rate limited' };
      }
      return flakyState.run(command, args);
    });
    expect(promoteBundle({ dir: flaky.dir, channel: 'latest', run: throwsOnce }).channelVersion).toBe('1.0.1');
    expect(thrown).toBe(true);
  });

  it('exhausts read-back retries on persistent failures and aborts fast on a channel refusal', () => {
    const exhausted = prepared();
    const exhaustedState = registryRunner(exhausted.dir);
    publishBundle({ dir: exhausted.dir, stagingTag: 'staging-1-1', run: exhaustedState.run });
    let exhaustedAdds = 0;
    let exhaustedReads = 0;
    const alwaysThrows = vi.fn((command: string, args: string[]) => {
      if (args[0] === 'dist-tag' && args[1] === 'add') exhaustedAdds += 1;
      if (exhaustedAdds === 2 && args[0] === 'view' && args[2] === 'dist-tags.latest' && exhaustedReads < 12) {
        exhaustedReads += 1;
        throw Object.assign(new Error('registry unavailable'), { status: 2 });
      }
      return exhaustedState.run(command, args);
    });
    expect(() => promoteBundle({ dir: exhausted.dir, channel: 'latest', run: alwaysThrows })).toThrow(
      /registry unavailable/
    );
    expect(exhaustedReads).toBe(12);
    // The rollback ran after the retry budget was exhausted.
    expect(
      exhaustedState.manifest.packages.every(pkg => exhaustedState.registry.get(pkg.name)?.tags.latest === undefined)
    ).toBe(true);

    // A concurrent fitting-newer write mid-read-back is a refusal: it must
    // abort into the rollback on the first read, not burn the retry budget.
    const raced = prepared();
    const racedState = registryRunner(raced.dir);
    publishBundle({ dir: raced.dir, stagingTag: 'staging-1-2', run: racedState.run });
    const [racedFirst] = racedState.manifest.packages;
    let racedAdds = 0;
    let postAddReads = 0;
    const concurrentNewer = vi.fn((command: string, args: string[]) => {
      if (args[0] === 'dist-tag' && args[1] === 'add' && ++racedAdds === 2) {
        const result = racedState.run(command, args);
        racedState.registry.set(racedFirst.name, {
          ...racedState.registry.get(`${racedFirst.name}@${racedFirst.version}`)!,
          tags: { latest: '1.0.2' }
        });
        return result;
      }
      if (racedAdds >= 2 && args[0] === 'view' && args[2] === 'dist-tags.latest') postAddReads += 1;
      return racedState.run(command, args);
    });
    expect(() => promoteBundle({ dir: raced.dir, channel: 'latest', run: concurrentNewer })).toThrow(
      /mixed or rollback/
    );
    // One read-back round (2 packages) plus rollback reads. A retried refusal
    // would burn 24 read-back reads alone, so this discriminates with margin.
    expect(postAddReads).toBeLessThan(24);
  });

  it('aborts the post-promotion channel verification on a refusal instead of retrying it', () => {
    // An external writer moving the channel after the adds land is
    // deterministic: the final verification must fail fast, not sleep
    // through the whole budget re-deriving the same verdict.
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    const [first] = state.manifest.packages;
    let adds = 0;
    let latestReads = 0;
    let tampered = false;
    const tampersAfterReadBack = vi.fn((command: string, args: string[]) => {
      if (args[0] === 'dist-tag' && args[1] === 'add') adds += 1;
      const result = state.run(command, args);
      if (adds >= 2 && args[0] === 'view' && args[2] === 'dist-tags.latest') {
        latestReads += 1;
        // Let promoteGroup's read-back confirm 'target' first, then tamper.
        if (latestReads === state.manifest.packages.length && !tampered) {
          tampered = true;
          state.registry.set(first.name, {
            ...state.registry.get(`${first.name}@${first.version}`)!,
            tags: { latest: '1.0.2' }
          });
        }
      }
      return result;
    });
    expect(() => promoteBundle({ dir, channel: 'latest', run: tampersAfterReadBack })).toThrow(/mixed or rollback/);
    expect(tampered).toBe(true);
    // The verification loop reads the channel once and gives up; retrying the
    // refusal would cost 12 rounds of 2 reads on top of the read-back.
    expect(latestReads).toBeLessThan(12);
    // Deliberately NOT rolled back: our adds landed and an external writer
    // holds the other value, so the channel stays split and the failure
    // escalates to a human. Rolling back here would only produce a
    // differently-split channel.
    expect(state.registry.get(first.name)?.tags.latest).toBe('1.0.2');
    expect(state.registry.get(state.manifest.packages[1].name)?.tags.latest).toBe('1.0.1');
  });

  it('retries a version that has not propagated yet instead of calling it a tamper', () => {
    // registryValue returns null on a 404 and a freshly published version
    // reads 404 until it propagates. Absent must not present as an integrity
    // mismatch, which is marked deterministic and would abort at once.
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    let adds = 0;
    let absentReads = 0;
    const notPropagatedYet = vi.fn((command: string, args: string[]) => {
      if (args[0] === 'dist-tag' && args[1] === 'add') adds += 1;
      if (adds >= 2 && args[0] === 'view' && args[2] === 'dist.integrity' && absentReads === 0) {
        absentReads += 1;
        throw { status: 1, stderr: 'npm error code E404' };
      }
      return state.run(command, args);
    });
    expect(promoteBundle({ dir, channel: 'latest', run: notPropagatedYet }).channelVersion).toBe('1.0.1');
    expect(absentReads).toBe(1);
    expect(state.manifest.packages.every(pkg => state.registry.get(pkg.name)?.tags.latest === '1.0.1')).toBe(true);
  });

  it('retries the post-promotion channel verification over a transient read failure', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    let adds = 0;
    let transients = 0;
    const failsVerifyOnce = vi.fn((command: string, args: string[]) => {
      if (args[0] === 'dist-tag' && args[1] === 'add') adds += 1;
      if (adds >= 2 && args[0] === 'view' && args[2] === 'dist.integrity' && transients === 0) {
        transients += 1;
        throw Object.assign(new Error('registry unavailable'), { status: 2 });
      }
      return state.run(command, args);
    });
    expect(promoteBundle({ dir, channel: 'latest', run: failsVerifyOnce }).channelVersion).toBe('1.0.1');
    expect(transients).toBe(1);
    expect(state.manifest.packages.every(pkg => state.registry.get(pkg.name)?.tags.latest === '1.0.1')).toBe(true);
  });

  it('clamps and validates the retry delay override', () => {
    const saved = process.env.BONKLM_RELEASE_RETRY_DELAY_MS;
    try {
      delete process.env.BONKLM_RELEASE_RETRY_DELAY_MS;
      expect(retryDelayMs()).toBe(45_000);
      for (const malformed of ['', ' ', '1e3', '0x10', '-1', '12.5']) {
        process.env.BONKLM_RELEASE_RETRY_DELAY_MS = malformed;
        expect(retryDelayMs()).toBe(45_000);
      }
      process.env.BONKLM_RELEASE_RETRY_DELAY_MS = '999999999';
      expect(retryDelayMs()).toBe(120_000);
      process.env.BONKLM_RELEASE_RETRY_DELAY_MS = '250';
      expect(retryDelayMs()).toBe(250);
    } finally {
      // A raw env assignment is outside vi.unstubAllEnvs()'s reach, and
      // leaving it dirty would make a later suite sleep for real minutes.
      if (saved === undefined) delete process.env.BONKLM_RELEASE_RETRY_DELAY_MS;
      else process.env.BONKLM_RELEASE_RETRY_DELAY_MS = saved;
    }
    expect(retryDelayMs()).toBe(0);
  });

  it('keeps a stable next value a hard stop and heals only across fitting prereleases', () => {
    // No npm side effect writes a stable version to next, so an unfit value
    // there signals an external writer and must stay fail-closed.
    const prerelease = prepared({ familyVersion: '1.0.1-preview.1' });
    const state = registryRunner(prerelease.dir);
    publishBundle({ dir: prerelease.dir, stagingTag: 'staging-1-3', run: state.run });
    const [first, second] = state.manifest.packages;
    state.registry.set(first.name, {
      ...state.registry.get(`${first.name}@${first.version}`)!,
      tags: { next: '1.1.0' }
    });
    expect(() => promoteBundle({ dir: prerelease.dir, channel: 'next', run: state.run })).toThrow(
      /Invalid existing next dist-tag/
    );
    expect(state.registry.get(first.name)?.tags.next).toBe('1.1.0');

    // A fitting newer prerelease still refuses as a rollback on next.
    state.registry.set(first.name, {
      ...state.registry.get(`${first.name}@${first.version}`)!,
      tags: { next: '1.1.0-preview.1' }
    });
    expect(() => promoteBundle({ dir: prerelease.dir, channel: 'next', run: state.run })).toThrow(/mixed or rollback/);

    state.registry.set(first.name, {
      ...state.registry.get(`${first.name}@${first.version}`)!,
      tags: { next: '1.0.0-preview.9' }
    });
    expect(promoteBundle({ dir: prerelease.dir, channel: 'next', run: state.run }).channelVersion).toBe(
      '1.0.1-preview.1'
    );
    expect(state.registry.get(first.name)?.tags.next).toBe('1.0.1-preview.1');
    expect(state.registry.get(second.name)?.tags.next).toBe('1.0.1-preview.1');
  });

  it('fails when a registry ignores a channel update and verifies complete channels', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    const ignoresDistTag = vi.fn((command: string, args: string[]) => {
      if (args[0] === 'dist-tag') return '';
      return state.run(command, args);
    });
    expect(() => promoteBundle({ dir, channel: 'latest', run: ignoresDistTag })).toThrow(/Incomplete/);
    expect(state.manifest.packages.every(pkg => state.registry.get(pkg.name)?.tags.latest === undefined)).toBe(true);
    expect(() => verifyChannelBundle({ dir, channel: 'latest', run: state.run })).toThrow(/Incomplete/);
    expect(() => verifyChannelBundle({ dir, channel: 'beta', run: state.run })).toThrow(/dist-tag/);
  });

  it('rolls back every channel move when a mid-family promotion fails', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    state.registry.set(state.manifest.packages[0].name, {
      ...state.registry.get(`${state.manifest.packages[0].name}@1.0.1`)!,
      tags: { latest: '1.0.0' }
    });
    let addCount = 0;
    const failsSecondAdd = vi.fn((command: string, args: string[]) => {
      if (args[0] === 'dist-tag' && args[1] === 'add' && ++addCount === 2) throw new Error('promotion failed');
      return state.run(command, args);
    });
    expect(() => promoteBundle({ dir, channel: 'latest', run: failsSecondAdd })).toThrow('promotion failed');
    expect(state.registry.get(state.manifest.packages[0].name)?.tags.latest).toBe('1.0.0');
    expect(state.registry.get(state.manifest.packages[1].name)?.tags.latest).toBeUndefined();
  });

  it('restores the whole vector when the failing registry call mutates before disconnecting', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    let addCount = 0;
    const mutatesThenDisconnects = vi.fn((command: string, args: string[]) => {
      const result = state.run(command, args);
      if (args[0] === 'dist-tag' && args[1] === 'add' && ++addCount === 2) throw new Error('connection lost');
      return result;
    });
    expect(() => promoteBundle({ dir, channel: 'latest', run: mutatesThenDisconnects })).toThrow(/connection lost/);
    expect(state.manifest.packages.every(pkg => state.registry.get(pkg.name)?.tags.latest === undefined)).toBe(true);
  });

  it('reports both the promotion failure and an exhausted verified rollback', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    state.registry.set(state.manifest.packages[0].name, {
      ...state.registry.get(`${state.manifest.packages[0].name}@1.0.1`)!,
      tags: { latest: '1.0.0' }
    });
    let targetAdds = 0;
    const failsPromotionAndRollback = vi.fn((command: string, args: string[]) => {
      if (args[0] === 'dist-tag' && args[1] === 'add') {
        if (args[2].endsWith('@1.0.1') && ++targetAdds === 2) throw 'promotion failed';
        if (args[2].endsWith('@1.0.0')) throw 'rollback failed';
      }
      return state.run(command, args);
    });
    expect(() => promoteBundle({ dir, channel: 'latest', run: failsPromotionAndRollback })).toThrow(
      /promotion failed; Failed to restore complete latest channel/
    );
  });

  it('refuses to overwrite an unrelated channel update during rollback', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    let addCount = 0;
    const concurrentUpdate = vi.fn((command: string, args: string[]) => {
      if (args[0] === 'dist-tag' && args[1] === 'add' && ++addCount === 2) {
        const second = state.manifest.packages[1];
        state.registry.set(second.name, {
          ...state.registry.get(`${second.name}@${second.version}`)!,
          tags: { latest: '1.1.0' }
        });
        throw new Error('promotion failed');
      }
      return state.run(command, args);
    });
    expect(() => promoteBundle({ dir, channel: 'latest', run: concurrentUpdate })).toThrow(/concurrent channel/);
    expect(state.registry.get(state.manifest.packages[1].name)?.tags.latest).toBe('1.1.0');
  });

  it('persists and restores a complete channel recovery vector', () => {
    const { root, dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    state.registry.set(state.manifest.packages[0].name, {
      ...state.registry.get(`${state.manifest.packages[0].name}@1.0.1`)!,
      tags: { latest: '1.0.0' }
    });
    const snapshotPath = join(root, 'recovery', 'npm.json');
    expect(
      snapshotChannel({ dir, channel: 'latest', outputPath: snapshotPath, run: state.run }).snapshot.packages
    ).toEqual([
      { name: '@blackunicorn/a', channelVersion: '1.0.0' },
      { name: '@blackunicorn/b', channelVersion: null }
    ]);
    promoteBundle({ dir, channel: 'latest', run: state.run });
    restoreChannelSnapshot({ dir, snapshotPath, run: state.run });
    expect(state.registry.get('@blackunicorn/a')?.tags.latest).toBe('1.0.0');
    expect(state.registry.get('@blackunicorn/b')?.tags.latest).toBeUndefined();
  });

  it('refuses promotion when the retained channel snapshot changed before the first mutation', () => {
    const { root, dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    const snapshotPath = join(root, 'npm-recovery.json');
    snapshotChannel({ dir, channel: 'latest', outputPath: snapshotPath, run: state.run });
    expect(() => promoteBundle({ dir, channel: 'next', snapshotPath, run: state.run })).toThrow(
      /snapshot channel does not match/
    );
    state.registry.set(state.manifest.packages[0].name, {
      ...state.registry.get(`${state.manifest.packages[0].name}@1.0.1`)!,
      tags: { latest: '1.1.0' }
    });

    expect(() => promoteBundle({ dir, channel: 'latest', snapshotPath, run: state.run })).toThrow(
      /changed after the recovery snapshot/
    );
    expect(state.registry.get(state.manifest.packages[1].name)?.tags.latest).toBeUndefined();
  });

  it('fails closed on invalid snapshot channels and every malformed recovery field', () => {
    const { root, dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    expect(() => snapshotChannel({ dir, channel: 'beta', outputPath: join(root, 'bad.json'), run: state.run })).toThrow(
      /Public dist-tag/
    );
    const snapshotPath = join(root, 'snapshot.json');
    type Recovery = {
      schemaVersion: number;
      channel: string;
      packages: Array<{ name: string; channelVersion: unknown }> | null;
    };
    const mutations: Array<(value: Recovery) => unknown> = [
      value => (value.schemaVersion = 2),
      value => (value.channel = 'beta'),
      value => (value.packages = null),
      value => value.packages!.pop(),
      value => (value.packages![0].name = 'wrong'),
      value => delete (value.packages![0] as { channelVersion?: unknown }).channelVersion,
      value => (value.packages![0].channelVersion = 42),
      value => (value.packages![0].channelVersion = 'latest')
    ];
    for (const mutate of mutations) {
      snapshotChannel({ dir, channel: 'latest', outputPath: snapshotPath, run: state.run });
      const value = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Recovery;
      mutate(value);
      writeFileSync(snapshotPath, JSON.stringify(value));
      expect(() => restoreChannelSnapshot({ dir, snapshotPath, run: state.run })).toThrow(/snapshot is invalid/);
    }
  });

  it('attempts every rollback with retries and fails if the original vector is not restored', () => {
    const { root, dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    const snapshotPath = join(root, 'npm-recovery.json');
    snapshotChannel({ dir, channel: 'latest', outputPath: snapshotPath, run: state.run });
    promoteBundle({ dir, channel: 'latest', run: state.run });
    const attempts = new Map<string, number>();
    const alwaysFails = vi.fn((command: string, args: string[]) => {
      if (args[0] === 'dist-tag') {
        const name = args[2];
        attempts.set(name, (attempts.get(name) ?? 0) + 1);
        throw new Error('restore unavailable');
      }
      return state.run(command, args);
    });
    expect(() => restoreChannelSnapshot({ dir, snapshotPath, run: alwaysFails, retries: 2 })).toThrow(
      /Failed to restore complete/
    );
    expect([...attempts.values()]).toEqual([2, 2]);
  });

  it('removes opaque staging tags and aggregates non-404 cleanup failures', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    for (const pkg of state.manifest.packages) {
      state.registry.set(pkg.name, {
        ...state.registry.get(`${pkg.name}@${pkg.version}`)!,
        tags: { 'staging-1-1': pkg.version }
      });
    }
    expect(cleanupStagingTag({ dir, stagingTag: 'staging-1-1', run: state.run }).packages).toHaveLength(2);
    expect(state.manifest.packages.every(pkg => state.registry.get(pkg.name)?.tags['staging-1-1'] === undefined)).toBe(
      true
    );
    expect(() => cleanupStagingTag({ dir, stagingTag: 'latest', run: state.run })).toThrow(/Invalid staging/);
    const denied = Object.assign(new Error('denied'), { status: 1, stderr: 'npm error code E401' });
    expect(() =>
      cleanupStagingTag({
        dir,
        stagingTag: 'staging-1-2',
        run: () => {
          throw denied;
        }
      })
    ).toThrow(/Failed to remove/);
    expect(() =>
      cleanupStagingTag({
        dir,
        stagingTag: 'staging-1-2',
        run: state.run
      })
    ).not.toThrow();
    expect(() =>
      cleanupStagingTag({
        dir,
        stagingTag: 'staging-1-2',
        run: () => {
          throw 'plain cleanup failure';
        }
      })
    ).toThrow(/plain cleanup failure/);
  });

  it('queries before removing absent tags and verifies absence after a remove response failure', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    expect(() => cleanupStagingTag({ dir, stagingTag: 'staging-9-9', run: state.run })).not.toThrow();
    expect(state.calls.some(call => call[1] === 'dist-tag' && call[2] === 'rm')).toBe(false);

    const pkg = state.manifest.packages[0];
    state.registry.set(pkg.name, {
      ...state.registry.get(`${pkg.name}@${pkg.version}`)!,
      tags: { 'staging-1-1': pkg.version }
    });
    const mutatesThenErrors = vi.fn((command: string, args: string[]) => {
      const result = state.run(command, args);
      if (args[0] === 'dist-tag' && args[1] === 'rm') {
        throw Object.assign(new Error('is not a dist-tag on package'), { status: 1 });
      }
      return result;
    });
    expect(() => cleanupStagingTag({ dir, stagingTag: 'staging-1-1', run: mutatesThenErrors })).not.toThrow();

    state.registry.set(pkg.name, {
      ...state.registry.get(`${pkg.name}@${pkg.version}`)!,
      tags: { 'staging-1-1': pkg.version }
    });
    const ignored = vi.fn((command: string, args: string[]) => {
      if (args[0] === 'dist-tag' && args[1] === 'rm') return '';
      return state.run(command, args);
    });
    // A tag that remains after a failed remove is a warning, not a failure:
    // granular tokens cannot call the dist-tag DELETE endpoint at all.
    expect(() => cleanupStagingTag({ dir, stagingTag: 'staging-1-1', run: ignored })).not.toThrow();
  });

  it('rejects missing integrity, provenance, and invalid existing channel versions', () => {
    const { dir } = prepared();
    const state = registryRunner(dir);
    publishBundle({ dir, stagingTag: 'staging-1-1', run: state.run });
    const pkg = state.manifest.packages[0];
    state.registry.get(`${pkg.name}@${pkg.version}`)!.provenance = '';
    expect(() => verifyRegistryBundle({ dir, run: state.run, requireProvenance: true })).toThrow(/provenance missing/);
    expect(() => verifyRegistryBundle({ dir, run: state.run, requireProvenance: false })).not.toThrow();
    state.registry.get(`${pkg.name}@${pkg.version}`)!.integrity = 'wrong';
    expect(() => verifyRegistryBundle({ dir, run: state.run, requireProvenance: false })).toThrow(/integrity mismatch/);
    state.registry.get(`${pkg.name}@${pkg.version}`)!.integrity = pkg.integrity;
    state.registry.get(`${pkg.name}@${pkg.version}`)!.provenance = 'https://attest';
    state.registry.set(pkg.name, { ...state.registry.get(`${pkg.name}@${pkg.version}`)!, tags: { latest: 'bad' } });
    expect(() => promoteBundle({ dir, channel: 'latest', run: state.run })).toThrow(/Invalid existing/);

    for (const malformed of [42, { version: '1.0.2' }]) {
      state.registry.set(pkg.name, {
        ...state.registry.get(`${pkg.name}@${pkg.version}`)!,
        tags: { latest: malformed as unknown as string }
      });
      expect(() => promoteBundle({ dir, channel: 'latest', run: state.run })).toThrow(/Invalid existing/);
    }
  });
});
