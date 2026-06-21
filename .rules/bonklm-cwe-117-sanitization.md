---
id: bonklm-cwe-117-sanitization
tier: tier-1-required
title: CWE-117 log sanitization — sanitizeLogString + sanitizeMeta canonical
applies_to: [all]
priority: 25
---
Every `logger.*` call, OTel `span.add*` call, synthetic `GuardrailResult.findings[].description`, HTTP response body, or other log-emit site must sanitize attacker-influenceable strings. This is defined in ADR-0001 (`docs/contributing/adr/0001-log-sanitization.md`).

**Canonical primitive:** `sanitizeLogString` from `packages/core/src/common/index.ts`.

**When to apply:**
- Does the template literal interpolate any string from user input (request body, file content, validator output, file path, validator-thrown `error.message`)? → Wrap with `sanitizeLogString` (or `sanitizeMeta` at connector boundaries).
- Does the meta object include any string-typed value with the same origin? → Wrap that field's value.
- Does the OTel span attribute carry such a string? → Wrap.
- Does a synthetic `GuardrailResult` finding `description` embed `String(error)` or any caught value? Prefer `sanitizeLogString(serializeError(error).message)` for consistency.
- Does a `logger.warn`/`logger.error` meta carry a raw `error` value? Use `{ error: serializeError(error) }` — bare `{ error }` renders as `error={}` post-JSON.stringify.

**`sanitizeLogString` coverage:**
- Hex-escapes `\x00–\x09`, `\x0B–\x1F`, `\x7F–\x9F` (DEL + C1 control range) to `\xNN` markers.
- Replaces `\r\n` / `\n` / `\r` / `U+2028` / `U+2029` with literal `\n` marker.
- Hex-escapes bidi-override (`U+202A–U+202E`) and bidi-isolate (`U+2066–U+2069`) code points.
- Hex-escapes zero-width / Unicode-format class (`U+061C`, `U+200B–U+200F`, `U+2060–U+2064`, `U+FEFF`) to preserve forensic signal.
- Caps output at 500 chars + appends `…[truncated]` marker.

**Do NOT use `stripLogControlChars`** (marked `@deprecated`; kept `@public` through v1.x for rc.1–rc.3 importers; v2.0 removes it). Internal callers migrated to `sanitizeLogString` ahead of v1.0.0-rc.4.

**Audit checklist:** When you add any log emit or re-touch a file for any reason, re-run the sink-pattern grep on the whole file, not just the touched region (Sprint 45 lesson).
