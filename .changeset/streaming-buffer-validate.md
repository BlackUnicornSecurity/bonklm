---
'@blackunicorn/bonklm-openai': patch
'@blackunicorn/bonklm-anthropic': patch
'@blackunicorn/bonklm-ollama': patch
---

openai, anthropic, ollama: implement `streamingMode: 'buffer'` (previously a warn-and-fall-back
no-op).

Buffer mode now performs real buffered full-stream validation with hold-back-and-release semantics:
every chunk is held back, the full response is validated once at stream completion, and the buffered
chunks are released unchanged only if validation passes. On a violation the content is withheld
entirely and a single filtered marker chunk is emitted (and `onStreamBlocked` fires) — zero
pre-validation leakage and one validation pass instead of one per interval, traded against
progressive delivery. Matches the vercel connector's existing buffer semantics. The `'incremental'`
default is unchanged, and both modes still enforce `maxStreamBufferSize` (SEC-003).
