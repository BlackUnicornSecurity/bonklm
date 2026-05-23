/**
 * Sprint 16 cumulative audit closure (code-reviewer CONCERN-2 + security
 * BLOCK-1): shared `ValidatorInput` → `string` unwrap. Previously
 * duplicated verbatim across `code-injection.ts` and `path-traversal.ts`
 * with no defensive reason. Future kinds added to `ValidatorInput`
 * (e.g. `image_url`) need to flow through ONE place.
 *
 * **Cross-validator composition (security BLOCK-1)**: `audio_partial`
 * is recognised here so `CodeInjectionValidator` and
 * `PathTraversalValidator` can sit in a `GuardrailEngine` chain
 * alongside `AudioStreamValidator` without throwing per-chunk
 * `TypeError`s. The validators that consume this helper treat audio
 * partial chunks as regular text input — recall they ARE text per
 * Story 3.1 (the upstream realtime SDK already did the audio→text
 * transcription).
 */
import type { ValidatorInput } from '../../engine/GuardrailEngine.types.js';

/**
 * Unwrap a `ValidatorInput` (or raw string) to the inner text payload.
 *
 * Accepts: `text` | `composed_context` | `memory_write` | `tool_call`
 * | `audio_partial`. Throws `TypeError` on any other discriminated
 * kind (forward-compat trip-wire).
 *
 * `tool_call` args are stringified via `JSON.stringify`; non-string
 * non-object args fall back to `String(...)`. **Known limitation**
 * (security CONCERN-1): double-escaped Unicode in JSON strings (e.g.
 * `"\\u0065val"`) survives stringification as literal `eval` and
 * may evade ASCII regex scans. Sprint 18 planned Unicode-escape
 * normalisation pre-scan.
 */
export function unwrapValidatorInput(
  input: string | ValidatorInput,
  validatorName: string
): string {
  if (typeof input === 'string') return input;
  switch (input.kind) {
    case 'text':
      return input.content;
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
        return typeof input.args === 'string'
          ? input.args
          : JSON.stringify(input.args);
      } catch {
        return String(input.args);
      }
    default: {
      // Exhaustive check — TypeScript ensures `input` is `never` here
      // when every kind is handled. If a new kind lands in the union
      // we want the compiler to flag this branch.
      const _exhaustive: never = input;
      void _exhaustive;
      throw new TypeError(
        `${validatorName}: unsupported ValidatorInput kind '${(input as { kind: string }).kind}'.`
      );
    }
  }
}

/**
 * Unified score → RiskLevel mapping (code-reviewer CONCERN-1 closure).
 * Previously: AudioStream used `≥7 HIGH / ≥3 MEDIUM`; CodeInjection +
 * PathTraversal used `≥10 HIGH / ≥5 MEDIUM`. Convergent value is the
 * BROADER threshold — connectors should treat one CRITICAL finding
 * (weight 10) as `HIGH`, two WARNING findings (weight 5 each) as
 * `MEDIUM`.
 */
export function scoreToRiskLevel(score: number): import('../../base/GuardrailResult.js').RiskLevel {
  // Inline import to avoid circular dep — this helper is leaf-most.
  const HIGH = 'HIGH' as const;
  const MEDIUM = 'MEDIUM' as const;
  const LOW = 'LOW' as const;
  if (score >= 10) return HIGH as unknown as import('../../base/GuardrailResult.js').RiskLevel;
  if (score >= 5) return MEDIUM as unknown as import('../../base/GuardrailResult.js').RiskLevel;
  return LOW as unknown as import('../../base/GuardrailResult.js').RiskLevel;
}
