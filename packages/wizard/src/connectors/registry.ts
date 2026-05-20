/**
 * Connector Registry
 *
 * Central registry for all available connector definitions.
 * Provides methods to retrieve connectors by ID, category, or get all connectors.
 */

import type { ConnectorCategory, ConnectorDefinition } from './base.js';

/** Default timeout in milliseconds for API-based connector tests */
export const DEFAULT_API_TIMEOUT = 5000;

/** Default timeout in milliseconds for local service connector tests */
export const DEFAULT_LOCAL_TIMEOUT = 2000;

// Import all MVP connectors
import { openaiConnector } from './implementations/openai.js';
import { anthropicConnector } from './implementations/anthropic.js';
import { ollamaConnector } from './implementations/ollama.js';
import { expressConnector } from './implementations/express.js';
import { langchainConnector } from './implementations/langchain.js';

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
] as const);

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
  return CONNECTORS.find((c) => c.id === id);
}

/**
 * Get all available connectors.
 *
 * @returns A shallow copy of the connectors array
 *
 * @example
 * ```ts
 * const all = getAllConnectors();
 * console.log(all.length); // 5
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
  return CONNECTORS.filter((c) => c.category === category).map((c) => ({ ...c }));
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
  return CONNECTORS.some((c) => c.id === id);
}

/**
 * Get all connector IDs.
 *
 * @returns An array of all connector IDs
 *
 * @example
 * ```ts
 * const ids = getConnectorIds();
 * console.log(ids); // ['openai', 'anthropic', 'ollama', 'express', 'langchain']
 * ```
 */
export function getConnectorIds(): string[] {
  return CONNECTORS.map((c) => c.id);
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
  const unique = new Set(CONNECTORS.map((c) => c.category));
  return Array.from(unique);
}
