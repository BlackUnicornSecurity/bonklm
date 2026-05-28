/**
 * `@blackunicorn/bonklm-document-ingest` — Document Ingest Hooks
 * for BonkLM (Story 3.7).
 *
 * Three vendor wrappers + one DIY helper:
 *
 *   - `wrapLlamaParse(reader, opts)` — `@llamaindex/llama-cloud ^2.4.0`
 *   - `wrapUnstructured(client, opts)` — `unstructured-client ^0.31.0`
 *   - `wrapReducto(client, opts)` — `reductoai ^0.15.0` (BONUS per AC)
 *   - `validateExtractedText(text, opts)` — for DIY parsers
 *     (pdf.js / mammoth / jsdom / etc.)
 *
 * All four pass the extracted document text through the
 * `GuardrailEngine` BEFORE downstream consumers (vector DB writes,
 * LLM context windows) see it. Last line of defence against
 * document-borne prompt injection (OWASP LLM-01).
 *
 * **First-line defence ONLY.** Validators run regex pattern matching;
 * they cannot decode payloads embedded in images, encoded blobs the
 * vendor stripped during extraction, or steganographic carriers.
 */
export { wrapLlamaParse } from './wrap-llamaparse.js';
export type { LlamaParseReaderLike, LlamaParseDocument } from './wrap-llamaparse.js';
export { wrapUnstructured } from './wrap-unstructured.js';
export type { UnstructuredClientLike, UnstructuredPartitionResponse } from './wrap-unstructured.js';
export { wrapReducto } from './wrap-reducto.js';
export type { ReductoClientLike, ReductoParseResponse } from './wrap-reducto.js';
export {
  validateExtractedText,
  MAX_EXTRACTED_TEXT_BYTES,
  type ValidateExtractedTextOptions,
  type ValidateExtractedTextResult
} from './validate-extracted-text.js';
export {
  DocumentIngestBlockedError,
  type DocumentIngestBlockEvent,
  type DocumentIngestPhase,
  type DocumentIngestWrapOptions
} from './types.js';
