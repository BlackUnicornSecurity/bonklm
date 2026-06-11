/**
 * Tests for the shared credential-format validator.
 *
 * Drives both {@link validateCredentialFormat} and the per-connector
 * `credentialFormats` declarations on the bundled openai / anthropic connectors
 * (the single source of truth that replaces the prefix checks previously
 * duplicated in `wizard.ts` / `connector-add.ts`).
 */

import { describe, it, expect } from 'vitest';
import { validateCredentialFormat } from './credential-format.js';
import { getConnector } from './registry.js';

const openai = getConnector('openai')!;
const anthropic = getConnector('anthropic')!;
const express = getConnector('express')!;

describe('validateCredentialFormat', () => {
  it('rejects an OpenAI key without the sk- prefix', () => {
    expect(validateCredentialFormat(openai, 'OPENAI_API_KEY', 'nope')).toBe('OpenAI API key must start with "sk-"');
  });

  it('accepts an OpenAI key with the sk- prefix', () => {
    expect(validateCredentialFormat(openai, 'OPENAI_API_KEY', 'sk-abc123')).toBeUndefined();
  });

  it('rejects an Anthropic key with sk- but not the full sk-ant- prefix', () => {
    expect(validateCredentialFormat(anthropic, 'ANTHROPIC_API_KEY', 'sk-abc')).toBe(
      'Anthropic API key must start with "sk-ant-"'
    );
  });

  it('accepts an Anthropic key with the sk-ant- prefix', () => {
    expect(validateCredentialFormat(anthropic, 'ANTHROPIC_API_KEY', 'sk-ant-abc')).toBeUndefined();
  });

  it('returns undefined for a connector that declares no credentialFormats', () => {
    expect(validateCredentialFormat(express, 'ANYTHING', 'whatever')).toBeUndefined();
  });

  it('returns undefined for an env var the connector does not constrain', () => {
    expect(validateCredentialFormat(openai, 'SOME_OTHER_VAR', 'whatever')).toBeUndefined();
  });

  it('reads own entries only — never inherited Object.prototype members', () => {
    // Defense-in-depth mirroring the applyConnectorConfigKeys hardening: an
    // env-var name colliding with an Object.prototype member must not resolve to
    // an inherited function (which would produce a nonsense `"undefined"` hint).
    // These are not valid env-var names, but an own-only read keeps the guard total.
    expect(validateCredentialFormat(openai, 'toString', 'whatever')).toBeUndefined();
    expect(validateCredentialFormat(openai, 'constructor', 'whatever')).toBeUndefined();
    expect(validateCredentialFormat(openai, '__proto__', 'whatever')).toBeUndefined();
  });
});
