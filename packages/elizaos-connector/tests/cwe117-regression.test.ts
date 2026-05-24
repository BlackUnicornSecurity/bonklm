/**
 * Sprint 40 connector CWE-117 sweep — elizaos-connector regression.
 *
 * Two src sites carry attacker-influenced template-literal log calls:
 *   - `wrap-memory.ts:typoMsg` uses `callerPluginName` from the
 *     ElizaOS plugin registry (hostile plugin can register a name
 *     containing control chars).
 *   - `probe.ts` three sites embed `outcome.reason` from
 *     `runStartupProbe` (network-derived error.message).
 *
 * Sprint 40 wraps with `sanitizeLogString` at each interpolation
 * boundary. This test locks the import + asserts the canonical
 * primitive's behaviour for the specific vectors the elizaos
 * connector exposes.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString } from '@blackunicorn/bonklm';

describe('elizaos-connector — Sprint 40 CWE-117 sanitization contract', () => {
  it('sanitizes a hostile plugin name (typo-squat path)', () => {
    // Real-world vector: a hostile plugin registers
    // `@elizaos/plugin-solana\nINJECTED:CRITICAL fake_alert: bypass`
    // — the typo-squat REFUSE log includes this name in a
    // template-literal `[BonkLM] CRITICAL — Caller plugin "..."`
    // message. Pre-Sprint-40, the embedded `\n` forged a second
    // log line. Sprint 40 wraps the variable with sanitizeLogString.
    const hostile = '@elizaos/plugin-soIana\nINJECTED:CRITICAL bypass';
    expect(sanitizeLogString(hostile)).toBe(
      '@elizaos/plugin-soIana\\nINJECTED:CRITICAL bypass'
    );
  });

  it('sanitizes a probe-outcome reason carrying a network error message', () => {
    // probe.ts: `outcome.reason` ends up in 3 different template
    // literals depending on the outcome variant. The CWE-117 vector
    // is a runtime error.message that includes a CR/LF — the runtime
    // host config is operator-edited, but any downstream config
    // pipeline taking caller input could surface attacker-controlled
    // host names here.
    const reason = 'connect ECONNREFUSED 127.0.0.1:1024\tINJECTED:fake_metric';
    expect(sanitizeLogString(reason)).toBe(
      'connect ECONNREFUSED 127.0.0.1:1024\\x09INJECTED:fake_metric'
    );
  });
});
