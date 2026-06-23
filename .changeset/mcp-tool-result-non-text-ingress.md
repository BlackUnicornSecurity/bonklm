---
'@blackunicorn/bonklm-mcp': minor
---

feat(mcp): scan non-text tool-result leaves for indirect injection

Extends the inbound tool-result indirect-injection scan beyond the text channel. The previous
increment scanned only top-level `text` items; a payload in a `resource.text`, a `resource.uri`, an
embedded structured-content string leaf, or a base64 blob was returned unscanned. `createGuardedMCP`
now extracts every scannable text leaf and scans three views — the newline-joined form, a
separator-free concatenation (closes a contiguous attack token split across two content items, e.g.
`AGENT_` + `FOOTER`), and each leaf independently (closes benign-padding / truncation-window
evasion).

Adds two opt-in options: `decodeBinaryContent` (default `false`) bounded-decodes base64 blocks
(`image` / `audio` `data`, `resource.blob`) to UTF-8 and scans them, and `maxDecodedBlobSize`
(default 64 KiB) bounds that decode. With decoding off, a result carrying only uninspectable binary
content is no longer silently passed — a telemetry `warn` is emitted (with CWE-117-sanitized
blob-kind metadata). Extraction is bounded (leaf-count / cumulative-byte / depth caps) and the
result-scan loop carries an aggregate wall-clock budget, both surfaced via telemetry when hit. A
`data` field is treated as binary only on image/audio blocks, so a payload cannot be hidden by
parking it in a field named `data`. Fail-closed semantics on validation error are unchanged and the
common single-text-item result is still scanned exactly once. Closes the non-text portion of the
documented known-limitation (known-limitations.md §30) and adds regression coverage for the attack
class.
