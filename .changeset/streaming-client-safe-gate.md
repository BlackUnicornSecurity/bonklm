---
'@blackunicorn/bonklm': patch
'@blackunicorn/bonklm-google-genai': patch
'@blackunicorn/bonklm-vercel': patch
---

streaming: add opt-in validate-before-release for structured-chunk streams
(`streamReleaseMode: 'gated'`).

core adds a `ClientSafeStreamGate` helper (+ `ClientSafeStreamOptions`) that drives the
`StreamValidator.processForClient` / `finalizeForClient` lifecycle for connectors that forward
structured chunks (provider response objects, data-stream frames, SDK event objects): chunks are
held until the release gate clears their text, then the ORIGINAL chunks are forwarded in order — no
unvalidated output reaches the client and the wire protocol is preserved.

Wired opt-in into google-genai (`wrapGenerateContentStream`, `wrapChat`) and vercel
(`createGuardedAI` incremental mode, `bonkMiddleware`) via `streamReleaseMode: 'gated'` (default
`'trailing'` — existing streaming behaviour is unchanged). Tune the release point with
`minBufferBeforeRelease` (default `256`, or `Infinity`/full-response when a Secret or PII validator
is in the chain). Gated mode trades streaming latency for leak prevention; see known-limitations §9.
