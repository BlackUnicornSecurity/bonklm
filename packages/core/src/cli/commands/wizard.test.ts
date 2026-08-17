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
  // A connector detected via package.json whose only env var is optional —
  // covers the package-match detection arm and the skippable-prompt path.
  const optomaConnector: ConnectorDefinition = {
    id: 'optoma',
    name: 'Optoma',
    category: 'utility',
    npmPackage: '@blackunicorn/bonklm-optoma',
    detection: { packageJson: ['@blackunicorn/bonklm-optoma'], envVars: ['OPTOMA_HOST'], ports: [4242] },
    optionalEnvVars: ['OPTOMA_HOST'],
    test: async () => ({ connection: true, validation: true }),
    generateSnippet: () => '// optoma snippet',
    configSchema: z.object({})
  };
  const extra: Record<string, ConnectorDefinition> = { mocktor: mocktorConnector, optoma: optomaConnector };
  return {
    ...actual,
    getAllConnectors: () => [...actual.getAllConnectors(), mocktorConnector, optomaConnector],
    getConnector: (id: string) => extra[id] ?? actual.getConnector(id),
    getConnectorIds: () => [...actual.getConnectorIds(), 'mocktor', 'optoma']
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
    expect(wizardCommand).toHaveProperty('registeredArguments');
    expect(wizardCommand).toHaveProperty('options');
    expect(wizardCommand.registeredArguments.length).toBe(0); // wizard has no args
  });

  it('should have proper command structure', () => {
    expect(wizardCommand).toHaveProperty('registeredArguments');
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

  it('marks a connector detected when the project declares one of its packages', async () => {
    h.detectFrameworks.mockResolvedValue([
      { name: 'optoma', package: '@blackunicorn/bonklm-optoma', version: '^1.0.0' }
    ]);
    h.multiselect.mockResolvedValue([]);

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    const options = h.multiselect.mock.calls[0][0];
    // Detected connectors sort first, start pre-selected, and carry a hint.
    expect(options.initialValues).toContain('optoma');
    // The registry is the whole connector surface; an unwindowed prompt
    // redraws every row on each keystroke.
    expect(options.maxItems).toBe(12);
    expect(options.options[0]).toMatchObject({ value: 'optoma', hint: 'detected · utility' });
    expect(options.options.at(-1)!.hint).not.toContain('detected');
    const successes = h.log.success.mock.calls.flat().map(String).join('\n');
    expect(successes).toContain('Detected 1 of');
  });

  it('marks a connector detected when a declared port is listening', async () => {
    h.detectServices.mockResolvedValue([{ name: 'optoma', type: 'port', available: true, address: 'localhost:4242' }]);
    h.multiselect.mockResolvedValue([]);

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    expect(h.multiselect.mock.calls[0][0].initialValues).toContain('optoma');
  });

  it('does NOT mark a connector detected when its port is probed but closed', async () => {
    // detectServices reports every declared port, available or not. Ignoring
    // `available` made every port-declaring connector "detected" — and, since
    // detected connectors are pre-selected, configured by default — on every
    // machine. This test fails if the `s.available &&` guard is removed.
    h.detectServices.mockResolvedValue([{ name: 'optoma', type: 'port', available: false, address: 'localhost:4242' }]);
    h.multiselect.mockResolvedValue([]);

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    expect(h.multiselect.mock.calls[0][0].initialValues).toEqual([]);
  });

  it('marks a connector detected when a matching Docker container is running', async () => {
    // Chroma and Weaviate declare no port and no env var — a running container
    // is their only non-package signal, and it was previously ignored.
    h.detectServices.mockResolvedValue([{ name: 'my-chroma-db', type: 'docker', available: true }]);
    h.multiselect.mockResolvedValue([]);

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    expect(h.multiselect.mock.calls[0][0].initialValues).toContain('chroma');
  });

  it('ignores a stopped container', async () => {
    h.detectServices.mockResolvedValue([{ name: 'my-chroma-db', type: 'docker', available: false }]);
    h.multiselect.mockResolvedValue([]);

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    expect(h.multiselect.mock.calls[0][0].initialValues).toEqual([]);
  });

  it('does not match a port by substring (4242 must not match 42420)', async () => {
    h.detectServices.mockResolvedValue([{ name: 'other', type: 'port', available: true, address: 'localhost:42420' }]);
    h.multiselect.mockResolvedValue([]);

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    expect(h.multiselect.mock.calls[0][0].initialValues).toEqual([]);
  });

  it('does not pre-select anything when nothing is detected', async () => {
    h.multiselect.mockResolvedValue([]);

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    expect(h.multiselect.mock.calls[0][0].initialValues).toEqual([]);
    const successes = h.log.success.mock.calls.flat().map(String).join('\n');
    expect(successes).not.toContain('Detected');
  });

  it('skips an optional credential the user leaves blank', async () => {
    h.multiselect.mockResolvedValue(['optoma']);
    h.password.mockResolvedValue('');
    h.testConnectorWithTimeout.mockResolvedValue({ connection: true, validation: true, latency: 1 });

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    // Prompt is offered and marked optional, but nothing is persisted.
    expect(h.password.mock.calls[0][0].message).toContain('optional');
    expect(h.password.mock.calls[0][0].validate('')).toBeUndefined();
    expect(h.testConnectorWithTimeout.mock.calls[0][1]).toEqual({});
    expect(h.envWrite).not.toHaveBeenCalled();
  });

  it('persists an optional credential the user does provide', async () => {
    h.multiselect.mockResolvedValue(['optoma']);
    h.password.mockResolvedValue('http://ollama.internal:4242');
    h.testConnectorWithTimeout.mockResolvedValue({ connection: true, validation: true, latency: 1 });

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    expect(h.envWrite).toHaveBeenCalledWith({ OPTOMA_HOST: 'http://ollama.internal:4242' });
  });

  it('still requires a non-optional credential', async () => {
    h.multiselect.mockResolvedValue(['mocktor']);
    h.testConnectorWithTimeout.mockResolvedValue({ connection: true, validation: true, latency: 1 });

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    const validate = h.password.mock.calls[0][0].validate;
    expect(validate('')).toBe('MOCKTOR_API_KEY is required');
    expect(validate('x'.repeat(2049))).toContain('too long');
    expect(validate('fine')).toBeUndefined();
  });

  it('hex-escapes a hostile dependency version before echoing it', async () => {
    // fw.version comes straight out of the project's package.json — the
    // untrusted input this command exists to read (CWE-117, ADR-0001).
    h.detectFrameworks.mockResolvedValue([
      { name: 'optoma', package: '@blackunicorn/bonklm-optoma', version: '1.0.0\u001b[2Jspoofed' }
    ]);
    h.multiselect.mockResolvedValue([]);

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    const line = h.log.success.mock.calls
      .flat()
      .map(String)
      .find(m => m.includes('Found optoma'));
    expect(line).toBeDefined();
    expect(line).not.toContain('\u001b');
    expect(line).toContain('\\x1b');
  });

  it('omits the parenthesised version when a dependency declares none', async () => {
    h.detectFrameworks.mockResolvedValue([{ name: 'optoma', package: '@blackunicorn/bonklm-optoma' }]);
    h.multiselect.mockResolvedValue([]);

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    const line = h.log.success.mock.calls
      .flat()
      .map(String)
      .find(m => m.includes('Found optoma'));
    expect(line).toBe('Found optoma');
  });

  it('continues when service detection throws its own timeout', async () => {
    h.detectServices.mockRejectedValue(new Error('DETECTION_TIMEOUT'));
    h.multiselect.mockResolvedValue([]);

    const cmd = await loadWizard();
    await expect(cmd.parseAsync([], { from: 'user' })).resolves.toBeDefined();

    const warns = h.log.warn.mock.calls.flat().map(String).join('\n');
    expect(warns).toContain('No services detected');
  });

  it('hex-escapes a hostile masked credential before echoing it', async () => {
    h.detectCredentials.mockResolvedValue([
      { name: 'optoma', key: 'OPTOMA_HOST', maskedValue: 'ht\u001b[2J**4242', present: true },
      { name: 'absent', key: 'ABSENT_KEY', maskedValue: 'not set', present: false }
    ]);
    h.multiselect.mockResolvedValue([]);

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    const line = h.log.success.mock.calls
      .flat()
      .map(String)
      .find(m => m.includes('Found optoma ('));
    expect(line).toBeDefined();
    expect(line).not.toContain('\u001b');
    expect(line).toContain('\\x1b');
  });

  it('names the env vars it is about to copy from the environment into .env', async () => {
    process.env.OPTOMA_HOST = 'http://optoma.internal:4242';
    try {
      h.multiselect.mockResolvedValue(['optoma']);
      h.confirm.mockResolvedValue(true);
      h.testConnectorWithTimeout.mockResolvedValue({ connection: true, validation: true, latency: 1 });

      const cmd = await loadWizard();
      await cmd.parseAsync([], { from: 'user' });

      expect(h.confirm.mock.calls[0][0].message).toContain('OPTOMA_HOST');
      expect(h.confirm.mock.calls[0][0].message).toContain('.env');
      // Copying an ambient secret onto disk must not happen by holding Enter.
      expect(h.confirm.mock.calls[0][0].initialValue).toBe(false);
      expect(h.envWrite).toHaveBeenCalledWith({ OPTOMA_HOST: 'http://optoma.internal:4242' });
      expect(h.password).not.toHaveBeenCalled();
    } finally {
      delete process.env.OPTOMA_HOST;
    }
  });

  it('re-prompts when the user declines the detected environment credentials', async () => {
    process.env.OPTOMA_HOST = 'http://optoma.internal:4242';
    try {
      h.multiselect.mockResolvedValue(['optoma']);
      h.confirm.mockResolvedValue(false);
      h.password.mockResolvedValue('http://typed.internal:4242');
      h.testConnectorWithTimeout.mockResolvedValue({ connection: true, validation: true, latency: 1 });

      const cmd = await loadWizard();
      await cmd.parseAsync([], { from: 'user' });

      expect(h.password).toHaveBeenCalled();
      expect(h.envWrite).toHaveBeenCalledWith({ OPTOMA_HOST: 'http://typed.internal:4242' });
    } finally {
      delete process.env.OPTOMA_HOST;
    }
  });

  it('reports when no credentials are present in the environment', async () => {
    h.detectCredentials.mockResolvedValue([]);
    h.multiselect.mockResolvedValue([]);

    const cmd = await loadWizard();
    await cmd.parseAsync([], { from: 'user' });

    const warns = h.log.warn.mock.calls.flat().map(String).join('\n');
    expect(warns).toContain('No credentials detected');
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
    h.multiselect.mockResolvedValue(['no-such-connector']);

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
