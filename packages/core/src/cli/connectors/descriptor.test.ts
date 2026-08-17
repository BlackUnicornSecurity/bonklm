/**
 * Tests for the connector descriptor factory.
 *
 * These pin the translation from declarative descriptor to
 * {@link ConnectorDefinition}: detection rules, credential wiring, the two
 * probes, and the generated snippet. Every catalog connector is produced by
 * this function, so a regression here silently breaks 46 connectors at once.
 *
 * @module connectors/descriptor.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineConnector, type ConnectorDescriptor } from './descriptor.js';
import { WizardError } from '../utils/error.js';

const readProjectDependencies = vi.hoisted(() => vi.fn());
const checkPort = vi.hoisted(() => vi.fn());

vi.mock('../detection/project-deps.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../detection/project-deps.js')>();
  return { ...actual, readProjectDependencies };
});

vi.mock('../detection/port.js', () => ({ checkPort }));

/** Minimal descriptor used as the base for the cases below. */
const BASE: ConnectorDescriptor = {
  id: 'acme',
  name: 'Acme',
  category: 'llm',
  npmPackage: '@blackunicorn/bonklm-acme',
  summary: 'Guard the Acme API.'
};

/** Builds a dependency map in the shape readProjectDependencies returns. */
function deps(dependencies: Record<string, string> = {}, devDependencies: Record<string, string> = {}) {
  return { dependencies, devDependencies };
}

beforeEach(() => {
  vi.clearAllMocks();
  readProjectDependencies.mockResolvedValue(deps());
  checkPort.mockResolvedValue(false);
});

describe('defineConnector — identity and detection', () => {
  it('carries id, name, category and npmPackage through', () => {
    const connector = defineConnector(BASE);
    expect(connector.id).toBe('acme');
    expect(connector.name).toBe('Acme');
    expect(connector.category).toBe('llm');
    expect(connector.npmPackage).toBe('@blackunicorn/bonklm-acme');
  });

  it('always detects the connector package itself, then its peers', () => {
    const connector = defineConnector({ ...BASE, peerPackages: ['acme-sdk', '@acme/client'] });
    expect(connector.detection.packageJson).toEqual(['@blackunicorn/bonklm-acme', 'acme-sdk', '@acme/client']);
  });

  it('omits detection fields that were not declared', () => {
    const connector = defineConnector(BASE);
    expect(connector.detection.envVars).toBeUndefined();
    expect(connector.detection.ports).toBeUndefined();
    expect(connector.detection.dockerContainers).toBeUndefined();
    expect(connector.configKeyByEnvVar).toBeUndefined();
    expect(connector.credentialFormats).toBeUndefined();
    expect(connector.optionalEnvVars).toBeUndefined();
  });

  it('passes ports and docker patterns through', () => {
    const connector = defineConnector({ ...BASE, ports: [6333], dockerContainers: ['acme'] });
    expect(connector.detection.ports).toEqual([6333]);
    expect(connector.detection.dockerContainers).toEqual(['acme']);
  });

  it('returns a frozen definition so nothing mutates a shared connector', () => {
    const connector = defineConnector(BASE);
    expect(Object.isFrozen(connector)).toBe(true);
    expect(Object.isFrozen(connector.detection)).toBe(true);
  });
});

describe('defineConnector — credentials', () => {
  const withKey: ConnectorDescriptor = {
    ...BASE,
    credentials: [{ env: 'ACME_API_KEY', configKey: 'apiKey', prefix: 'ak-' }]
  };

  it('maps the env var to its config key', () => {
    expect(defineConnector(withKey).configKeyByEnvVar).toEqual({ ACME_API_KEY: 'apiKey' });
  });

  it('exposes a declared prefix as an input-format hint', () => {
    expect(defineConnector(withKey).credentialFormats).toEqual({ ACME_API_KEY: { prefix: 'ak-' } });
  });

  it('carries a custom credential label into the hint', () => {
    const connector = defineConnector({
      ...BASE,
      credentials: [{ env: 'ACME_SECRET', configKey: 'secret', prefix: 'as-', label: 'HMAC secret' }]
    });
    expect(connector.credentialFormats).toEqual({ ACME_SECRET: { prefix: 'as-', label: 'HMAC secret' } });
  });

  it('declares no format hint for a credential with no prefix', () => {
    const connector = defineConnector({ ...BASE, credentials: [{ env: 'ACME_API_KEY', configKey: 'apiKey' }] });
    expect(connector.credentialFormats).toBeUndefined();
    expect(connector.configKeyByEnvVar).toEqual({ ACME_API_KEY: 'apiKey' });
  });

  it('marks detect-only env vars optional but keeps credentials required', () => {
    const connector = defineConnector({
      ...BASE,
      credentials: [{ env: 'ACME_API_KEY', configKey: 'apiKey' }],
      detectEnvVars: ['ACME_API_KEY', 'ACME_REGION']
    });
    expect(connector.detection.envVars).toEqual(['ACME_API_KEY', 'ACME_REGION']);
    expect(connector.optionalEnvVars).toEqual(['ACME_REGION']);
  });

  it('validates config against the declared prefix', () => {
    const schema = defineConnector(withKey).configSchema;
    expect(schema.safeParse({ apiKey: 'ak-live-1' }).success).toBe(true);
    expect(schema.safeParse({ apiKey: 'wrong' }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('rejects an empty value for a credential with no prefix', () => {
    const schema = defineConnector({
      ...BASE,
      credentials: [{ env: 'ACME_API_KEY', configKey: 'apiKey' }]
    }).configSchema;
    expect(schema.safeParse({ apiKey: 'anything' }).success).toBe(true);
    expect(schema.safeParse({ apiKey: '' }).success).toBe(false);
  });

  it('accepts any config for a credential-free connector', () => {
    expect(defineConnector(BASE).configSchema.safeParse({}).success).toBe(true);
  });
});

describe('defineConnector — installed probe', () => {
  it('passes when the connector package is present', async () => {
    readProjectDependencies.mockResolvedValue(deps({ '@blackunicorn/bonklm-acme': '^1.0.0' }));
    await expect(defineConnector(BASE).test({})).resolves.toEqual({ connection: true, validation: true });
  });

  it('passes when only the upstream SDK is present', async () => {
    readProjectDependencies.mockResolvedValue(deps({}, { 'acme-sdk': '^2.0.0' }));
    const connector = defineConnector({ ...BASE, peerPackages: ['acme-sdk'] });
    await expect(connector.test({})).resolves.toEqual({ connection: true, validation: true });
  });

  it('fails with an install hint when nothing is present', async () => {
    const result = await defineConnector(BASE).test({});
    expect(result.connection).toBe(false);
    expect(result.validation).toBe(false);
    expect(result.error).toContain('npm install @blackunicorn/bonklm-acme');
  });

  it('fails before touching the filesystem when a credential is missing', async () => {
    const connector = defineConnector({
      ...BASE,
      credentials: [{ env: 'ACME_API_KEY', configKey: 'apiKey', label: 'API key' }]
    });
    const result = await connector.test({});
    expect(result.error).toBe('API key is required (ACME_API_KEY)');
    expect(readProjectDependencies).not.toHaveBeenCalled();
  });

  it('fails when a credential does not match its declared prefix', async () => {
    const connector = defineConnector({
      ...BASE,
      credentials: [{ env: 'ACME_API_KEY', configKey: 'apiKey', prefix: 'ak-' }]
    });
    const result = await connector.test({ apiKey: 'nope' });
    expect(result.error).toBe('API key must start with "ak-"');
    expect(readProjectDependencies).not.toHaveBeenCalled();
  });

  it('passes when a prefixed credential is well-formed and the package is present', async () => {
    readProjectDependencies.mockResolvedValue(deps({ '@blackunicorn/bonklm-acme': '^1.0.0' }));
    const connector = defineConnector({
      ...BASE,
      credentials: [{ env: 'ACME_API_KEY', configKey: 'apiKey', prefix: 'ak-' }]
    });
    await expect(connector.test({ apiKey: 'ak-live-1' })).resolves.toEqual({ connection: true, validation: true });
  });

  it('does not read an inherited property as a credential value', async () => {
    const connector = defineConnector({ ...BASE, credentials: [{ env: 'ACME_KEY', configKey: 'toString' }] });
    const result = await connector.test({});
    expect(result.connection).toBe(false);
    expect(result.error).toContain('required');
  });

  it('reports a hostile package.json as a failed test instead of crashing', async () => {
    readProjectDependencies.mockRejectedValue(new WizardError('PATH_TRAVERSAL', 'package.json escaped the project'));
    const result = await defineConnector(BASE).test({});
    expect(result).toEqual({
      connection: false,
      validation: false,
      error: 'package.json escaped the project'
    });
  });

  it('reports a non-Error rejection without leaking its shape', async () => {
    readProjectDependencies.mockRejectedValue('boom');
    await expect(defineConnector(BASE).test({})).resolves.toMatchObject({ error: 'Unknown error' });
  });
});

describe('defineConnector — tcp probe', () => {
  const tcpDescriptor: ConnectorDescriptor = { ...BASE, probe: { kind: 'tcp', port: 6333 } };

  it('passes when the port accepts a connection', async () => {
    checkPort.mockResolvedValue(true);
    await expect(defineConnector(tcpDescriptor).test({})).resolves.toEqual({ connection: true, validation: true });
    expect(checkPort).toHaveBeenCalledWith('localhost', 6333, expect.any(Number));
  });

  it('fails with the address when nothing is listening', async () => {
    const result = await defineConnector(tcpDescriptor).test({});
    expect(result).toEqual({
      connection: false,
      validation: false,
      error: 'No service listening on localhost:6333'
    });
  });

  it('honours a custom host', async () => {
    await defineConnector({ ...BASE, probe: { kind: 'tcp', port: 6333, host: 'db.internal' } }).test({});
    expect(checkPort).toHaveBeenCalledWith('db.internal', 6333, expect.any(Number));
  });

  it('does not read package.json for a tcp connector', async () => {
    await defineConnector(tcpDescriptor).test({});
    expect(readProjectDependencies).not.toHaveBeenCalled();
  });
});

describe('defineConnector — generated snippet', () => {
  it('names the real package and summary', () => {
    const snippet = defineConnector(BASE).generateSnippet({});
    expect(snippet).toContain("from '@blackunicorn/bonklm-acme'");
    expect(snippet).toContain('Guard the Acme API.');
    expect(snippet).toContain('createConnector(engine, {});');
  });

  it('wires declared credentials through process.env', () => {
    const snippet = defineConnector({
      ...BASE,
      credentials: [{ env: 'ACME_API_KEY', configKey: 'apiKey' }]
    }).generateSnippet({});
    expect(snippet).toContain('apiKey: process.env.ACME_API_KEY,');
  });

  it('never interpolates the user config into the snippet', () => {
    const snippet = defineConnector({
      ...BASE,
      credentials: [{ env: 'ACME_API_KEY', configKey: 'apiKey' }]
    }).generateSnippet({ apiKey: 'ak-super-secret' });
    expect(snippet).not.toContain('ak-super-secret');
  });
});
