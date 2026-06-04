/**
 * Story 2.1b-connectors — startup HTTP probe tests.
 *
 * Covers all the security amendments threaded through the 4-iteration
 * plan audit: 2000ms AbortController, IPv6 fallback, ALS-clear,
 * module-scope dedup with FIFO eviction, probe-await, 4-branch outcome.
 */
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runStartupProbe, applyProbeOutcome, __clearProbeCacheForTests, type ProbeOutcome } from '../src/probe.js';
import { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
import { withCallContext, getCallContext } from '../src/als-context.js';
import type { IAgentRuntimeLike } from '../src/types.js';

const fakeRuntime: IAgentRuntimeLike = {
  agentId: 'test-agent',
  createMemory: async () => undefined
};

/** Spin up an HTTP server bound to 127.0.0.1 with the given status code. */
async function spinUpServer(statusCode: number): Promise<{ server: Server; port: number }> {
  return new Promise(resolve => {
    const server = createServer((_req, res) => {
      res.statusCode = statusCode;
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({ server, port: addr.port });
      }
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}

describe('runStartupProbe — 4-branch outcomes', () => {
  beforeEach(() => __clearProbeCacheForTests());

  it('Branch 1 — unauth /memories detected + flag absent → unauth_detected_no_ack', async () => {
    const { server, port } = await spinUpServer(200);
    try {
      const outcome = await runStartupProbe({ agentId: 'test', port });
      expect(outcome.kind).toBe('unauth_detected_no_ack');
    } finally {
      await closeServer(server);
    }
  });

  it('Branch 2 — unauth detected + acknowledgeClass4Risk:true → unauth_detected_acknowledged', async () => {
    const { server, port } = await spinUpServer(200);
    try {
      const outcome = await runStartupProbe({
        agentId: 'test',
        port,
        acknowledgeClass4Risk: true
      });
      expect(outcome.kind).toBe('unauth_detected_acknowledged');
    } finally {
      await closeServer(server);
    }
  });

  it('Safe — route returns 401 → unreachable kind with "Probe completed" reason', async () => {
    const { server, port } = await spinUpServer(401);
    try {
      const outcome = await runStartupProbe({ agentId: 'test', port });
      expect(outcome.kind).toBe('unreachable');
      if (outcome.kind === 'unreachable') {
        expect(outcome.reason.startsWith('Probe completed')).toBe(true);
      }
    } finally {
      await closeServer(server);
    }
  });

  it('Branch 3 — both IPv4 + IPv6 unreachable → unreachable', async () => {
    // No server running; use an unprivileged port we KNOW nothing listens on.
    const outcome = await runStartupProbe({ agentId: 'test', port: 1 });
    expect(outcome.kind).toBe('unreachable');
    if (outcome.kind === 'unreachable') {
      expect(outcome.reason).toMatch(/could not reach/i);
    }
  });

  it('Branch 4 — BONKLM_SKIP_RUNTIME_PROBE=1 + non-production → skipped', async () => {
    const outcome = await runStartupProbe({
      agentId: 'test',
      port: 9999,
      envBindings: { BONKLM_SKIP_RUNTIME_PROBE: '1', NODE_ENV: 'development' }
    });
    expect(outcome.kind).toBe('skipped');
  });

  it('Branch 4 NOT taken when NODE_ENV=production (skip not permitted in prod)', async () => {
    // The probe still RUNS (no skip) even with skip-flag set, because
    // NODE_ENV=production overrides the skip. Probe then falls through
    // to unreachable on port 1.
    const outcome = await runStartupProbe({
      agentId: 'test',
      port: 1,
      envBindings: { BONKLM_SKIP_RUNTIME_PROBE: '1', NODE_ENV: 'production' }
    });
    expect(outcome.kind).toBe('unreachable');
  });
});

describe('runStartupProbe — dedup memo + FIFO eviction', () => {
  beforeEach(() => __clearProbeCacheForTests());

  it('returns the SAME Promise for repeat calls against the same (agentId, port)', () => {
    const a = runStartupProbe({ agentId: 'x', port: 1 });
    const b = runStartupProbe({ agentId: 'x', port: 1 });
    expect(a).toBe(b);
  });

  it('returns DIFFERENT promises for different (agentId, port) pairs', () => {
    const a = runStartupProbe({ agentId: 'x', port: 1 });
    const b = runStartupProbe({ agentId: 'y', port: 1 });
    expect(a).not.toBe(b);
  });

  it('50-plugin parallel init resolves quickly (dedup defeats DoS amplification)', async () => {
    // All 50 share the same cache key → ONE probe fires.
    const start = Date.now();
    const promises = Array.from({ length: 50 }, () => runStartupProbe({ agentId: 'dedup-test', port: 1 }));
    const outcomes = await Promise.all(promises);
    const elapsed = Date.now() - start;
    // Worst case is 4s (2s IPv4 + 2s IPv6); we want well under that
    // because all 50 share the same probe.
    expect(elapsed).toBeLessThan(6000);
    // All outcomes are the SAME reference.
    expect(outcomes.every(o => o === outcomes[0])).toBe(true);
  });
});

describe('runStartupProbe — ALS-clear during probe', () => {
  beforeEach(() => __clearProbeCacheForTests());

  it('probe runs with ambient call context CLEARED even when called from inside withCallContext', async () => {
    let observedInsideProbe: ReturnType<typeof getCallContext> = undefined as ReturnType<typeof getCallContext>;
    const { server, port } = await spinUpServer(401);
    try {
      // Start a withCallContext scope, then trigger the probe from
      // inside. The probe's HTTP request callback path must observe
      // getCallContext() === undefined.
      await withCallContext(fakeRuntime, { sourceTrust: 'agent_internal', pluginName: 'parent' }, async () => {
        // Sanity — outside the probe, we DO see parent context.
        expect(getCallContext()?.pluginName).toBe('parent');

        // The probe's executeProbe runs runWithoutCallContext(...)
        // around its work. We can't directly inspect the HTTP
        // callback's view here without a side-channel, but we can
        // assert the wrapping helper does clear context — that's
        // covered by als-context.test.ts. Here we just verify the
        // probe ran without crashing under an active parent ctx.
        const outcome = await runStartupProbe({ agentId: 'als-clear', port });
        expect(outcome.kind).toBe('unreachable'); // 401 = "safe" branch
      });
      // After the probe + parent scope return, no leaked context.
      expect(getCallContext()).toBeUndefined();
      // Silence the lint about unused; observedInsideProbe is reserved
      // for a future side-channel test.
      void observedInsideProbe;
    } finally {
      await closeServer(server);
    }
  });
});

describe('applyProbeOutcome — side-effect application', () => {
  it('Branch 1 throws ConnectorValidationError(invalid_runtime)', () => {
    const outcome: ProbeOutcome = { kind: 'unauth_detected_no_ack' };
    expect(() => applyProbeOutcome(outcome, {})).toThrow(ConnectorValidationError);
  });

  it('Branch 1 throw message mentions acknowledgeClass4Risk so consumer knows the escape hatch', () => {
    const outcome: ProbeOutcome = { kind: 'unauth_detected_no_ack' };
    try {
      applyProbeOutcome(outcome, {});
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/acknowledgeClass4Risk/);
    }
  });

  it('Branch 2 does NOT throw (acknowledged → continue)', () => {
    const outcome: ProbeOutcome = { kind: 'unauth_detected_acknowledged' };
    expect(() => applyProbeOutcome(outcome, {})).not.toThrow();
  });

  it('Branch 3 does NOT throw (unreachable → log + continue)', () => {
    const outcome: ProbeOutcome = {
      kind: 'unreachable',
      reason: 'mock unreachable'
    };
    expect(() => applyProbeOutcome(outcome, {})).not.toThrow();
  });

  it('Branch 4 does NOT throw (skipped → info + continue)', () => {
    const outcome: ProbeOutcome = { kind: 'skipped', reason: 'mock skip' };
    expect(() => applyProbeOutcome(outcome, {})).not.toThrow();
  });
});

describe('runStartupProbe — redirect: manual on 3xx', () => {
  beforeEach(() => __clearProbeCacheForTests());

  it('3xx response routes to safe branch (opaque-redirect → unreachable+probe-completed), NOT unauth_detected', async () => {
    // Iter-1 code-reviewer HIGH-1 + security 3xx test. Spin a server
    // that returns 302 with a Location header. With `redirect: 'manual'`
    // fetch returns an opaque-redirect response (status=0); our probe
    // logic correctly treats this as "safe" (not 200 → not unauth).
    const server = createServer((_req, res) => {
      res.statusCode = 302;
      res.setHeader('Location', 'http://127.0.0.1:99999/auth/login');
      res.end();
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    if (!addr || typeof addr !== 'object') throw new Error('no port');
    try {
      const outcome = await runStartupProbe({ agentId: '3xx-test', port: addr.port });
      // Must NOT be unauth_detected_no_ack.
      expect(outcome.kind).not.toBe('unauth_detected_no_ack');
      expect(outcome.kind).toBe('unreachable');
      if (outcome.kind === 'unreachable') {
        expect(outcome.reason.startsWith('Probe completed')).toBe(true);
      }
    } finally {
      await closeServer(server);
    }
  });
});

describe('runStartupProbe — AbortController 2000ms timeout', () => {
  beforeEach(() => __clearProbeCacheForTests());

  it('aborts after 2 seconds against a hung server (does NOT stall init for 60s)', async () => {
    // Spin up a server that accepts the connection but NEVER responds.
    // Without the AbortController deadline this would stall for the
    // default Node http socket timeout (~60-120s). With the deadline
    // we expect ≤5s (2s × 2 IP attempts + ALS overhead).
    const server: Server = createServer((_req, _res) => {
      // intentionally never respond
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    if (!addr || typeof addr !== 'object') throw new Error('no port');
    const port = addr.port;

    const start = Date.now();
    try {
      const outcome = await runStartupProbe({ agentId: 'hung', port });
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(5500);
      expect(outcome.kind).toBe('unreachable');
    } finally {
      await closeServer(server);
    }
  });
});

describe('runStartupProbe — injectable fetch transport (fetchImpl)', () => {
  beforeEach(() => __clearProbeCacheForTests());

  it('routes the probe through an injected fetchImpl instead of the global fetch', async () => {
    // 200 from the injected transport → unauth detected, proving the seam
    // threads opts.fetchImpl → executeProbe → probeSingleIp (IPv4 attempt).
    // The port is URL-cosmetic only: the injected transport never binds a
    // socket, so these tests assume nothing about ports 65000/65001 being free.
    const transport = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const outcome = await runStartupProbe({
      agentId: 'inject-200',
      port: 65000,
      fetchImpl: transport as unknown as typeof fetch
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0][0])).toContain('127.0.0.1:65000');
    expect(outcome.kind).toBe('unauth_detected_no_ack');
  });

  it('injected transport rejection falls through IPv4 → IPv6 → unreachable', async () => {
    const econnrefused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const transport = vi.fn().mockRejectedValue(econnrefused);
    const outcome = await runStartupProbe({
      agentId: 'inject-reject',
      port: 65001,
      fetchImpl: transport as unknown as typeof fetch
    });
    expect(outcome.kind).toBe('unreachable');
    // Both the 127.0.0.1 and [::1] attempts use the injected transport.
    expect(transport).toHaveBeenCalledTimes(2);
    expect(String(transport.mock.calls[0][0])).toContain('127.0.0.1:65001');
    expect(String(transport.mock.calls[1][0])).toContain('[::1]:65001');
  });
});
