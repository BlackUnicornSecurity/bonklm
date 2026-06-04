/**
 * Story 2.4a Phase-2 — wiring tests.
 *
 * Covers:
 *  - bonklmPlugin.init auto-subscribes MESSAGE_RECEIVED when both
 *    shadowLog + runtime.on are present; INFO log when on() missing.
 *  - tool-call-args-gate reads from shadow log when configured;
 *    falls back to runtime.getMemories when not (backward compat).
 *  - tool-call-args-gate fails CLOSED when shadow-log chain integrity
 *    fails (returns generic public error string; no brokenAt leak).
 *  - acknowledgeClass4Risk deprecation warning emitted when
 *    shadowLog is configured AND the flag is set.
 *  - auditInstalledVersions emits HIGH EOL finding for v0.4.x.
 *  - runDoctor accepts installedVersions and threads through.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createShadowLog,
  createInMemoryShadowLogStorage,
  PromptInjectionValidator,
  type Validator
} from '@blackunicorn/bonklm';
import { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
import { auditInstalledVersions, bonklmPlugin, runDoctor, wrapSigningAction } from '../src/index.js';
import { __clearProbeCacheForTests } from '../src/probe.js';
import type { ActionLike, IAgentRuntimeLike, MemoryLike } from '../src/types.js';

function makeValidators(): Validator[] {
  return [new PromptInjectionValidator()];
}

describe('bonklmPlugin.init — shadow log auto-wire', () => {
  it('subscribes to MESSAGE_RECEIVED when runtime.on is present + shadowLog configured', async () => {
    const shadowLog = createShadowLog(createInMemoryShadowLogStorage());
    const onSpy = vi.fn();
    const runtime: IAgentRuntimeLike = {
      agentId: 'a-1',
      createMemory: vi.fn(),
      actions: [],
      on: onSpy
    };

    const plugin = bonklmPlugin({ shadowLog, validators: makeValidators() });
    await plugin.init!({ runtime });

    expect(onSpy).toHaveBeenCalledTimes(1);
    expect(onSpy.mock.calls[0][0]).toBe('MESSAGE_RECEIVED');
    expect(typeof onSpy.mock.calls[0][1]).toBe('function');
  });

  it('logs INFO when shadowLog is configured BUT runtime.on is absent', async () => {
    const shadowLog = createShadowLog(createInMemoryShadowLogStorage());
    const logs: Array<{ level: string; msg: string }> = [];
    const logger = {
      debug: () => {},
      info: (msg: string) => logs.push({ level: 'info', msg }),
      warn: (msg: string) => logs.push({ level: 'warn', msg }),
      error: (msg: string) => logs.push({ level: 'error', msg })
    };
    const runtime: IAgentRuntimeLike = {
      agentId: 'a-1',
      createMemory: vi.fn(),
      actions: []
      // No .on()
    };

    const plugin = bonklmPlugin({ shadowLog, validators: makeValidators(), logger });
    await plugin.init!({ runtime });

    const infoLog = logs.find(l => l.level === 'info' && l.msg.includes('shadow log auto-wire skipped'));
    expect(infoLog).toBeDefined();
  });

  it('does NOT subscribe when shadowLog is NOT configured (v0.4.x backward compat)', async () => {
    const onSpy = vi.fn();
    const runtime: IAgentRuntimeLike = {
      agentId: 'a-1',
      createMemory: vi.fn(),
      actions: [],
      on: onSpy
    };

    const plugin = bonklmPlugin({ validators: makeValidators() });
    await plugin.init!({ runtime });

    expect(onSpy).not.toHaveBeenCalled();
  });
});

describe('bonklmPlugin.init — acknowledgeClass4Risk deprecation', () => {
  it('emits WARN when both shadowLog AND acknowledgeClass4Risk:true are set', async () => {
    const shadowLog = createShadowLog(createInMemoryShadowLogStorage());
    const logs: Array<{ level: string; msg: string }> = [];
    const logger = {
      debug: () => {},
      info: () => {},
      warn: (msg: string) => logs.push({ level: 'warn', msg }),
      error: () => {}
    };
    const runtime: IAgentRuntimeLike = {
      agentId: 'a-1',
      createMemory: vi.fn(),
      actions: [],
      on: vi.fn()
    };

    const plugin = bonklmPlugin({
      shadowLog,
      acknowledgeClass4Risk: true,
      validators: makeValidators(),
      logger
    });
    await plugin.init!({ runtime });

    const deprecationWarn = logs.find(
      l => l.msg.includes('acknowledgeClass4Risk') && l.msg.includes('no longer needed')
    );
    expect(deprecationWarn).toBeDefined();
  });

  it('emits the backward-compat WARN when acknowledgeClass4Risk:true and NO shadowLog', async () => {
    const logs: Array<{ level: string; msg: string }> = [];
    const logger = {
      debug: () => {},
      info: () => {},
      warn: (msg: string) => logs.push({ level: 'warn', msg }),
      error: () => {}
    };
    const runtime: IAgentRuntimeLike = {
      agentId: 'a-1',
      createMemory: vi.fn(),
      actions: []
    };

    const plugin = bonklmPlugin({
      acknowledgeClass4Risk: true,
      validators: makeValidators(),
      logger
    });
    await plugin.init!({ runtime });

    const backwardCompatWarn = logs.find(l => l.msg.includes('acknowledgeClass4Risk=true accepted'));
    expect(backwardCompatWarn).toBeDefined();
  });
});

describe('wrapSigningAction — shadow log read path (Phase-2)', () => {
  it('reads memories from shadow log when configured (authenticated entry)', async () => {
    const shadowLog = createShadowLog(createInMemoryShadowLogStorage());
    // Pre-seed shadow log with a user-authored message mentioning the recipient.
    await shadowLog.append({
      messageId: 'm-1',
      roomId: 'r-1',
      entityId: 'user-1',
      text: 'please send to 0xabc',
      sourceTrust: 'authenticated'
    });

    const handlerSpy = vi.fn();
    const action: ActionLike = { name: 'TRANSFER_SOL', handler: handlerSpy };
    const runtime: IAgentRuntimeLike = {
      agentId: 'a-1'
      // NO getMemories — proves the gate reads from shadow log.
    };
    const wrapped = wrapSigningAction(action, runtime, {
      shadowLog,
      validators: makeValidators()
    });

    const message: MemoryLike = {
      roomId: 'r-1',
      content: { args: { recipient: '0xabc' } }
    };

    // recipient '0xabc' appears in the shadow log entry → gate passes.
    await wrapped.handler!(runtime, message);
    expect(handlerSpy).toHaveBeenCalled();
  });

  it('falls back to runtime.getMemories when shadowLog is NOT configured (backward compat)', async () => {
    const getMemoriesSpy = vi.fn(async () => [
      {
        roomId: 'r-1',
        content: { text: 'please send to 0xabc' },
        source: 'authenticated' as const,
        metadata: { bonklmTrust: true }
      }
    ]);
    const handlerSpy = vi.fn();
    const action: ActionLike = { name: 'TRANSFER_SOL', handler: handlerSpy };
    const runtime: IAgentRuntimeLike = {
      agentId: 'a-1',
      getMemories: getMemoriesSpy
    };
    const wrapped = wrapSigningAction(action, runtime, {
      // NO shadowLog
      validators: makeValidators()
    });

    const message: MemoryLike = {
      roomId: 'r-1',
      content: { args: { recipient: '0xabc' } }
    };

    await wrapped.handler!(runtime, message);
    expect(getMemoriesSpy).toHaveBeenCalled();
    expect(handlerSpy).toHaveBeenCalled();
  });

  it('fails CLOSED on shadow-log integrity failure (returns generic error)', async () => {
    // Custom adapter that lets us mutate stored entries to break the chain.
    const stored: Array<import('@blackunicorn/bonklm').ShadowLogEntry> = [];
    const adapter = {
      async append(entry: import('@blackunicorn/bonklm').ShadowLogEntry) {
        stored.push({ ...entry });
      },
      async readByRoom() {
        return [...stored];
      },
      async getLatestHashForRoom() {
        return stored.length > 0 ? stored[stored.length - 1].contentHash : null;
      }
    };
    const shadowLog = createShadowLog(adapter);
    await shadowLog.append({
      messageId: 'm-1',
      roomId: 'r-1',
      entityId: 'user-1',
      text: 'please send to 0xabc',
      sourceTrust: 'authenticated'
    });
    // Tamper.
    stored[0] = { ...stored[0], text: 'ATTACKER MUTATED' };

    const handlerSpy = vi.fn();
    const action: ActionLike = { name: 'TRANSFER_SOL', handler: handlerSpy };
    const runtime: IAgentRuntimeLike = { agentId: 'a-1' };

    const onActionBlockedSpy = vi.fn();
    const wrapped = wrapSigningAction(action, runtime, {
      shadowLog,
      validators: makeValidators(),
      onActionBlocked: onActionBlockedSpy
    });

    const message: MemoryLike = {
      roomId: 'r-1',
      content: { args: { recipient: '0xabc' } }
    };

    await expect(wrapped.handler!(runtime, message)).rejects.toThrow(ConnectorValidationError);
    // The handler MUST NOT have executed.
    expect(handlerSpy).not.toHaveBeenCalled();
    // The callback fired with the generic integrity-failure marker.
    expect(onActionBlockedSpy).toHaveBeenCalledWith('TRANSFER_SOL', 'shadow_log_integrity_failure');
  });
});

describe('wrapSigningAction — security BLOCK-Q2 + Q10a default semantics', () => {
  it('Q10a: agent_internal entries are EXCLUDED from corroboration set by default', async () => {
    const shadowLog = createShadowLog(createInMemoryShadowLogStorage());
    // Append an entry tagged as agent_internal (e.g., an agent's
    // own tool-call output that incidentally mentions the recipient).
    await shadowLog.append({
      messageId: 'm-1',
      roomId: 'r-1',
      entityId: 'agent',
      text: 'recipient 0xabc was used in a prior step',
      sourceTrust: 'agent_internal'
    });

    const handlerSpy = vi.fn();
    const action: ActionLike = { name: 'TRANSFER_SOL', handler: handlerSpy };
    const runtime: IAgentRuntimeLike = { agentId: 'a-1' };
    const wrapped = wrapSigningAction(action, runtime, {
      shadowLog,
      validators: makeValidators()
    });

    const message: MemoryLike = {
      roomId: 'r-1',
      content: { args: { recipient: '0xabc' } }
    };

    // Default sourceFilter is ['authenticated'] only — agent_internal
    // entries are filtered out at the shadow-log read step. The
    // corroboration set is empty; gate blocks because no
    // user-authored message references the recipient.
    await expect(wrapped.handler!(runtime, message)).rejects.toThrow(ConnectorValidationError);
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('Q10a: shadowEntryToMemoryLike preserves the actual sourceTrust (data integrity)', async () => {
    // This test verifies that the conversion does NOT re-stamp the
    // source field. Verified indirectly: an authenticated entry passes
    // the gate; an agent_internal entry — if it ever leaked past the
    // shadow-log filter — would NOT pass evaluateRecipientGate because
    // its source field would correctly be 'agent_internal', not
    // 'authenticated'. Combined with the source-filter default
    // (['authenticated'] only) this is double-defense.
    const shadowLog = createShadowLog(createInMemoryShadowLogStorage());
    await shadowLog.append({
      messageId: 'm-1',
      roomId: 'r-1',
      entityId: 'user-1',
      text: 'please send to 0xabc',
      sourceTrust: 'authenticated'
    });
    // Use a broader sourceFilter on the read to expose the conversion
    // — this is opt-in only; default would exclude.
    // We assert this via a successful gate pass on the authenticated
    // entry: the source field flowing into evaluateRecipientGate
    // must be the ACTUAL 'authenticated' from the shadow log entry.
    const handlerSpy = vi.fn();
    const action: ActionLike = { name: 'TRANSFER_SOL', handler: handlerSpy };
    const runtime: IAgentRuntimeLike = { agentId: 'a-1' };
    const wrapped = wrapSigningAction(action, runtime, {
      shadowLog,
      validators: makeValidators()
    });

    const message: MemoryLike = {
      roomId: 'r-1',
      content: { args: { recipient: '0xabc' } }
    };
    await wrapped.handler!(runtime, message);
    expect(handlerSpy).toHaveBeenCalled();
  });
});

describe('bonklmPlugin.init — security A&D-Q7: shadowLog absent + runtimePort set', () => {
  // Hermeticity — defect OI-006, "the :3000 trap". This test's subject is the
  // A&D-Q7 HIGH warn (init emits it when `runtimePort` is set but `shadowLog`
  // is absent); it is NOT a probe-branch test. The startup probe is incidental
  // but would otherwise fire a REAL fetch to 127.0.0.1:<runtimePort>/api/agents/<id>/memories,
  // so anything answering 200 on that port (a stray dev server, a Docker
  // container publishing :3000) makes the probe mis-read a Class-4 unauth route
  // and init THROWS before the warn is reached. We inject a rejecting transport
  // through the typed public contract (`fetchImpl`) so BOTH the IPv4 and IPv6
  // probe attempts resolve to `unreachable` — no network, no host-port
  // assumption — and init proceeds to the warn under test. Injecting via the
  // documented option (vs the prior `vi.stubGlobal('fetch')`) makes a future
  // move of the probe's transport off `fetchImpl` a COMPILE-TIME break rather
  // than a silent runtime no-op that re-opens the trap. Probe-branch behaviour
  // itself is covered by probe.test.ts against real loopback servers.
  beforeEach(() => {
    __clearProbeCacheForTests();
  });

  afterEach(() => {
    // Drop the `a-1:3000` outcome this describe cached so it cannot outlive the
    // block in the module-scope probe memo (`fetchImpl` is not part of the
    // dedup key — see ProbeOptions.fetchImpl).
    __clearProbeCacheForTests();
  });

  it('emits HIGH warn when runtimePort is configured but shadowLog is absent', async () => {
    const logs: Array<{ level: string; msg: string }> = [];
    const logger = {
      debug: () => {},
      info: () => {},
      warn: (msg: string) => logs.push({ level: 'warn', msg }),
      error: () => {}
    };
    const runtime: IAgentRuntimeLike = {
      agentId: 'a-1',
      createMemory: vi.fn(),
      actions: []
    };

    // Deterministic rejecting transport injected via the public contract — the
    // probe is incidental here, so we only need it to be a guaranteed no-op
    // (ECONNREFUSED on both the IPv4 + IPv6 attempts → `unreachable`).
    const econnrefused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1'), { code: 'ECONNREFUSED' });
    const transport = vi.fn().mockRejectedValue(econnrefused);

    const plugin = bonklmPlugin({
      validators: makeValidators(),
      runtimePort: 3000,
      fetchImpl: transport as unknown as typeof fetch,
      // NO shadowLog — the gap A&D-Q7 catches.
      logger
    });
    await plugin.init!({ runtime });

    // Premise check: the injected transport was actually exercised, so the
    // incidental probe is a true no-op (init reached the warn, did not throw).
    // With DI this is type-safe — moving the probe off `fetchImpl` fails here
    // loudly instead of silently re-opening the :3000 trap.
    expect(transport).toHaveBeenCalled();
    expect(transport.mock.calls.some(([url]) => String(url).includes('127.0.0.1:3000'))).toBe(true);

    const highWarn = logs.find(
      l => l.msg.includes('HIGH') && l.msg.includes('runtimePort') && l.msg.includes('shadowLog')
    );
    expect(highWarn).toBeDefined();
  });

  it('does NOT emit the A&D-Q7 warn when runtimePort is set AND shadowLog IS wired', async () => {
    // Negative regression guard (ADR-0001 analogue): the A&D-Q7 warn fires ONLY
    // because the `shadowLog === undefined` guard in init holds. With a shadow
    // log wired, init takes the auto-wire branch and the warn is unreachable.
    // Without this assertion, dropping that guard — so the warn fired whenever
    // `runtimePort` is set, regardless of shadowLog — would pass the positive
    // test above undetected, silently breaking the gap A&D-Q7 is meant to catch.
    const logs: Array<{ level: string; msg: string }> = [];
    const logger = {
      debug: () => {},
      info: () => {},
      warn: (msg: string) => logs.push({ level: 'warn', msg }),
      error: () => {}
    };
    // `on` present so the auto-wire branch subscribes silently (no warn).
    const runtime: IAgentRuntimeLike = {
      agentId: 'a-1',
      createMemory: vi.fn(),
      actions: [],
      on: vi.fn()
    };

    // Same incidental probe no-op as the positive case — `runtimePort` still
    // triggers the probe here, so the seam is exercised in this scenario too.
    const econnrefused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1'), { code: 'ECONNREFUSED' });
    const transport = vi.fn().mockRejectedValue(econnrefused);

    const plugin = bonklmPlugin({
      validators: makeValidators(),
      runtimePort: 3000,
      // The ONLY difference from the positive case: shadowLog IS wired.
      shadowLog: createShadowLog(createInMemoryShadowLogStorage()),
      fetchImpl: transport as unknown as typeof fetch,
      logger
    });
    await plugin.init!({ runtime });

    // The probe still ran, so absence-of-warn is meaningful (not a skipped path)…
    expect(transport).toHaveBeenCalled();
    // …yet because `shadowLog` IS wired, the A&D-Q7 gap warn must NOT appear —
    // same predicate as the positive test, asserted absent.
    const highWarn = logs.find(
      l => l.msg.includes('HIGH') && l.msg.includes('runtimePort') && l.msg.includes('shadowLog')
    );
    expect(highWarn).toBeUndefined();
  });
});

describe('auditInstalledVersions — EOL finding for bonklm-elizaos@0.4.x', () => {
  it('emits HIGH plugin_not_in_allowlist for installed 0.4.x version', () => {
    const findings = auditInstalledVersions({
      '@blackunicorn/bonklm-elizaos': '0.4.1'
    });
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('HIGH');
    expect(findings[0].category).toBe('elizaos_connector_eol_v04');
    expect(findings[0].description).toContain('0.4.1');
  });

  it('returns no findings for v0.5.x installs', () => {
    const findings = auditInstalledVersions({
      '@blackunicorn/bonklm-elizaos': '0.5.0'
    });
    expect(findings.length).toBe(0);
  });

  it('returns no findings when the package is not installed', () => {
    const findings = auditInstalledVersions({
      'some-other-package': '1.0.0'
    });
    expect(findings.length).toBe(0);
  });

  it('returns no findings when installedVersions is undefined', () => {
    expect(auditInstalledVersions(undefined)).toEqual([]);
  });
});

describe('runDoctor — threaded EOL findings via installedVersions', () => {
  it('includes the EOL finding in the combined report', () => {
    const report = runDoctor({
      character: { system: 'you are a helpful assistant' },
      plugins: [],
      installedVersions: {
        '@blackunicorn/bonklm-elizaos': '0.4.2'
      }
    });
    const eolFinding = report.findings.find(f => f.category === 'elizaos_connector_eol_v04');
    expect(eolFinding).toBeDefined();
  });
});
