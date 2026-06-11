/**
 * Connector ID validation helpers
 *
 * Shared, security-relevant validation for the user-supplied `<id>` argument
 * across the `connector add` / `connector test` / `connector remove` commands.
 *
 * Two concerns are kept deliberately separate:
 *  1. **Format** ({@link isValidConnectorIdFormat}) — a cheap structural guard
 *     applied at the CLI boundary BEFORE any registry lookup or filesystem
 *     access. It rejects over-long, empty, or malformed ids (anything that is
 *     not a lowercase-letter-led `[a-z][a-z0-9-]*` token) so hostile input
 *     never reaches downstream sinks.
 *  2. **Existence** (the registry's `getConnector` / `hasConnector`) — whether the
 *     id maps to a real connector. The registry is the single source of
 *     truth for the available-connector set; the previous inline whitelist in
 *     `connector-add.ts` duplicated that set and could drift.
 *
 * @module commands/connector-id
 */

import { getConnectorIds } from '../connectors/registry.js';

/**
 * Valid connector ID format.
 *
 * Must start with a lowercase letter and contain only lowercase letters,
 * digits, and hyphens. Mirrors the pattern previously inlined in
 * `connector-add.ts` (kept identical so the add command's behaviour is
 * unchanged by the consolidation).
 */
export const CONNECTOR_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Maximum accepted connector ID length (DoS guard).
 */
export const MAX_CONNECTOR_ID_LENGTH = 50;

/**
 * Structural validation for a connector ID.
 *
 * Does NOT check the registry — callers resolve existence via the registry's
 * `getConnector` for that. A format-valid id that is not in the registry is
 * "unknown", not "invalid";
 * the two are surfaced to the user with different messages.
 *
 * @param id - The raw connector ID from the CLI argument.
 * @returns True if the id is a well-formed connector identifier.
 */
export function isValidConnectorIdFormat(id: string): boolean {
  if (typeof id !== 'string') {
    return false;
  }
  if (id.length < 1 || id.length > MAX_CONNECTOR_ID_LENGTH) {
    return false;
  }
  return CONNECTOR_ID_PATTERN.test(id);
}

/**
 * The set of available connector IDs, sourced from the registry.
 *
 * @returns An array of all registered connector IDs.
 */
export function getAvailableConnectorIds(): string[] {
  return getConnectorIds();
}

/**
 * A comma-separated, human-readable list of available connector IDs, for use
 * in error messages ("Available connectors: openai, anthropic, ...").
 *
 * @returns The available connector IDs joined by ", ".
 */
export function formatAvailableConnectors(): string {
  return getConnectorIds().join(', ');
}
