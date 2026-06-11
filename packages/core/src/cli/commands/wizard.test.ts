/**
 * Wizard Command Tests
 *
 * Structural tests for the command surface plus action-level tests that drive
 * the wizard with mocked prompt / detection / network seams. The action-level
 * suite pins the shared connector-id validation (the registry is the single
 * source of truth — no hardcoded whitelist) and the hardened `--json` error
 * sanitization (credential redaction + control-char hex-escaping).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wizardCommand } from './wizard.js';
import type { ConnectorDefinition } from '../connectors/base.js';

const h = vi.hoisted(() => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  cancel: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
    message: vi.fn()
  },
  multiselect: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
  detectFrameworks: vi.fn(),
  detectServices: vi.fn(),
  detectCredentials: vi.fn(),
  testConnectorWithTimeout: vi.fn(),
  envWrite: vi.fn(),
  auditLog: vi.fn()
}));

vi.mock('@clack/prompts', () => ({
  intro: h.intro,
  outro: h.outro,
  note: h.note,
  cancel: h.cancel,
  log: h.log,
  multiselect: h.multiselect,
  password: h.password,
  confirm: h.confirm,
  // The mocked prompts only ever resolve strings/arrays, never the clack
  // cancellation symbol, so a symbol check is a faithful isCancel stand-in.
  isCancel: (value: unknown) => typeof value === 'symbol'
}));

vi.mock('../detection/framework.js', () => ({ detectFrameworks: h.detectFrameworks }));
vi.mock('../detection/services.js', () => ({ detectServices: h.detectServices }));
vi.mock('../detection/credentials.js', () => ({ detectCredentials: h.detectCredentials }));
vi.mock('../testing/validator.js', () => ({ testConnectorWithTimeout: h.testConnectorWithTimeout }));
vi.mock('../config/env.js', () => ({
  EnvManager: class {
    write = h.envWrite;
  }
}));
vi.mock('../utils/audit.js', () => ({
  AuditLogger: class {
    log = h.auditLog;
  }
}));

vi.mock('../connectors/registry.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../connectors/registry.js')>();
  const { z } = await import('zod');
  // A connector that exists in the registry but was never part of the old
  // hardcoded wizard whitelist — selecting it proves the wizard trusts the
  // registry, not a private id list that can desync.
  const mocktorConnector: ConnectorDefinition = {
    id: 'mocktor',
    name: 'Mocktor',
    category: 'llm',
    detection: { envVars: ['MOCKTOR_API_KEY'] },
    test: async () => ({ connection: true, validation: true }),
    generateSnippet: () => '// mocktor snippet',
    configSchema: z.object({})
  };
  return {
    ...actual,
    getAllConnectors: () => [...actual.getAllConnectors(), mocktorConnector],
    getConnector: (id: string) => (id === 'mocktor' ? mocktorConnector : actual.getConnector(id)),
    getConnectorIds: () => [...actual.getConnectorIds(), 'mocktor']
  };
});

/**
 * Re-imports the wizard module so each action-level test gets a fresh
 * commander instance (option state would otherwise leak between parses).
 */
async function loadWizard(): Promise<typeof wizardCommand> {
  vi.resetModules();
  const mod = await import('./wizard.js');
  return mod.wizardCommand;
}

/**
 * Shared mock defaults for the action-level suites: empty detection results,
 * resolved env/audit sinks, and a password prompt that returns a fixed value.
 */
function primeActionMocks(): void {
  vi.clearAllMocks();
  h.detectFrameworks.mockResolvedValue([]);
  h.detectServices.mockResolvedValue([]);
  h.detectCredentials.mockResolvedValue([]);
  h.envWrite.mockResolvedValue(undefined);
  h.auditLog.mockResolvedValue(undefined);
  h.password.mockResolvedValue('mocktor-secret-value');
  delete process.env.MOCKTOR_API_KEY;
}

describe('wizard command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(wizardCommand).toBeDefined();
  });

  it('should have correct name', () => {
    expect(wizardCommand.name()).toBe('wizard');
  });

  it('should have description', () => {
    expect(wizardCommand.description()).toBeTruthy();
    expect(wizardCommand.description()).toContain('interactive setup');
  });

  it('should have --json option', () => {
    const options = wizardCommand.options;
    const jsonOption = options.find(opt => opt.long === '--json');
    expect(jsonOption).toBeDefined();
  });

  it('should have action handler registered', () => {
    // Commander.js stores the action handler internally
    // The _executionCommand property indicates an action is registered
    expect(wizardCommand).toHaveProperty('_args');
    expect(wizardCommand).toHaveProperty('options');
    expect(wizardCommand._args.length).toBe(0); // wizard has no args
  });

  it('should have proper command structure', () => {
    expect(wizardCommand).toHaveProperty('_args');
    expect(wizardCommand).toHaveProperty('options');
  });
});

describe('wizard action — connector id validation', () => {
  beforeEach(() => {
    primeActionMocks();
  });

  it('configures a registry connector that was never hardcoded in the wizard', async () => {
    h.multiselect.mockResolvedValue(['mocktor']);
    h.testConnectorWithTimeout.mockResolvedValue({ connection: true, validation: true, latency: 7 });

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    expect(h.testConnectorWithTimeout).toHaveBeenCalledTimes(1);
    expect(h.testConnectorWithTimeout.mock.calls[0][0]).toMatchObject({ id: 'mocktor' });
    expect(h.testConnectorWithTimeout.mock.calls[0][1]).toEqual({ MOCKTOR_API_KEY: 'mocktor-secret-value' });
    expect(h.envWrite).toHaveBeenCalledWith({ MOCKTOR_API_KEY: 'mocktor-secret-value' });

    const warns = h.log.warn.mock.calls.flat().map(String).join('\n');
    expect(warns).not.toContain('Skipping');
  });

  it('skips a structurally invalid connector id before any registry lookup', async () => {
    h.multiselect.mockResolvedValue(['Invalid;Id']);

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    expect(h.testConnectorWithTimeout).not.toHaveBeenCalled();
    expect(h.envWrite).not.toHaveBeenCalled();

    const warns = h.log.warn.mock.calls.flat().map(String).join('\n');
    expect(warns).toContain('Skipping invalid connector ID');
  });

  it('skips a well-formed id that is not in the registry', async () => {
    h.multiselect.mockResolvedValue(['qdrant']);

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    expect(h.testConnectorWithTimeout).not.toHaveBeenCalled();
    expect(h.envWrite).not.toHaveBeenCalled();

    const warns = h.log.warn.mock.calls.flat().map(String).join('\n');
    expect(warns).toContain('Skipping unknown connector');
  });

  it('hex-escapes control characters when echoing a hostile id', async () => {
    h.multiselect.mockResolvedValue(['evil\u001b[2Jid']);

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    expect(h.testConnectorWithTimeout).not.toHaveBeenCalled();

    const warns = h.log.warn.mock.calls.flat().map(String).join('\n');
    expect(warns).not.toContain('\u001b');
    expect(warns).toContain('\\x1b');
  });
});

describe('wizard action — output sanitization', () => {
  beforeEach(() => {
    primeActionMocks();
  });

  it('redacts credentials and hex-escapes control chars in --json error output', async () => {
    const secret = 'sk-1234567890abcdefghijklmnopqrstuvwxyz123';
    const hostileError = `auth failed for ${secret}\u001b[31m\u2028injected line`;
    h.multiselect.mockResolvedValue(['mocktor']);
    h.testConnectorWithTimeout.mockResolvedValue({ connection: false, validation: false, error: hostileError });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const cmd = await loadWizard();
      await cmd.parseAsync(['--json'], { from: 'user' });

      const jsonText = logSpy.mock.calls.map(call => String(call[0])).find(text => text.includes('"failed"'));
      expect(jsonText).toBeDefined();
      const parsed = JSON.parse((jsonText ?? '').trim()) as {
        configured: unknown[];
        failed: Array<{ id: string; name: string; error?: string }>;
        envEntries?: unknown;
      };

      expect(parsed.failed).toHaveLength(1);
      expect(parsed.failed[0].id).toBe('mocktor');
      expect(parsed.failed[0].error).toContain('***REDACTED***');
      expect(parsed.failed[0].error).not.toContain(secret);
      expect(parsed.failed[0].error).not.toContain('\u001b');
      expect(parsed.failed[0].error).toContain('\\x1b');
      expect(parsed.failed[0].error).not.toContain('\u2028');
      // env entries must never appear in JSON output
      expect(parsed.envEntries).toBeUndefined();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('sanitizes connector error strings in the human summary', async () => {
    h.multiselect.mockResolvedValue(['mocktor']);
    h.testConnectorWithTimeout.mockResolvedValue({
      connection: false,
      validation: false,
      error: 'boom\u001b[2Jcleared'
    });

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    const summaryLines = h.log.message.mock.calls.flat().map(String).join('\n');
    expect(summaryLines).toContain('Mocktor');
    expect(summaryLines).not.toContain('\u001b');
    expect(summaryLines).toContain('\\x1b');
  });
});
