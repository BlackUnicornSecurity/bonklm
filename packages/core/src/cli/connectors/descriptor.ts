/**
 * Connector descriptors
 *
 * A descriptor is the declarative, data-only form of a connector: what to look
 * for in the user's project, which credentials it needs, and how to test it.
 * {@link defineConnector} turns one into a full {@link ConnectorDefinition}, so
 * the wizard automates detection + configuration + test for a connector without
 * anyone hand-writing a definition module.
 *
 * Why data rather than code-per-connector: BonkLM ships 50+ connector packages
 * and every connector package depends on core, so core cannot import them back
 * (dependency cycle) — the catalog therefore lives here as plain data, and
 * `registry.test.ts` audits it against the workspace manifests so a new
 * connector package cannot ship unregistered.
 *
 * Hand-written definitions remain supported and take precedence; the five
 * reference connectors under `implementations/` keep their tuned code snippets.
 *
 * @module connectors/descriptor
 */

import { z } from 'zod';
import type { ConnectorCategory, ConnectorDefinition, CredentialFormat, TestResult } from './base.js';
import { checkPort } from '../detection/port.js';
import { lookupDependency, readProjectDependencies } from '../detection/project-deps.js';

/**
 * A credential the wizard prompts for and persists to `.env`.
 *
 * Only declare a credential whose environment-variable name is documented by
 * the connector package itself — the wizard writes this exact name into the
 * user's `.env`, so a guessed name silently produces a config that nothing
 * reads.
 */
export interface DescriptorCredential {
  /** Environment variable name, as written to `.env` (e.g. `PINECONE_API_KEY`) */
  env: string;

  /** Config key the connector's own options object uses (e.g. `apiKey`) */
  configKey: string;

  /** Required leading prefix, used as an input-format hint in the prompt */
  prefix?: string;

  /** Human label for the credential in prompt errors; defaults to `API key` */
  label?: string;
}

/**
 * How a configured connector is verified.
 *
 * - `installed` (default): the connector's package — or the upstream SDK it
 *   wraps — is present in the project's `package.json`, and every declared
 *   credential is non-empty and matches its declared prefix. Local, offline,
 *   and honest: it proves the wiring, not the remote provider's uptime.
 * - `tcp`: a local service is listening on the declared port (Ollama, Qdrant).
 *
 * There is deliberately no generic "call the provider's API" probe: an endpoint
 * we have not verified would be an invented fact, and a wrong one reports a
 * healthy connector as broken.
 */
export type DescriptorProbe = { kind: 'installed' } | { kind: 'tcp'; port: number; host?: string };

/**
 * Declarative description of a connector.
 */
export interface ConnectorDescriptor {
  /** Unique connector id, `[a-z][a-z0-9-]*` (matches the CLI id format guard) */
  id: string;

  /** Human-readable display name */
  name: string;

  /** Category, used to group the wizard's selection list */
  category: ConnectorCategory;

  /** The npm package that ships this connector */
  npmPackage: string;

  /**
   * Upstream SDK / framework packages this connector wraps, taken from the
   * connector package's own `peerDependencies`. Their presence in the user's
   * project is what marks the connector as "detected".
   */
  peerPackages?: readonly string[];

  /** Environment variables whose presence hints this connector is relevant */
  detectEnvVars?: readonly string[];

  /** Local TCP ports that indicate the backing service is running */
  ports?: readonly number[];

  /** Docker container name substrings that indicate the backing service is running */
  dockerContainers?: readonly string[];

  /** Credentials the wizard prompts for and writes to `.env` */
  credentials?: readonly DescriptorCredential[];

  /** How to verify the connector; defaults to `{ kind: 'installed' }` */
  probe?: DescriptorProbe;

  /** One-line description shown above the generated snippet */
  summary: string;
}

/** Timeout for the `tcp` probe, in milliseconds. */
const TCP_PROBE_TIMEOUT = 2000;

/**
 * Builds the zod schema for a descriptor's credentials.
 *
 * Every declared credential is required and non-empty; a declared `prefix`
 * becomes a `startsWith` constraint, mirroring the hand-written connectors.
 * Descriptors with no credentials get a permissive object so `configSchema` is
 * always present (the `ConnectorDefinition` contract requires it).
 *
 * @param descriptor - The descriptor being defined.
 * @returns A zod schema over the connector's config keys.
 */
function buildConfigSchema(descriptor: ConnectorDescriptor): z.ZodSchema {
  const credentials = descriptor.credentials ?? [];
  if (credentials.length === 0) {
    return z.object({}).passthrough();
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const credential of credentials) {
    const label = credential.label ?? 'API key';
    shape[credential.configKey] = credential.prefix
      ? z.string().startsWith(credential.prefix, `${descriptor.name} ${label} must start with "${credential.prefix}"`)
      : z.string().min(1, `${descriptor.name} ${label} is required`);
  }
  return z.object(shape);
}

/**
 * Runs the `installed` probe: the connector (or the SDK it wraps) is present in
 * the project, and every declared credential is populated and well-formed.
 *
 * @param descriptor - The descriptor being tested.
 * @param config - Config keyed by the descriptor's `configKey`s.
 * @returns The test result.
 */
async function probeInstalled(descriptor: ConnectorDescriptor, config: Record<string, string>): Promise<TestResult> {
  for (const credential of descriptor.credentials ?? []) {
    const value = Object.prototype.hasOwnProperty.call(config, credential.configKey)
      ? config[credential.configKey]
      : undefined;
    const label = credential.label ?? 'API key';
    if (!value) {
      return { connection: false, validation: false, error: `${label} is required (${credential.env})` };
    }
    if (credential.prefix && !value.startsWith(credential.prefix)) {
      return { connection: false, validation: false, error: `${label} must start with "${credential.prefix}"` };
    }
  }

  const candidates = [descriptor.npmPackage, ...(descriptor.peerPackages ?? [])];
  let deps;
  try {
    deps = await readProjectDependencies();
  } catch (error) {
    // A hostile or oversized package.json throws from the hardened reader.
    // Report it as a failed test rather than crashing the wizard mid-run.
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { connection: false, validation: false, error: message };
  }

  const found = candidates.some(name => lookupDependency(deps, name) !== undefined);
  if (!found) {
    return {
      connection: false,
      validation: false,
      error: `Not installed — run: npm install ${descriptor.npmPackage}`
    };
  }

  return { connection: true, validation: true };
}

/**
 * Runs the `tcp` probe: the backing service accepts a connection.
 *
 * @param probe - The tcp probe spec.
 * @returns The test result.
 */
async function probeTcp(probe: Extract<DescriptorProbe, { kind: 'tcp' }>): Promise<TestResult> {
  const host = probe.host ?? 'localhost';
  const open = await checkPort(host, probe.port, TCP_PROBE_TIMEOUT);
  return {
    connection: open,
    validation: open,
    error: open ? undefined : `No service listening on ${host}:${probe.port}`
  };
}

/**
 * Generates the usage snippet for a descriptor-defined connector.
 *
 * Deliberately minimal: it names the real package and the real config keys, and
 * nothing else. A richer, hand-tuned snippet is the reason to write a
 * definition module under `implementations/` instead.
 *
 * @param descriptor - The descriptor being defined.
 * @returns A TypeScript snippet.
 */
function buildSnippet(descriptor: ConnectorDescriptor): string {
  const credentials = descriptor.credentials ?? [];
  const options =
    credentials.length === 0 ? '' : `\n${credentials.map(c => `  ${c.configKey}: process.env.${c.env},`).join('\n')}\n`;

  return `
// ${descriptor.summary}
import { GuardrailEngine } from '@blackunicorn/bonklm';
import { createConnector } from '${descriptor.npmPackage}';

const engine = new GuardrailEngine({
  validators: [
    // ... your validators
  ],
});

const connector = createConnector(engine, {${options}});
`.trim();
}

/**
 * Turns a {@link ConnectorDescriptor} into a {@link ConnectorDefinition}.
 *
 * The produced definition is frozen: the registry hands connectors out to CLI
 * commands and nothing should mutate a shared definition at runtime.
 *
 * @param descriptor - The declarative descriptor.
 * @returns A registry-ready connector definition.
 *
 * @example
 * ```ts
 * const qdrant = defineConnector({
 *   id: 'qdrant',
 *   name: 'Qdrant',
 *   category: 'vector-db',
 *   npmPackage: '@blackunicorn/bonkdrant',
 *   peerPackages: ['@qdrant/js-client-rest'],
 *   ports: [6333],
 *   probe: { kind: 'tcp', port: 6333 },
 *   summary: 'Guard documents on the way into Qdrant.',
 * });
 * ```
 */
export function defineConnector(descriptor: ConnectorDescriptor): ConnectorDefinition {
  const credentials = descriptor.credentials ?? [];

  const configKeyByEnvVar: Record<string, string> = {};
  const credentialFormats: Record<string, CredentialFormat> = {};
  for (const credential of credentials) {
    configKeyByEnvVar[credential.env] = credential.configKey;
    if (credential.prefix) {
      credentialFormats[credential.env] = credential.label
        ? { prefix: credential.prefix, label: credential.label }
        : { prefix: credential.prefix };
    }
  }

  // Detection env vars are the union of the credentials we prompt for and any
  // extra "this connector is probably relevant" hints (e.g. a provider key the
  // connector reads from the deployment env rather than from wizard config).
  const envVars = Array.from(new Set([...credentials.map(c => c.env), ...(descriptor.detectEnvVars ?? [])]));

  // Detect-only env vars are prompted but skippable: the connector works
  // without them (a setting with a default, or one of several alternative
  // provider secrets). Declared credentials stay required.
  const optionalEnvVars = (descriptor.detectEnvVars ?? []).filter(envVar => !credentials.some(c => c.env === envVar));

  const probe = descriptor.probe ?? { kind: 'installed' };

  return Object.freeze({
    id: descriptor.id,
    name: descriptor.name,
    category: descriptor.category,
    npmPackage: descriptor.npmPackage,
    detection: Object.freeze({
      // The connector's own package counts as a detection signal: if it is
      // already installed the user has clearly opted into it.
      packageJson: Object.freeze([descriptor.npmPackage, ...(descriptor.peerPackages ?? [])]) as string[],
      ...(envVars.length > 0 ? { envVars: Object.freeze(envVars) as string[] } : {}),
      ...(descriptor.ports ? { ports: Object.freeze([...descriptor.ports]) as number[] } : {}),
      ...(descriptor.dockerContainers
        ? { dockerContainers: Object.freeze([...descriptor.dockerContainers]) as string[] }
        : {})
    }),
    ...(optionalEnvVars.length > 0 ? { optionalEnvVars: Object.freeze(optionalEnvVars) as string[] } : {}),
    ...(Object.keys(configKeyByEnvVar).length > 0 ? { configKeyByEnvVar: Object.freeze(configKeyByEnvVar) } : {}),
    ...(Object.keys(credentialFormats).length > 0 ? { credentialFormats: Object.freeze(credentialFormats) } : {}),
    test: async (config: Record<string, string>) =>
      probe.kind === 'tcp' ? probeTcp(probe) : probeInstalled(descriptor, config),
    generateSnippet: () => buildSnippet(descriptor),
    configSchema: buildConfigSchema(descriptor)
  });
}
