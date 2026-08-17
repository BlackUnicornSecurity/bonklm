/**
 * tsd type-surface suite — @blackunicorn/bonklm-document-ingest (ST-04-241).
 *
 * Locks the published public type surface (imports by package name): the
 * three vendor wrappers (`wrapLlamaParse` / `wrapUnstructured` / `wrapReducto`,
 * each generic + client-preserving), the DIY `validateExtractedText` helper +
 * `MAX_EXTRACTED_TEXT_BYTES`, the `DocumentIngestBlockedError` class, and the
 * event / phase / options / result types. Run via `pnpm exec tsd`. Lives in
 * test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  wrapLlamaParse,
  wrapUnstructured,
  wrapReducto,
  validateExtractedText,
  MAX_EXTRACTED_TEXT_BYTES,
  DocumentIngestBlockedError,
  type LlamaParseReaderLike,
  type LlamaParseDocument,
  type UnstructuredClientLike,
  type UnstructuredPartitionResponse,
  type ReductoClientLike,
  type ReductoParseResponse,
  type ValidateExtractedTextOptions,
  type ValidateExtractedTextResult,
  type DocumentIngestBlockEvent,
  type DocumentIngestPhase,
  type DocumentIngestWrapOptions
} from '@blackunicorn/bonklm-document-ingest';

declare const engine: GuardrailEngine;

// --- wrapLlamaParse: generic, preserves the reader type ---------------------
declare const reader: LlamaParseReaderLike & { extra: number };
expectType<LlamaParseReaderLike & { extra: number }>(wrapLlamaParse(reader, { engine }));
expectError(wrapLlamaParse(reader, {})); // engine required
declare const r: LlamaParseReaderLike;
expectType<Promise<LlamaParseDocument[]>>(r.loadData('file.pdf'));
expectType<Promise<LlamaParseDocument[]>>(r.loadData(['a.pdf', 'b.pdf']));
expectAssignable<LlamaParseDocument>({});
expectAssignable<LlamaParseDocument>({ text: 't', id_: 'doc-1', metadata: {} });

// --- wrapUnstructured: generic, preserves the client type -------------------
declare const uclient: UnstructuredClientLike;
expectType<UnstructuredClientLike>(wrapUnstructured(uclient, { engine }));
expectError(wrapUnstructured(uclient, {})); // engine required
expectType<Promise<UnstructuredPartitionResponse>>(uclient.general.partition({}));
expectAssignable<UnstructuredPartitionResponse>({});
expectAssignable<UnstructuredPartitionResponse>({ elements: [{ text: 't', type: 'NarrativeText' }], statusCode: 200 });

// --- wrapReducto: generic, preserves the client type ------------------------
declare const rclient: ReductoClientLike;
expectType<ReductoClientLike>(wrapReducto(rclient, { engine }));
expectError(wrapReducto(rclient, {})); // engine required
expectType<Promise<ReductoParseResponse>>(rclient.parse({}));
expectAssignable<ReductoParseResponse>({});
expectAssignable<ReductoParseResponse>({ result: { chunks: [{ content: 'c' }] }, job_id: 'j', duration: 1 });

// --- validateExtractedText + MAX_EXTRACTED_TEXT_BYTES -----------------------
expectType<Promise<ValidateExtractedTextResult>>(validateExtractedText('extracted body', { engine }));
expectError(validateExtractedText('extracted body', {})); // engine required
expectError(validateExtractedText(123, { engine })); // text must be a string
expectType<1000000>(MAX_EXTRACTED_TEXT_BYTES); // `const = 1_000_000` keeps the literal type

// --- DocumentIngestPhase union ----------------------------------------------
expectAssignable<DocumentIngestPhase>('llamaparse');
expectAssignable<DocumentIngestPhase>('validate_extracted_text');
expectNotAssignable<DocumentIngestPhase>('docx');

// --- DocumentIngestWrapOptions ----------------------------------------------
expectAssignable<DocumentIngestWrapOptions>({ engine });
expectAssignable<DocumentIngestWrapOptions>({
  engine,
  onBlock: _event => {},
  onError: _err => {},
  shouldValidate: (_text, _docId) => true
});
expectNotAssignable<DocumentIngestWrapOptions>({}); // engine required

// --- ValidateExtractedTextOptions (extends WrapOptions) + onOversize union ---
expectAssignable<ValidateExtractedTextOptions>({ engine });
expectAssignable<ValidateExtractedTextOptions>({
  engine,
  phase: 'reducto',
  documentId: 'd',
  returnInsteadOfThrow: true,
  maxBytes: 2_000_000,
  onOversize: 'block'
});
expectNotAssignable<ValidateExtractedTextOptions>({ engine, onOversize: 'nuke' }); // 'truncate' | 'block' | 'allow'

// --- ValidateExtractedTextResult shape --------------------------------------
expectAssignable<ValidateExtractedTextResult>({ blocked: false });
expectAssignable<ValidateExtractedTextResult>({
  blocked: true,
  reason: 'r',
  category: 'c',
  severity: 'critical',
  excerpt: 'x',
  skipped: false,
  oversized: true
});
expectNotAssignable<ValidateExtractedTextResult>({}); // blocked required

// --- DocumentIngestBlockEvent shape (kind discriminator + phase union) ------
expectAssignable<DocumentIngestBlockEvent>({ kind: 'document', phase: 'reducto', reason: 'r' });
expectNotAssignable<DocumentIngestBlockEvent>({ kind: 'web-middleware', phase: 'reducto', reason: 'r' }); // kind is 'document'
expectNotAssignable<DocumentIngestBlockEvent>({ kind: 'document', phase: 'pdfjs', reason: 'r' }); // phase union
expectNotAssignable<DocumentIngestBlockEvent>({ kind: 'document', phase: 'reducto' }); // reason required

// --- DocumentIngestBlockedError class ---------------------------------------
const err = new DocumentIngestBlockedError('blocked', 'llamaparse', {
  documentId: 'd',
  category: 'c',
  severity: 'high'
});
expectType<DocumentIngestBlockedError>(err);
expectType<'DocumentIngestBlockedError'>(err.name);
expectType<DocumentIngestPhase>(err.phase);
expectType<string | undefined>(err.documentId);
expectType<string | undefined>(err.category);
expectType<string | undefined>(err.severity);
expectError(new DocumentIngestBlockedError('blocked')); // phase required
expectError(new DocumentIngestBlockedError('blocked', 'badphase')); // phase must be a DocumentIngestPhase
