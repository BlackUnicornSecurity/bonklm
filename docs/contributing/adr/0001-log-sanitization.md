# ADR-0001: Log Sanitization (CWE-117) — Internal Contributor Guide

> Status: Living document — Sprint 50 (2026-05-25) (revised 2026-05-26 per Sprint 51 HB-3 + B.4)
> Scope: Internal contributor guide. Public consumers should never need this.
> Authority: Architect + security-reviewer convergent HIGH (Sprint 38 + Sprint 39).
> Latest revision: Sprint 50 — Decision #2 revised; the three legacy
> internal callers of `stripLogControlChars` migrated to the canonical
> `sanitizeLogString` ahead of v1.0.0-rc.4 cut.

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
  by accident. **Marked `@deprecated` in Sprint 39; the three internal
  callers migrated to `sanitizeLogString` in Sprint 50 (see Decision #2
  below). Removal of the `@public` surface target v2.0** — preserved
  through v1.x for any external consumer who imported it during the
  rc.1 → rc.3 window.

  **Residual risk closure (Sprint 50):** the SPACE-replacement
  forensic-loss risk flagged by security-reviewer MEDIUM (Sprint 39)
  is now closed on the three internal call sites. Post-Sprint-50,
  a TAB-injected log line surfaces as `\x09` in the rendered output
  — a SOC analyst can distinguish
  `"name": "legit payload"` from
  `"name": "malicious\x09phantom\x09column"` directly. New code
  MUST continue to prefer `sanitizeLogString`; the only remaining
  caller of `stripLogControlChars` is its own `@public` export
  surface (no internal call sites).
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

   **Canonical primitive's strip surface (post-Sprint-51):**
   - Hex-escapes `\x00–\x09`, `\x0B–\x1F`, `\x7F` to `\xNN` markers.
   - Replaces `\r\n` / `\n` / `\r` / `U+2028` (LINE SEPARATOR) /
     `U+2029` (PARAGRAPH SEPARATOR) with the literal `\n` marker.
     The U+2028 / U+2029 coverage closes Sprint 39 security-MEDIUM #4:
     V8's `JSON.stringify` renderer + several SIEM ingestors treat
     both as line terminators, but they live above 0x7F so the
     control-char regex misses them.
   - Hex-escapes bidi-override code points `U+202A–U+202E` and
     bidi-isolate code points `U+2066–U+2069` to `\uNNNN` markers.
     This closes Sprint 51 HB-3 / ST-05-003 (CWE-1007 visual-spoof):
     a `U+202E` RIGHT-TO-LEFT OVERRIDE in an attacker-controlled string
     can reverse subsequent characters in any Unicode-aware terminal or
     SIEM UI — making the rendered log line differ from the byte stream
     a parser reads. Hex-escaping makes the attack visible.
   - Caps output at 500 chars + appends `…[truncated]` marker.
2. **`stripLogControlChars` is `@public` + `@deprecated` through 1.x;
   internal callers migrated to `sanitizeLogString` in Sprint 50.**
   The three previous internal callers (`sanitizeLogMetadata`,
   `logValidationFailure`, `logTimeout`) all now use the canonical
   `sanitizeLogString`, restoring forensic signal across the
   connector-utils log surface. The `@public` deprecated export
   itself remains exported through v1.x so any external consumer
   who imported it during the rc.1 → rc.3 window does not face a
   breaking change mid-1.x; v2.0 removes the export (see Decision
   #4).

   **Revision rationale (Sprint 50):** the original D#2 preserved
   SPACE-replacement for SIEM back-compat through 1.x. The actual
   pre-publish state at rc.3 — zero downstream consumers, no SIEM
   rules in production keyed on BonkLM's output format — meant the
   "preserve format" guarantee had no users to protect. Sprint 50
   migrated ahead of v1.0.0-rc.4 cut so the very first published
   release ships with the preferred forensic-preserving behaviour.
   The behaviour change is documented under `CHANGELOG.md` →
   `[1.0.0-rc.4]` → "Behavior changes".

   ### Decision history
   - Sprint 51 (2026-05-26 / agent-J-sanitize-bidi): extended escape-set to bidi-override (U+202A..E) + bidi-isolates (U+2066..9). Closes HB-3 + B.4. Sister-sanitizer `sanitizeReasonText` aligned to TAB hex-escape.

3. **`sanitiseShell` stays inline in `bash-safety.ts`.** Not exported,
   not part of any contract. The local closure makes the use-case
   boundary explicit.
4. **Consolidation to a single primitive lands in v2.0**, alongside the
   `stripLogControlChars` removal. The unified primitive will accept a
   `mode` parameter (`'escape' | 'replace' | 'strip'`) covering all three
   behaviors.

## Audit checklist for new code

When you add a `logger.*` call, a `span.add*` call, **a synthetic
`GuardrailResult.findings[].description` field**, an HTTP response
body / error message returned to a caller, or any other emit:

- [ ] Does the template literal interpolate any string that originated
      from user input (request body, file content, validator output,
      file path, validator-thrown `error.message`)? → Wrap with
      `sanitizeLogString` (or `sanitizeMeta` at connector boundaries).
- [ ] Does the meta object include any string-typed value with the same
      origin? → Wrap that field's value with `sanitizeLogString` /
      `sanitizeMeta`.
- [ ] Does the OTel span attribute carry such a string? → Wrap.
- [ ] **Sprint 42 addition**: Does a synthetic `GuardrailResult`
      finding `description` embed `String(error)` or any other raw
      caught value? Synthetic findings flow into `EngineResult` and
      surface to consumer log surfaces — wrap the interpolation per
      ADR-0001. Prefer `sanitizeLogString(serializeError(error).message)`
      for consistency with sister log-meta sites.
- [ ] **Sprint 42 addition**: Does a `logger.warn`/`logger.error`
      meta carry a raw `error` value? Use `{ error: serializeError(error) }`
      per Sprint 33 canonical pattern — bare `{ error }` renders as
      `error={}` post-JSON.stringify because Error properties are
      non-enumerable.
- [ ] If you used `stripLogControlChars`: was it because the surrounding
      code already uses it (back-compat consistency)? If yes — document
      that. If no — switch to `sanitizeLogString`.
- [ ] If your tests assert log output: do they catch the case where
      someone removes the sanitize wrap? (i.e., the test must FAIL when
      the wrap is removed — otherwise it is a happy-path test, not a
      regression test). **Integration tests preferred over contract-lock
      tests** — Sprint 41/42 lesson: integration tests find what grep
      sweeps miss.
- [ ] **Sprint 42 addition**: enumeration of sink-pattern sites must
      span the ENTIRE codebase, not just `connector-utils/` or
      `connectors/`. Engine, validators, guards, telemetry, hooks, and
      service-layer code all qualify. Grep by interpolation shape
      (`\${`, `${String(`, `${name`), not by directory.
- [ ] **Sprint 45 addition**: when re-touching a file for any reason,
      re-run the sink-pattern grep on the WHOLE file, not just the
      touched region. Sprint 38 swept the otlp-export.ts addEvent loop
      but missed `options.validator` + `spanName` pre-loop sites in
      the SAME file; Sprint 45 audit caught them on the 5th sprint
      examining the file. Within-file orphan-site sweep is mandatory.
- [ ] **Sprint 45 addition**: telemetry boundary (`packages/core/src/
      telemetry/`) is a separate sink class. `OTel addEvent`,
      `setAttribute`, `setStatus`, and the `TelemetryEvent.collect()`
      path all qualify. Don't assume "telemetry = library-controlled"
      — caller-supplied fields (validator name, span name,
      extraAttributes, runId, operation, error.message) all reach
      this boundary.

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
- **Sprint 40** — connector-package sweep (7 connectors: openclaw,
  mcp, elizaos, nestjs, anthropic, langchain, plus express-middleware
  + nestjs.interceptor sister sites). 12 src wraps across 7 packages
  + 4 new test files. Audit-driven scope expansion from initial 4
  connectors to 7 after security audit surfaced 2 NEW HIGH findings
  + architect HIGH sister-site finding.
- **Sprint 41** — `sanitizeMeta` @public helper added at
  `packages/core/src/connector-utils/logger.ts` consolidating the
  `sanitizeLogString(String(x ?? ''))` combo. ~10 connector call
  sites retrofitted. Pre-commit `tsc --noEmit` hook installed via
  simple-git-hooks (architect HIGH-5 closure, 3 sprints overdue).
  Real integration test for elizaos `installSealedWrapMemory`
  surfaced 3 more unsanitized sites Sprint 40 missed (wrap-memory.ts
  lines 74, 125, 130/135) — fixed inline.
- **Sprint 42** — mcp + nestjs integration test upgrades
  (architect HIGH-2 closure). 14 CWE-117 wraps applied: 5 surfaced
  by integration tests (engine short-circuit reason, mcp dev-mode
  Error + filteredText, nestjs getErrorMessage + response-leg body)
  + 9 surfaced by 3-lane audit pass on those fixes (4 engine
  validator/guard catch descriptions, 1 nestjs service finding
  description, 4 interceptor extractor error metas). Confirms
  Sprint 38 lesson "enumerate by SINK PATTERN, not by FUNCTION
  NAME or directory" — engine sites were outside connector-utils
  enumeration scope across Sprints 38-41.
- **Sprint 43** — cross-connector orphan sweep (Sprint 42 architect
  LOW deferral). 14 connectors swept / 61 CWE-117 wraps applied:
  26 from initial scoping (weaviate/pinecone/openai/openai-agents/
  fastify-plugin/langchain) + 35 from 3-lane audit scope expansion
  (anthropic/chroma/qdrant/ollama/vercel/llamaindex/copilotkit/
  genkit/google-genai). NEW SURFACES: `path` (HTTP request URL)
  sanitization in fastify; `documentPreview` (RAG retrieved-doc
  content slice) in llamaindex; streamed JSON-chunk error fields
  in vercel; application-output `filteredContent` strings in
  openai/anthropic/ollama. Core hardening: `sanitizeMeta`
  fail-closes hostile-toString throws to `[unstringifiable]`
  marker (security MEDIUM #5 — denial-of-logging vector closure).
  Re-validated Sprint 41 lesson 4th time: integration/audit finds
  what grep misses, including across-connector orphans.
- **Sprint 44** — architect HIGH/MEDIUM/LOW closures from Sprint 43
  audit: nestjs path-sanitization parity with fastify (MEDIUM #7),
  fastify session-tracking sessionId at 2 sites (HIGH #6), langchain
  handler runId at 2 stream sites (LOW #9 + #10). Sprint 44 audit
  surfaced additional 6 fixes inline: `GuardrailResult.reason`
  raw forwarding to integrator `onError` callbacks (CR MUST-FIX #1
  + security MEDIUM #1), test-helper inline duplication (CR
  MUST-FIX #2), nestjs content-too-large path uniformity (architect
  MEDIUM #2), `extractRequestUrl` originalUrl preference for Express
  sub-routers (architect LOW #4). NEW LESSON: when a value appears
  in BOTH a log call AND a return struct, sanitize at the variable-
  binding site, not at each sink — `GuardrailResult.reason` field
  flows through integrator-controlled `onError` callbacks where
  log-only sanitization is insufficient.
- **Sprint 45** — Sprint 41 S41-2 LOW closure: `otlp-export.ts`
  retrofit of 4 sites from legacy `sanitizeLogString(String(x ??
  '<default>'))` combo to canonical `sanitizeMeta(x ?? '<default>')`.
  Sprint 44 integration test deferrals closed: real fastify session-
  tracking escalation + real langchain stream-buffer-exceeded.
  Audit pass surfaced HIGH × 2 + MEDIUM × 2 expansion: otlp-export
  `options.validator` span attribute (security HIGH #1) + `spanName`
  (security HIGH #2) + `extraAttributes` string values (MEDIUM #3)
  + `TelemetryService.ts` ConsoleTelemetryCollector runId/operation
  + recordValidationError error.name/message (MEDIUM #4). All
  fixed inline. NEW LESSON: telemetry subsystem is a third sink
  class outside the connector-utils + engine enumeration scopes
  established in earlier sprints. Contributor checklist now mandates
  cross-subsystem enumeration: engine + connector-utils + connectors
  + telemetry + hooks + service-layer.
- **Sprint 46** — hooks subsystem CWE-117 sweep. 10 wraps across 3
  files: `hooks/index.ts` (5 sites — caller-supplied `hook.name` +
  raw `error.message` in HookResult.message construction),
  `HookSandbox.ts` (3 sites — log + event + ExecutionResult.message),
  `EdgeHookManager.ts` (2 sites — log + EdgeExecutionResult.message).
  Audit-pass closure of CR SHOULD-FIX double-sanitize bug:
  `sanitizeMeta(serializeError(error).message)` collapsed to bare
  `serializeError(error).message` (serializeError already sanitizes
  internally via Sprint 33 implementation). NEW LESSON: don't
  double-wrap with sanitizers of the same class — audit the inner
  codec's body to confirm what it ALREADY does. `HookResult.message`
  is the 3rd instance of the "sanitize-at-construction-site" pattern
  (Sprint 42 getErrorMessage, Sprint 44 GuardrailResult.reason,
  Sprint 46 HookResult.message).
- **Sprint 47** — fault-tolerance + cli sweep. 5 wraps:
  `RetryPolicy.ts` × 2 (raw `lastError.message` → canonical
  `serializeError(...)` in non-retryable + retry-attempt warn logs),
  `cli/testing/display.ts` × 2 (connector-supplied `test.result.error`
  in console.log with ANSI color sequences — terminal-control
  hijacking vector), `cli/commands/wizard.ts` × 1
  (`testResult.result.error` in p.log.error). `CircuitBreaker.ts`
  verified safe (numeric stats only — no fix). NOTE: 3-lane audit
  hit session limit; commit landed with single-architect coverage
  attempted but no findings returned.
- **Sprint 48** — TelemetryService missed-sites + core-sweep
  closure. 3 wraps in `TelemetryService.ts` (collect / flush /
  shutdown catch blocks passed `{ error }` / `{ error: err }`
  raw — switched to canonical `serializeError`). Final
  workspace-wide grep verification produced ZERO remaining
  unwrapped `error` meta sites in core/src. NEW LESSON:
  `grep -rn "logger\.\(warn\|error\)" | grep -v sanitize | grep
  error` is the canonical post-sprint verification grep — run it
  BEFORE dispatching audit lanes. Cross-subsystem coverage now
  complete across engine + connector-utils + 14 connectors +
  telemetry + hooks + fault-tolerance + cli + edge + base +
  validation + adapters + security + validators + guards.
- **Sprint 49** — nestjs session-category parity (Sprint 44 INFO
  #5 closure). 2 wraps in `guardrails.service.ts`
  (checkSessionEscalation + updateSessionWithFindings — sanitize
  `result.reason` at the return-spread site since
  `SessionTracker.ts:321` embeds `finding.category` verbatim).
  Fastify already had this fix (Sprint 44); nestjs catches up.
  Variable-binding-site sanitization pattern now applied in 4
  places: getErrorMessage (Sprint 42) / GuardrailResult.reason
  (Sprint 44) / HookResult.message (Sprint 46) / nestjs
  session-escalation result (Sprint 49).
- **Sprint 50** — ADR-0001 Decision #2 revision + `bonklm doctor`
  pre-commit hook check. The three internal callers of the
  deprecated `stripLogControlChars` (`sanitizeLogMetadata`,
  `logValidationFailure`, `logTimeout`) migrated to the canonical
  `sanitizeLogString` ahead of v1.0.0-rc.4 cut — closes architect
  HIGH #5 (open since Sprint 43). Behaviour change: SPACE → hex-
  escape on these three sinks, restoring SOC forensic signal
  (TAB-injection now surfaces as `\x09` instead of collapsing to
  SPACE). Three new test cases lock the migration: hex-escape on
  TAB, hex-escape on CRLF in `logValidationFailure.reason`, and a
  truncation-marker canary asserting the 500-char `sanitizeLogString`
  cap is now in effect (was 256 under `stripLogControlChars`).
  `stripLogControlChars` itself stays `@public` + `@deprecated` for
  back-compat with any rc.1 → rc.3 importer; removal target
  unchanged at v2.0 per Decision #4. Independent ITEM 2:
  `bonklm doctor` command added (cli/commands/doctor.ts) with a
  pre-commit hook check verifying the simple-git-hooks postinstall
  landed (architect M-2 closure from Sprint 41).
- **Sprint 51** — HB-3 (ST-05-003) bidi-override escape extension +
  B.4 (ST-05-103) `sanitizeReasonText` TAB alignment. Nine bidi code
  points added to `sanitizeLogString` escape-set (U+202A..U+202E +
  U+2066..U+2069) — closes CWE-1007 visual-spoof attack surface.
  Output format: `\uNNNN` (4-digit Unicode hex-escape, consistent with
  existing U+2028/U+2029 treatment pattern). `sanitizeReasonText`
  updated to hex-escape C0 control chars before the printable-strip
  pass, bringing TAB output to `\x09` (was silently deleted) — aligns
  the sister sanitizer with ADR-0001 D#2 forensic-signal contract.
  12-payload regression corpus added under ST-05-003. Decision #2
  history entry + canonical surface table updated.

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
