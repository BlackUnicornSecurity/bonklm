/**
 * Consolidation guard — both credential redactors share one engine, keep two outputs
 * =============================================================================
 * `redactSecrets` (common, finding/telemetry egress) and `redactCredentials`
 * (cli/utils/error, error/CLI messages) now run through the same
 * {@link applyRedactionPasses} engine. This suite proves the consolidation did
 * NOT collapse them into one behaviour: each surface still redacts a shared
 * credential fixture, but with its OWN marker — and never leaks the other
 * surface's marker. A regression that wired one surface onto the other's passes
 * (marker, shapes, or entropy predicate) would fail here.
 *
 * The per-surface shape/entropy contracts stay locked by their own suites
 * (`redact-credential-egress.test.ts`, `cli/utils/error.test.ts`); this file
 * only guards the boundary between them.
 *
 * Credentials below are SYNTHETIC, shaped just off the repo secret-scanner's
 * thresholds so the test source itself stays clean.
 */
import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../../../src/common/index.js';
import { redactCredentials } from '../../../src/cli/utils/error.js';

const SK_KEY = 'sk-ant-api03-Zx9Kp2mQ7vL4wR8tY1nB3cF6';
const EGRESS_MARKER = '[REDACTED]';
const CLI_MARKER = '***REDACTED***';

describe('redaction consolidation — both surfaces redact a shared fixture', () => {
  it('redactSecrets masks the key with the egress marker only', () => {
    const out = redactSecrets(`key: ${SK_KEY}`);
    expect(out).not.toContain(SK_KEY);
    expect(out).toContain(EGRESS_MARKER);
    // Must NOT emit the CLI surface's marker.
    expect(out).not.toContain(CLI_MARKER);
  });

  it('redactCredentials masks the key with the CLI marker only', () => {
    const out = redactCredentials(`key: ${SK_KEY}`);
    expect(out).not.toContain(SK_KEY);
    expect(out).toContain(CLI_MARKER);
    // Must NOT emit the egress surface's bracketed marker.
    expect(out).not.toContain(EGRESS_MARKER);
  });
});

describe('redaction consolidation — surface-specific behaviour is preserved', () => {
  it('only the egress redactor masks URL userinfo (keeps scheme + host)', () => {
    const url = 'GET https://AKIAIOSFODNN7EXAMPLE@evil.example.com/p';
    const egress = redactSecrets(url);
    expect(egress).toContain('https://[REDACTED]@');
    expect(egress).toContain('evil.example.com');
    // The CLI redactor has no userinfo pass; it must not invent the egress marker.
    expect(redactCredentials(url)).not.toContain(EGRESS_MARKER);
  });

  it('only the CLI redactor has the message-only api_key= catch-all', () => {
    // A label + high-entropy value; the CLI api_key catch-all redacts the value
    // in place, keeping the `api_key=` label.
    const out = redactCredentials('api_key=aB3xK9mQ2pL7vR5wT8zCdE1f');
    expect(out).toBe('api_key=***REDACTED***');
  });

  it('leaves ordinary prose untouched on both surfaces', () => {
    const prose = 'Failed to connect to the database after three retries.';
    expect(redactSecrets(prose)).toBe(prose);
    expect(redactCredentials(prose)).toBe(prose);
  });
});
