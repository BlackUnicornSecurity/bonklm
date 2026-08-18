/**
 * tsd type-surface suite — @blackunicorn/bonklm-voltops-otel (ST-04-249).
 *
 * Locks the published public type surface (imports by package name so it
 * resolves the package `types` entry exactly as a consumer would):
 *   - `emitVoltOpsSpan<R>(result, options)` (generic — the `GuardrailResult`
 *     subtype `R` is returned unchanged; asserted with a marker-extended
 *     interface) + its `EmitVoltOpsSpanOptions` bag (`scanner` is the
 *     VoltOps-specific required field),
 *   - the re-exported core `bonklmTrace<R>` (whose option bag instead
 *     requires `validator`) + the six re-exported core trace types
 *     (`BonklmTraceSurface`, `BonklmTracer`, `BonklmSpan`,
 *     `BonklmSpanOptions`, `BonklmTraceAction`, `BonklmTraceOptions`).
 *
 * The R2-10 surface vocabulary is locked exactly (forbidden synonyms such
 * as `prompt` must be rejected). The generic `startActiveSpan` is locked
 * via call-site return-type threading rather than exact generic-signature
 * matching.
 *
 * Run via `pnpm exec tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailResult } from '@blackunicorn/bonklm';
import {
  emitVoltOpsSpan,
  bonklmTrace,
  type EmitVoltOpsSpanOptions,
  type BonklmTraceSurface,
  type BonklmTracer,
  type BonklmSpan,
  type BonklmSpanOptions,
  type BonklmTraceAction,
  type BonklmTraceOptions
} from '@blackunicorn/bonklm-voltops-otel';

interface MarkedResult extends GuardrailResult {
  marker: 'unique';
}
declare const markedResult: MarkedResult;
declare const tracer: BonklmTracer;

// --- emitVoltOpsSpan (generic — R returned unchanged; scanner required) -----
expectType<MarkedResult>(emitVoltOpsSpan(markedResult, { tracer, scanner: 's', surface: 'text_input' }));
expectError(emitVoltOpsSpan()); // result + options required
expectError(emitVoltOpsSpan(markedResult)); // options required
expectError(emitVoltOpsSpan(markedResult, { tracer, surface: 'text_input' })); // scanner required
expectError(emitVoltOpsSpan(markedResult, { tracer, scanner: 's' })); // surface required
expectError(emitVoltOpsSpan(markedResult, { scanner: 's', surface: 'text_input' })); // tracer required
expectError(emitVoltOpsSpan(markedResult, { tracer, scanner: 's', surface: 'nope' })); // bad surface

// --- EmitVoltOpsSpanOptions (tracer + scanner + surface required) -----------
expectAssignable<EmitVoltOpsSpanOptions>({ tracer, scanner: 's', surface: 'text_input' });
expectAssignable<EmitVoltOpsSpanOptions>({
  tracer,
  scanner: 's',
  surface: 'tool_call',
  spanName: 'custom',
  extraAttributes: { a: 1, b: 'x', c: true }
});
expectNotAssignable<EmitVoltOpsSpanOptions>({ scanner: 's', surface: 'text_input' }); // tracer required
expectNotAssignable<EmitVoltOpsSpanOptions>({ tracer, surface: 'text_input' }); // scanner required
expectNotAssignable<EmitVoltOpsSpanOptions>({ tracer, scanner: 's' }); // surface required
expectNotAssignable<EmitVoltOpsSpanOptions>({ tracer, scanner: 1, surface: 'text_input' }); // scanner is string

// --- bonklmTrace re-export (generic; core bag requires `validator`) ---------
expectType<MarkedResult>(bonklmTrace(markedResult, { tracer, validator: 'v', surface: 'text_input' }));
expectError(bonklmTrace()); // result + options required
expectError(bonklmTrace(markedResult)); // options required
expectError(bonklmTrace(markedResult, { tracer, surface: 'text_input' })); // validator required (core uses validator, not scanner)

// --- BonklmTraceSurface (R2-10 locked 7-member vocabulary) ------------------
expectAssignable<BonklmTraceSurface>('text_input');
expectAssignable<BonklmTraceSurface>('text_output');
expectAssignable<BonklmTraceSurface>('tool_call');
expectAssignable<BonklmTraceSurface>('retrieved_doc');
expectAssignable<BonklmTraceSurface>('memory_write');
expectAssignable<BonklmTraceSurface>('audio_partial');
expectAssignable<BonklmTraceSurface>('composed_context');
expectNotAssignable<BonklmTraceSurface>('prompt'); // forbidden R2-10 synonym
expectNotAssignable<BonklmTraceSurface>('output'); // forbidden R2-10 synonym
expectNotAssignable<BonklmTraceSurface>('');

// --- BonklmTraceAction ('allow' | 'block') ----------------------------------
expectAssignable<BonklmTraceAction>('allow');
expectAssignable<BonklmTraceAction>('block');
expectNotAssignable<BonklmTraceAction>('deny');

// --- BonklmTracer (startActiveSpan generic — locked via return threading) ---
expectType<number>(
  tracer.startActiveSpan('n', {}, span => {
    expectType<BonklmSpan>(span); // fn receives a BonklmSpan (locks the callback param, not just T)
    return 1;
  })
);
expectType<string>(tracer.startActiveSpan('n', { attributes: { a: 1 } }, () => 'x')); // T threads through
expectError(tracer.startActiveSpan('n')); // options + fn required
expectError(tracer.startActiveSpan('n', {})); // fn required
expectNotAssignable<BonklmTracer>({}); // startActiveSpan required

// --- BonklmSpanOptions (attributes optional, primitive values only) ---------
expectAssignable<BonklmSpanOptions>({});
expectAssignable<BonklmSpanOptions>({ attributes: { a: 1, b: 'x', c: true } });
expectNotAssignable<BonklmSpanOptions>({ attributes: { a: {} } }); // value must be string|number|boolean

// --- BonklmSpan (setAttribute + end required; addEvent/setStatus optional) --
declare const span: BonklmSpan;
expectType<(key: string, value: string | number | boolean) => void>(span.setAttribute);
expectType<() => void>(span.end);
expectNotAssignable<BonklmSpan>({}); // setAttribute + end required
expectNotAssignable<BonklmSpan>({ setAttribute: () => {} }); // end required

// --- BonklmTraceOptions (tracer + validator + surface required) -------------
expectAssignable<BonklmTraceOptions>({ tracer, validator: 'v', surface: 'text_input' });
expectAssignable<BonklmTraceOptions>({
  tracer,
  validator: 'v',
  surface: 'retrieved_doc',
  spanName: 'custom',
  extraAttributes: { a: 1 }
});
expectNotAssignable<BonklmTraceOptions>({ validator: 'v', surface: 'text_input' }); // tracer required
expectNotAssignable<BonklmTraceOptions>({ tracer, surface: 'text_input' }); // validator required
expectNotAssignable<BonklmTraceOptions>({ tracer, validator: 'v' }); // surface required
expectNotAssignable<BonklmTraceOptions>({ tracer, validator: 1, surface: 'text_input' }); // validator is string
