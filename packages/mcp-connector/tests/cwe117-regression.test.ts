/**
 * Sprint 40 connector CWE-117 sweep — mcp-connector regression.
 *
 * Per Sprint 39 security audit HIGH #3: guarded-mcp.ts line ~381
 * logged `tool: name` directly with no sanitization. `name` is the
 * MCP tool name from a remote server — attacker-controlled. Sprint
 * 40 wraps with `sanitizeLogString` + replaces inline error
 * extraction with the canonical `serializeError` primitive.
 *
 * Sprint 42 (this file): upgraded from contract-lock-only to real
 * integration tests mirroring the elizaos `installSealedWrapMemory`
 * pattern. The integration suite instantiates `createGuardedMCP`
 * with a spy logger + mock MCP client, triggers the wrap targets
 * via blocked-validator + throwing-callback paths, and asserts the
 * spy captured sanitized output. Closes Sprint 40 architect HIGH-2
 * + code-reviewer MEDIUM + security S40-4 for the mcp connector.
 *
 * Per Sprint 41 lesson — "integration tests find what grep sweeps
 * miss" — this suite surfaced an unsanitized site at guarded-mcp.ts
 * line ~314 (the `Tool result filtered by guardrails: ${blocked.reason}`
 * filteredText for the NON-error result-blocked path was raw — the
 * Sprint 40 sweep wrapped only the error-catch sister site at ~402).
 * Fixed in the same commit as this test.
 */
import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '@blackunicorn/bonklm';
import { sanitizeLogString, serializeError } from '@blackunicorn/bonklm';

import { createGuardedMCP } from '../src/guarded-mcp.js';

describe('mcp-connector — Sprint 40 CWE-117 sanitization helpers available', () => {
  it('imports sanitizeLogString from the core barrel', () => {
    // Sprint 40 contract: the canonical sanitizer is reachable from
    // the connector's import surface. Removing this re-export from
    // core would break the connector's CWE-117 defence — this test
    // surfaces that break loudly.
    expect(typeof sanitizeLogString).toBe('function');
    expect(sanitizeLogString('a\tb')).toBe('a\\x09b');
  });

  it('imports serializeError from the core barrel', () => {
    expect(typeof serializeError).toBe('function');
    const out = serializeError(new Error('mcp tool-result validation failure'));
    expect(out.message).toBe('mcp tool-result validation failure');
    expect(out.name).toBe('Error');
  });

  it('serializeError sanitizes attacker-influenced error messages from MCP servers', () => {
    // The remote MCP server can craft an error whose message contains
    // control chars; serializeError → sanitizeLogString defeats this.
    const malicious = new Error('rpc failed\nINJECTED:CRITICAL fake severity log');
    const out = serializeError(malicious);
    expect(out.message).toBe('rpc failed\\nINJECTED:CRITICAL fake severity log');
  });
});

// Sprint 42 integration tests (architect HIGH-2 + code-reviewer MEDIUM
// + security S40-4 closure for mcp): exercises the real callTool path
// with a spy logger + hostile validator output, then a throwing user
// callback that triggers the error-catch fallback. If a future commit
// removes a sanitization wrap, these tests fail — proving the wrap is
// regression-net protected, not just contract-lock asserted.
describe('mcp-connector — Sprint 42 CWE-117 integration tests', () => {
  function makeSpyLogger(): Logger & {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  } {
    return {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }

  function makeMockClient(callToolImpl?: () => unknown) {
    const defaultResult = {
      content: [{ type: 'text', text: 'Tool result success' }],
    };
    return {
      callTool: vi.fn().mockImplementation(
        callToolImpl ?? (async () => defaultResult)
      ),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      close: vi.fn().mockResolvedValue(undefined),
      // @ts-expect-error — minimal mock surface; createGuardedMCP only
      // consumes callTool/listTools/close at runtime.
    } as Parameters<typeof createGuardedMCP>[0];
  }

  it('sanitizes blocked.reason in the input-validation warn log path', async () => {
    const logger = makeSpyLogger();
    const mockClient = makeMockClient();

    // Validator that blocks input with a control-char-laden reason
    // mirroring what PromptInjectionValidator can surface when the
    // matched pattern slice includes a literal CR/LF (real-world
    // example: user prompt contains a newline within the matched
    // span).
    const hostileReasonValidator = {
      name: 'HostileReasonValidator',
      validate: vi.fn().mockReturnValue({
        allowed: false,
        blocked: true,
        severity: 'critical' as const,
        risk_level: 'high' as const,
        risk_score: 100,
        reason: 'Pattern matched: ignore_previous\nINJECTED:CRITICAL fake_alert',
        findings: [],
        timestamp: Date.now(),
      }),
    };

    const guarded = createGuardedMCP(mockClient, {
      validators: [hostileReasonValidator as never],
      logger,
      productionMode: false,
    });

    await expect(
      guarded.callTool({ name: 'calculator', arguments: { x: 1 } })
    ).rejects.toThrow();

    // Two warn calls fire on a blocked input: engine's short-circuit
    // warn (Sprint 42 wrap via `sanitizeLogString`) AND mcp's
    // `logValidationFailure` warn (existing wrap via
    // `stripLogControlChars`). Both must be sanitized. Sprint 42
    // code-review SHOULD-FIX closure: pin each assertion to its
    // specific call rather than the broad `includes(...)` match.
    expect(logger.warn).toHaveBeenCalled();
    const engineShortCircuitCall = logger.warn.mock.calls.find(
      (call) => call[0] === 'Validation blocked (short-circuit)'
    );
    const mcpFailureCall = logger.warn.mock.calls.find(
      (call) => call[0] === 'Validation blocked'
    );
    expect(engineShortCircuitCall).toBeDefined();
    expect(mcpFailureCall).toBeDefined();
    // Engine path: hex-escape via sanitizeLogString — literal `\\n`.
    const engineMeta = engineShortCircuitCall![1] as { reason?: string };
    expect(engineMeta.reason).not.toContain('\n');
    expect(engineMeta.reason).toContain('\\n');
    expect(engineMeta.reason).toMatch(/INJECTED/);
    // mcp path: stripLogControlChars (legacy SPACE-replace) — no `\n`.
    const mcpMeta = mcpFailureCall![1] as { reason?: string };
    expect(mcpMeta.reason).not.toContain('\n');
    expect(mcpMeta.reason).toMatch(/INJECTED/);
  });

  it('sanitizes the user-callback error in the result-validation error catch', async () => {
    const logger = makeSpyLogger();
    const mockClient = makeMockClient();

    // The result-validation error catch fires when the user's
    // onToolResultBlocked callback throws. The catch site at
    // guarded-mcp.ts ~388 logs `{ tool: sanitizeMeta(name), error:
    // serializeError(error) }`. The thrown error message carries
    // control chars — serializeError must sanitize via
    // sanitizeLogString.
    const onToolResultBlocked = vi.fn(() => {
      throw new Error('user-callback boom\nINJECTED:CRITICAL fake_log');
    });

    // Validator: allow INPUT (validateToolCall path), block OUTPUT.
    const blockOutputValidator = {
      name: 'BlockOutputValidator',
      validate: vi.fn((content: string) => {
        const isInputContext = content.startsWith('Tool:');
        return {
          allowed: isInputContext,
          blocked: !isInputContext,
          severity: 'critical' as const,
          risk_level: 'high' as const,
          risk_score: 100,
          reason: isInputContext ? undefined : 'output blocked',
          findings: [],
          timestamp: Date.now(),
        };
      }),
    };

    const guarded = createGuardedMCP(mockClient, {
      validators: [blockOutputValidator as never],
      logger,
      validateToolResults: true,
      productionMode: false,
      onToolResultBlocked,
    });

    const result = await guarded.callTool({
      name: 'calculator',
      arguments: { x: 1 },
    });

    // The catch block returned a filtered ToolCallResult (fail-closed).
    expect(result).toBeDefined();
    expect(result.filtered).toBe(true);

    // The error-log site must have fired with sanitized fields.
    const errorCall = logger.error.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('Tool result validation error')
    );
    expect(errorCall).toBeDefined();
    const errorMeta = errorCall![1] as {
      tool?: string;
      error?: { message?: string; name?: string };
    };
    // tool is library-controlled here (already-validated name) but
    // must still be a string post-sanitizeMeta.
    expect(errorMeta.tool).toBe('calculator');
    // error.message MUST NOT contain raw \n — serializeError pipes
    // through sanitizeLogString, replacing with the literal `\\n`
    // marker.
    expect(errorMeta.error?.message).toBe(
      'user-callback boom\\nINJECTED:CRITICAL fake_log'
    );

    // The filtered ToolCallResult text (returned to the caller) must
    // also be sanitized — Sprint 40 wrapped this site already.
    const text = result.content[0]?.text;
    expect(typeof text).toBe('string');
    expect(text).not.toContain('user-callback boom\nINJECTED');
    expect(text).toContain('user-callback boom\\nINJECTED');
  });

  it('sanitizes blocked.reason in the result-filtered ToolCallResult text (Sprint 42 surfaced site)', async () => {
    // Sprint 42 integration-test surfaced site: guarded-mcp.ts:314
    // returned `Tool result filtered by guardrails: ${blocked.reason}`
    // without sanitizing `blocked.reason`. The Sprint 40 sweep wrapped
    // the SISTER site at line ~402 (error-catch fallback filteredText)
    // but missed this NON-error path. An adversarial remote MCP server
    // can craft a tool-result whose validator-produced reason contains
    // control chars — the unsanitized filteredText would propagate into
    // a chat UI / agent transcript / terminal output, where the raw
    // bytes could hijack the rendering. Per Sprint 41 defensive-by-
    // default policy: sanitize at the connector boundary regardless of
    // downstream rendering context.
    const logger = makeSpyLogger();
    const mockClient = makeMockClient();

    const hostileOutputValidator = {
      name: 'HostileOutputValidator',
      validate: vi.fn((content: string) => {
        const isInputContext = content.startsWith('Tool:');
        return {
          allowed: isInputContext,
          blocked: !isInputContext,
          severity: 'critical' as const,
          risk_level: 'high' as const,
          risk_score: 100,
          reason: isInputContext
            ? undefined
            : 'output_blocked\nINJECTED:CRITICAL fake_severity',
          findings: [],
          timestamp: Date.now(),
        };
      }),
    };

    const guarded = createGuardedMCP(mockClient, {
      validators: [hostileOutputValidator as never],
      logger,
      validateToolResults: true,
      productionMode: false,
    });

    const result = await guarded.callTool({
      name: 'calculator',
      arguments: { x: 1 },
    });

    expect(result.filtered).toBe(true);
    const text = result.content[0]?.text;
    expect(typeof text).toBe('string');
    expect(text).not.toContain('output_blocked\nINJECTED');
    expect(text).toContain('output_blocked\\nINJECTED');
  });

  it('sanitizes U+2028 LINE SEPARATOR through the connector boundary (Sprint 42 security LOW closure)', async () => {
    // Sprint 42 security LOW closure: the unit-level `sanitizeLogString`
    // already asserts U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH
    // SEPARATOR) coverage from Sprint 39, but the connector-boundary
    // integration tests bare-asserted only on `\n`. If a future
    // refactor incorrectly downgraded `blocked.reason` to a sanitizer
    // that lacked the Sprint-39 U+2028 extension, all Sprint 42
    // assertions would still pass while leaking the codepoint. This
    // test pins the end-to-end behaviour.
    const logger = makeSpyLogger();
    const mockClient = makeMockClient();

    const u2028Validator = {
      name: 'U2028Validator',
      validate: vi.fn().mockReturnValue({
        allowed: false,
        blocked: true,
        severity: 'critical' as const,
        risk_level: 'high' as const,
        risk_score: 100,
        reason: 'matched FAKE_INJECTED',
        findings: [],
        timestamp: Date.now(),
      }),
    };

    const guarded = createGuardedMCP(mockClient, {
      validators: [u2028Validator as never],
      logger,
      productionMode: false,
    });

    let thrown: unknown = null;
    try {
      await guarded.callTool({ name: 'calculator', arguments: { x: 1 } });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const msg = (thrown as Error).message;
    // The raw U+2028 codepoint MUST NOT survive — sanitizeLogString
    // replaces it with the literal `\\n` marker per Sprint 39 ADR.
    expect(msg).not.toContain(' ');
    expect(msg).toContain('\\n');
    expect(msg).toContain('FAKE_INJECTED');
  });

  it('sanitizes a validator-error description through the engine catch path (Sprint 42 architect HIGH closure)', async () => {
    // Sprint 42 architect HIGH #1 closure: the engine's validator
    // catch builds a synthetic finding with
    // `description: \`Validator ${name} threw an error: ${String(error)}\``
    // which previously embedded raw `error.message`. A hostile validator
    // can throw with a CR/LF-laden message; the finding flows into
    // EngineResult.findings, surfacing to any consumer that logs the
    // result. Sprint 42 wraps `String(error)` with sanitizeLogString —
    // this test pins that wrap.
    const logger = makeSpyLogger();
    const mockClient = makeMockClient();

    const throwingValidator = {
      name: 'ThrowingValidator',
      validate: vi.fn(() => {
        throw new Error('upstream rpc failed\nINJECTED:CRITICAL fake');
      }),
    };

    const guarded = createGuardedMCP(mockClient, {
      validators: [throwingValidator as never],
      logger,
      productionMode: false,
    });

    // The thrown validator -> engine creates a CRITICAL synthetic
    // finding -> aggregation -> blocked input -> mcp throws.
    let thrown: unknown = null;
    try {
      await guarded.callTool({ name: 'calculator', arguments: { x: 1 } });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);

    // Inspect the engine's validator-error log to confirm the
    // description's `String(error)` interpolation was sanitized.
    const errorCall = logger.error.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].startsWith('Error in validator')
    );
    expect(errorCall).toBeDefined();
    // The error meta uses serializeError — already sanitized at the
    // log boundary (Sprint 33 primitive). What Sprint 42 fixes is the
    // `description` field that lands in the synthetic
    // GuardrailResult.findings — that field is exposed via the
    // EngineResult, not the log meta. Confirm the engine's
    // serializeError wrap is still intact for the log path.
    const errorMeta = errorCall![1] as { error?: { message?: string } };
    expect(errorMeta.error?.message).toBe(
      'upstream rpc failed\\nINJECTED:CRITICAL fake'
    );
  });

  it('sanitizes blocked.reason in the input-blocked Error message thrown to the caller (Sprint 42 surfaced site)', async () => {
    // Sprint 42 integration-test surfaced site: guarded-mcp.ts:287
    // threw `new Error(\`Tool call blocked: ${blocked.reason}\`)`
    // without sanitizing `blocked.reason`. The caller receives this
    // error with raw control-char bytes in `.message` — if they log
    // the error message via a downstream logger, the raw bytes forge
    // phantom log lines (CWE-117 leaked across the connector
    // boundary). Per Sprint 41 defensive-by-default: sanitize at the
    // throw site. (Production-mode throw is a static string —
    // unaffected; dev-mode is the surfaced vector.)
    const logger = makeSpyLogger();
    const mockClient = makeMockClient();

    const hostileInputValidator = {
      name: 'HostileInputValidator',
      validate: vi.fn().mockReturnValue({
        allowed: false,
        blocked: true,
        severity: 'critical' as const,
        risk_level: 'high' as const,
        risk_score: 100,
        reason: 'input_blocked\nINJECTED:CRITICAL fake_severity',
        findings: [],
        timestamp: Date.now(),
      }),
    };

    const guarded = createGuardedMCP(mockClient, {
      validators: [hostileInputValidator as never],
      logger,
      productionMode: false,
    });

    let thrown: unknown = null;
    try {
      await guarded.callTool({ name: 'calculator', arguments: { x: 1 } });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const msg = (thrown as Error).message;
    expect(msg).not.toContain('input_blocked\nINJECTED');
    expect(msg).toContain('input_blocked\\nINJECTED');
  });
});
