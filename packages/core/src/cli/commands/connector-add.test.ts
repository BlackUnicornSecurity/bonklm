/**
 * Connector Add Command Tests
 *
 * Structural tests for the command surface plus action-level tests that drive
 * the add command with mocked prompt / validator / env / audit seams. The
 * action-level suite pins the human-path output sanitization (D-035): the two
 * `p.cancel(...)` sinks that interpolate connector-supplied error text must
 * route it through `sanitizeMeta` so a hostile/buggy provider cannot echo
 * raw ANSI / control / line-separator sequences to the terminal. Credential
 * redaction stays a `--json`-only concern (the CLI-wide human-path
 * convention); `connector add` has no `--json` path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectorAddCommand } from './connector-add.js';
import type { ConnectorDefinition } from '../connectors/base.js';

const h = vi.hoisted(() => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    message: vi.fn()
  },
  password: vi.fn(),
  confirm: vi.fn(),
  testConnectorWithTimeout: vi.fn(),
  envWrite: vi.fn(),
  auditLog: vi.fn()
}));

vi.mock('@clack/prompts', () => ({
  intro: h.intro,
  outro: h.outro,
  cancel: h.cancel,
  log: h.log,
  password: h.password,
  confirm: h.confirm,
  // The mocked prompts only ever resolve strings, never the clack cancellation
  // symbol, so a symbol check is a faithful isCancel stand-in.
  isCancel: (value: unknown) => typeof value === 'symbol'
}));

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
  // A registry connector whose `test()` we drive via the mocked
  // `testConnectorWithTimeout`, so the add action reaches its error sinks
  // without a real provider call.
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
 * Re-imports the add module so each action-level test gets a fresh commander
 * instance (argument/option state would otherwise leak between parses).
 */
async function loadConnectorAdd(): Promise<typeof connectorAddCommand> {
  vi.resetModules();
  const mod = await import('./connector-add.js');
  return mod.connectorAddCommand;
}

/**
 * Shared mock defaults for the action-level suite: resolved env/audit sinks and
 * a password prompt that returns a fixed value, with no pre-existing env
 * credential (so the action collects via the prompt).
 */
function primeActionMocks(): void {
  vi.clearAllMocks();
  h.envWrite.mockResolvedValue(undefined);
  h.auditLog.mockResolvedValue(undefined);
  h.password.mockResolvedValue('mocktor-secret-value');
  delete process.env.MOCKTOR_API_KEY;
}

describe('connector add command', () => {
  it('should be defined', () => {
    expect(connectorAddCommand).toBeDefined();
  });

  it('should have correct name', () => {
    expect(connectorAddCommand.name()).toBe('add');
  });

  it('should have description', () => {
    expect(connectorAddCommand.description()).toBeTruthy();
    expect(connectorAddCommand.description()).toContain('connector');
  });

  it('should have id argument', () => {
    // Commander exposes registered arguments via the public `registeredArguments`
    // accessor (the internal `_args` it replaced predates commander 11).
    const args = connectorAddCommand.registeredArguments;
    expect(args).toBeDefined();
    expect(args.length).toBe(1);
  });

  it('should have --force option', () => {
    const options = connectorAddCommand.options;
    const forceOption = options.find(opt => opt.long === '--force');
    expect(forceOption).toBeDefined();
  });

  it('should be properly configured', () => {
    expect(connectorAddCommand).toHaveProperty('registeredArguments');
    expect(connectorAddCommand).toHaveProperty('options');
  });
});

describe('connector add action — human-path output sanitization (D-035)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    primeActionMocks();
    // Both error sinks call process.exit(1); make it throw so the action halts
    // instead of tearing down the test runner.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('hex-escapes control / line-separator chars in a failed-test cancel message', async () => {
    // Connector-supplied failure text carrying a raw ANSI sequence (ESC) and a
    // U+2028 line separator — both must be neutralised before reaching the TTY.
    const hostileError = 'auth refused\u001b[31m\u2028injected line';
    h.testConnectorWithTimeout.mockResolvedValue({
      connection: false,
      validation: false,
      error: hostileError
    });

    const cmd = await loadConnectorAdd();
    await expect(cmd.parseAsync(['mocktor'], { from: 'user' })).rejects.toThrow('process.exit called');

    // First cancel is the failed-test sink (the rethrown process.exit then
    // routes through the catch-all; assert the sink-A message specifically).
    const cancelMsg = String(h.cancel.mock.calls[0]?.[0]);
    expect(cancelMsg).toContain('Connector test failed');
    expect(cancelMsg).not.toContain('\u001b');
    expect(cancelMsg).toContain('\\x1b');
    expect(cancelMsg).not.toContain('\u2028');
    expect(cancelMsg).toContain('\\n');
  });

  it('hex-escapes control chars in the catch-all error cancel message', async () => {
    // A thrown (rejected) connector error whose message carries a raw ANSI
    // clear-screen sequence reaches the generic catch-all sink.
    h.testConnectorWithTimeout.mockRejectedValue(new Error('boom\u001b[2Jcleared'));

    const cmd = await loadConnectorAdd();
    await expect(cmd.parseAsync(['mocktor'], { from: 'user' })).rejects.toThrow('process.exit called');

    const cancelMsg = String(h.cancel.mock.calls[0]?.[0]);
    expect(cancelMsg).toContain('Error:');
    expect(cancelMsg).not.toContain('\u001b');
    expect(cancelMsg).toContain('\\x1b');
  });

  it('passes through a benign failure message unchanged', async () => {
    // Regression guard: sanitization must not mangle ordinary error prose.
    h.testConnectorWithTimeout.mockResolvedValue({
      connection: false,
      validation: false,
      error: 'invalid api key'
    });

    const cmd = await loadConnectorAdd();
    await expect(cmd.parseAsync(['mocktor'], { from: 'user' })).rejects.toThrow('process.exit called');

    const cancelMsg = String(h.cancel.mock.calls[0]?.[0]);
    expect(cancelMsg).toBe('Connector test failed: invalid api key');
  });
});
