/**
 * Story 3.11 — OTLP `bonklmTrace()` export tests
 *
 * AC: OTel span attributes are present + correctly typed; R2-10
 * locked surface vocab enforced.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  bonklmTrace,
  type BonklmSpan,
  type BonklmTracer,
} from '../../src/telemetry/otlp-export.js';
import { Severity, RiskLevel, type GuardrailResult } from '../../src/base/GuardrailResult.js';

function makeMockTracer(): {
  tracer: BonklmTracer;
  capturedSpan: { current: BonklmSpan | null };
  capturedAttrs: { current: Record<string, string | number | boolean> };
  capturedName: { current: string };
  capturedEvents: Array<{ name: string; attrs?: Record<string, string | number | boolean> }>;
  capturedStatus: { current: { code: number; message?: string } | null };
} {
  const capturedSpan: { current: BonklmSpan | null } = { current: null };
  const capturedAttrs: { current: Record<string, string | number | boolean> } = { current: {} };
  const capturedName: { current: string } = { current: '' };
  const capturedEvents: Array<{ name: string; attrs?: Record<string, string | number | boolean> }> = [];
  const capturedStatus: { current: { code: number; message?: string } | null } = { current: null };

  const tracer: BonklmTracer = {
    startActiveSpan: <T>(name: string, _opts: { attributes?: Record<string, string | number | boolean> }, fn: (span: BonklmSpan) => T): T => {
      capturedName.current = name;
      const span: BonklmSpan = {
        setAttribute: vi.fn((k: string, v: string | number | boolean) => {
          capturedAttrs.current[k] = v;
        }),
        addEvent: vi.fn((evName: string, attrs?: Record<string, string | number | boolean>) => {
          capturedEvents.push({ name: evName, attrs });
        }),
        setStatus: vi.fn((status: { code: number; message?: string }) => {
          capturedStatus.current = status;
        }),
        end: vi.fn(),
      };
      capturedSpan.current = span;
      return fn(span);
    },
  };

  return { tracer, capturedSpan, capturedAttrs, capturedName, capturedEvents, capturedStatus };
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

describe('bonklmTrace — surface', () => {
  it('throws TypeError when tracer is missing', () => {
    expect(() =>
      bonklmTrace(makeResult(), { validator: 'x', surface: 'text_input' } as Parameters<typeof bonklmTrace>[1])
    ).toThrow(TypeError);
  });

  it('throws TypeError when validator is empty', () => {
    const { tracer } = makeMockTracer();
    expect(() =>
      bonklmTrace(makeResult(), { tracer, validator: '', surface: 'text_input' })
    ).toThrow(TypeError);
  });

  it('throws TypeError on invalid surface vocab (R2-10 lock)', () => {
    const { tracer } = makeMockTracer();
    expect(() =>
      bonklmTrace(makeResult(), {
        tracer,
        validator: 'x',
        surface: 'prompt' as unknown as 'text_input',
      })
    ).toThrow(/R2-10 locked vocab/);
  });

  it('accepts all 7 R2-10 surfaces', () => {
    const { tracer } = makeMockTracer();
    const surfaces = [
      'text_input',
      'text_output',
      'tool_call',
      'retrieved_doc',
      'memory_write',
      'audio_partial',
      'composed_context',
    ] as const;
    for (const s of surfaces) {
      expect(() => bonklmTrace(makeResult(), { tracer, validator: 'x', surface: s })).not.toThrow();
    }
  });

  it('returns the result unchanged (chaining-safe)', () => {
    const { tracer } = makeMockTracer();
    const r = makeResult();
    expect(bonklmTrace(r, { tracer, validator: 'x', surface: 'text_input' })).toBe(r);
  });
});

describe('bonklmTrace — span attributes', () => {
  it('sets bonklm.validator / severity / action / finding_count / surface', () => {
    const { tracer, capturedAttrs } = makeMockTracer();
    bonklmTrace(
      makeResult({
        blocked: true,
        severity: Severity.CRITICAL,
        findings: [
          { category: 'prompt_injection', severity: Severity.CRITICAL, description: 'malicious' },
        ],
      }),
      { tracer, validator: 'prompt-injection', surface: 'text_input' }
    );
    expect(capturedAttrs.current['bonklm.validator']).toBe('prompt-injection');
    expect(capturedAttrs.current['bonklm.severity']).toBe('critical');
    expect(capturedAttrs.current['bonklm.action']).toBe('block');
    expect(capturedAttrs.current['bonklm.finding_count']).toBe(1);
    expect(capturedAttrs.current['bonklm.surface']).toBe('text_input');
  });

  it('sets bonklm.action = allow on ALLOW result', () => {
    const { tracer, capturedAttrs } = makeMockTracer();
    bonklmTrace(makeResult({ blocked: false }), {
      tracer,
      validator: 'x',
      surface: 'text_output',
    });
    expect(capturedAttrs.current['bonklm.action']).toBe('allow');
  });

  it('merges extraAttributes', () => {
    const { tracer, capturedAttrs } = makeMockTracer();
    bonklmTrace(makeResult(), {
      tracer,
      validator: 'x',
      surface: 'text_input',
      extraAttributes: { 'service.name': 'my-app', 'trace.id': 'abc123' },
    });
    expect(capturedAttrs.current['service.name']).toBe('my-app');
    expect(capturedAttrs.current['trace.id']).toBe('abc123');
  });

  it('span name default: bonklm.validator.<surface>', () => {
    const { tracer, capturedName } = makeMockTracer();
    bonklmTrace(makeResult(), { tracer, validator: 'x', surface: 'memory_write' });
    expect(capturedName.current).toBe('bonklm.validator.memory_write');
  });

  it('honours custom spanName override', () => {
    const { tracer, capturedName } = makeMockTracer();
    bonklmTrace(makeResult(), {
      tracer,
      validator: 'x',
      surface: 'text_input',
      spanName: 'my.custom.span',
    });
    expect(capturedName.current).toBe('my.custom.span');
  });
});

describe('bonklmTrace — span events + status', () => {
  it('emits bonklm.finding events per finding', () => {
    const { tracer, capturedEvents } = makeMockTracer();
    bonklmTrace(
      makeResult({
        blocked: true,
        findings: [
          { category: 'a', severity: Severity.CRITICAL, description: 'desc-a' },
          { category: 'b', severity: Severity.WARNING, description: 'desc-b' },
        ],
      }),
      { tracer, validator: 'x', surface: 'text_input' }
    );
    expect(capturedEvents).toHaveLength(2);
    expect(capturedEvents[0]!.name).toBe('bonklm.finding');
    expect(capturedEvents[0]!.attrs!.category).toBe('a');
    expect(capturedEvents[1]!.attrs!.category).toBe('b');
  });

  it('setStatus ERROR on BLOCK', () => {
    const { tracer, capturedStatus } = makeMockTracer();
    bonklmTrace(makeResult({ blocked: true, reason: 'blocked-x' }), {
      tracer,
      validator: 'x',
      surface: 'text_input',
    });
    expect(capturedStatus.current).toEqual({ code: 2, message: 'blocked-x' });
  });

  it('does NOT setStatus ERROR on ALLOW', () => {
    const { tracer, capturedStatus } = makeMockTracer();
    bonklmTrace(makeResult({ blocked: false }), {
      tracer,
      validator: 'x',
      surface: 'text_input',
    });
    expect(capturedStatus.current).toBeNull();
  });
});

describe('bonklmTrace — span lifecycle', () => {
  it('always calls span.end()', () => {
    const { tracer, capturedSpan } = makeMockTracer();
    bonklmTrace(makeResult(), { tracer, validator: 'x', surface: 'text_input' });
    expect(capturedSpan.current!.end).toHaveBeenCalledTimes(1);
  });
});
