/**
 * Connector Add Command Tests
 *
 * Structural tests for the command surface plus action-level tests that drive
 * the add command with mocked prompt / validator / env / audit seams. The
 * action-level suites pin the command's human-path TTY output sanitization:
 * every sink that interpolates connector-supplied or user-supplied text routes
 * it through `sanitizeMeta` so a hostile/buggy provider or a crafted CLI
 * argument cannot echo raw ANSI / control / bidi / line-separator sequences to
 * the terminal. Two scopes are covered: the connection-test failure and
 * catch-all error sinks, and the residual id-echo,
 * existing-credential-display, and ERROR-code wizard-message sinks.
 * Credential redaction stays a `--json`-only concern (the CLI-wide human-path
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
    // 'ghostless' is registered in the id list but has NO connector definition
    // (getConnector resolves undefined for it), so a test can reach the
    // unknown-connector sink: validateConnectorId passes (format + id-list
    // membership) yet getConnector returns falsy.
    getConnectorIds: () => [...actual.getConnectorIds(), 'mocktor', 'ghostless']
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

describe('connector add action — human-path output sanitization', () => {
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

describe('connector add action — residual TTY-sink sanitization', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    primeActionMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    delete process.env.MOCKTOR_API_KEY;
  });

  it('hex-escapes control chars in the invalid-connector-id cancel message', async () => {
    // A hostile <id> that fails the `[a-z][a-z0-9-]*` format guard reaches the
    // "Invalid connector ID" sink with attacker-controlled bytes. The echoed id
    // must be neutralised (CWE-117), as connector-test does for its echoed id.
    const cmd = await loadConnectorAdd();
    await expect(cmd.parseAsync(['BAD\u001b[31mid'], { from: 'user' })).rejects.toThrow('process.exit called');

    const cancelMsg = String(h.cancel.mock.calls[0]?.[0]);
    expect(cancelMsg).toContain('Invalid connector ID');
    expect(cancelMsg).not.toContain('\u001b');
    expect(cancelMsg).toContain('\\x1b');
  });

  it('echoes the connector id through safeId in the unknown-connector sink', async () => {
    // 'ghostless' is in the id list but has no connector definition, so it
    // passes validateConnectorId and reaches the unknown-connector sink. A
    // hostile id is unreachable here (the [a-z][a-z0-9-]* format guard runs
    // first), so this covers the safeId wiring + byte-identical passthrough for
    // a clean id rather than a control-char escape.
    const cmd = await loadConnectorAdd();
    await expect(cmd.parseAsync(['ghostless'], { from: 'user' })).rejects.toThrow('process.exit called');

    const cancelMsg = String(h.cancel.mock.calls[0]?.[0]);
    expect(cancelMsg).toBe('Unknown connector: ghostless');
  });

  it('passes a benign (but format-invalid) id through unchanged', async () => {
    // Regression guard: sanitization must not mangle an ordinary id. 'Bad-Upper'
    // fails the lowercase-led format (uppercase) but carries no control/bidi
    // chars, so the message is byte-identical to the raw interpolation.
    const cmd = await loadConnectorAdd();
    await expect(cmd.parseAsync(['Bad-Upper'], { from: 'user' })).rejects.toThrow('process.exit called');

    const cancelMsg = String(h.cancel.mock.calls[0]?.[0]);
    expect(cancelMsg).toBe('Invalid connector ID: Bad-Upper');
  });

  it('hex-escapes control chars surfaced by maskKey when displaying existing credentials', async () => {
    // maskKey echoes the first-2 / last-4 chars of the raw credential verbatim.
    // A credential whose edge chars include a control byte would otherwise reach
    // the TTY through the existing-credentials display sink. Both edges carry a
    // raw ESC here so maskKey's output (and thus the sink) must be sanitized.
    // The value must exceed maskKey's MIN_VISIBLE_LENGTH (8) so it takes the
    // prefix/suffix branch and the ESC edge chars survive masking (a shorter
    // value would mask to '***', exposing no edges).
    process.env.MOCKTOR_API_KEY = `\u001bAB${'x'.repeat(12)}YZ\u001b`;
    h.confirm.mockResolvedValue(true); // accept the existing credentials

    const cmd = await loadConnectorAdd();
    // --force skips the connection test; the credential display happens before it.
    await cmd.parseAsync(['mocktor', '--force'], { from: 'user' });

    const credLine = h.log.message.mock.calls.map(c => String(c[0])).find(m => m.includes('MOCKTOR_API_KEY'));
    expect(credLine).toBeDefined();
    expect(credLine).not.toContain('\u001b');
    expect(credLine).toContain('\\x1b');
  });

  it('hex-escapes control chars in an ERROR-code WizardError cancel message', async () => {
    // The catch block echoes an ExitCode.ERROR WizardError's message verbatim.
    // Today those messages are static literals; this guards the latent path so a
    // future interpolated message cannot carry control sequences to the TTY.
    h.testConnectorWithTimeout.mockResolvedValue({ connection: true, validation: true, latency: 3 });

    const cmd = await loadConnectorAdd();
    // Import error.js AFTER loadConnectorAdd: it runs vi.resetModules(), so this
    // resolves the SAME module instance the reloaded action imports — otherwise
    // `error instanceof WizardError` would be false and the throw would fall
    // through to the catch-all sink, making this assertion vacuous for :226.
    const { WizardError, ExitCode } = await import('../utils/error.js');
    h.envWrite.mockRejectedValue(
      new WizardError('ENV_WRITE_FAILED', 'write blew up\u001b[2J', undefined, undefined, ExitCode.ERROR)
    );

    await expect(cmd.parseAsync(['mocktor'], { from: 'user' })).rejects.toThrow('process.exit called');

    const cancelMsg = String(h.cancel.mock.calls[0]?.[0]);
    expect(cancelMsg).not.toContain('\u001b');
    expect(cancelMsg).toContain('\\x1b');
  });
});
