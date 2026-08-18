/**
 * Connector config-key mapping — end-to-end regression with the REAL connectors.
 *
 * Proves the user-facing acceptance for `bonklm connector test|add openai|anthropic`
 * and the wizard test step: the actual openai/anthropic connector definitions, fed
 * an env-var-keyed credential bag exactly as the CLI loaders build it
 * (`{ OPENAI_API_KEY: ... }`), reach a populated `config.apiKey` through the shared
 * `testConnector` seam and report success — instead of the former "API key is
 * required" false failure.
 *
 * The outbound key check (`validateApiKeySecure`) is mocked, so the test exercises
 * the env-var -> config.apiKey wiring with no network call. Complements the seam +
 * mapper unit tests in `validator.test.ts`: those pin the mapping in isolation, this
 * pins the real connector definitions + the live `connector test` command path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// openai/anthropic test() call validateApiKeySecure(apiKey, ...) and map its
// boolean result to connection/validation. Override only that export (keep the
// module's other members real) so the connector runs without a live API call.
vi.mock('../utils/validation.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/validation.js')>();
  return { ...actual, validateApiKeySecure: vi.fn() };
});

import { validateApiKeySecure } from '../utils/validation.js';
import { testConnector } from './validator.js';
import { runConnectorTest } from '../commands/connector-test.js';
import { openaiConnector } from '../connectors/implementations/openai.js';
import { anthropicConnector } from '../connectors/implementations/anthropic.js';

const mockValidate = vi.mocked(validateApiKeySecure);

describe('connector config-key mapping (end-to-end, real connectors)', () => {
  beforeEach(() => {
    mockValidate.mockReset();
  });

  it('openai: a valid OPENAI_API_KEY reaches config.apiKey and reports success', async () => {
    mockValidate.mockResolvedValue(true);

    const result = await testConnector(openaiConnector, { OPENAI_API_KEY: 'sk-valid' });

    expect(result.connection).toBe(true);
    expect(result.validation).toBe(true);
    expect(result.error).toBeUndefined();
    // The seam re-keyed OPENAI_API_KEY -> apiKey, so the real key reached the check.
    expect(mockValidate).toHaveBeenCalledWith(
      'sk-valid',
      expect.objectContaining({ testEndpoint: expect.any(String) })
    );
  });

  it('anthropic: a valid ANTHROPIC_API_KEY reaches config.apiKey and reports success', async () => {
    mockValidate.mockResolvedValue(true);

    const result = await testConnector(anthropicConnector, { ANTHROPIC_API_KEY: 'sk-ant-valid' });

    expect(result.connection).toBe(true);
    expect(result.validation).toBe(true);
    expect(mockValidate).toHaveBeenCalledWith(
      'sk-ant-valid',
      expect.objectContaining({ testEndpoint: expect.any(String) })
    );
  });

  it('runConnectorTest openai: an env-var-keyed bag from the loader yields status ok / exit 0', async () => {
    mockValidate.mockResolvedValue(true);
    const audit = { log: vi.fn().mockResolvedValue(undefined) };

    // Inject only loadConfig (the loader's env-var-keyed shape) + audit; the real
    // testConnectorWithTimeout -> testConnector -> applyConnectorConfigKeys runs.
    const report = await runConnectorTest('openai', {
      loadConfig: async () => ({ OPENAI_API_KEY: 'sk-valid' }),
      audit
    });

    expect(report.status).toBe('ok');
    expect(report.exitCode).toBe(0);
    expect(report.result?.connection).toBe(true);
    expect(report.result?.validation).toBe(true);
    expect(mockValidate).toHaveBeenCalledWith('sk-valid', expect.anything());
  });
});
