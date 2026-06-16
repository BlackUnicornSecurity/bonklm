# ADR-0001: Log Sanitization (CWE-117) — Internal Contributor Guide

> Status: Living document. Scope: internal contributor guide — public consumers should never need
> this. The three internal callers of the deprecated `stripLogControlChars` migrated to the
> canonical `sanitizeLogString` ahead of the v1.0.0-rc.4 cut (see Decision #2).

## Problem

BonkLM's engine, validators, guards, telemetry exporters, and connector packages all emit structured
log entries. Many of those entries interpolate attacker-influenceable strings (matched pattern
content, file paths from upload pipelines, custom validator descriptions, OTel span attribute
values). Without sanitization at every emit-boundary, an attacker who controls the input string can
inject control characters (CR/LF/TAB/NUL) to:

- Forge log records in downstream aggregators (Splunk, Datadog, ELK, OTel collectors) — CWE-117.
- Pivot a TSV-format syslog ingestor's column parser by injecting a TAB (the most common form of
  "phantom column" attack).
- Drop forensic signal by sneaking a NUL byte past a C-string truncator in the downstream pipeline.

## Why three sanitizers exist

The library currently ships three control-char sanitization primitives. This is the product of
incremental hardening — each one was added when a specific gap surfaced, none was retroactively
consolidated.

| Function                    | Location                                            | Strip set                             | Replacement       | Cap                         | Newline handling                           |
| --------------------------- | --------------------------------------------------- | ------------------------------------- | ----------------- | --------------------------- | ------------------------------------------ |
| **`sanitizeLogString`**     | `packages/core/src/common/index.ts`                 | `0x00–0x09`, `0x0B–0x1F`, `0x7F–0x9F` | `\xNN` hex escape | 500 + `…[truncated]` marker | `\r\n` / `\n` / `\r` → literal `\n` marker |
| **`stripLogControlChars`**  | `packages/core/src/connector-utils/logger.ts`       | `0x00–0x1F`, `0x7F`                   | SPACE             | 256 (no marker)             | replaced with SPACE (subset of strip)      |
| **`sanitiseShell`** (local) | `packages/core/src/guards/bash-safety.ts` (closure) | `0x00–0x1F`, `0x7F`                   | empty (delete)    | none                        | deleted                                    |

### Why the differences are intentional (for now)

- `sanitizeLogString` is the **engine-canonical primitive**. Hex-escape preserves forensic signal —
  a SOC analyst can tell a TAB-injection attempt apart from a legitimate space-padded input. Use
  this everywhere unless you have a documented reason not to.
- `stripLogControlChars` was the original metadata-sanitizer used by `sanitizeLogMetadata`,
  `logValidationFailure`, `logTimeout`. Space replacement produces more human-readable log lines —
  the trade-off was reasonable when the function was internal to connector-utils. Once re-exported
  through `connector-utils/index.ts`, it became `@public` by accident. **Marked `@deprecated`; the
  three internal callers migrated to `sanitizeLogString` (see Decision #2 below). Removal of the
  `@public` surface targets v2.0** — preserved through v1.x for any external consumer who imported
  it during the rc.1 → rc.3 window.

  **Residual risk closure:** the SPACE-replacement forensic-loss risk on the three internal call
  sites is now closed. A TAB-injected log line surfaces as `\x09` in the rendered output — a SOC
  analyst can distinguish `"name": "legit payload"` from `"name": "malicious\x09phantom\x09column"`
  directly. New code MUST continue to prefer `sanitizeLogString`; the only remaining caller of
  `stripLogControlChars` is its own `@public` export surface (no internal call sites).

- `sanitiseShell` is a closure inside `bash-safety.ts:validate()`. It populates the `Finding.match`
  field of `GuardrailResult` — an **API-result** field, not a log field. Shell-command readability
  matters more there than forensic preservation; delete-mode is intentional. Not exported; not part
  of any contract.

## Decision

1. **`sanitizeLogString` is the canonical primitive for all new code.** Apply it at every
   emit-boundary that interpolates attacker-influenceable strings into either:
   - Template literals passed to `logger.{error,warn,info,debug}`.
   - String fields inside meta objects passed to a structured logger (RFC 8259 §7 permits literal
     TAB in JSON strings — TAB survives `JSON.stringify` and reaches the exporter wire format).
   - String values passed to OTel span attributes (`span.addEvent`, `span.setStatus`,
     `span.setAttribute`) — these are NOT JSON-serialized by the OTel SDK; they reach the exporter
     as-is.

   **Canonical primitive's strip surface:**
   - Hex-escapes `\x00–\x09`, `\x0B–\x1F`, `\x7F–\x9F` (DEL + the C1 control range, e.g. U+009B CSI
     / U+0085 NEL) to `\xNN` markers.
   - Replaces `\r\n` / `\n` / `\r` / `U+2028` (LINE SEPARATOR) / `U+2029` (PARAGRAPH SEPARATOR) with
     the literal `\n` marker. The U+2028 / U+2029 coverage closes a newline-injection gap: V8's
     `JSON.stringify` renderer + several SIEM ingestors treat both as line terminators, but they
     live above 0x7F so the control-char regex misses them.
   - Hex-escapes bidi-override code points `U+202A–U+202E` and bidi-isolate code points
     `U+2066–U+2069` to `\uNNNN` markers. This closes the CWE-1007 visual-spoof attack surface: a
     `U+202E` RIGHT-TO-LEFT OVERRIDE in an attacker-controlled string can reverse subsequent
     characters in any Unicode-aware terminal or SIEM UI — making the rendered log line differ from
     the byte stream a parser reads. Hex-escaping makes the attack visible.
   - Hex-escapes the zero-width / Unicode-format (Cf) class — `U+061C` (ALM), `U+200B`–`U+200F`
     (zero-width space/joiners + the LRM/RLM directional marks), `U+2060`–`U+2064` (word joiner +
     the invisible math operators), and `U+FEFF` (BOM) — to `\uNNNN` markers. These code points
     render as nothing yet survive in the byte stream, so an attacker can smuggle invisible content
     into a log line (homoglyph / zero-width spoof — e.g. `ad<ZWSP>min` rendering as `admin` while a
     naive `grep admin` misses the forged record) or wedge a Unicode-aware parser. They live above
     0x7F so the control-char regex misses them, and they are disjoint from the bidi
     override/isolate range above. Hex-escaping preserves forensic signal. NOTE: this is the LOG
     sink, which ESCAPES; the detection-layer text-normalizer STRIPS the same class before injection
     matching — a different sink with a different goal. This LOG set is intentionally NARROWER than
     the detection-layer strip set and deliberately omits the astral TAG block (`U+E0000`–`U+E007F`,
     the "ASCII smuggling" channel) plus assorted other Cf points (`U+00AD`, `U+180E`,
     `U+206A`–`U+206F`, `U+FFF9`–`U+FFFB`, …) — those need an astral-aware escape (the BMP `\uNNNN`
     formula mis-escapes surrogate pairs) and are tracked as a follow-up. NOTE also: this primitive
     sanitizes LOG output; do NOT route end-user-display text through it where `U+200C` / `U+200D`
     are orthographically load-bearing (Persian ZWNJ, Indic / emoji ZWJ) — escaping them there
     mangles legitimate non-Latin content; use a display-safe path instead.
   - Caps output at 500 chars + appends `…[truncated]` marker.

2. **`stripLogControlChars` is `@public` + `@deprecated` through 1.x; internal callers migrated to
   `sanitizeLogString`.** The three previous internal callers (`sanitizeLogMetadata`,
   `logValidationFailure`, `logTimeout`) all now use the canonical `sanitizeLogString`, restoring
   forensic signal across the connector-utils log surface. The `@public` deprecated export itself
   remains exported through v1.x so any external consumer who imported it during the rc.1 → rc.3
   window does not face a breaking change mid-1.x; v2.0 removes the export (see Decision #4).

   **Revision rationale:** the original D#2 preserved SPACE-replacement for SIEM back-compat through
   1.x. The actual pre-publish state at rc.3 — zero downstream consumers, no SIEM rules in
   production keyed on BonkLM's output format — meant the "preserve format" guarantee had no users
   to protect. The migration landed ahead of the v1.0.0-rc.4 cut so the very first published release
   ships with the preferred forensic-preserving behaviour. The behaviour change is documented under
   `CHANGELOG.md` → `[1.0.0-rc.4]` → "Behavior changes".

   ### Decision history
   - 2026-05-26: extended escape-set to bidi-override (U+202A..E) + bidi-isolates (U+2066..9).
     Sister-sanitizer `sanitizeReasonText` aligned to TAB hex-escape.
   - 2026-06-16: extended escape-set to the zero-width / Unicode-format class (U+061C, U+200B..F,
     U+2060..4, U+FEFF). Closes the invisible-content / homoglyph log-spoof gap in the canonical
     primitive; inherited by `sanitizeMeta` and every connector sink. Mutation-proven per the
     load-bearing regression corpus in `packages/core/tests/unit/common/index.test.ts`.

3. **`sanitiseShell` stays inline in `bash-safety.ts`.** Not exported, not part of any contract. The
   local closure makes the use-case boundary explicit.
4. **Consolidation to a single primitive lands in v2.0**, alongside the `stripLogControlChars`
   removal. The unified primitive will accept a `mode` parameter (`'escape' | 'replace' | 'strip'`)
   covering all three behaviors.

## Audit checklist for new code

When you add a `logger.*` call, a `span.add*` call, **a synthetic
`GuardrailResult.findings[].description` field**, an HTTP response body / error message returned to
a caller, or any other emit:

- [ ] Does the template literal interpolate any string that originated from user input (request
      body, file content, validator output, file path, validator-thrown `error.message`)? → Wrap
      with `sanitizeLogString` (or `sanitizeMeta` at connector boundaries).
- [ ] Does the meta object include any string-typed value with the same origin? → Wrap that field's
      value with `sanitizeLogString` / `sanitizeMeta`.
- [ ] Does the OTel span attribute carry such a string? → Wrap.
- [ ] Does a synthetic `GuardrailResult` finding `description` embed `String(error)` or any other
      raw caught value? Synthetic findings flow into `EngineResult` and surface to consumer log
      surfaces — wrap the interpolation per ADR-0001. Prefer
      `sanitizeLogString(serializeError(error).message)` for consistency with sister log-meta sites.
- [ ] Does a `logger.warn`/`logger.error` meta carry a raw `error` value? Use
      `{ error: serializeError(error) }` — bare `{ error }` renders as `error={}`
      post-JSON.stringify because Error properties are non-enumerable.
- [ ] If you used `stripLogControlChars`: was it because the surrounding code already uses it
      (back-compat consistency)? If yes — document that. If no — switch to `sanitizeLogString`.
- [ ] If your tests assert log output: do they catch the case where someone removes the sanitize
      wrap? (i.e., the test must FAIL when the wrap is removed — otherwise it is a happy-path test,
      not a regression test). **Integration tests are preferred over contract-lock tests** —
      integration tests find what grep sweeps miss.
- [ ] Enumeration of sink-pattern sites must span the ENTIRE codebase, not just `connector-utils/`
      or `connectors/`. Engine, validators, guards, telemetry, hooks, and service-layer code all
      qualify. Grep by interpolation shape (`\${`, `${String(`, `${name`), not by directory.
- [ ] When re-touching a file for any reason, re-run the sink-pattern grep on the WHOLE file, not
      just the touched region — a prior within-file sweep can leave pre-loop or orphan sites in the
      same file. Within-file orphan-site sweep is mandatory.
- [ ] The telemetry boundary (`packages/core/src/telemetry/`) is a separate sink class. OTel
      `addEvent`, `setAttribute`, `setStatus`, and the `TelemetryEvent.collect()` path all qualify.
      Don't assume "telemetry = library-controlled" — caller-supplied fields (validator name, span
      name, extraAttributes, runId, operation, error.message) all reach this boundary.

## Evolution

These sanitizers were introduced incrementally as emit-boundary gaps surfaced across the engine,
connector, telemetry, hooks, fault-tolerance, CLI, and edge layers, rather than designed up front.
The canonical `sanitizeLogString` / `sanitizeMeta` pair is now applied cross-subsystem; new code
MUST follow the checklist above. The canonical post-change verification grep is
`grep -rn "logger\.\(warn\|error\)" | grep -v sanitize | grep error` — run it before review. Consult
the changeset history for the per-release record.
