/**
 * tsd type-surface suite — @blackunicorn/bonklm-browser-agents-core (ST-04-243).
 *
 * Locks the published public type surface (imports by package name): the
 * `withBrowserAgentGuardrails` factory (generic, preserves the wrapped
 * client type), the `BrowserAgentGuardrailBlockedError` class, the event /
 * options / result / logger types, AND the security-relevant shared helpers
 * (`assertNonCuaMode`, `detectVendorMode`, `isUnsafeBinaryResult`, etc. — all
 * UNTESTED at runtime, so this type contract is their only guard). Run via
 * `pnpm exec tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  withBrowserAgentGuardrails,
  BrowserAgentGuardrailBlockedError,
  CUA_MODE_PATTERN,
  assertNonCuaMode,
  detectVendorMode,
  emitWarning,
  isUnsafeBinaryResult,
  normaliseActArg,
  sanitizeReasonText,
  type GuardedBrowserAgentClient,
  type BrowserAgentEvent,
  type BrowserAgentGuardOptions,
  type BrowserAgentLogger,
  type BrowserAgentValidateResult
} from '@blackunicorn/bonklm-browser-agents-core';

declare const engine: GuardrailEngine;

// --- withBrowserAgentGuardrails: preserves T, augments with `bonklm` --------
const guarded = withBrowserAgentGuardrails({ foo: 1 }, { engine });
expectType<number>(guarded.foo);
expectType<Promise<BrowserAgentValidateResult>>(guarded.bonklm.validateEvent({ kind: 'observe', prompt: 'p' }));
expectType<string>(guarded.bonklm.engineInstanceId);
expectError(withBrowserAgentGuardrails({ foo: 1 }, {})); // engine required
expectError(withBrowserAgentGuardrails('not-an-object', { engine })); // T extends object

declare const g: GuardedBrowserAgentClient<{ a: string }>;
expectType<string>(g.a);
expectType<string>(g.bonklm.engineInstanceId);

// --- BrowserAgentEvent union (all six variants + discriminant enforcement) --
expectAssignable<BrowserAgentEvent>({ kind: 'act', action: 'click' });
expectAssignable<BrowserAgentEvent>({ kind: 'act', action: 'click', args: { selector: '#submit' } });
expectAssignable<BrowserAgentEvent>({ kind: 'extract', schema: {}, result: {} });
expectAssignable<BrowserAgentEvent>({ kind: 'observe', prompt: 'p' });
expectAssignable<BrowserAgentEvent>({ kind: 'agent.execute', task: 't' });
expectAssignable<BrowserAgentEvent>({ kind: 'file', op: 'write', path: '/etc/x', content: 'c' });
expectAssignable<BrowserAgentEvent>({ kind: 'mcp.tool', server: 's', tool: 't' });
expectNotAssignable<BrowserAgentEvent>({ kind: 'act' }); // action required
expectNotAssignable<BrowserAgentEvent>({ kind: 'file', op: 'append', path: '/x' }); // op is read|write|delete
expectNotAssignable<BrowserAgentEvent>({ kind: 'screenshot' }); // not a known kind

// --- BrowserAgentGuardOptions / Result / Logger -----------------------------
expectAssignable<BrowserAgentGuardOptions>({ engine });
expectAssignable<BrowserAgentGuardOptions>({ engine, allowCuaMode: true, logger: { warn: _m => {} } });
expectNotAssignable<BrowserAgentGuardOptions>({}); // engine required

expectAssignable<BrowserAgentValidateResult>({ blocked: false, allowed: true, surface: 'tool_call' });
expectAssignable<BrowserAgentValidateResult>({ blocked: true, allowed: false, reason: 'r', surface: 'retrieved_doc' });
expectNotAssignable<BrowserAgentValidateResult>({ blocked: false, allowed: true, surface: 'screenshot' }); // surface union
expectNotAssignable<BrowserAgentValidateResult>({ blocked: false, allowed: true }); // surface required

expectAssignable<BrowserAgentLogger>({ warn: _m => {} });
expectAssignable<BrowserAgentLogger>({ warn: (_m, _meta) => {}, error: _m => {} });
expectNotAssignable<BrowserAgentLogger>({}); // warn required

// --- shared helpers (security-relevant; runtime-untested) -------------------
expectType<RegExp>(CUA_MODE_PATTERN);

expectType<string | undefined>(assertNonCuaMode('wrapStagehand', {}, {}));
expectType<string | undefined>(
  assertNonCuaMode('wrapEko', {}, { allowCuaMode: true, configOverride: { mode: 'cua' } })
);
expectError(assertNonCuaMode('wrapStagehand', {})); // options arg required
expectError(assertNonCuaMode('wrapStagehand')); // client + options required

expectType<string | undefined>(detectVendorMode({}, undefined));
expectType<string | undefined>(detectVendorMode({}, { mode: 'computer-use' }));
expectError(detectVendorMode({})); // configOverride arg required (may be undefined, but must be passed)

expectType<{ actionString: string; args?: Record<string, unknown> }>(normaliseActArg('click submit'));
expectType<{ actionString: string; args?: Record<string, unknown> }>(
  normaliseActArg({ action: 'click', selector: '#x' })
);
expectError(normaliseActArg({ selector: '#x' })); // object form requires `action`
expectError(normaliseActArg(123)); // string | { action: string } only

expectType<boolean>(isUnsafeBinaryResult(new Uint8Array()));
expectType<boolean>(isUnsafeBinaryResult('plain text'));

expectType<void>(emitWarning(undefined, 'msg'));
expectType<void>(emitWarning({ warn: _m => {} }, 'msg', { runId: 'r' }));
expectError(emitWarning(undefined)); // message required

expectType<string | undefined>(sanitizeReasonText('reason'));
expectType<string | undefined>(sanitizeReasonText(undefined));
expectError(sanitizeReasonText()); // reason arg required

// --- BrowserAgentGuardrailBlockedError class --------------------------------
const err = new BrowserAgentGuardrailBlockedError('stagehand', 'act', 'tool_call', 'blocked by validator');
expectType<BrowserAgentGuardrailBlockedError>(err);
expectType<string>(err.connector);
expectType<string>(err.action);
expectType<BrowserAgentValidateResult['surface']>(err.surface);
expectError(new BrowserAgentGuardrailBlockedError('stagehand', 'act')); // surface + reason required
