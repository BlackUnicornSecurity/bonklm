# @blackunicorn/bonklm-document-ingest

Document-ingest wrappers for BonkLM (Story 3.7). Validates extracted document text BEFORE downstream
consumers (vector DBs, LLM context windows) ingest it — last-line defence against document-borne
prompt injection (OWASP LLM-01).

## Wrappers

- `wrapLlamaParse(reader, opts)` — `@llamaindex/llama-cloud ^2.4.0` (canonical successor to
  `llama-cloud-services` which expired 2026-05-01).
- `wrapUnstructured(client, opts)` — `unstructured-client ^0.31.0`.
- `wrapReducto(client, opts)` — `reductoai ^0.15.0` (BONUS per AC).
- `validateExtractedText(text, opts)` — for DIY parsers (pdf.js, mammoth, jsdom, etc.).

All four feed the extracted text through `engine.validate(text)`. On BLOCK, throw
`DocumentIngestBlockedError` (the LLM never sees the payload). Optional `returnInsteadOfThrow: true`
on `validateExtractedText`.

## Top-level warning

> **First-line defence only.** The validators run regex pattern matching; they cannot decode
> payloads embedded in images (steganography), in encoded blobs the vendor stripped during
> extraction, or in vendor-side fragmentation that hides individual tokens. Combine with
> sandbox-isolated LLM execution + retrieval- source allowlisting for full coverage.

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-document-ingest
# Plus whichever vendor SDKs you use (all OPTIONAL peer deps):
pnpm add @llamaindex/llama-cloud unstructured-client reductoai
```

## Quick start — LlamaParse

```ts
import { LlamaParseReader } from '@llamaindex/llama-cloud';
import { wrapLlamaParse, DocumentIngestBlockedError } from '@blackunicorn/bonklm-document-ingest';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator()],
  shortCircuit: true
});

const reader = wrapLlamaParse(new LlamaParseReader(), {
  engine,
  onBlock: event => {
    console.warn(`[bonklm-document-ingest] BLOCKED doc ${event.documentId}: ${event.reason}`);
  }
});

try {
  const docs = await reader.loadData('contract.pdf');
  // docs[*].text is GUARANTEED to have passed validation
  for (const doc of docs) await vectorDb.upsert(doc);
} catch (err) {
  if (err instanceof DocumentIngestBlockedError) {
    // doc was malicious — already logged via onBlock
  } else {
    throw err;
  }
}
```

## DIY parser (validateExtractedText)

```ts
import { getDocument } from 'pdfjs-dist';
import { validateExtractedText } from '@blackunicorn/bonklm-document-ingest';

const pdf = await getDocument({ url: 'file.pdf' }).promise;
const text = await extractAllText(pdf);

await validateExtractedText(text, {
  engine,
  documentId: 'file.pdf',
  onBlock: event => console.warn('blocked:', event.reason)
});

// Safe to ingest.
await vectorDb.upsert({ id: 'file.pdf', text });
```

## Sprint 21 audit-pattern compliance

All three wrappers apply the Sprint 20 cumulative-hardenings:

- **Symbol-keyed double-wrap rejection.** Wrapping the same reader / client twice throws explicitly
  so an operator misconfig can't double- validate every document silently.
- **Returns a NEW object — does NOT mutate the caller's SDK instance.** Matches the immutability
  rule + avoids contaminating the caller's reference.
- **Fail-safe telemetry routing.** A throwing `onBlock` does not disable the BLOCK enforcement;
  errors route through `onError`.

## Known gaps (out-of-scope this sprint)

- Vendor-side fragmentation: an injection split across two Unstructured `elements` is caught via
  joined-text validation, but if the vendor strips boundaries between elements differently the
  joined form may differ from the LLM-consumer view.
- Reducto's `result.chunks[].embed` + `enriched` fields are NOT validated; only `content`.
  Embeddings are vendor-side text → they cannot carry injection that the LLM consumer hasn't already
  seen via `content`.
- LlamaParse `metadata` (page numbers, bounding boxes) is not validated.

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn
