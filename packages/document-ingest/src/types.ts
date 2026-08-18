/**
 * Document Ingest Hooks shared types
 * ================================================
 *
 * LlamaParse + Unstructured + Reducto wrap their respective SDK
 * surfaces; all three feed extracted text through the
 * `GuardrailEngine` before downstream consumers (vector DB writes,
 * LLM context windows) ingest it.
 *
 * Threat model: a malicious PDF / DOCX / HTML carries an LLM-targeted
 * injection payload inside the document body. The vendor parses the
 * document into text + structured blocks. BonkLM validates the
 * extracted text BEFORE it reaches the LLM context — last line of
 * defence against document-borne prompt injection (OWASP LLM-01).
 *
 * **First-line defence ONLY.** The validators run regex pattern
 * matching; they cannot decode embedded LLM-targeted payloads inside
 * images (steganography) or inside encoded blobs that the vendor
 * happened to strip during extraction. Document this in the README.
 */
import type { GuardrailEngine } from '@blackunicorn/bonklm';

export type DocumentIngestPhase = 'llamaparse' | 'unstructured' | 'reducto' | 'validate_extracted_text';

/**
 * Document-ingest block event. Sprint 21 hardening (architect C1):
 * carries `kind: 'document'` so it is structurally a
 * `BonklmDocumentBlockEvent` and operators get cross-connector
 * pivoting on `kind` without per-connector mappers.
 */
export interface DocumentIngestBlockEvent {
  kind: 'document';
  phase: DocumentIngestPhase;
  reason: string;
  documentId?: string;
  category?: string;
  severity?: string;
  /** First 200 chars of the extracted text that triggered the block. */
  excerpt?: string;
}

export interface DocumentIngestWrapOptions {
  engine: GuardrailEngine;
  /** Fires on BLOCK before throw. */
  onBlock?: (event: DocumentIngestBlockEvent) => void;
  /** Error sink for handler exceptions. */
  onError?: (err: unknown) => void;
  /**
   * Pre-validation hook. Receives the extracted text BEFORE the
   * validator stack runs. Return `false` to skip validation for this
   * document (e.g. operator-trusted source).
   */
  shouldValidate?: (text: string, documentId?: string) => boolean;
}

export class DocumentIngestBlockedError extends Error {
  override readonly name = 'DocumentIngestBlockedError';
  readonly phase: DocumentIngestPhase;
  readonly documentId?: string;
  readonly category?: string;
  readonly severity?: string;

  constructor(
    message: string,
    phase: DocumentIngestPhase,
    extra?: { documentId?: string; category?: string; severity?: string }
  ) {
    super(message);
    this.phase = phase;
    this.documentId = extra?.documentId;
    this.category = extra?.category;
    this.severity = extra?.severity;
  }
}
