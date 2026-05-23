/**
 * @blackunicorn/bonklm-mistral
 * ============================
 * Mistral SDK v2 wrapper. `wrapMistral(client, engine)` returns a
 * Proxy-wrapped Mistral client with the 5 contract sub-resources
 * (`chat`, `agents`, `fim`, `embeddings`, `classifiers`) guarded by
 * the validator pipeline. All other sub-resources pass through.
 *
 * **ESM-only.** Mistral SDK v2 is ESM-only; the connector inherits.
 * Consumers on CJS-only stacks should pin `@mistralai/mistralai@^1.x`
 * (older API surface) or migrate the consumer build to ESM. See
 * `README.md` for migration notes.
 *
 * Public surface:
 *   - `wrapMistral(client, engine, options?)` — factory returning a
 *     guarded Mistral client (shape #1).
 *   - `MistralGuardrailBlockedError` — error class for catching
 *     guardrail-driven blocks via `instanceof`.
 *
 * Types:
 *   - `WrapMistralOptions`
 *   - `WrappedMistralClient`
 *   - `MistralLike`
 *   - `MistralEngineLike`
 *   - `MistralGuardrailBlockedErrorShape`
 */
export {
  wrapMistral,
  MistralGuardrailBlockedError,
} from './wrap-mistral.js';
export type {
  MistralEngineLike,
  MistralGuardrailBlockedErrorShape,
  MistralLike,
  WrapMistralOptions,
  WrappedMistralClient,
} from './types.js';
