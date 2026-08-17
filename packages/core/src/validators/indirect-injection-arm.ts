/**
 * Indirect-Injection Arm Composer
 * ===================================================
 * A single home for the "append the provenance-gated
 * {@link IndirectInjectionValidator} onto a caller-supplied validator chain"
 * operation. Before this helper the append was copy-pasted as a bare
 * `[...validators, new IndirectInjectionValidator({ surface: <X> })]` literal
 * across the four composite factories (`createToolCallArgsValidator`,
 * `createRetrievedDocValidator`, `createComposedContextValidator`,
 * `createMemoryWriteValidator`) and — as the connector rollout lands — would
 * have been re-pasted into each connector's inbound tool-result path. Five-plus
 * copies of one ordering + surface-tag decision drift the moment one is touched.
 *
 * Two invariants live here, ONCE:
 *  1. **Ordering** — the arm is APPENDED, never prepended. The caller's own
 *     validators run (and short-circuit on the first BLOCK via
 *     `runValidatorChain`) before the indirect arm. The arm only ever ADDS
 *     connector-boundary task-hijack / exfil coverage that no user-text bar
 *     carries; it must not pre-empt a caller validator's verdict.
 *  2. **Surface tag** — the {@link ProvenanceBoundary} that gates which pattern
 *     arms fire. For a bare-string scan (the composition path) the surface is
 *     supplied here; an object-kind `ValidatorInput` derives its surface from
 *     `kind` inside the validator regardless (see {@link IndirectInjectionValidator}).
 *
 * @package @blackunicorn/bonklm/core
 */
import type { Validator } from '../engine/GuardrailEngine.types.js';
import type { ProvenanceBoundary } from './provenance.js';
import { IndirectInjectionValidator } from './indirect-injection.js';

/**
 * Append the provenance-gated indirect-injection arm for a connector surface
 * onto a caller-supplied validator chain.
 *
 * The returned array is a NEW array (the input is never mutated) with the
 * caller's validators first, in their original order, followed by a single
 * {@link IndirectInjectionValidator} bound to `surface`.
 *
 * @param validators - The caller's validator chain. May be empty; the returned
 *   chain then carries only the indirect arm.
 * @param surface - The connector {@link ProvenanceBoundary} the appended arm
 *   gates (`tool_result`, `retrieved_doc`, `composed_context`, `memory_write`).
 * @returns A new validator chain with the indirect arm appended last.
 *
 * @example
 * ```ts
 * const chain = appendIndirectInjectionArm(userValidators, 'tool_result');
 * const engine = new GuardrailEngine({ validators: chain });
 * ```
 */
export function appendIndirectInjectionArm(validators: readonly Validator[], surface: ProvenanceBoundary): Validator[] {
  return [...validators, new IndirectInjectionValidator({ surface })];
}

/**
 * Convenience wrapper around {@link appendIndirectInjectionArm} for the
 * `tool_result` surface — the boundary every inbound tool-result / action-result
 * connector path shares. Connectors wiring the default-on inbound scan call this
 * so the `'tool_result'` literal lives in exactly one place fleet-wide.
 *
 * @param validators - The caller's validator chain.
 * @returns A new validator chain with the `tool_result` indirect arm appended last.
 */
export function appendToolResultInjectionArm(validators: readonly Validator[]): Validator[] {
  return appendIndirectInjectionArm(validators, 'tool_result');
}
