/**
 * CWE-117 sanitization primitive contract — elizaos-connector.
 *
 * Two attacker-influenced interpolation boundaries in this connector wrap their
 * value with the canonical sanitizer:
 *   - `wrap-memory.ts` interpolates `callerPluginName` (from the ElizaOS plugin
 *     registry — a hostile plugin can register a name with control chars) into
 *     the typo-squat / non-allowlisted REFUSE log.
 *   - `probe.ts`'s `applyProbeOutcome` interpolates `outcome.reason`
 *     (network-derived error text) into its three startup-probe log messages.
 *
 * This contract-lock asserts the canonical sanitizer primitives are reachable
 * from the import surface and behave as expected. The END-TO-END proof that each
 * guarded path actually applies the wrap (and FAILS if it is removed — the
 * ADR-0001 non-vacuity standard) lives in the driving blocks:
 *   - wrap-memory: the "elizaos-connector — Sprint 41 typo-squat CRITICAL log
 *     integration" block below (installs the sealed wrapper + drives the refuse
 *     log with a hostile plugin name).
 *   - probe: `probe.test.ts` › "applyProbeOutcome — CWE-117 reason sanitization
 *     is load-bearing (ADR-0001)".
 */
import { describe, expect, it, vi } from 'vitest';

import { sanitizeLogString, sanitizeMeta } from '@blackunicorn/bonklm';

import { withCallContext } from '../src/als-context.js';
import { installSealedWrapMemory } from '../src/wrap-memory.js';
import type { IAgentRuntimeLike, MemoryLike } from '../src/types.js';

describe('elizaos-connector — CWE-117 sanitization primitive contract', () => {
  it('sanitizes a hostile plugin name for the typo-squat / refuse log', () => {
    // Real-world vector: a hostile plugin registers a name carrying a control
    // char; the refuse log interpolates it into a `[BonkLM] CRITICAL — Caller
    // plugin "..."` message. The embedded `\n` would otherwise forge a second
    // log line. wrap-memory.ts wraps the value with the canonical sanitizer.
    const hostile = '@elizaos/plugin-soIana\nINJECTED:CRITICAL bypass';
    expect(sanitizeLogString(hostile)).toBe('@elizaos/plugin-soIana\\nINJECTED:CRITICAL bypass');
  });

  it('sanitizes a probe-outcome reason carrying a network error message', () => {
    // probe.ts's `applyProbeOutcome` interpolates `outcome.reason` (network-derived
    // error text) into its startup-probe log messages via `sanitizeMeta`. A reason
    // carrying a CR/LF would otherwise forge a second log line.
    const reason = 'connect ECONNREFUSED 127.0.0.1:1024\nINJECTED:fake_metric';
    expect(sanitizeMeta(reason)).toBe('connect ECONNREFUSED 127.0.0.1:1024\\nINJECTED:fake_metric');
  });
});

// Sprint 41 integration test (architect HIGH-2 + code-reviewer MEDIUM
// + security S40-4 closure for elizaos): exercises the actual
// `installSealedWrapMemory` → `createMemory` → typo-squat CRITICAL
// log path with a hostile plugin name carrying control characters.
// If a future commit removes `sanitizeMeta(callerPluginName)` from
// `wrap-memory.ts`, this test fails — proving the wrap is
// regression-net protected, not just contract-lock asserted.
describe('elizaos-connector — Sprint 41 typo-squat CRITICAL log integration', () => {
  function makeRuntime(): IAgentRuntimeLike {
    return {
      agentId: 'test-agent',
      createMemory: vi.fn(async () => 'created'),
      actions: []
    } as unknown as IAgentRuntimeLike;
  }

  function makeSpyLogger() {
    return {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
  }

  it('sanitizes hostile plugin name in the non-allowlisted refuse warn log', async () => {
    const runtime = makeRuntime();
    const logger = makeSpyLogger();

    // Install the sealed wrapper with our spy logger.
    installSealedWrapMemory(runtime, { logger, productionMode: false });

    // Hostile plugin name: distance 1 from verified publisher
    // `@elizaos/plugin-solana` (single `\n` insertion at the tail).
    // detectTypoSquat normalises via NFKC + format-char strip but
    // does NOT strip `\n`, so the normalized form remains
    // `@elizaos/plugin-solana\n` — exact-match misses, Levenshtein
    // distance to the verified publisher = 1, typo-squat fires.
    // The wrap-memory.ts CRITICAL log includes this raw name in a
    // template literal; sanitizeMeta MUST convert the `\n` to the
    // literal marker `\\n` to defeat phantom-log-line injection.
    const hostileName = '@elizaos/plugin-solana\nINJECTED';

    // Run the createMemory call inside the call context that carries
    // the hostile plugin name as the caller identity.
    let thrown: unknown = null;
    // sourceTrust: 'authenticated' bypasses the non-auth refusal check
    // so the typo-squat assertion path can fire on the messages-write.
    await withCallContext(runtime, { sourceTrust: 'authenticated', pluginName: hostileName }, async () => {
      try {
        await runtime.createMemory({
          tableName: 'messages',
          content: { text: 'hello' }
        } as MemoryLike);
      } catch (err) {
        thrown = err;
      }
    });

    // The typo-squat path throws ConnectorValidationError and logs
    // a CRITICAL line. Verify the throw fired (path was exercised).
    expect(thrown).not.toBeNull();

    // The hostile name has `\n` + 8 chars of suffix — Levenshtein
    // distance from `@elizaos/plugin-solana` is 9, > typo-squat
    // threshold of 2. So the path lands at the NON-ALLOWLISTED warn
    // branch (not the typo-squat CRITICAL branch). That branch was
    // ALSO unsanitized in Sprint 40 — surfaced + fixed Sprint 41 by
    // this very test. The integration assertion below verifies the
    // wrap fires regardless of which refuse branch ran.
    expect(logger.warn).toHaveBeenCalled();
    const warnCalls = logger.warn.mock.calls;
    const refuseLog = warnCalls.find(call => typeof call[0] === 'string' && call[0].includes('Refusing'));
    expect(refuseLog).toBeDefined();

    // Inspect both the message AND the meta-field `caller` —
    // BOTH must be sanitized. The hostile name with `\n` MUST appear
    // as the literal two-char marker `\\n`, NOT as a real newline
    // byte (CWE-117 — would forge a second log line in downstream
    // aggregators).
    const [refuseMessage, refuseMeta] = refuseLog!;
    expect(typeof refuseMessage).toBe('string');
    expect(refuseMessage as string).not.toContain('@elizaos/plugin-solana\nINJECTED');
    // Meta `caller` field MUST also be sanitized.
    expect(refuseMeta).toBeDefined();
    const meta = refuseMeta as { caller: string };
    expect(meta.caller).toBe('@elizaos/plugin-solana\\nINJECTED');
  });
});
