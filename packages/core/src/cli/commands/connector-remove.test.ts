/**
 * Connector Remove Command Tests
 *
 * Exercises the testable core ({@link runConnectorRemove}) with injected I/O
 * (env read/write, audit, confirmation) so no test ever touches a real `.env`,
 * plus the render helper and the command-shape contract.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  connectorRemoveCommand,
  renderConnectorRemoveHuman,
  runConnectorRemove,
  type ConnectorRemoveReport
} from './connector-remove.js';

/** A resolved-audit stub that records calls without touching disk. */
function makeAudit() {
  return { log: vi.fn().mockResolvedValue(undefined) };
}

describe('connector remove command', () => {
  it('should be defined', () => {
    expect(connectorRemoveCommand).toBeDefined();
  });

  it('should have correct name', () => {
    expect(connectorRemoveCommand.name()).toBe('remove');
  });

  it('should have description', () => {
    expect(connectorRemoveCommand.description()).toBeTruthy();
    expect(connectorRemoveCommand.description()).toContain('connector');
  });

  it('should have --yes option', () => {
    const options = connectorRemoveCommand.options;
    const yesOption = options.find(opt => opt.long === '--yes');
    expect(yesOption).toBeDefined();
  });

  it('should be properly configured', () => {
    expect(connectorRemoveCommand).toHaveProperty('registeredArguments');
    expect(connectorRemoveCommand.registeredArguments.length).toBe(1);
    expect(connectorRemoveCommand).toHaveProperty('options');
  });
});

describe('runConnectorRemove', () => {
  it('returns invalid-id for a malformed id without reading the env', async () => {
    const readEnv = vi.fn();
    const writeEnv = vi.fn();

    const report = await runConnectorRemove('Bad!', {}, { readEnv, writeEnv, audit: makeAudit() });

    expect(report.status).toBe('invalid-id');
    expect(report.exitCode).toBe(1);
    expect(readEnv).not.toHaveBeenCalled();
    expect(writeEnv).not.toHaveBeenCalled();
  });

  it('returns unknown-connector for a well-formed but unregistered id', async () => {
    const report = await runConnectorRemove('foobar', {}, { readEnv: vi.fn(), writeEnv: vi.fn(), audit: makeAudit() });

    expect(report.status).toBe('unknown-connector');
    expect(report.exitCode).toBe(1);
  });

  it('returns nothing-to-remove when no matching keys are present (exit 0)', async () => {
    const writeEnv = vi.fn();

    const report = await runConnectorRemove(
      'openai',
      {},
      { readEnv: async () => ({ SOMETHING_ELSE: 'x' }), writeEnv, audit: makeAudit() }
    );

    expect(report.status).toBe('nothing-to-remove');
    expect(report.exitCode).toBe(0);
    expect(report.affectedKeys).toEqual([]);
    expect(writeEnv).not.toHaveBeenCalled();
  });

  it('removes the connector keys and rewrites the remaining env when --yes is set', async () => {
    const writeEnv = vi.fn().mockResolvedValue(undefined);
    const audit = makeAudit();
    const confirm = vi.fn();

    const report = await runConnectorRemove(
      'openai',
      { yes: true },
      { readEnv: async () => ({ OPENAI_API_KEY: 'sk-x', KEEP_ME: 'v' }), writeEnv, audit, confirm }
    );

    expect(report.status).toBe('removed');
    expect(report.exitCode).toBe(0);
    expect(report.affectedKeys).toEqual(['OPENAI_API_KEY']);
    expect(confirm).not.toHaveBeenCalled();
    expect(writeEnv).toHaveBeenCalledWith({ KEEP_ME: 'v' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'connector_removed', success: true }));
  });

  it('removes after an affirmative confirmation when --yes is not set', async () => {
    const writeEnv = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockResolvedValue(true);

    const report = await runConnectorRemove(
      'anthropic',
      {},
      { readEnv: async () => ({ ANTHROPIC_API_KEY: 'sk-ant-x' }), writeEnv, audit: makeAudit(), confirm }
    );

    expect(report.status).toBe('removed');
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: 'anthropic', connectorName: 'Anthropic', keys: ['ANTHROPIC_API_KEY'] })
    );
    expect(writeEnv).toHaveBeenCalledWith({});
  });

  it('declines (exit 0, no write) when the user answers no', async () => {
    const writeEnv = vi.fn();
    const audit = makeAudit();

    const report = await runConnectorRemove(
      'openai',
      {},
      { readEnv: async () => ({ OPENAI_API_KEY: 'sk-x' }), writeEnv, audit, confirm: async () => false }
    );

    expect(report.status).toBe('declined');
    expect(report.exitCode).toBe(0);
    expect(report.affectedKeys).toEqual(['OPENAI_API_KEY']);
    expect(writeEnv).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('reports cancelled (exit 1, no write) when the confirmation aborts', async () => {
    const writeEnv = vi.fn();

    const report = await runConnectorRemove(
      'openai',
      {},
      {
        readEnv: async () => ({ OPENAI_API_KEY: 'sk-x' }),
        writeEnv,
        audit: makeAudit(),
        confirm: async () => {
          throw new Error('cancelled');
        }
      }
    );

    expect(report.status).toBe('cancelled');
    expect(report.exitCode).toBe(1);
    expect(writeEnv).not.toHaveBeenCalled();
  });

  it('does not crash when the audit write fails after a successful removal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const writeEnv = vi.fn().mockResolvedValue(undefined);
    const audit = { log: vi.fn().mockRejectedValue(new Error('disk full')) };

    const report = await runConnectorRemove(
      'openai',
      { yes: true },
      { readEnv: async () => ({ OPENAI_API_KEY: 'sk-x' }), writeEnv, audit }
    );

    expect(report.status).toBe('removed');
    expect(report.exitCode).toBe(0);
    expect(writeEnv).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns env-error (exit 1, no write) when the .env read throws', async () => {
    const writeEnv = vi.fn();

    const report = await runConnectorRemove(
      'openai',
      {},
      {
        readEnv: async () => {
          throw new Error('EACCES: permission denied');
        },
        writeEnv,
        audit: makeAudit()
      }
    );

    expect(report.status).toBe('env-error');
    expect(report.exitCode).toBe(1);
    expect(report.error).toContain('permission denied');
    expect(writeEnv).not.toHaveBeenCalled();
  });

  it('returns env-error (exit 1) when the .env write throws after confirmation', async () => {
    const audit = makeAudit();

    const report = await runConnectorRemove(
      'openai',
      { yes: true },
      {
        readEnv: async () => ({ OPENAI_API_KEY: 'sk-x', KEEP_ME: 'v' }),
        writeEnv: async () => {
          throw new Error('INVALID_ENV_VALUE: newline in retained value');
        },
        audit
      }
    );

    expect(report.status).toBe('env-error');
    expect(report.exitCode).toBe(1);
    expect(report.affectedKeys).toEqual(['OPENAI_API_KEY']);
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('renderConnectorRemoveHuman', () => {
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

  function stdout(): string {
    return logSpy.mock.calls.map(c => c[0]).join('\n');
  }

  function stderr(): string {
    return errorSpy.mock.calls.map(c => c[0]).join('\n');
  }

  const base = (overrides: Partial<ConnectorRemoveReport>): ConnectorRemoveReport => ({
    status: 'removed',
    connectorId: 'openai',
    connectorName: 'OpenAI',
    affectedKeys: ['OPENAI_API_KEY'],
    exitCode: 0,
    ...overrides
  });

  it('reports a removal on stdout with the removed keys', () => {
    spyConsole();
    renderConnectorRemoveHuman(base({ status: 'removed' }));
    expect(stdout()).toContain('Removed OpenAI (openai)');
    expect(stdout()).toContain('OPENAI_API_KEY');
  });

  it('reports nothing-to-remove on stdout', () => {
    spyConsole();
    renderConnectorRemoveHuman(base({ status: 'nothing-to-remove', affectedKeys: [] }));
    expect(stdout()).toContain('Nothing to remove');
  });

  it('reports a declined removal on stdout', () => {
    spyConsole();
    renderConnectorRemoveHuman(base({ status: 'declined' }));
    expect(stdout()).toContain('no changes made');
  });

  it('reports a cancelled removal on stderr', () => {
    spyConsole();
    renderConnectorRemoveHuman(base({ status: 'cancelled', exitCode: 1 }));
    expect(stderr()).toContain('aborted');
  });

  it('reports an env-error on stderr with the sanitized detail', () => {
    spyConsole();
    renderConnectorRemoveHuman(base({ status: 'env-error', error: 'permission denied', exitCode: 1 }));
    expect(stderr()).toContain('Could not update .env');
    expect(stderr()).toContain('permission denied');
  });

  it('reports an invalid id on stderr with guidance', () => {
    spyConsole();
    renderConnectorRemoveHuman({ status: 'invalid-id', connectorId: 'Bad!', exitCode: 1 });
    expect(stderr()).toContain('Invalid connector ID');
    expect(stderr()).toContain('Bad!');
    expect(stderr()).toContain('Available connectors');
  });

  it('reports an unknown connector on stderr', () => {
    spyConsole();
    renderConnectorRemoveHuman({ status: 'unknown-connector', connectorId: 'foobar', exitCode: 1 });
    expect(stderr()).toContain('Unknown connector');
    expect(stderr()).toContain('foobar');
  });
});
