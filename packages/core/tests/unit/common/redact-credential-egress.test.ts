/**
 * Unit tests — `redactSecrets` (finding/telemetry-egress credential redactor)
 * =============================================================================
 * Locks the three-pass contract: URL userinfo, named provider/token shapes, and
 * the bare high-entropy catch-all — plus the no-over-redaction guarantee that
 * keeps ordinary directive prose intact.
 *
 * Every credential below is SYNTHETIC and shaped just off the repo
 * secret-scanner's high-confidence thresholds (so the test source itself is
 * clean) while still tripping `redactSecrets`'s broader egress patterns. The
 * one AWS-shaped key is assembled from fragments at runtime for the same reason.
 */
import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../../../src/common/index.js';

const MARKER = '[REDACTED]';
// Assembled at runtime so no single source line carries a contiguous AKIA key.
const AWS_KEY = 'AKIA' + 'IOSFODNN7EXAMPLE';
// Assembled at runtime so no single source line carries a contiguous xoxb- token.
const SLACK_TOKEN = 'xoxb' + '-123456789-Zx9Kp2mQ7vL4wR8';

describe('redactSecrets — named provider/token shapes', () => {
  it.each([
    ['OpenAI/Anthropic sk- key', 'token: sk-ant-api03-Zx9Kp2mQ7vL4wR8tY1nB3cF6', 'Zx9Kp2mQ7vL4wR8'],
    ['GitHub PAT', 'pat ghp_Zx9Kp2mQ7vL4wR8tY1nB3cF6abcd', 'Zx9Kp2mQ7vL4wR8'],
    ['Slack token', `slack ${SLACK_TOKEN}`, 'Zx9Kp2mQ7vL4wR8'],
    ['AWS access-key id', `key ${AWS_KEY} here`, AWS_KEY],
    ['Google API key', 'g AIzaSy0123456789abcdefghijklmnopqr', 'AIzaSy0123456789abcdefghijklmnopqr'],
    ['Bearer token', 'auth Bearer Zx9Kp2mQ7vL4wR8tY1nB3cF6==', 'Zx9Kp2mQ7vL4wR8'],
    ['JWT', 'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NQ.Zx9Kp2mQ7vL4wR8tY1n', 'Zx9Kp2mQ7vL4wR8']
  ])('redacts a %s', (_label, input, body) => {
    const out = redactSecrets(input);
    expect(out).toContain(MARKER);
    expect(out).not.toContain(body);
  });
});

describe('redactSecrets — extended provider shapes (review-loop F1 coverage)', () => {
  it.each([
    ['Stripe restricted key', 'k rk_live_0123456789abcdEFGH here', 'rk_live_0123456789abcdEFGH'],
    ['GitLab PAT', 'g glpat-0123456789abcd done', 'glpat-0123456789abcd'],
    ['npm token', 'n npm_0123456789abcdef0123 done', 'npm_0123456789abcdef0123'],
    ['Vault token (dot-bearing)', 'v hvs.AyI3x9zKpQ2abc end', 'hvs.AyI3x9zKpQ2abc']
  ])('redacts a %s', (_label, input, body) => {
    const out = redactSecrets(input);
    expect(out).toContain(MARKER);
    expect(out).not.toContain(body);
  });

  it('catches a 16-char high-entropy run (lowered floor)', () => {
    const token = 'Zx9Kp2mQ7vL4wR8t'; // exactly 16, high entropy, no provider prefix
    const out = redactSecrets(`v=${token}`);
    expect(out).not.toContain(token);
  });
});

describe('redactSecrets — URL userinfo', () => {
  it('masks userinfo but keeps the scheme and host for forensic signal', () => {
    const out = redactSecrets('GET https://sk-ant-api03-Zx9Kp2mQ7vL4wR8@evil.example.com/p');
    expect(out).toContain('https://[REDACTED]@');
    expect(out).toContain('evil.example.com');
    expect(out).not.toContain('Zx9Kp2mQ7vL4wR8');
  });

  it('leaves a credential-free URL untouched', () => {
    const url = 'see https://docs.example.com/guide/setup for details';
    expect(redactSecrets(url)).toBe(url);
  });
});

describe('redactSecrets — bare high-entropy catch-all', () => {
  it('redacts a provider-agnostic high-entropy run (>=20 chars)', () => {
    const out = redactSecrets('value=Qx7Lm2Vn9Rt4Wp8Zb1Hk3Yd6Fa5Sc0Ej');
    expect(out).toContain(MARKER);
    expect(out).not.toContain('Qx7Lm2Vn9Rt4Wp8Zb1Hk3Yd6Fa5Sc0Ej');
  });

  it('does NOT redact a long low-entropy run (entropy branch = false)', () => {
    const input = 'padding pppppppppppppppppppppppppppppp end'; // 30 identical chars
    expect(redactSecrets(input)).toBe(input);
  });
});

describe('redactSecrets — no over-redaction', () => {
  it('leaves ordinary directive prose unchanged', () => {
    const prose = 'This note overrides earlier instructions in this session.';
    expect(redactSecrets(prose)).toBe(prose);
  });

  it('returns an empty string unchanged', () => {
    expect(redactSecrets('')).toBe('');
  });

  it('redacts every credential when several appear in one string', () => {
    const out = redactSecrets('a sk-ant-api03-AAAABBBBCCCCDDDD and ghp_EEEEFFFFGGGGHHHHIIIIJJJJ b');
    expect(out).not.toContain('sk-ant-api03-AAAABBBBCCCCDDDD');
    expect(out).not.toContain('ghp_EEEEFFFFGGGGHHHHIIIIJJJJ');
    expect(out.match(/\[REDACTED\]/g)?.length).toBe(2);
  });
});
