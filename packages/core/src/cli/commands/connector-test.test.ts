/**
 * Connector Test Command Tests
 *
 * Exercises the testable core ({@link runConnectorTest}) with injected I/O —
 * no network, filesystem, or audit side effects — plus the render helpers and
 * the command-shape contract.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  connectorTestCommand,
  renderConnectorTestHuman,
  renderConnectorTestJson,
  runConnectorTest,
  type ConnectorTestReport
} from './connector-test.js';

/** A resolved-audit stub that records calls without touching disk. */
function makeAudit() {
  return { log: vi.fn().mockResolvedValue(undefined) };
}

describe('connector test command', () => {
  it('should be defined', () => {
    expect(connectorTestCommand).toBeDefined();
  });

  it('should have correct name', () => {
    expect(connectorTestCommand.name()).toBe('test');
  });

  it('should have description', () => {
    expect(connectorTestCommand.description()).toBeTruthy();
    expect(connectorTestCommand.description()).toContain('connector');
  });

  it('should have --json option', () => {
    const options = connectorTestCommand.options;
    const jsonOption = options.find(opt => opt.long === '--json');
    expect(jsonOption).toBeDefined();
  });

  it('should be properly configured', () => {
    expect(connectorTestCommand).toHaveProperty('_args');
    expect(connectorTestCommand).toHaveProperty('options');
  });
});

describe('runConnectorTest', () => {
  it('returns invalid-id for a malformed id without any I/O', async () => {
    const loadConfig = vi.fn();
    const testFn = vi.fn();
    const audit = makeAudit();

    const report = await runConnectorTest('Bad!', { loadConfig, testFn, audit });

    expect(report.status).toBe('invalid-id');
    expect(report.exitCode).toBe(1);
    expect(loadConfig).not.toHaveBeenCalled();
    expect(testFn).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('returns unknown-connector for a well-formed but unregistered id', async () => {
    const report = await runConnectorTest('foobar', {
      loadConfig: vi.fn(),
      testFn: vi.fn(),
      audit: makeAudit()
    });

    expect(report.status).toBe('unknown-connector');
    expect(report.exitCode).toBe(1);
  });

  it('returns not-configured (and audits the miss) when no credentials are present', async () => {
    const audit = makeAudit();
    const testFn = vi.fn();

    const report = await runConnectorTest('openai', { loadConfig: async () => ({}), testFn, audit });

    expect(report.status).toBe('not-configured');
    expect(report.exitCode).toBe(1);
    expect(report.connectorName).toBe('OpenAI');
    expect(report.missing).toContain('OPENAI_API_KEY');
    expect(testFn).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'connector_tested', success: false, error_code: 'NOT_CONFIGURED' })
    );
  });

  it('runs the test for a connector with no declared env vars (not "not-configured")', async () => {
    // ollama declares no envVars — an empty config must NOT be treated as
    // unconfigured; the test should still run.
    const audit = makeAudit();
    const testFn = vi.fn().mockResolvedValue({ connection: true, validation: true, latency: 2 });

    const report = await runConnectorTest('ollama', { loadConfig: async () => ({}), testFn, audit });

    expect(report.status).toBe('ok');
    expect(report.exitCode).toBe(0);
    expect(testFn).toHaveBeenCalledOnce();
  });

  it('returns ok/exit 0 when connection and validation pass', async () => {
    const audit = makeAudit();
    const testFn = vi.fn().mockResolvedValue({ connection: true, validation: true, latency: 7 });

    const report = await runConnectorTest('openai', {
      loadConfig: async () => ({ OPENAI_API_KEY: 'sk-x' }),
      testFn,
      audit
    });

    expect(report.status).toBe('ok');
    expect(report.exitCode).toBe(0);
    expect(report.result).toEqual({ connection: true, validation: true, latency: 7 });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'connector_tested', success: true }));
  });

  it('returns ok/exit 2 when the test runs but validation fails', async () => {
    const audit = makeAudit();
    const testFn = vi.fn().mockResolvedValue({ connection: true, validation: false, error: 'bad key' });

    const report = await runConnectorTest('anthropic', {
      loadConfig: async () => ({ ANTHROPIC_API_KEY: 'sk-ant-x' }),
      testFn,
      audit
    });

    expect(report.status).toBe('ok');
    expect(report.exitCode).toBe(2);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'connector_tested', success: false, error_code: 'TEST_FAILED' })
    );
  });

  it('returns exit 2 on connection failure', async () => {
    const testFn = vi.fn().mockResolvedValue({ connection: false, validation: false, error: 'no route' });

    const report = await runConnectorTest('openai', {
      loadConfig: async () => ({ OPENAI_API_KEY: 'sk-x' }),
      testFn,
      audit: makeAudit()
    });

    expect(report.exitCode).toBe(2);
  });

  it('folds a thrown timeout into a failed result (exit 2)', async () => {
    const testFn = vi.fn().mockRejectedValue(new Error('Connector test timed out after 10000ms'));

    const report = await runConnectorTest('openai', {
      loadConfig: async () => ({ OPENAI_API_KEY: 'sk-x' }),
      testFn,
      audit: makeAudit()
    });

    expect(report.status).toBe('ok');
    expect(report.exitCode).toBe(2);
    expect(report.result?.connection).toBe(false);
    expect(report.result?.error).toContain('timed out');
  });

  it('uses a generic error message when a non-Error value is thrown', async () => {
    const testFn = vi.fn().mockRejectedValue('weird');

    const report = await runConnectorTest('openai', {
      loadConfig: async () => ({ OPENAI_API_KEY: 'sk-x' }),
      testFn,
      audit: makeAudit()
    });

    expect(report.result?.error).toBe('Connector test failed');
  });

  it('does not crash when the audit write fails (best-effort telemetry)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const audit = { log: vi.fn().mockRejectedValue(new Error('disk full')) };
    const testFn = vi.fn().mockResolvedValue({ connection: true, validation: true, latency: 1 });

    const report = await runConnectorTest('openai', {
      loadConfig: async () => ({ OPENAI_API_KEY: 'sk-x' }),
      testFn,
      audit
    });

    expect(report.status).toBe('ok');
    expect(report.exitCode).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('falls back to the default credential loader (process.env) when none is injected', async () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-from-env';
    const audit = makeAudit();
    const testFn = vi.fn().mockResolvedValue({ connection: true, validation: true, latency: 3 });

    try {
      const report = await runConnectorTest('openai', { testFn, audit });
      expect(report.status).toBe('ok');
      expect(testFn).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'openai' }),
        { OPENAI_API_KEY: 'sk-from-env' },
        expect.any(Number)
      );
    } finally {
      if (prev === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = prev;
      }
    }
  });
});

describe('renderConnectorTestJson', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    logSpy?.mockRestore();
  });

  it('emits parseable JSON for an ok result', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const report: ConnectorTestReport = {
      status: 'ok',
      connectorId: 'openai',
      connectorName: 'OpenAI',
      result: { connection: true, validation: true, latency: 42 },
      exitCode: 0
    };

    renderConnectorTestJson(report);

    expect(logSpy).toHaveBeenCalledOnce();
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload).toMatchObject({
      connectorId: 'openai',
      status: 'ok',
      connection: true,
      validation: true,
      latency: 42,
      exitCode: 0
    });
  });

  it('emits JSON for a not-configured result with defaults for the missing test fields', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const report: ConnectorTestReport = {
      status: 'not-configured',
      connectorId: 'openai',
      connectorName: 'OpenAI',
      missing: ['OPENAI_API_KEY'],
      exitCode: 1
    };

    renderConnectorTestJson(report);

    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload.connection).toBe(false);
    expect(payload.validation).toBe(false);
    expect(payload.missing).toEqual(['OPENAI_API_KEY']);
  });
});

describe('renderConnectorTestHuman', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    logSpy?.mockRestore();
    errorSpy?.mockRestore();
  });

  function spyConsole() {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  }

  it('delegates an ok report to the shared results renderer (stdout)', () => {
    spyConsole();
    renderConnectorTestHuman({
      status: 'ok',
      connectorId: 'openai',
      connectorName: 'OpenAI',
      result: { connection: true, validation: true, latency: 5 },
      exitCode: 0
    });
    expect(logSpy).toHaveBeenCalled();
  });

  it('reports an invalid id on stderr with guidance', () => {
    spyConsole();
    renderConnectorTestHuman({ status: 'invalid-id', connectorId: 'Bad!', exitCode: 1 });
    const out = errorSpy.mock.calls.map(c => c[0]).join('\n');
    expect(out).toContain('Invalid connector ID');
    expect(out).toContain('Bad!');
    expect(out).toContain('Available connectors');
  });

  it('reports an unknown connector on stderr', () => {
    spyConsole();
    renderConnectorTestHuman({ status: 'unknown-connector', connectorId: 'foobar', exitCode: 1 });
    const out = errorSpy.mock.calls.map(c => c[0]).join('\n');
    expect(out).toContain('Unknown connector');
    expect(out).toContain('foobar');
  });

  it('reports a not-configured connector with the add hint', () => {
    spyConsole();
    renderConnectorTestHuman({
      status: 'not-configured',
      connectorId: 'openai',
      connectorName: 'OpenAI',
      missing: ['OPENAI_API_KEY'],
      exitCode: 1
    });
    const out = errorSpy.mock.calls.map(c => c[0]).join('\n');
    expect(out).toContain('is not configured');
    expect(out).toContain('OPENAI_API_KEY');
    expect(out).toContain('bonklm connector add openai');
  });
});
