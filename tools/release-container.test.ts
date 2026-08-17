import { describe, expect, it, vi } from 'vitest';
import {
  cleanupStagingImage,
  command,
  createRunner,
  ensureExactImage,
  inspectImage,
  main,
  runCli,
  waitFor
} from './release-container.js';

const digest = 'sha256:abc';
const revision = 'a'.repeat(40);
const version = '1.0.1';
const image = {
  Digest: digest,
  Labels: { 'org.opencontainers.image.revision': revision, 'org.opencontainers.image.version': version }
};

function missing(message = 'manifest unknown') {
  return Object.assign(new Error(message), { status: 1, stderr: message });
}

describe('container release registry controls', () => {
  it('copies only after two explicit missing-manifest results and verifies the result', () => {
    const responses: Array<object | Error> = [missing(), missing(), image];
    const run = vi.fn((tool: string, args: string[]) => {
      if (tool === 'cosign') return '';
      const value = responses.shift();
      if (value instanceof Error) throw value;
      return JSON.stringify(value);
    });
    expect(
      ensureExactImage({ source: 'stage/image', destination: 'public/image:1.0.1', digest, revision, version, run })
        .Digest
    ).toBe(digest);
    expect(run).toHaveBeenCalledWith('cosign', ['copy', 'stage/image@sha256:abc', 'public/image:1.0.1'], {});
  });

  it('repairs signature referrers on a matching exact tag and rejects digest or label conflicts', () => {
    const matching = vi.fn((tool: string) => (tool === 'cosign' ? '' : JSON.stringify(image)));
    expect(
      ensureExactImage({
        source: 'stage/image',
        destination: 'public/image:1.0.1',
        digest,
        revision,
        version,
        run: matching
      }).Digest
    ).toBe(digest);
    // Idempotent resume: an existing tag that already matches the verified
    // digest and release identity short-circuits without re-copying.
    expect(matching).not.toHaveBeenCalledWith('cosign', ['copy', 'stage/image@sha256:abc', 'public/image:1.0.1'], {});
    const wrongDigest = vi.fn(() => JSON.stringify({ ...image, Digest: 'sha256:other' }));
    expect(
      () =>
        ensureExactImage({ source: 'stage', destination: 'dest', digest, revision, version, run: wrongDigest }).Digest
    ).toThrow(/conflicts/);
    const wrongLabel = vi.fn(() => JSON.stringify({ ...image, Labels: {} }));
    expect(() =>
      ensureExactImage({ source: 'stage', destination: 'dest', digest, revision, version, run: wrongLabel })
    ).toThrow(/release identity label/);
  });

  it('rejects a different digest across a bootstrap rerun even when labels match', () => {
    const firstDigest = 'sha256:first-run';
    const existing = { ...image, Digest: firstDigest };
    const run = vi.fn(() => JSON.stringify(existing));
    expect(
      () =>
        ensureExactImage({
          source: 'stage/image',
          destination: 'public/image:1.0.1',
          digest: 'sha256:second-run',
          revision,
          version,
          run
        }).Digest
    ).toThrow(/conflicts/);
    expect(run.mock.calls.some(([tool]) => tool === 'cosign')).toBe(false);

    const wrongRevision = vi.fn(() =>
      JSON.stringify({
        ...existing,
        Labels: { ...existing.Labels, 'org.opencontainers.image.revision': 'b'.repeat(40) }
      })
    );
    expect(() =>
      ensureExactImage({ source: 'stage', destination: 'dest', digest, revision, version, run: wrongRevision })
    ).toThrow(/release identity label/);
  });

  it('rejects a failed copy and an exact tag that changes during verification', () => {
    const copyResponses: Array<object | Error> = [missing(), missing(), { ...image, Digest: 'sha256:wrong' }];
    expect(() =>
      ensureExactImage({
        source: 'stage',
        destination: 'dest',
        digest,
        revision,
        version,
        run: (tool: string) => {
          if (tool === 'cosign') return '';
          const value = copyResponses.shift();
          if (value instanceof Error) throw value;
          return JSON.stringify(value);
        }
      })
    ).toThrow(/Copied container tag/);

    // Idempotent resume: once the existing tag matches the verified digest
    // and identity, the function returns without re-copying — a later
    // divergence is a NEW run's preflight conflict, not this call's.
    const changed = [{ ...image }, { ...image, Digest: 'sha256:changed' }];
    expect(
      ensureExactImage({
        source: 'stage',
        destination: 'dest',
        digest,
        revision,
        version,
        run: (tool: string) => (tool === 'cosign' ? '' : JSON.stringify(changed.shift()))
      }).Digest
    ).toBe(digest);
  });

  it('fails closed on transport/auth errors instead of treating them as absence', () => {
    const denied = Object.assign(new Error('unauthorized'), { status: 1, stderr: 'unauthorized: denied' });
    expect(() =>
      inspectImage(() => {
        throw denied;
      }, 'image:tag')
    ).toThrow(denied);
    expect(
      inspectImage(() => {
        throw { stderr: 'manifest unknown' };
      }, 'image:missing')
    ).toBeNull();
    expect(
      inspectImage(() => {
        throw { message: 'name unknown' };
      }, 'image:missing')
    ).toBeNull();
    expect(() =>
      ensureExactImage({
        source: 'stage',
        destination: 'dest',
        digest,
        revision,
        version,
        run: () => {
          throw denied;
        }
      })
    ).toThrow(denied);
  });

  it('removes private staging references, tolerates absence, and propagates other failures', () => {
    const run = vi.fn((tool: string, args: string[]) => {
      if (tool === 'cosign' && args[0] === 'clean') return '';
      if (tool === 'cosign' && args[0] === 'download') throw missing('no signatures found');
      if (args[0] === 'delete') return '';
      throw missing();
    });
    cleanupStagingImage({ reference: 'stage:image', run });
    expect(run).toHaveBeenCalledWith('cosign', ['clean', '--force', 'stage:image'], {});
    expect(run).toHaveBeenCalledWith('cosign', ['download', 'signature', 'stage:image'], {});
    expect(run).toHaveBeenCalledWith('cosign', ['download', 'attestation', 'stage:image'], {});
    expect(run).toHaveBeenCalledWith('skopeo', ['delete', 'docker://stage:image'], {});
    expect(run).toHaveBeenCalledWith('skopeo', ['inspect', 'docker://stage:image'], {});
    expect(() =>
      cleanupStagingImage({
        reference: 'stage:missing',
        run: () => {
          throw missing('name unknown');
        }
      })
    ).not.toThrow();
    const denied = Object.assign(new Error('denied'), { stderr: 'denied' });
    expect(() =>
      cleanupStagingImage({
        reference: 'stage:image',
        run: () => {
          throw denied;
        }
      })
    ).toThrow(denied);
    expect(() =>
      cleanupStagingImage({
        reference: 'stage:image',
        run: (tool: string, args: string[]) => {
          if (tool === 'cosign' && args[0] === 'clean') return '';
          if (tool === 'cosign' && args[0] === 'download') throw denied;
          return '';
        }
      })
    ).toThrow(denied);
    // skopeo delete denial is best-effort cleanup: token-scope limitation
    // on the registry, warn and continue (private opaque tag).
    expect(() =>
      cleanupStagingImage({
        reference: 'stage:image',
        run: (tool: string, args: string[]) => {
          if (tool === 'cosign' && args[0] === 'clean') return '';
          if (tool === 'cosign' && args[0] === 'download') throw missing('no signatures found');
          throw denied;
        }
      })
    ).not.toThrow();
  });

  it('polls for staging deletion and fails if the reference remains', () => {
    const responses: Array<object | Error> = [image, image, missing()];
    const delayed = vi.fn((tool: string, args: string[]) => {
      if (tool === 'cosign' && args[0] === 'clean') return '';
      if (tool === 'cosign' && args[0] === 'download') throw missing('no signatures found');
      if (args[0] === 'delete') return '';
      const value = responses.shift();
      if (value instanceof Error) throw value;
      return JSON.stringify(value);
    });
    const pause = vi.fn();
    expect(() => cleanupStagingImage({ reference: 'stage:delayed', run: delayed, retries: 3, pause })).not.toThrow();
    expect(pause).toHaveBeenNthCalledWith(1, 250);
    expect(pause).toHaveBeenNthCalledWith(2, 500);
    const remains = vi.fn((tool: string, args: string[]) => {
      if (tool === 'cosign' && args[0] === 'clean') return '';
      if (tool === 'cosign' && args[0] === 'download') throw missing('no signatures found');
      return args[0] === 'delete' ? '' : JSON.stringify(image);
    });
    // a reference that remains after deletion is a best-effort warning, not a failure
    expect(() => cleanupStagingImage({ reference: 'stage:stuck', run: remains, retries: 2, pause })).not.toThrow();
    expect(() => waitFor(0)).not.toThrow();
  });

  it('fails cleanup while a signature or attestation remains', () => {
    const run = vi.fn((tool: string, args: string[]) => {
      if (tool === 'cosign' && args[0] === 'clean') return '';
      if (tool === 'cosign' && args[0] === 'download' && args[1] === 'signature') return '{"signature":"still-here"}';
      if (tool === 'cosign' && args[0] === 'download') throw missing('no attestations found');
      return '';
    });
    expect(() => cleanupStagingImage({ reference: 'stage:signed', run, retries: 1, pause: vi.fn() })).toThrow(
      /signature artifacts remain/
    );
    const malformed = {};
    expect(() =>
      cleanupStagingImage({
        reference: 'stage:malformed',
        run: (tool: string, args: string[]) => {
          if (tool === 'cosign' && args[0] === 'clean') return '';
          throw malformed;
        }
      })
    ).toThrow(malformed);
  });
});

describe('container release CLI', () => {
  it('routes exact promotion and cleanup and rejects invalid usage', () => {
    const log = vi.fn();
    const inspect = vi.fn(() => JSON.stringify(image));
    expect(
      main({ argv: ['ensure-exact', 'stage', 'public:1.0.1', digest, version, revision], run: inspect, log })
    ).toEqual(image);
    const cleanup = vi.fn((tool: string, args: string[]) => {
      if (tool === 'cosign' && args[0] === 'clean') return '';
      if (tool === 'cosign' && args[0] === 'download') throw missing('no signatures found');
      if (args[0] === 'delete') return '';
      throw missing();
    });
    expect(main({ argv: ['cleanup-staging', 'stage:opaque'], run: cleanup, log })).toBeNull();
    expect(createRunner({ argv: ['cleanup-staging', 'stage:opaque'], run: cleanup, log })()).toBeNull();
    expect(log).toHaveBeenCalledTimes(3);
    expect(() => main({ argv: [], run: inspect, log })).toThrow(/Usage/);
    expect(command(process.execPath, ['--version'], {})).toMatch(/^v/);
  });

  it('runs only for its entrypoint and reports Error and non-Error failures', () => {
    expect(runCli({ argv1: '/other', scriptPath: '/script', run: vi.fn(), exit: vi.fn() })).toBe(false);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.fn();
    expect(
      runCli({
        argv1: '/script',
        scriptPath: '/script',
        run: () => {
          throw new Error('\u001b[31mboom\nsecret\u202e' + 'x'.repeat(600));
        },
        exit
      })
    ).toBe(true);
    expect(
      runCli({
        argv1: '/script',
        scriptPath: '/script',
        run: () => {
          throw 'bad\nsecret';
        },
        exit
      })
    ).toBe(true);
    expect(exit).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenNthCalledWith(1, 'release-container: container release command failed');
    expect(error).toHaveBeenNthCalledWith(2, 'release-container: container release command failed');
    error.mockRestore();
  });
});
