/**
 * Sprint 20 audit closure (convergent BLOCK — all 3 lanes):
 * `adaptValidator` hoisted to core after restate-middleware + temporal-
 * middleware duplicated the same helper byte-for-byte. Capability-
 * detection replaces the previous try-catch-TypeError fallback which
 * silently masked legitimate validator bugs (security B-2, code-reviewer
 * C-2, architect C-1).
 *
 * Capability heuristic: validators that ACCEPT a structured
 * `ValidatorInput` should declare it via a static `acceptsInput`
 * property:
 *
 *   ```ts
 *   export class MyValidator implements Validator {
 *     static readonly acceptsInput: 'string' | 'envelope' | 'both' = 'both';
 *     readonly name = 'my-validator';
 *     async validate(input: string | ValidatorInput) { ... }
 *   }
 *   ```
 *
 * When the static is absent, the adapter assumes `'string'` (legacy
 * shape) and pre-extracts the content. This is the SAFE default — a
 * validator that genuinely accepts envelopes will still receive the
 * extracted string and work correctly (the envelope is downcast to
 * its string content).
 *
 * `name` REQUIRED — cachedValidate B2 guard fires if absent.
 */
import type { Validator, ValidatorInput } from '../engine/GuardrailEngine.types.js';

/**
 * Capability hint that validators MAY declare. Adapter uses this
 * instead of catching TypeError to decide how to invoke `.validate`.
 */
export type ValidatorInputCapability = 'string' | 'envelope' | 'both';

interface ValidatorWithCapability {
  acceptsInput?: ValidatorInputCapability;
}

/**
 * Wrap a validator so it cooperates with `cachedValidate` (which
 * always passes ValidatorInput). For legacy `string`-only validators
 * (PromptInjection, Jailbreak) the adapter pre-extracts the inner
 * text content. The wrapper preserves `.name` so cachedValidate's
 * B2 guard accepts it.
 *
 * @throws TypeError if the validator has no `.name`.
 */
export function adaptValidatorToUniversalInput(v: Validator, callerLabel: string): Validator {
  const name = v.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError(
      `${callerLabel}: validator missing required \`name\` property. ` +
        `Set \`readonly name = '<id>'\` on the validator class.`
    );
  }

  const capability =
    (v.constructor as unknown as ValidatorWithCapability).acceptsInput ??
    (v as unknown as ValidatorWithCapability).acceptsInput ??
    inferCapability(v);

  return {
    name,
    validate: async (input) => {
      if (capability === 'string') {
        const content = extractStringContent(input);
        return v.validate(content);
      }
      // 'envelope' OR 'both' — pass through.
      return v.validate(input);
    },
  };
}

/**
 * Extract a string payload from any input shape. Used by the adapter
 * when calling a string-only legacy validator.
 */
export function extractStringContent(input: string | ValidatorInput): string {
  if (typeof input === 'string') return input;
  switch (input.kind) {
    case 'text':
    case 'audio_partial':
      return input.content;
    case 'composed_context':
      return input.entries.join('\n\n');
    case 'memory_write':
      return input.payload.content;
    case 'retrieved_docs':
      return input.docs.map((d) => d.content).join('\n\n');
    case 'tool_call':
      try {
        return typeof input.args === 'string' ? input.args : JSON.stringify(input.args);
      } catch {
        // Sprint 20 audit security N-1 + code-reviewer C-5: never
        // collapse to empty string (skips validation) on circular
        // refs — emit a sentinel that the validator can still scan.
        return '[non-serializable tool_call args]';
      }
    default:
      return String(input);
  }
}

/**
 * Best-effort capability inference for validators that don't declare
 * `acceptsInput`. Falls back to `'string'` (safe default —
 * pre-extracts content so even envelope-aware validators work).
 *
 * Known legacy validators (no declaration, string-only): PromptInjection,
 * Jailbreak.
 */
function inferCapability(_v: Validator): ValidatorInputCapability {
  return 'string';
}
