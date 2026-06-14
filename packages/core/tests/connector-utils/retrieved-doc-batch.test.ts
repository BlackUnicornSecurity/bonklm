/**
 * Unit tests for connector-utils/retrieved-doc-batch.ts
 *
 * Focus: the CWE-117 sanitization of the validator `reason` embedded in the
 * thrown `ConnectorValidationError` message (D-042). A custom validator returns
 * a batch result whose `reason` carries raw control bytes — the helper's throw
 * boundary is the only sanitization point, so this is the non-vacuous lock for
 * that fix (removing the wrap leaks the raw bytes into error.message).
 */
import { describe, it, expect } from 'vitest';
import { applyRetrievedDocValidatorToMatches } from '../../src/connector-utils/retrieved-doc-batch.js';
import { ConnectorValidationError } from '../../src/connector-utils/errors.js';
import type { RetrievedDocValidator, RetrievedDocBatchResult } from '../../src/validators/retrieved-doc.js';
import type { GuardrailResult } from '../../src/base/GuardrailResult.js';
import { Severity } from '../../src/base/GuardrailResult.js';

const ESC = String.fromCharCode(27);
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);
const RAW_CONTROL = [ESC, NL, CR, TAB];
const CONTROL_REASON = `evil${ESC}[31m${NL}FAKE-LOG${CR}injected${TAB}`;

interface Match {
  id: string;
  text: string;
}

// A custom RetrievedDocValidator whose validateBatch returns a control-char
// reason directly — so the batch helper's throw is the sole sanitization site.
function makeBlockingValidator(reason: string): RetrievedDocValidator {
  const blockedResult: GuardrailResult = {
    allowed: false,
    blocked: true,
    reason,
    severity: Severity.CRITICAL,
    risk_level: 'HIGH',
    risk_score: 30,
    findings: [],
    timestamp: Date.now()
  };
  return {
    name: 'BlockingBatchValidator',
    validate: async () => blockedResult,
    validateBatch: async (docs): Promise<RetrievedDocBatchResult> => ({
      result: blockedResult,
      docs: [],
      filteredCount: docs.length
    })
  };
}

const toDoc = (m: Match) => ({ content: m.text, metadata: undefined });

describe('applyRetrievedDocValidatorToMatches — CWE-117 throw sanitization (D-042)', () => {
  it('escapes control chars in the validator reason embedded in the thrown error', async () => {
    const validator = makeBlockingValidator(CONTROL_REASON);
    const matches: Match[] = [{ id: 'm0', text: 'anything' }];

    let err: unknown;
    try {
      await applyRetrievedDocValidatorToMatches(matches, validator, toDoc, {
        productionMode: false,
        itemNoun: 'document'
      });
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(ConnectorValidationError);
    const message = (err as Error).message;
    expect(message).toContain('document batch blocked');
    for (const ch of RAW_CONTROL) {
      expect(message).not.toContain(ch);
    }
  });

  it('production mode omits the reason entirely', async () => {
    const validator = makeBlockingValidator(CONTROL_REASON);
    let err: unknown;
    try {
      await applyRetrievedDocValidatorToMatches([{ id: 'm0', text: 'x' }], validator, toDoc, {
        productionMode: true,
        itemNoun: 'document'
      });
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toBe('document batch blocked');
  });
});
