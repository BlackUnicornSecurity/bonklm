import { describe, it, expect } from 'vitest';
import { formatBlockMessage } from '../lib/report.js';

const cc = String.fromCharCode;

describe('formatBlockMessage', () => {
  it('includes every supplied field', () => {
    const out = formatBlockMessage({
      validator: 'secret',
      title: 'HARDCODED SECRET',
      reason: 'found a key',
      target: '/repo/file.ts',
      recommendations: ['use env vars', 'use a vault'],
    });
    expect(out).toContain('BONKLM GUARDRAIL: HARDCODED SECRET');
    expect(out).toContain('found a key');
    expect(out).toContain('Target: /repo/file.ts');
    expect(out).toContain('- use env vars');
    expect(out).toContain('- use a vault');
    expect(out).toContain('Validator: secret');
  });

  it('falls back to defaults when fields are missing', () => {
    const out = formatBlockMessage({});
    expect(out).toContain('BONKLM GUARDRAIL: BLOCKED');
    expect(out).toContain('Validator: unknown');
    expect(out).not.toContain('Target:');
    expect(out).not.toContain('Recommendations:');
  });

  it('omits the recommendations section for an empty array', () => {
    expect(formatBlockMessage({ recommendations: [] })).not.toContain('Recommendations:');
  });

  it('tolerates being called with no arguments', () => {
    expect(typeof formatBlockMessage()).toBe('string');
  });

  it('neutralizes injected control characters in interpolated fields', () => {
    const out = formatBlockMessage({ validator: 'v', reason: `ok${cc(10)}FORGED`, target: `t${cc(0)}` });
    expect(out).toContain('ok FORGED');
    expect(out).not.toContain(`ok${cc(10)}FORGED`);
  });
});
