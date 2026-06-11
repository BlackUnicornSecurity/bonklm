/**
 * Shared credential-format validation for the interactive CLI prompts.
 *
 * The `wizard` and `connector add` commands both collect credentials through a
 * `@clack/prompts` password prompt and historically duplicated hardcoded
 * `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` prefix checks inline. This module hosts
 * the single shared validator that reads a connector's own
 * {@link ConnectorDefinition.credentialFormats} hints, so the registry is the
 * one source of truth and the two commands cannot desync.
 *
 * @module connectors/credential-format
 */

import type { ConnectorDefinition } from './base.js';

/**
 * Validates a freshly-entered credential value against the connector's declared
 * input-format hint for that env var.
 *
 * Returns a user-facing error message when the value violates the hint (e.g. a
 * provider API key missing its required prefix), or `undefined` when the value
 * is acceptable OR the connector declares no hint for that env var. This is a UX
 * guard for the interactive prompts only; the authoritative validation remains
 * the connector's {@link ConnectorDefinition.configSchema}.
 *
 * @param connector - The connector whose credential is being entered.
 * @param envVar - The env-var name being prompted for (connector-declared).
 * @param value - The value the user entered.
 * @returns An error message string, or `undefined` if the value is acceptable.
 */
export function validateCredentialFormat(
  connector: ConnectorDefinition,
  envVar: string,
  value: string
): string | undefined {
  const formats = connector.credentialFormats;
  // Read ONLY own entries: a bare `formats[envVar]` walks the prototype chain,
  // so an env-var name colliding with an Object.prototype member (e.g.
  // `constructor`, `toString`) would resolve to an inherited function and
  // produce a nonsense `"undefined"` hint. (envVar is trusted connector-declared
  // metadata, but this mirrors the applyConnectorConfigKeys hardening and keeps
  // the guard total.)
  if (!formats || !Object.prototype.hasOwnProperty.call(formats, envVar)) {
    return undefined;
  }

  const format = formats[envVar];
  if (!value.startsWith(format.prefix)) {
    // The only credentials with a prefix today are API keys; this hint mirrors
    // the messages previously hardcoded in wizard.ts / connector-add.ts. Extend
    // CredentialFormat with a label if a non-key credential ever needs one.
    return `${connector.name} API key must start with "${format.prefix}"`;
  }
  return undefined;
}
