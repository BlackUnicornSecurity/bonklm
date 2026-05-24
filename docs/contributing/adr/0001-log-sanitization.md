# ADR-0001: Log Sanitization (CWE-117) — Internal Contributor Guide

> Status: Living document — Sprint 39 (2026-05-24)
> Scope: Internal contributor guide. Public consumers should never need this.
> Authority: Architect + security-reviewer convergent HIGH (Sprint 38 + Sprint 39).

## Problem

BonkLM's engine, validators, guards, telemetry exporters, and 22 connector
packages all emit structured log entries. Many of those entries interpolate
attacker-influenceable strings (matched pattern content, file paths from
upload pipelines, custom validator descriptions, OTel span attribute values).
Without sanitization at every emit-boundary, an attacker who controls the
input string can inject control characters (CR/LF/TAB/NUL) to:

- Forge log records in downstream aggregators (Splunk, Datadog, ELK, OTel
  collectors) — CWE-117.
- Pivot a TSV-format syslog ingestor's column parser by injecting a TAB
  (the most common form of "phantom column" attack).
- Drop forensic signal by sneaking a NUL byte past a C-string truncator in
  the downstream pipeline.

## Why three sanitizers exist

The library currently ships three control-char sanitization primitives.
This is the product of incremental hardening — each one was added when a
specific gap surfaced, none was retroactively consolidated.

| Function | Location | Strip set | Replacement | Cap | Newline handling |
| --- | --- | --- | --- | --- | --- |
| **`sanitizeLogString`** | `packages/core/src/common/index.ts` | `0x00–0x09`, `0x0B–0x1F`, `0x7F` | `\xNN` hex escape | 500 + `…[truncated]` marker | `\r\n` / `\n` / `\r` → literal `\n` marker |
| **`stripLogControlChars`** | `packages/core/src/connector-utils/logger.ts` | `0x00–0x1F`, `0x7F` | SPACE | 256 (no marker) | replaced with SPACE (subset of strip) |
| **`sanitiseShell`** (local) | `packages/core/src/guards/bash-safety.ts` (closure) | `0x00–0x1F`, `0x7F` | empty (delete) | none | deleted |

### Why the differences are intentional (for now)

- `sanitizeLogString` is the **engine-canonical primitive**. Hex-escape
  preserves forensic signal — a SOC analyst can tell a TAB-injection
  attempt apart from a legitimate space-padded input. Use this everywhere
  unless you have a documented reason not to.
- `stripLogControlChars` was the original metadata-sanitizer used by
  `sanitizeLogMetadata`, `logValidationFailure`, `logTimeout`. Space
  replacement produces more human-readable log lines — the trade-off was
  reasonable when the function was internal to connector-utils. Once
  re-exported through `connector-utils/index.ts`, it became `@public`
  by accident. **Marked `@deprecated` in Sprint 39; removal target v2.0.**

  **Residual risk (security-reviewer MEDIUM, Sprint 39):** SPACE
  replacement destroys the attacker's forensic fingerprint. After
  sanitization a TAB-injected log line is visually indistinguishable
  from a legitimately space-padded one — a SOC analyst cannot tell
  `"name": "legit payload"` apart from
  `"name": "malicious\x09phantom\x09column"` once both render with
  spaces. The hex-escape form in `sanitizeLogString` preserves this
  signal. This is an accepted residual risk for the three legacy
  call sites; new code MUST NOT introduce additional ones.
- `sanitiseShell` is a closure inside `bash-safety.ts:validate()`. It
  populates the `Finding.match` field of `GuardrailResult` — an
  **API-result** field, not a log field. Shell-command readability
  matters more there than forensic preservation; delete-mode is intentional.
  Not exported; not part of any contract.

## Decision

1. **`sanitizeLogString` is the canonical primitive for all new code.**
   Apply it at every emit-boundary that interpolates attacker-influenceable
   strings into either:
   - Template literals passed to `logger.{error,warn,info,debug}`.
   - String fields inside meta objects passed to a structured logger
     (RFC 8259 §7 permits literal TAB in JSON strings — TAB survives
     `JSON.stringify` and reaches the exporter wire format).
   - String values passed to OTel span attributes (`span.addEvent`,
     `span.setStatus`, `span.setAttribute`) — these are NOT JSON-serialized
     by the OTel SDK; they reach the exporter as-is.

   **Canonical primitive's strip surface (post-Sprint-39):**
   - Hex-escapes `\x00–\x09`, `\x0B–\x1F`, `\x7F` to `\xNN` markers.
   - Replaces `\r\n` / `\n` / `\r` / `U+2028` (LINE SEPARATOR) /
     `U+2029` (PARAGRAPH SEPARATOR) with the literal `\n` marker.
     The U+2028 / U+2029 coverage closes Sprint 39 security-MEDIUM #4:
     V8's `JSON.stringify` renderer + several SIEM ingestors treat
     both as line terminators, but they live above 0x7F so the
     control-char regex misses them.
   - Caps output at 500 chars + appends `…[truncated]` marker.
2. **`stripLogControlChars` stays for back-compat through 1.x.** Marked
   `@deprecated`. The three existing callers (`sanitizeLogMetadata`,
   `logValidationFailure`, `logTimeout`) keep their current
   space-replacement behavior to avoid breaking downstream SIEM rules
   keyed on the existing format.
3. **`sanitiseShell` stays inline in `bash-safety.ts`.** Not exported,
   not part of any contract. The local closure makes the use-case
   boundary explicit.
4. **Consolidation to a single primitive lands in v2.0**, alongside the
   `stripLogControlChars` removal. The unified primitive will accept a
   `mode` parameter (`'escape' | 'replace' | 'strip'`) covering all three
   behaviors.

## Audit checklist for new code

When you add a `logger.*` call, a `span.add*` call, or any other
log/telemetry emit:

- [ ] Does the template literal interpolate any string that originated
      from user input (request body, file content, validator output,
      file path)? → Wrap with `sanitizeLogString`.
- [ ] Does the meta object include any string-typed value with the same
      origin? → Wrap that field's value with `sanitizeLogString`.
- [ ] Does the OTel span attribute carry such a string? → Wrap.
- [ ] If you used `stripLogControlChars`: was it because the surrounding
      code already uses it (back-compat consistency)? If yes — document
      that. If no — switch to `sanitizeLogString`.
- [ ] If your tests assert log output: do they catch the case where
      someone removes the sanitize wrap? (i.e., the test must FAIL when
      the wrap is removed — otherwise it is a happy-path test, not a
      regression test).

## Sprint history

- **Sprint 31** — extracted `sanitizeLogString` (then anonymous, inline
  in `timeout-wrapper.ts`).
- **Sprint 33** — promoted to `@public` in `common/index.ts`; wired
  into engine catch sites + timeout-wrapper.
- **Sprint 37** — sanitizeLogString TAB strip extension; serializeError
  `raw` + `name` sanitization; bash-safety.ts:560 wrap.
- **Sprint 38** — connector-utils logTimeout `operation` wrap;
  reformulation-detector two wraps; otlp-export 4-field wrap
  (security-HIGH inline closure).
- **Sprint 39 (this ADR)** — `stripLogControlChars` `@deprecated`
  tag + explicit `@public`; secret.ts:159+295 filePath meta wrap;
  test-file layout standardization; U+2028 / U+2029 added to
  `sanitizeLogString` newline-replacement pass (security-MEDIUM #4
  closure); this document.

## Known gaps deferred to Sprint 40

- **Connector-package CWE-117 sweep** (security-HIGH Sprint 39 #3,
  Sprint 40 blocker): `packages/mcp-connector/src/guarded-mcp.ts`
  logs `toolName` via `logValidationFailure`, which routes through
  the SPACE-replacement `stripLogControlChars` — works for forensic
  parsers that care only about column boundaries, but loses the
  attack fingerprint. `packages/openclaw-adapter/src/middleware.ts`
  is worse: logs `toolName` / `sessionId` / `messageId` / `channel`
  with no sanitization wrapper at all (`channel` is attacker-
  controlled via the incoming OpenClaw message context). Sprint 40
  must sweep all 22 connector packages for the same class of
  meta-field exposures.
- **Parallel `tests/validators/` + `tests/unit/validators/` dirs**
  (architect MEDIUM Sprint 39 #4): 14 + 6 files split across two
  parallel locations. Sprint 40 must consolidate.
- **Pre-commit `tsc --noEmit` enforcement** (architect HIGH Sprint 39
  #5, process-level): the `git mv` import-breakage lesson has now
  surfaced twice (2026-05-20 + Sprint 39). Documentation alone is a
  memorial, not a control. Sprint 40 should add a pre-commit hook
  or fail-fast CI step.
- **`secret.ts` `secret_type` future-field guard** (security MEDIUM
  Sprint 39 #1): current warn-log meta has no detection-derived
  string fields, but any future addition (e.g. user-extended secret
  pattern catalog) MUST sanitize at the meta boundary. Documented
  inline in secret.ts and here.
