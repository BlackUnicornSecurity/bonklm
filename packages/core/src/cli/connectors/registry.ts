/**
 * Connector Registry
 *
 * Central registry for all available connector definitions.
 * Provides methods to retrieve connectors by ID, category, or get all connectors.
 */

import type { ConnectorCategory, ConnectorDefinition } from './base.js';

// Re-exported for backwards compatibility; the definitions live in the leaf
// module so importing a connector implementation cannot cycle back through the
// registry mid-initialisation.
export { DEFAULT_API_TIMEOUT, DEFAULT_LOCAL_TIMEOUT } from './timeouts.js';

// Hand-written reference connectors. These carry tuned code snippets and live
// provider probes that a descriptor cannot express, so they stay as modules.
import { openaiConnector } from './implementations/openai.js';
import { anthropicConnector } from './implementations/anthropic.js';
import { ollamaConnector } from './implementations/ollama.js';
import { expressConnector } from './implementations/express.js';
import { langchainConnector } from './implementations/langchain.js';

// Every other publishable connector is declared as data and compiled to a
// definition here. See connectors/descriptor.ts for why the catalog lives in
// core rather than in each connector package.
import { CONNECTOR_CATALOG } from './catalog/index.js';
import { defineConnector } from './descriptor.js';

/**
 * Readonly array of all available connectors.
 * This array is frozen to prevent modification at runtime.
 */
const CONNECTORS: readonly ConnectorDefinition[] = Object.freeze([
  openaiConnector,
  anthropicConnector,
  ollamaConnector,
  expressConnector,
  langchainConnector,
  ...CONNECTOR_CATALOG.map(defineConnector)
]);

/**
 * Get a connector by its unique ID.
 *
 * @param id - The unique identifier of the connector
 * @returns The connector definition if found, undefined otherwise
 *
 * @example
 * ```ts
 * const openai = getConnector('openai');
 * if (openai) {
 *   console.log(openai.name); // 'OpenAI'
 * }
 * ```
 */
export function getConnector(id: string): ConnectorDefinition | undefined {
  if (!id || typeof id !== 'string') {
    return undefined;
  }
  return CONNECTORS.find(c => c.id === id);
}

/**
 * Get all available connectors.
 *
 * @returns A shallow copy of the connectors array
 *
 * @example
 * ```ts
 * const all = getAllConnectors();
 * console.log(all.length); // every publishable connector
 * ```
 */
export function getAllConnectors(): ConnectorDefinition[] {
  return [...CONNECTORS];
}

/**
 * Get all connectors for a specific category.
 *
 * @param category - The category to filter by ('llm' | 'framework' | 'vector-db')
 * @returns An array of connectors in the specified category
 *
 * @example
 * ```ts
 * const llmConnectors = getConnectorsByCategory('llm');
 * console.log(llmConnectors.map(c => c.name)); // ['OpenAI', 'Anthropic', 'Ollama']
 * ```
 */
export function getConnectorsByCategory(category: ConnectorCategory): ConnectorDefinition[] {
  // Return a new array with copies of connector objects to prevent mutation
  return CONNECTORS.filter(c => c.category === category).map(c => ({ ...c }));
}

/**
 * Check if a connector with the given ID exists.
 *
 * @param id - The unique identifier of the connector
 * @returns true if the connector exists, false otherwise
 *
 * @example
 * ```ts
 * if (hasConnector('openai')) {
 *   // Use the connector
 * }
 * ```
 */
export function hasConnector(id: string): boolean {
  return CONNECTORS.some(c => c.id === id);
}

/**
 * Get all connector IDs.
 *
 * @returns An array of all connector IDs
 *
 * @example
 * ```ts
 * const ids = getConnectorIds();
 * console.log(ids); // ['openai', 'anthropic', 'ollama', 'express', 'langchain', ...]
 * ```
 */
export function getConnectorIds(): string[] {
  return CONNECTORS.map(c => c.id);
}

/**
 * Get all available categories.
 *
 * @returns An array of unique category values
 *
 * @example
 * ```ts
 * const categories = getCategories();
 * console.log(categories); // ['llm', 'framework']
 * ```
 */
export function getCategories(): ConnectorCategory[] {
  const unique = new Set(CONNECTORS.map(c => c.category));
  return Array.from(unique);
}

/**
 * One detection signal, tagged with the connector that declares it.
 *
 * The detection modules used to keep their own hardcoded pattern tables, which
 * silently went stale every time a connector was added. They now build their
 * tables from these aggregators, so the registry is the single source of truth
 * for what the wizard looks for.
 */
export interface DetectionSignal<T> {
  /** The id of the connector that declares this signal */
  connectorId: string;
  /** The signal value (package name, env var, port, or container pattern) */
  value: T;
}

/**
 * Collects one detection field across every connector, preserving registry
 * order and dropping duplicate values (the first connector to claim a value
 * wins, so a shared signal is attributed consistently).
 *
 * Correct for env vars, ports and container patterns, where a duplicate means
 * redundant work — one env var must not be reported twice, and one port must
 * not be scanned twice. NOT used for package names: there, dropping a duplicate
 * would silently disable the losing connector's detection (see
 * {@link getDetectionPackages}).
 *
 * Exported for direct testing: the registry's own connectors declare no
 * duplicate values today, so the dedupe arm is only reachable with a synthetic
 * picker.
 *
 * @param pick - Reads the field off a connector's detection rules.
 * @returns Deduplicated signals tagged with their declaring connector.
 */
export function collectSignals<T>(
  pick: (connector: ConnectorDefinition) => readonly T[] | undefined
): DetectionSignal<T>[] {
  const seen = new Set<T>();
  const signals: DetectionSignal<T>[] = [];
  for (const connector of CONNECTORS) {
    for (const value of pick(connector) ?? []) {
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);
      signals.push({ connectorId: connector.id, value });
    }
  }
  return signals;
}

/**
 * Every package name any connector looks for in the project's `package.json`.
 *
 * NOT deduplicated by value, unlike the other aggregators. Two connectors may
 * legitimately wrap the same upstream SDK, and dropping the second one's signal
 * would make that connector permanently undetectable. Duplicate work is not a
 * concern here — matching is a map lookup, and `detectFrameworks` already emits
 * at most one entry per connector.
 *
 * @param connectors - Connector list to read; defaults to the registry. Only
 * overridden in tests, to exercise a connector shape the registry does not hold.
 * @returns Package-name signals tagged with their declaring connector.
 */
export function getDetectionPackages(
  connectors: readonly ConnectorDefinition[] = CONNECTORS
): DetectionSignal<string>[] {
  const signals: DetectionSignal<string>[] = [];
  for (const connector of connectors) {
    for (const value of connector.detection.packageJson ?? []) {
      signals.push({ connectorId: connector.id, value });
    }
  }
  return signals;
}

/**
 * Every environment variable any connector looks for.
 *
 * This is the whitelist credential detection scans — nothing outside it is
 * ever read from `process.env`.
 *
 * @returns Env-var signals tagged with their declaring connector.
 */
export function getDetectionEnvVars(): DetectionSignal<string>[] {
  return collectSignals(c => c.detection.envVars);
}

/**
 * Every local TCP port any connector probes for a running service.
 *
 * @returns Port signals tagged with their declaring connector.
 */
export function getDetectionPorts(): DetectionSignal<number>[] {
  return collectSignals(c => c.detection.ports);
}

/**
 * Every Docker container name pattern any connector matches against.
 *
 * @returns Container-pattern signals tagged with their declaring connector.
 */
export function getDetectionDockerPatterns(): DetectionSignal<string>[] {
  return collectSignals(c => c.detection.dockerContainers);
}
