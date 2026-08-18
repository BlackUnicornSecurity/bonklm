/**
 * Connector ID helper tests
 *
 * Covers the structural format guard, registry-backed existence check, and the
 * available-connector listing helpers shared by the connector add/test/remove
 * commands.
 */

import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_ID_PATTERN,
  MAX_CONNECTOR_ID_LENGTH,
  formatAvailableConnectors,
  getAvailableConnectorIds,
  isValidConnectorIdFormat
} from './connector-id.js';
import { getConnectorIds } from '../connectors/registry.js';

describe('isValidConnectorIdFormat', () => {
  it('accepts well-formed lowercase ids', () => {
    expect(isValidConnectorIdFormat('openai')).toBe(true);
    expect(isValidConnectorIdFormat('a')).toBe(true);
    expect(isValidConnectorIdFormat('a-b-1')).toBe(true);
    expect(isValidConnectorIdFormat('connector9')).toBe(true);
  });

  it('rejects the empty string', () => {
    expect(isValidConnectorIdFormat('')).toBe(false);
  });

  it('rejects ids exceeding the maximum length', () => {
    expect(isValidConnectorIdFormat('a'.repeat(MAX_CONNECTOR_ID_LENGTH + 1))).toBe(false);
  });

  it('accepts an id at exactly the maximum length (boundary)', () => {
    expect(isValidConnectorIdFormat('a'.repeat(MAX_CONNECTOR_ID_LENGTH))).toBe(true);
  });

  it('rejects ids starting with a digit or hyphen', () => {
    expect(isValidConnectorIdFormat('1abc')).toBe(false);
    expect(isValidConnectorIdFormat('-abc')).toBe(false);
  });

  it('rejects uppercase letters and disallowed characters', () => {
    expect(isValidConnectorIdFormat('OpenAI')).toBe(false);
    expect(isValidConnectorIdFormat('foo_bar')).toBe(false);
    expect(isValidConnectorIdFormat('foo!')).toBe(false);
    expect(isValidConnectorIdFormat('foo bar')).toBe(false);
    expect(isValidConnectorIdFormat('../etc')).toBe(false);
  });

  it('rejects non-string input defensively', () => {
    // The CLI hands us a string, but the guard must not throw on bad input.
    expect(isValidConnectorIdFormat(undefined as unknown as string)).toBe(false);
    expect(isValidConnectorIdFormat(123 as unknown as string)).toBe(false);
    expect(isValidConnectorIdFormat(null as unknown as string)).toBe(false);
  });

  it('exposes the canonical pattern as a named export', () => {
    expect(CONNECTOR_ID_PATTERN.test('openai')).toBe(true);
    expect(CONNECTOR_ID_PATTERN.test('Bad')).toBe(false);
  });
});

describe('getAvailableConnectorIds', () => {
  it('mirrors the registry connector id set', () => {
    expect(getAvailableConnectorIds()).toEqual(getConnectorIds());
    expect(getAvailableConnectorIds()).toContain('openai');
  });
});

describe('formatAvailableConnectors', () => {
  it('renders a comma-separated list of available ids', () => {
    const formatted = formatAvailableConnectors();
    expect(formatted).toContain('openai');
    expect(formatted).toContain(', ');
    for (const id of getConnectorIds()) {
      expect(formatted).toContain(id);
    }
  });
});
