/**
 * Indicative micro-benchmarks — log-sanitizer hot path + secret/PII scrubber overhead.
 *
 * Covers the `sanitizeLogString` hot path (the CWE-117 primitive every guarded
 * log/throw funnels through) and the credential / PII scrubber overhead. These
 * are DEV-INDICATIVE single-core numbers (hardware-portable), distinct from the
 * marketing-canonical suite in `benchmark.bench.ts`. Run with `pnpm benchmark:micro`.
 *
 * Note: `sanitizeLogString` truncates to `maxLen` (default 500), so the hot path
 * is bounded at ~500 chars regardless of input size; the inputs below sit at/below
 * that cap, plus one explicit large-`maxLen` stress case for the unbounded worst case.
 * The scrubbers have no length cap, so they use ~6 KB inputs to show overhead at scale.
 */
import { bench, describe } from 'vitest';

import { sanitizeLogString } from '../src/common/index.js';
import { redactCredentials } from '../src/cli/utils/error.js';
import { redactPIIInString, redactPIIInStringSync } from '../src/guards/pii/validators.js';

// Prime the PII redaction pattern cache so `redactPIIInStringSync` is NON-VACUOUS:
// it returns its input UNCHANGED until the async path loads the patterns, so an
// unprimed cache would silently turn the redaction benches below into no-ops. The
// top-level await resolves before vitest collects the benches; assert it actually
// transformed a known-PII probe so a priming failure is a hard error rather than a
// misleadingly-fast "PII-laden" number.
const PRIME_PROBE = 'john.doe@example.com';
if ((await redactPIIInString(PRIME_PROBE)) === PRIME_PROBE) {
  throw new Error('micro.bench: PII pattern cache failed to prime — redaction benches would be vacuous');
}

const CLEAN_SHORT = 'Connector validated input for session 42.';
// >500 chars so the default maxLen=500 truncation branch is actually exercised.
const CLEAN_OVERCAP = 'The quick brown fox jumps over the lazy dog. '.repeat(13).slice(0, 560);
const CLEAN_6K = `Audit log. ${'The quick brown fox jumps over the lazy dog. '.repeat(130)}`; // ~6 KB

// Worst-case sanitizer work: dense C0/C1 control chars + CR/LF/TAB + bidi overrides/isolates.
const DIRTY_500 = '\x00\x1b\t\r\n‮⁦\x9b\x85'.repeat(56).slice(0, 500);
// ~6 KB INPUT; the escaped output is ~30 KB, returned untruncated only because the
// bench passes maxLen=100k below (the default 500 would truncate it).
const DIRTY_6K = '\x00\x1b\t\r\n‮⁦\x9b\x85'.repeat(700);

// Scrubber inputs. Contiguous card number so the Credit_Card regex (no spaces) matches.
const SECRET_LADEN = `deploy with api_key="sk-ant-${'a1B2c3D4'.repeat(6)}" and token 'ghp_${'Zz9Yy8Xx'.repeat(5)}' set`;
const PII_LADEN = 'contact john.doe@example.com or card 4111111111111111, ssn 123-45-6789, tel 555-123-4567';

describe('Sanitizer hot-path — sanitizeLogString', () => {
  bench('clean short (~40 chars, fast path)', () => {
    sanitizeLogString(CLEAN_SHORT);
  });

  bench('clean ~560 chars (engages maxLen=500 truncation)', () => {
    sanitizeLogString(CLEAN_OVERCAP);
  });

  bench('control/bidi-dense at maxLen cap (~500 chars, work path)', () => {
    sanitizeLogString(DIRTY_500);
  });

  bench('control/bidi-dense ~6 KB, maxLen=100k (unbounded worst case)', () => {
    sanitizeLogString(DIRTY_6K, 100_000);
  });
});

describe('Scrubber overhead — credential + PII redaction', () => {
  bench('redactCredentials — clean prose (no redaction)', () => {
    redactCredentials(CLEAN_SHORT);
  });

  bench('redactCredentials — secret-laden', () => {
    redactCredentials(SECRET_LADEN);
  });

  bench('redactPIIInStringSync — clean prose (no redaction)', () => {
    redactPIIInStringSync(CLEAN_SHORT);
  });

  bench('redactPIIInStringSync — PII-laden', () => {
    redactPIIInStringSync(PII_LADEN);
  });

  bench('redactPIIInStringSync — clean ~6 KB (full-scan overhead)', () => {
    redactPIIInStringSync(CLEAN_6K);
  });
});
