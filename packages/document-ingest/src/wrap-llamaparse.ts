/**
 * Story 3.7 — wrapLlamaParse (LlamaParse wrapper)
 * =================================================
 *
 * Wraps `@llamaindex/llama-cloud ^2.4.0` (the canonical successor to
 * `llama-cloud-services` which expired 2026-05-01 per the Story 3.7 AC).
 *
 * Proxies the `LlamaParseReader.loadData(filePath | filePaths[])`
 * surface. Validates the extracted text from EACH parsed document
 * before returning the array to the caller. BLOCK throws
 * `DocumentIngestBlockedError`; the LLM consumer never sees the
 * payload.
 *
 * Structural typing — peer-optional SDK install.
 */
import { validateExtractedText } from './validate-extracted-text.js';
import type { DocumentIngestWrapOptions } from './types.js';

/**
 * Subset of LlamaParseReader surface we proxy. Real type:
 * `@llamaindex/llama-cloud` `LlamaParseReader`.
 */
export interface LlamaParseReaderLike {
  loadData(
    fileOrFiles: string | string[]
  ): Promise<LlamaParseDocument[]>;
}

export interface LlamaParseDocument {
  /** Extracted text body. */
  text?: string;
  /** Optional doc id from the parser. */
  id_?: string;
  /** Page metadata, parser-specific. */
  metadata?: Record<string, unknown>;
}

const BONKLM_WIRED = Symbol.for('bonklm.llamaparse.wired');

/**
 * Wrap a LlamaParseReader instance. Returns a NEW object with the
 * proxied `loadData` method; the original reader is not mutated.
 *
 * Sprint 21 audit-pattern application (Sprint 20 BLOCK closure):
 * Symbol-keyed sentinel + clone (not mutate) + reject double-wrap.
 */
export function wrapLlamaParse<R extends LlamaParseReaderLike>(
  reader: R,
  options: DocumentIngestWrapOptions
): R {
  if (!reader || typeof reader !== 'object') {
    throw new TypeError('wrapLlamaParse: reader is required.');
  }
  if (!options?.engine) {
    throw new TypeError('wrapLlamaParse: options.engine is required.');
  }
  if ((reader as unknown as Record<symbol, unknown>)[BONKLM_WIRED]) {
    throw new Error(
      'wrapLlamaParse: reader already wrapped by bonklm-document-ingest. ' +
        'Wrapping twice would double-validate every document. ' +
        'Use a fresh LlamaParseReader instance per wrap or pass the ' +
        'wrapped reader directly.'
    );
  }

  const wrapped = {
    ...reader,
    async loadData(fileOrFiles: string | string[]): Promise<LlamaParseDocument[]> {
      const docs = await reader.loadData(fileOrFiles);
      for (const doc of docs) {
        const text = doc?.text;
        if (typeof text !== 'string' || text.length === 0) continue;
        await validateExtractedText(text, {
          ...options,
          phase: 'llamaparse',
          documentId: doc.id_,
        });
      }
      return docs;
    },
  } as unknown as R;

  Object.defineProperty(wrapped, BONKLM_WIRED, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return wrapped;
}
