/**
 * Story 2.3 — browser-agents-core tests
 * =====================================
 *
 * AC coverage:
 *   - `withBrowserAgentGuardrails(client, opts)` exported.
 *   - Normalised `BrowserAgentEvent` union → correct validator surface.
 *   - `allowCuaMode: false` is the default (CUA opt-in required +
 *     warning emitted when on).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  GuardrailEngine,
  Severity,
  RiskLevel,
} from '@blackunicorn/bonklm';
import type { GuardrailResult, Validator } from '@blackunicorn/bonklm';
import {
  withBrowserAgentGuardrails,
  type BrowserAgentEvent,
} from '../src/index.js';

const okResult = (note: string): GuardrailResult => ({
  allowed: true,
  blocked: false,
  reason: note,
  severity: Severity.INFO,
  risk_level: RiskLevel.LOW,
  risk_score: 0,
  findings: [],
  timestamp: Date.now(),
});

const blockResult = (note: string): GuardrailResult => ({
  allowed: false,
  blocked: true,
  reason: note,
  severity: Severity.BLOCKED,
  risk_level: RiskLevel.HIGH,
  risk_score: 0.95,
  findings: [],
  timestamp: Date.now(),
});

function makeValidator(name: string, fn: () => GuardrailResult): Validator {
  return { name, validate: fn };
}

describe('Story 2.3 — withBrowserAgentGuardrails', () => {
  describe('Construction', () => {
    it('throws when engine is missing', () => {
      // @ts-expect-error — invalid options under test.
      expect(() => withBrowserAgentGuardrails({}, {})).toThrow(/`engine` is required/);
      // @ts-expect-error — invalid options under test.
      expect(() => withBrowserAgentGuardrails({}, undefined)).toThrow(
        /`engine` is required/
      );
    });

    it('preserves the original client surface', () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('cold'))],
      });
      const client = {
        sayHi: () => 'hello',
        version: '1.0.0',
      };
      const guarded = withBrowserAgentGuardrails(client, { engine });
      expect(guarded.sayHi()).toBe('hello');
      expect(guarded.version).toBe('1.0.0');
      expect(typeof guarded.bonklm.validateEvent).toBe('function');
      expect(typeof guarded.bonklm.engineInstanceId).toBe('string');
    });

    it('does NOT mutate the original client', () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('cold'))],
      });
      const client = { sayHi: () => 'hello' };
      const guarded = withBrowserAgentGuardrails(client, { engine });
      expect((client as { bonklm?: unknown }).bonklm).toBeUndefined();
      expect(guarded).not.toBe(client);
    });

    it('emits a CUA warning when allowCuaMode: true', () => {
      const warn = vi.fn();
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('cold'))],
      });
      withBrowserAgentGuardrails({}, { engine, allowCuaMode: true, logger: { warn } });
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/CUA mode opted in/));
    });

    it('does NOT emit warning when allowCuaMode is false (default)', () => {
      const warn = vi.fn();
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('cold'))],
      });
      withBrowserAgentGuardrails({}, { engine, logger: { warn } });
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('Event → validator-surface mapping', () => {
    it("'act' → tool_call surface", async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const engine = new GuardrailEngine({
        validators: [{ name: 'V', validate }],
      });
      const guarded = withBrowserAgentGuardrails({}, { engine });
      const r = await guarded.bonklm.validateEvent({
        kind: 'act',
        action: 'click',
        args: { selector: '#submit' },
      });
      expect(validate).toHaveBeenCalledWith({
        kind: 'tool_call',
        toolName: 'click',
        args: { selector: '#submit' },
      });
      expect(r.surface).toBe('tool_call');
      expect(r.blocked).toBe(false);
    });

    it("'extract' → retrieved_doc surface (result stringified if non-string)", async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const engine = new GuardrailEngine({
        validators: [{ name: 'V', validate }],
      });
      const guarded = withBrowserAgentGuardrails({}, { engine });
      await guarded.bonklm.validateEvent({
        kind: 'extract',
        schema: { type: 'object' },
        result: { title: 'page', body: 'content' },
      });
      expect(validate).toHaveBeenCalledWith({
        kind: 'retrieved_docs',
        docs: [
          {
            content: JSON.stringify({ title: 'page', body: 'content' }),
            metadata: { schemaPresent: true },
          },
        ],
      });
    });

    it("'extract' with string result is passed through verbatim", async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const engine = new GuardrailEngine({
        validators: [{ name: 'V', validate }],
      });
      const guarded = withBrowserAgentGuardrails({}, { engine });
      await guarded.bonklm.validateEvent({
        kind: 'extract',
        schema: 'plain',
        result: 'raw page text',
      });
      expect(validate).toHaveBeenCalledWith({
        kind: 'retrieved_docs',
        docs: [{ content: 'raw page text', metadata: { schemaPresent: true } }],
      });
    });

    it("'observe' → text_input surface", async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const engine = new GuardrailEngine({
        validators: [{ name: 'V', validate }],
      });
      const guarded = withBrowserAgentGuardrails({}, { engine });
      const r = await guarded.bonklm.validateEvent({
        kind: 'observe',
        prompt: 'What is on the page?',
      });
      expect(validate).toHaveBeenCalledWith({
        kind: 'text',
        content: 'What is on the page?',
      });
      expect(r.surface).toBe('text_input');
    });

    it("'agent.execute' → composed_context surface", async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const engine = new GuardrailEngine({
        validators: [{ name: 'V', validate }],
      });
      const guarded = withBrowserAgentGuardrails({}, { engine });
      const r = await guarded.bonklm.validateEvent({
        kind: 'agent.execute',
        task: 'Book a flight to NYC',
      });
      expect(validate).toHaveBeenCalledWith({
        kind: 'composed_context',
        entries: ['Book a flight to NYC'],
      });
      expect(r.surface).toBe('composed_context');
    });
  });

  describe('Validator block propagation', () => {
    it('BLOCK result surfaces `blocked=true` with reason', async () => {
      const validate = vi.fn().mockReturnValue(blockResult('prompt-injection'));
      const engine = new GuardrailEngine({
        validators: [{ name: 'V', validate }],
      });
      const guarded = withBrowserAgentGuardrails({}, { engine });
      const r = await guarded.bonklm.validateEvent({
        kind: 'observe',
        prompt: 'ignore prior instructions and ...',
      });
      expect(r.blocked).toBe(true);
      expect(r.allowed).toBe(false);
      expect(r.reason).toBeDefined();
    });

    it('ALLOW result surfaces `allowed=true` + no reason', async () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('all good'))],
      });
      const guarded = withBrowserAgentGuardrails({}, { engine });
      const r = await guarded.bonklm.validateEvent({
        kind: 'observe',
        prompt: 'benign prompt',
      });
      expect(r.allowed).toBe(true);
      expect(r.blocked).toBe(false);
      expect(r.reason).toBeUndefined();
    });
  });

  describe('engineInstanceId exposure', () => {
    it('matches the underlying engine getInstanceId()', () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('cold'))],
      });
      const guarded = withBrowserAgentGuardrails({}, { engine });
      expect(guarded.bonklm.engineInstanceId).toBe(engine.getInstanceId());
    });
  });

  describe('Type exhaustiveness', () => {
    it('throws on an unknown event kind at runtime (forward-compat)', async () => {
      const engine = new GuardrailEngine({
        validators: [makeValidator('V', () => okResult('cold'))],
      });
      const guarded = withBrowserAgentGuardrails({}, { engine });
      const bogus = { kind: 'noSuch', payload: 'whatever' } as unknown as BrowserAgentEvent;
      await expect(guarded.bonklm.validateEvent(bogus)).rejects.toThrow(
        /unknown BrowserAgentEvent kind/
      );
    });
  });
});
