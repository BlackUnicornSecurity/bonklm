/**
 * Status Command Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { statusCommand } from './status.js';

/** Hoisted mocks for the action-level suite below. */
const h = vi.hoisted(() => ({
  detectFrameworks: vi.fn(),
  detectServices: vi.fn(),
  detectCredentials: vi.fn(),
  envRead: vi.fn()
}));

vi.mock('../detection/framework.js', () => ({ detectFrameworks: h.detectFrameworks }));
vi.mock('../detection/services.js', () => ({ detectServices: h.detectServices }));
vi.mock('../detection/credentials.js', () => ({ detectCredentials: h.detectCredentials }));
vi.mock('../config/env.js', () => ({
  EnvManager: class {
    read = h.envRead;
  }
}));

/** Re-imports the command so each parse gets a fresh commander instance. */
async function loadStatus(): Promise<typeof statusCommand> {
  vi.resetModules();
  const mod = await import('./status.js');
  return mod.statusCommand;
}

describe('status command', () => {
  it('should be defined', () => {
    expect(statusCommand).toBeDefined();
  });

  it('should have correct name', () => {
    expect(statusCommand.name()).toBe('status');
  });

  it('should have description', () => {
    expect(statusCommand.description()).toBeTruthy();
  });

  it('should have --json option', () => {
    const options = statusCommand.options;
    const jsonOption = options.find(opt => opt.long === '--json');
    expect(jsonOption).toBeDefined();
  });

  it('should be properly configured', () => {
    expect(statusCommand).toHaveProperty('options');
  });
});

describe('status action', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    h.detectFrameworks.mockResolvedValue([]);
    h.detectServices.mockResolvedValue([]);
    h.detectCredentials.mockResolvedValue([]);
    h.envRead.mockResolvedValue({});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  /** All console.log output from the last run, joined. */
  const output = (): string => logSpy.mock.calls.flat().map(String).join('\n');

  it('renders every registered connector', async () => {
    const cmd = await loadStatus();
    await cmd.parseAsync([], { from: 'user' });

    expect(output()).toContain('BonkLM Environment Status');
    expect(output()).toContain('(openai)');
    expect(output()).toContain('(qdrant)');
  });

  it('degrades to an empty framework list when the package.json read times out', async () => {
    // readProjectDependencies is now timeout-bounded and throws DETECTION_TIMEOUT;
    // a best-effort phase must not take `bonklm status` down with it.
    h.detectFrameworks.mockRejectedValue(new Error('DETECTION_TIMEOUT'));

    const cmd = await loadStatus();
    await expect(cmd.parseAsync([], { from: 'user' })).resolves.toBeDefined();

    expect(output()).toContain('No frameworks detected');
  });

  it('lists unavailable services separately from available ones', async () => {
    h.detectServices.mockResolvedValue([
      { name: 'ollama', type: 'port', available: true, address: 'localhost:11434' },
      { name: 'qdrant', type: 'port', available: false, address: 'localhost:6333' }
    ]);

    const cmd = await loadStatus();
    await cmd.parseAsync([], { from: 'user' });

    expect(output()).toContain('(Unavailable: qdrant)');
  });

  it('degrades to an empty service list when service detection throws', async () => {
    // detectServices enforces its own timeout by THROWING. A best-effort
    // detection phase must not take `bonklm status` down with it.
    h.detectServices.mockRejectedValue(new Error('DETECTION_TIMEOUT'));

    const cmd = await loadStatus();
    await expect(cmd.parseAsync([], { from: 'user' })).resolves.toBeDefined();

    expect(output()).toContain('No services detected');
  });

  it('degrades to an empty .env when the file cannot be read', async () => {
    h.envRead.mockRejectedValue(new Error('EACCES'));

    const cmd = await loadStatus();
    await cmd.parseAsync([], { from: 'user' });

    expect(output()).toContain('Configured in .env: None');
  });

  it('reports detected frameworks, services and masked credentials', async () => {
    h.detectFrameworks.mockResolvedValue([{ name: 'express', package: 'express', version: '^4.18.0' }]);
    h.detectServices.mockResolvedValue([
      { name: 'ollama', type: 'port', available: true, address: 'localhost:11434' },
      { name: 'qdrant', type: 'port', available: false, address: 'localhost:6333' }
    ]);
    h.detectCredentials.mockResolvedValue([
      { name: 'openai', key: 'OPENAI_API_KEY', maskedValue: 'sk****1234', present: true }
    ]);
    h.envRead.mockResolvedValue({ OPENAI_API_KEY: 'sk-secret-value-1234' });

    const cmd = await loadStatus();
    await cmd.parseAsync([], { from: 'user' });

    expect(output()).toContain('express');
    expect(output()).toContain('ollama');
    expect(output()).toContain('(Unavailable: qdrant)');
    expect(output()).toContain('sk****1234');
    // The .env value is masked, never printed raw.
    expect(output()).not.toContain('sk-secret-value-1234');
  });

  it('hex-escapes hostile values before the terminal', async () => {
    // Same sinks the wizard hardens: a dependency version and a masked
    // credential, both carrying raw bytes from untrusted input (CWE-117).
    h.detectFrameworks.mockResolvedValue([{ name: 'express', package: 'express', version: '4.0.0\u001b[2Kforged' }]);
    h.detectCredentials.mockResolvedValue([
      { name: 'openai', key: 'OPENAI_API_KEY', maskedValue: 'sk\u001b[2K**1234', present: true }
    ]);
    h.envRead.mockResolvedValue({ OPENAI_API_KEY: '\u001b[2Ksecret-value-here' });

    const cmd = await loadStatus();
    await cmd.parseAsync([], { from: 'user' });

    expect(output()).not.toContain('\u001b');
    expect(output()).toContain('\\x1b');
  });

  it('hex-escapes hostile values in --json output too', async () => {
    h.detectFrameworks.mockResolvedValue([
      { name: 'express', package: 'express', version: '4.0.0\u2028forged' },
      // A dependency with no resolvable version must pass through as undefined
      // rather than becoming the string "undefined".
      { name: 'optoma', package: '@blackunicorn/bonklm-optoma' }
    ]);
    h.detectCredentials.mockResolvedValue([
      { name: 'openai', key: 'OPENAI_API_KEY', maskedValue: 'sk\u2028**1234', present: true }
    ]);

    const cmd = await loadStatus();
    await cmd.parseAsync(['--json'], { from: 'user' });

    // JSON.stringify alone leaves U+2028 intact for the consumer.
    expect(output()).not.toContain('\u2028');
    const parsed = JSON.parse(output()) as { frameworks: Array<{ name: string; version?: string }> };
    expect(parsed.frameworks.find(f => f.name === 'optoma')?.version).toBeUndefined();
  });

  it('emits JSON with masked credentials when --json is set', async () => {
    h.detectCredentials.mockResolvedValue([
      { name: 'openai', key: 'OPENAI_API_KEY', maskedValue: 'sk****1234', present: true }
    ]);

    const cmd = await loadStatus();
    await cmd.parseAsync(['--json'], { from: 'user' });

    const parsed = JSON.parse(output()) as { credentials: Array<{ maskedValue: string }>; available: unknown[] };
    expect(parsed.credentials[0].maskedValue).toBe('sk****1234');
    expect(parsed.available.length).toBeGreaterThan(40);
  });
});
