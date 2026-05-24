/**
 * Sprint 40 connector CWE-117 sweep — mcp-connector regression.
 *
 * Per Sprint 39 security audit HIGH #3: guarded-mcp.ts line ~381
 * logged `tool: name` directly with no sanitization. `name` is the
 * MCP tool name from a remote server — attacker-controlled. Sprint
 * 40 wraps with `sanitizeLogString` + replaces inline error
 * extraction with the canonical `serializeError` primitive.
 *
 * This file unit-tests the sanitization helpers' presence in the
 * mcp-connector import surface. **Sprint 41 follow-up (Sprint 42
 * scope):** upgrade to a real integration test mirroring the
 * elizaos `installSealedWrapMemory` integration pattern — instantiate
 * `createGuardedMCPClient` with a mock MCP transport, trigger the
 * tool-result error catch path with a hostile tool name, assert the
 * spy logger captured a sanitized output. The contract-lock tests
 * below remain a smoke-test layer above that integration test once
 * it lands.
 *
 * Sprint 41 architect HIGH-2 + CR MEDIUM + security S40-4 partial
 * closure: elizaos is fully closed via integration test;
 * mcp + nestjs are still contract-lock-only pending mock-infra
 * scaffolding for those packages.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, serializeError } from '@blackunicorn/bonklm';

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
