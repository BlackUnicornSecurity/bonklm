/**
 * BonkLM - Guard content derivation
 * =================================
 * Reduces a structured `ValidatorInput` to a single canonical text
 * surface so `Guard`-shaped checks — which take `(content: string,
 * context?: string)` — can run on `engine.validateInput(input)`, not
 * only on the string `engine.validate(content)` path.
 *
 * Coverage model:
 *   - Text-bearing fields pass through VERBATIM so guard patterns keep
 *     full fidelity (no JSON escaping of quotes / newlines, which would
 *     otherwise defeat source-syntax patterns such as `api_key = "…"`):
 *     `text` / `audio_partial` content, `composed_context` entries,
 *     `retrieved_docs[].content`, `memory_write.payload.content`.
 *   - Structured fields are JSON-encoded so they are still surfaced to
 *     guards: `tool_call` args, `retrieved_docs[]` id + metadata, and
 *     `memory_write` metadata / userId / sessionId. Standalone-TOKEN
 *     secrets (AWS access-key id `AKIA…`, GitHub `ghp_…`, Stripe
 *     `sk_live_…`, Anthropic `sk-ant-…`, opaque high-entropy tokens)
 *     match through the encoding; a quote-delimited `key = "value"`
 *     pattern (generic `api_key = "…"`, the AWS *secret* access key)
 *     may NOT match once the quotes are JSON-escaped — see
 *     known-limitations §10 for that residual.
 *
 * @package @blackunicorn/bonklm
 */
import type { ValidatorInput } from './GuardrailEngine.types.js';

/**
 * Returned only when a structured value cannot be encoded at all (e.g. a
 * throwing getter). Downstream consumers then handle an inert string
 * rather than the encode throwing into the validation pipeline (a crash
 * on hostile / page-controlled structured input).
 */
const UNSERIALIZABLE_CONTENT = '[bonklm: input not serializable]';

/**
 * JSON-encode an arbitrary value without ever throwing, and without a
 * single hostile sub-value silently dropping its serializable siblings.
 *
 * A naive `JSON.stringify` throws on the WHOLE object for one circular
 * reference or BigInt anywhere in the tree — which an attacker shaping
 * `tool_call` args could exploit to blind a guard (append one circular
 * property, and a real secret in a sibling key never reaches the guard).
 * The replacer instead neutralises those nodes locally (cycles → marker,
 * BigInt → its decimal string) so every other value is still surfaced.
 * The `try/catch` remains a last resort for the residual throwing-getter
 * case; `JSON.stringify` returning `undefined` (for `undefined` /
 * functions) collapses to an empty string.
 *
 * Shared by `deriveGuardContent` (guard surface) and `validateInput`'s
 * intercept-callback content derivation.
 */
export function safeJsonStringify(value: unknown): string {
  try {
    const seen = new WeakSet<object>();
    return (
      JSON.stringify(value, (_key, val) => {
        if (typeof val === 'bigint') {
          return val.toString();
        }
        if (typeof val === 'object' && val !== null) {
          // Add-only set: a node shared by two siblings (a DAG, not a
          // cycle) is fully serialized on its first visit and marked
          // `[Circular]` on the second. That mislabels shared nodes but
          // never DROPS content — the secret-bearing value is always
          // surfaced via the first (fully-serialized) reference.
          if (seen.has(val)) {
            return '[Circular]';
          }
          seen.add(val);
        }
        return val;
      }) ?? ''
    );
  } catch {
    return UNSERIALIZABLE_CONTENT;
  }
}

/**
 * Derive the string a `Guard` should inspect from a structured
 * `ValidatorInput`. Pure and total: every union member maps to a string
 * and the function never throws. See the module header for which fields
 * are surfaced verbatim vs JSON-encoded.
 */
export function deriveGuardContent(input: ValidatorInput): string {
  switch (input.kind) {
    case 'text':
    case 'audio_partial':
      return input.content;
    case 'composed_context':
      return input.entries.join('\n');
    case 'retrieved_docs':
      // Verbatim content + JSON-encoded id/metadata so a credential
      // planted in a doc's metadata is still surfaced to guards.
      return input.docs
        .map(doc => {
          const extras = safeJsonStringify({ id: doc.id, metadata: doc.metadata });
          return extras === '{}' ? doc.content : `${doc.content}\n${extras}`;
        })
        .join('\n');
    case 'memory_write': {
      // Verbatim content + JSON-encoded structured fields (a secret in
      // metadata / userId / sessionId must not slip past guards just
      // because it isn't the primary `content`).
      const { content, userId, sessionId, metadata } = input.payload;
      const extras = safeJsonStringify({ userId, sessionId, metadata });
      return extras === '{}' ? content : `${content}\n${extras}`;
    }
    case 'tool_call':
      return `${input.toolName}\n${safeJsonStringify(input.args)}`;
    default: {
      // Exhaustiveness guard. A new ValidatorInput kind added without
      // updating this switch is caught at compile time; at runtime it
      // falls back to a full JSON encode so guards still inspect
      // *something* rather than the new surface silently dropping out of
      // guard coverage.
      const _exhaustive: never = input;
      return safeJsonStringify(_exhaustive);
    }
  }
}
