---
'@blackunicorn/bonklm': minor
---

feat(core): re-scan memory writes against their raw upstream source for laundered injection

`createMemoryWriteValidator` now re-scans the raw upstream body behind a write's
`metadata.provenance` chain — the original tool result the content derives from, looked up by
`rawBodyHash` from the `runWithRawUpstreamCache` scope — in addition to scanning the write's surface
content. This catches the laundering chain where an agent paraphrases a poisoned tool result into
benign prose before persisting it: the laundered surface text matches no content pattern, but the
raw body still does.

The re-scan is gated on tool-derived provenance, so genuine user writes are never re-scanned and the
calibrated user-text false-positive floor is unchanged. It fails closed — because the poison is not
textually present in the laundered content, redact mode cannot remove it and the write is blocked
rather than redacted-and-allowed. A missing `rawBodyHash`, a cache miss, or a lookup outside an ALS
scope degrades cleanly to a no-op (never a false block), so the consumer is safe to ship before any
connector populates the cache. Re-scan findings redact their `match` (the raw body may carry
secrets/PII the laundered content never exposed), and the scan is byte-bounded per body with a
per-chain fan-out cap.

New exports: `rescanLaunderedProvenance` + `ProvenanceRescanResult` (the re-scan consumer) and the
`isToolDerivedRef` per-ref predicate. Documented in ADR-0010.
