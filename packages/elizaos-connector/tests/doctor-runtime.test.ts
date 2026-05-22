/**
 * Story 2.1b-connectors — `bonklm doctor --runtime` library tests.
 *
 * The CLI mode dispatches to `runDoctorRuntime(opts)`. We test the
 * library function directly; the CLI wiring (Sprint 12 in the plan)
 * is a thin shim atop this entry.
 */
import { createServer, type Server } from 'node:http';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  runDoctorRuntime,
  probeOutcomeToFindings,
  auditPlugins,
} from '../src/doctor.js';
import { __clearProbeCacheForTests, type ProbeOutcome } from '../src/probe.js';

async function spinUp(statusCode: number): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.statusCode = statusCode;
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve({ server, port: addr.port });
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('runDoctorRuntime', () => {
  beforeEach(() => __clearProbeCacheForTests());

  it('unauth route + no flag → CRITICAL finding + exitCode 1', async () => {
    const { server, port } = await spinUp(200);
    try {
      const report = await runDoctorRuntime({
        agentId: 'doctor-1',
        port,
      });
      expect(report.criticalCount).toBe(1);
      expect(report.exitCode).toBe(1);
      const finding = report.findings[0];
      expect(finding.category).toBe('runtime_unauth_memories');
      expect(finding.severity).toBe('CRITICAL');
    } finally {
      await closeServer(server);
    }
  });

  it('unauth route + flag → HIGH finding + exitCode 0', async () => {
    const { server, port } = await spinUp(200);
    try {
      const report = await runDoctorRuntime({
        agentId: 'doctor-2',
        port,
        acknowledgeClass4Risk: true,
      });
      expect(report.criticalCount).toBe(0);
      expect(report.exitCode).toBe(0);
      expect(report.findings[0].severity).toBe('HIGH');
      expect(report.findings[0].category).toBe('runtime_unauth_memories_acknowledged');
    } finally {
      await closeServer(server);
    }
  });

  it('protected route (401) → INFO finding', async () => {
    const { server, port } = await spinUp(401);
    try {
      const report = await runDoctorRuntime({
        agentId: 'doctor-3',
        port,
      });
      expect(report.criticalCount).toBe(0);
      expect(report.findings[0].severity).toBe('INFO');
      expect(report.findings[0].category).toBe('runtime_probe_safe');
    } finally {
      await closeServer(server);
    }
  });

  it('unreachable port → MEDIUM finding', async () => {
    const report = await runDoctorRuntime({ agentId: 'doctor-4', port: 1 });
    expect(report.criticalCount).toBe(0);
    expect(report.findings[0].severity).toBe('MEDIUM');
    expect(report.findings[0].category).toBe('runtime_probe_unreachable');
  });

  it('skipped probe (BONKLM_SKIP_RUNTIME_PROBE=1) → INFO finding', async () => {
    const report = await runDoctorRuntime({
      agentId: 'doctor-5',
      port: 9999,
      envBindings: { BONKLM_SKIP_RUNTIME_PROBE: '1', NODE_ENV: 'development' },
    });
    expect(report.findings[0].severity).toBe('INFO');
    expect(report.findings[0].category).toBe('runtime_probe_skipped');
  });
});

describe('probeOutcomeToFindings — exhaustive branch mapping', () => {
  it('unauth_detected_no_ack → CRITICAL', () => {
    const findings = probeOutcomeToFindings({ kind: 'unauth_detected_no_ack' });
    expect(findings[0].severity).toBe('CRITICAL');
  });
  it('unauth_detected_acknowledged → HIGH', () => {
    const findings = probeOutcomeToFindings({ kind: 'unauth_detected_acknowledged' });
    expect(findings[0].severity).toBe('HIGH');
  });
  it('unreachable (network failure) → MEDIUM', () => {
    const findings = probeOutcomeToFindings({
      kind: 'unreachable',
      reason: 'Probe could not reach...',
    } as ProbeOutcome);
    expect(findings[0].severity).toBe('MEDIUM');
  });
  it('unreachable (safe completion) → INFO', () => {
    const findings = probeOutcomeToFindings({
      kind: 'unreachable',
      reason: 'Probe completed; runtime HTTP /memories route is protected or absent (no unauth exposure detected).',
    } as ProbeOutcome);
    expect(findings[0].severity).toBe('INFO');
  });
  it('skipped → INFO', () => {
    const findings = probeOutcomeToFindings({
      kind: 'skipped',
      reason: 'mock skip',
    });
    expect(findings[0].severity).toBe('INFO');
  });
});

describe('auditPlugins — Phase-2 typo-squat upgrade', () => {
  it('returns CRITICAL plugin_typo_squat for distance-≤2 impersonation', () => {
    const findings = auditPlugins([
      { name: '@elizaos/plugin-soIana' }, // capital-I typo
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('CRITICAL');
    expect(findings[0].category).toBe('plugin_typo_squat');
  });

  it('returns MEDIUM plugin_not_in_allowlist for unknown-distant plugins (Phase-1 behaviour preserved)', () => {
    const findings = auditPlugins([{ name: '@random/unrelated-plugin' }]);
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('MEDIUM');
    expect(findings[0].category).toBe('plugin_not_in_allowlist');
  });

  it('does NOT flag exact-match allowlist members', () => {
    const findings = auditPlugins([{ name: '@elizaos/plugin-solana' }]);
    expect(findings.length).toBe(0);
  });
});
