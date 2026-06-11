/**
 * Base connector interfaces and types for the BonkLM Installation Wizard
 *
 * This module defines the core connector system that allows extensibility
 * for various LLM providers, frameworks, and vector databases.
 *
 * @module connectors/base
 */

import type { z } from 'zod';

/**
 * Supported connector categories
 *
 * - llm: Language Model providers (OpenAI, Anthropic, Ollama, etc.)
 * - framework: Framework integrations (Express, LangChain, etc.)
 * - vector-db: Vector database services (Chroma, Weaviate, Qdrant, etc.)
 */
export type ConnectorCategory = 'llm' | 'framework' | 'vector-db';

/**
 * Detection rules for auto-discovering connector configurations
 *
 * The wizard uses these rules to detect which connectors might be
 * available in the user's environment.
 */
export interface DetectionRules {
  /** Package names to check in package.json dependencies */
  packageJson?: string[];

  /** Environment variable names to check for credentials */
  envVars?: string[];

  /** TCP ports to check for running services */
  ports?: number[];

  /** Docker container name patterns to check */
  dockerContainers?: string[];
}

/**
 * Result of testing a connector connection
 *
 * Two-tier testing approach:
 * 1. connection: Basic connectivity (port open, auth valid)
 * 2. validation: Full functionality (can send queries, returns valid responses)
 */
export interface TestResult {
  /** True if basic connection succeeded */
  connection: boolean;

  /** True if full validation test succeeded */
  validation: boolean;

  /** Error message if connection or validation failed */
  error?: string;

  /** Latency in milliseconds */
  latency?: number;
}

/**
 * Connector definition interface
 *
 * All connectors must implement this interface to be compatible with
 * the wizard system.
 *
 * @example
 * ```ts
 * export const openaiConnector: ConnectorDefinition = {
 *   id: 'openai',
 *   name: 'OpenAI',
 *   category: 'llm',
 *   detection: { envVars: ['OPENAI_API_KEY'] },
 *   test: async (config) => { ... },
 *   generateSnippet: (config) => `...`,
 *   configSchema: openaiConfigSchema,
 * };
 * ```
 */
export interface ConnectorDefinition {
  /** Unique identifier for this connector */
  id: string;

  /** Human-readable display name */
  name: string;

  /** Category of this connector */
  category: ConnectorCategory;

  /** Rules for auto-detecting this connector */
  detection: DetectionRules;

  /**
   * Optional map from a detected env-var name (as declared in
   * {@link DetectionRules.envVars}) to the config key this connector's
   * {@link ConnectorDefinition.test} and {@link ConnectorDefinition.configSchema}
   * actually consume.
   *
   * The CLI credential loaders (`wizard`, `connector add`, `connector test`)
   * build config keyed by env-var name (e.g. `OPENAI_API_KEY`) because that is
   * the shape persisted to `.env`, but a connector's `test()` reads its own keys
   * (e.g. `apiKey`). Declaring `{ OPENAI_API_KEY: 'apiKey' }` lets the shared
   * test seam re-key the credential bag without each connector re-deriving it.
   * Connectors with no such indirection (e.g. `ollama`, keyed by ports; the
   * framework connectors) omit this field.
   *
   * @example
   * ```ts
   * detection: { envVars: ['OPENAI_API_KEY'] },
   * configKeyByEnvVar: { OPENAI_API_KEY: 'apiKey' },
   * ```
   */
  configKeyByEnvVar?: Record<string, string>;

  /**
   * Test function to verify connector configuration
   *
   * The function should respect the AbortSignal if provided to allow
   * timeout cancellation of long-running tests.
   *
   * @param config - Configuration values for the connector
   * @param signal - Optional AbortSignal for cancelling the test
   * @returns Promise resolving to test results
   */
  test: (config: Record<string, string>, signal?: AbortSignal) => Promise<TestResult>;

  /**
   * Generate code snippet for using this connector
   *
   * The snippet should be valid TypeScript/JavaScript code that
   * demonstrates how to use the connector with the provided configuration.
   *
   * @param config - Configuration values for the connector
   * @returns Code snippet as a string
   */
  generateSnippet: (config: Record<string, string>) => string;

  /**
   * Zod schema for validating connector configuration
   *
   * This schema is used to validate user input and ensure required
   * configuration values are present and correctly formatted.
   */
  configSchema: z.ZodSchema;
}

/**
 * Type guard to check if a value is a valid ConnectorCategory
 *
 * @param value - Value to check
 * @returns True if the value is a valid ConnectorCategory
 */
export function isConnectorCategory(value: unknown): value is ConnectorCategory {
  return typeof value === 'string' && ['llm', 'framework', 'vector-db'].includes(value);
}

/**
 * Type guard to check if a value is a valid TestResult
 *
 * @param value - Value to check
 * @returns True if the value is a valid TestResult
 */
export function isTestResult(value: unknown): value is TestResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    typeof result.connection === 'boolean' &&
    typeof result.validation === 'boolean' &&
    (result.error === undefined || typeof result.error === 'string') &&
    (result.latency === undefined || typeof result.latency === 'number')
  );
}

/**
 * Validates the optional {@link ConnectorDefinition.configKeyByEnvVar} field:
 * absent, or a non-null, non-array object whose values are all non-empty
 * strings. Used by {@link isConnectorDefinition} as a contract type-guard for
 * external embedders / tests that build connector definitions dynamically. (The
 * bundled CLI uses frozen compile-time connectors via the registry, which does
 * not run this guard — so it is a contract check, not a live-path defense.)
 *
 * @param value - The candidate `configKeyByEnvVar` value.
 * @returns True if absent or a valid non-empty-string-valued map.
 */
function isValidConfigKeyMap(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(v => typeof v === 'string' && v.length > 0);
}

/**
 * Type guard to check if a value is a valid ConnectorDefinition
 *
 * @param value - Value to check
 * @returns True if the value is a valid ConnectorDefinition
 */
export function isConnectorDefinition(value: unknown): value is ConnectorDefinition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const def = value as Record<string, unknown>;
  return (
    typeof def.id === 'string' &&
    typeof def.name === 'string' &&
    isConnectorCategory(def.category) &&
    typeof def.detection === 'object' &&
    typeof def.test === 'function' &&
    typeof def.generateSnippet === 'function' &&
    typeof def.configSchema === 'object' &&
    def.configSchema !== null &&
    'safeParse' in def.configSchema &&
    typeof def.configSchema.safeParse === 'function' &&
    isValidConfigKeyMap(def.configKeyByEnvVar)
  );
}

/**
 * Export Zod type for use in other modules
 *
 * This allows other modules to import the Zod type without
 * importing from the zod package directly.
 */
export type { z };
