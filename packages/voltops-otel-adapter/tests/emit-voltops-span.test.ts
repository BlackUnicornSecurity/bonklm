/**
 * Story 3.10 — voltops-otel-adapter tests
 */
import { describe, it, expect, vi } from 'vitest';
import { emitVoltOpsSpan } from '../src/index.js';
import type { BonklmSpan, BonklmTracer } from '../src/index.js';
import { Severity, RiskLevel, type GuardrailResult } from '@blackunicorn/bonklm';

function makeMockTracer(): {
  tracer: BonklmTracer;
  attrs: Record<string, string | number | boolean>;
} {
  const attrs: Record<string, string | number | boolean> = {};
  const tracer: BonklmTracer = {
    startActiveSpan: <T>(_name: string, _opts: { attributes?: Record<string, string | number | boolean> }, fn: (span: BonklmSpan) => T): T => {
      const span: BonklmSpan = {
        setAttribute: (k, v) => {
          attrs[k] = v;
        },
        addEvent: vi.fn(),
        setStatus: vi.fn(),
        end: vi.fn(),
      };
      return fn(span);
    },
  };
  return { tracer, attrs };
}

function makeResult(overrides: Partial<GuardrailResult> = {}): GuardrailResult {
  return {
    allowed: true,
    blocked: false,
    severity: Severity.INFO,
    risk_level: RiskLevel.LOW,
    risk_score: 0,
    findings: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('emitVoltOpsSpan', () => {
  it('throws TypeError when scanner is missing', () => {
    const { tracer } = makeMockTracer();
    expect(() =>
      emitVoltOpsSpan(makeResult(), {
        tracer,
        scanner: '',
        surface: 'text_input',
      })
    ).toThrow(TypeError);
  });

  it('adds bonklm.scanner attribute alongside R2-10 set', () => {
    const { tracer, attrs } = makeMockTracer();
    emitVoltOpsSpan(makeResult(), {
      tracer,
      scanner: 'pii-redactor',
      surface: 'text_output',
    });
    expect(attrs['bonklm.scanner']).toBe('pii-redactor');
    // R2-10 set still present.
    expect(attrs['bonklm.validator']).toBe('pii-redactor');
    expect(attrs['bonklm.surface']).toBe('text_output');
    expect(attrs['bonklm.action']).toBe('allow');
  });

  it('passes through severity + finding_count on BLOCK', () => {
    const { tracer, attrs } = makeMockTracer();
    emitVoltOpsSpan(
      makeResult({
        blocked: true,
        severity: Severity.CRITICAL,
        findings: [
          { category: 'pii', severity: Severity.CRITICAL, description: 'SSN detected' },
        ],
      }),
      { tracer, scanner: 'pii-redactor', surface: 'text_output' }
    );
    expect(attrs['bonklm.action']).toBe('block');
    expect(attrs['bonklm.severity']).toBe('critical');
    expect(attrs['bonklm.finding_count']).toBe(1);
  });

  it('returns the result unchanged', () => {
    const { tracer } = makeMockTracer();
    const r = makeResult();
    expect(
      emitVoltOpsSpan(r, { tracer, scanner: 'x', surface: 'text_input' })
    ).toBe(r);
  });

  it('merges extraAttributes', () => {
    const { tracer, attrs } = makeMockTracer();
    emitVoltOpsSpan(makeResult(), {
      tracer,
      scanner: 'x',
      surface: 'text_input',
      extraAttributes: { 'service.version': '1.2.3' },
    });
    expect(attrs['service.version']).toBe('1.2.3');
  });
});
