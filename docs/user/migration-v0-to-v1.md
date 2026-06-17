# BonkLM v0.x → v1.0 Migration Guide

Last updated: 2026-06-10 (v1.0.0-rc.4)

> **rc.3 and rc.4 introduced no additional breaking changes.** All migration steps below apply to
> the full v1.0 line. v0.7 consumers upgrading directly to v1.0.0-rc.4 need to address only the
> sections marked as applicable to their current version.

This guide walks you through the breaking changes between BonkLM 0.x (0.4 → 0.7) and the v1.0
release line. **Most v0.7 consumers will need ZERO code changes.** The cumulative breaking surface
is intentionally small — v0.5 → 0.7 already shipped the deprecation removals; v1.0 is a stability
commitment, not a rewrite.

If you are on:

| You are on | Read sections                                                                           | Code changes likely?                |
| ---------- | --------------------------------------------------------------------------------------- | ----------------------------------- |
| **v0.7.x** | §1 (Vercel alias), §3 (`@public` policy)                                                | None likely                         |
| **v0.6.x** | §1, §3, plus §4 (validator string-arg removed in 0.5)                                   | Possible (string args)              |
| **v0.5.x** | All sections                                                                            | Possible (string args)              |
| **v0.4.x** | All sections + see `docs/user/migration/edge-string-handlers.md` for the 0.4 transition | Likely (string args, edge handlers) |

---

## §1 — `messagesToTextLegacy` removed (`@blackunicorn/bonklm-vercel`)

**Released: v1.0.0-rc.1, Sprint 26**

The legacy alias in `@blackunicorn/bonklm-vercel` was reserved for a Vercel AI SDK v3/v4 type drop
(`CoreMessage` → `ModelMessage`) that never landed. It was always identical to `messagesToText`.

```diff
- import { messagesToTextLegacy } from '@blackunicorn/bonklm-vercel';
+ import { messagesToText } from '@blackunicorn/bonklm-vercel';
```

Behavior is identical. No other call-site changes required.

---

## §2 — `BonklmBlockEvent` unified discriminated union

**Released: v0.6.0, Sprint 21**

If you wrote custom telemetry sinks that consumed individual per-connector block events (e.g.
`BonklmVoiceBlockEvent`, `BonklmSandboxBlockEvent`), the recommended shape is now the **unified
discriminated union** with a `kind` field:

```ts
import type { BonklmBlockEvent } from '@blackunicorn/bonklm';

function onBlock(event: BonklmBlockEvent) {
  switch (event.kind) {
    case 'voice': // BonklmVoiceBlockEvent
    case 'sandbox': // BonklmSandboxBlockEvent
    case 'inference': // BonklmInferenceBlockEvent
    case 'durable-exec': // BonklmDurableExecBlockEvent
    case 'document': // BonklmDocumentBlockEvent
    case 'cf-agent': // BonklmCfAgentBlockEvent
    case 'web-middleware': // BonklmWebMiddlewareBlockEvent
    // narrow per-kind, then send to your SIEM
  }
}
```

The per-kind interfaces are still individually exported and remain backward-compatible. If you
previously used `event.payload`, `event.surface`, etc. on a specific narrowed type, nothing changes
— the union is additive.

**Security note**: `isBonklmBlockEvent()` is a TypeScript narrowing convenience, NOT a security
trust boundary. Treat `event.payload` / `event.excerpt` as untrusted (cap size, redact PII, escape
before logging).

---

## §3 — Public-API freeze (`@public` vs `@internal`)

**Released: v1.0.0-rc.1, Sprint 26**

`@blackunicorn/bonklm` now follows a strict **public-API contract**:

- **PUBLIC** (frozen until v2.0): every symbol re-exported from the root barrel
  `@blackunicorn/bonklm` and from the published connector barrels. Removal / breaking-change
  requires a major version bump. Adding **OPTIONAL** properties is additive (minor bump).

- **INTERNAL** (may change in any minor / patch):
  - Symbols prefixed with `_` (e.g. `_resetFailOpenWarnState`, `_defaultCodeValidator`).
  - Symbols NOT re-exported from a published barrel (deep imports into `dist/*` subpaths).
  - Internal utilities like `RegexCache`, raw `pattern-engine.ts` arrays, `validateBytes`,
    `analyze*` family on individual validators.

**Action required**: audit your imports.

```diff
- // INTERNAL — may break:
- import { RegexCache } from '@blackunicorn/bonklm/dist/common/regex-cache.js';
- import { _defaultCodeValidator } from '@blackunicorn/bonklm/dist/validators/code-injection.js';
+ // PUBLIC — frozen:
+ import { CodeInjectionValidator } from '@blackunicorn/bonklm';
```

If you have a use case that requires an `@internal` symbol, file a GitHub issue describing the use
case — we'll evaluate promoting it to `@public` in a minor release. **Do not depend on `@internal`
symbols in production code.**

See `docs/user/public-api-surface.md` for the full catalog.

---

## §3a — `OptionalRule` rejects explicit `null` (rc.2)

**Released: v1.0.0-rc.2, Sprint 29**

`OptionalRule` (`@blackunicorn/bonklm` → `validation/`) previously short-circuited on BOTH
`undefined` AND `null`. After Sprint 29 it only short-circuits on `undefined`; explicit `null` flows
into the inner rule for type-check.

**Why this changed**: the prior null-short-circuit was a footgun. Passing `{ logger: null }` would
pass schema validation, then crash at `this.logger.debug(...)` at runtime because the destructuring
default `logger = DEFAULT_LOGGER` ONLY fires for `undefined` (not `null`). The new behaviour rejects
the bad config at schema-load time with a clear error message.

```diff
- // pre-rc.2 — passed schema, crashed at runtime:
- const middleware = createGuardrailsMiddleware({
-   validators: [new PromptInjectionValidator()],
-   logger: null,  // ← silent footgun
- });

+ // rc.2+ — either omit the key OR pass undefined:
+ const middleware = createGuardrailsMiddleware({
+   validators: [new PromptInjectionValidator()],
+   // logger omitted — destructure default applies (DEFAULT_LOGGER)
+ });
```

Affects every connector that uses `Validators.optional(...)` for an object-shape field (logger,
attackLogger, sessionIdExtractor, etc.). External middleware wrappers (NestJS DI providers, factory
functions that snapshot config) that relied on `null` as a "disable" sentinel must migrate to either
omitting the key or passing `undefined`.

---

## §3b — `Validators.timeout` rejects `0` (rc.2)

**Released: v1.0.0-rc.2, Sprint 31 cumulative audit closure**

`Validators.timeout` (`@blackunicorn/bonklm` → `validation/`) previously accepted `0` ms as a valid
timeout. After Sprint 31 it rejects `0` to align with `validateWithTimeoutSecure`, which throws
`TypeError` on `timeoutMs <= 0`.

**Why this changed**: an operator passing `validationTimeout: 0` (e.g. `parseInt('')` from a broken
env-var) would pass schema validation, then crash the worker on EVERY request with an uncaught
TypeError. The schema is now the FIRST defense-in-depth layer — 0 is rejected at config-load time
with a clear error.

```diff
- validationTimeout: 0   // pre-rc.2: passed schema, ran the engine
- // with a 0ms budget (next-tick timeout = always blocked)
+ validationTimeout: 1   // rc.2+: minimum is 1ms (max 3,600,000 = 1h)
```

If you genuinely want to disable the timeout, set `validationTimeout: 3_600_000` (the 1-hour max) —
there is no "disable" sentinel for SEC-008. Sub-ms granularity is enforced because race-with-timeout
requires a positive integer.

---

## §3c — `Validators.positiveNumber(0)` honours the `0` floor (rc.2)

**Released: v1.0.0-rc.2, Sprint 31 cumulative audit closure**

`Validators.positiveNumber(0)` previously had a `min === 0 ? undefined : min` short-circuit that
silently turned the rule into an UNBOUNDED rule (accepting negative numbers). After Sprint 31 the
`min` argument is always honoured.

```diff
- // pre-rc.2 — Validators.positiveNumber(0) accepted -1024 silently:
- maxContentLength: Validators.optional(Validators.positiveNumber(0))
- // then config { maxContentLength: -1024 } passed schema validation

+ // rc.2+ — Validators.positiveNumber(0) means "≥ 0" strictly.
+ // Negative values are rejected.
```

If you have a connector schema with `Validators.positiveNumber(0)`, your runtime behaviour is
unchanged for valid inputs but invalid (negative) inputs are now rejected at schema-load time.

---

## §4 — Validator `validate(string)` legacy overload removed

**Released: v0.5.0** (already a year stale by v1.0 — included here for completeness)

Pre-0.4 validators accepted a bare string:

```ts
// REMOVED in v0.5 — throws in v1.0.
validator.validate('user input');
```

Replace with a `ValidatorInput` discriminated union:

```ts
// CURRENT — v0.4+:
validator.validate({ kind: 'text', content: 'user input' });
```

The `ValidatorInput` `kind` values accepted by `validate()` are: `text`, `tool_call`,
`retrieved_docs`, `memory_write`, `composed_context`, `audio_partial`. Distinct from these `kind`s
is the **R2-10 telemetry / hook _surface_ vocabulary** (the `surface` field on hooks and OTel spans;
frozen at v1.0):

- `text_input` — user-supplied input (chat message, form field)
- `text_output` — model-generated output (pre-stream chunk)
- `tool_call` — function/tool call arguments
- `retrieved_doc` — RAG / retrieval-augmented chunk
- `memory_write` — agent memory write
- `audio_partial` — streaming audio transcript fragment
- `composed_context` — concatenated multi-source context

Connector authors building custom shims: use `adaptValidatorToUniversalInput(input)` from
`@blackunicorn/bonklm` — replaces the try-catch-TypeError shim that several connectors duplicated
through 0.5.

---

## §5 — New connector packages (informational, non-breaking)

15 new connector packages shipped across Sprints 16-23 (v0.5.0 → v0.6.0). These are additive —
existing consumers see no change. New packages:

- `@blackunicorn/bonklm-livekit` — LiveKit Agents
- `@blackunicorn/bonklm-voice-webhooks` — Vapi + Retell HMAC webhooks
- `@blackunicorn/bonklm-sandbox-utils` — E2B + Daytona shared primitives
- `@blackunicorn/bonklm-e2b` — E2B `wrapSandbox`
- `@blackunicorn/bonklm-daytona` — Daytona `wrapSandbox`
- `@blackunicorn/bonklm-inference-providers` — Groq + Cerebras + Together
- `@blackunicorn/bonklm-restate` — Restate ObjectContext
- `@blackunicorn/bonklm-temporal` — Temporal activity middleware
- `@blackunicorn/bonklm-document-ingest` — LlamaParse + Unstructured + Reducto
- `@blackunicorn/bonklm-cloudflare-agents` — CF Agents (DO-backed)
- `@blackunicorn/bonklm-web-middleware-utils` — Elysia + Next.js shared
- `@blackunicorn/bonklm-elysia` — Elysia plugin
- `@blackunicorn/bonklm-nextjs` — Next.js App Router edge middleware
- `@blackunicorn/bonklm-voltagent` — VoltAgent agents
- `@blackunicorn/bonklm-voltops-otel` — VoltOps OTLP

See `docs/user/package-matrix.md` for the full package catalog with NODE / EDGE / ISO bundle tags.

---

## §6 — HMAC contract pinned (v1.0-RC)

**Released: v0.6.0 → frozen at v1.0**

The `bonklm-server` row-replay HMAC contract is now part of the public freeze:

- HMAC-SHA256 with **32-byte minimum** secret length (256-bit).
- Regex `^[a-f0-9]{64}$` (exactly 64 lowercase hex chars).
- `crypto.timingSafeEqual` comparison (no early-exit string compare).
- 5-minute **one-sided** replay window (`now - 5min ≤ ts ≤ now + 60s` for clock-skew tolerance —
  past tolerance is the replay window, future tolerance is bounded clock skew only).
- Per-row verification happens **inside** the body parser **before** `JSON.parse` to preserve the
  route-enumeration-oracle closure (Story 2.13 sec S4).

Migration: if you bypassed any of the above (custom HMAC, non-timing-safe compare, no replay
window), update before v1.0.

---

## §7 — Workerd compat date pin

**Released: v0.6.0 → re-audit every release prep**

Cloudflare Workers / Pages consumers: `compatibility_date` pinned at **`2024-09-23`** in the
`cloudflare-agents-connector` reference config. We re-audit this pin every release prep (Story 3.13
ritual) to avoid the late-2024 `nodejs_compat` semantic drift.

If you fork the reference config, keep the pin until you have explicitly verified your Worker
against a newer compat date.

---

## §8 — Sandbox attack corpus graduated

**Released: v0.7.0, Sprint 24**

The Story 4.5 R2-13 sandbox-attack-corpus graduation gate **PASSED** at 100% recall / 0%
false-positive / 100% precision. The corpus is hash-pinned at commit `4f8ea3f`:

```
sha256: e3661e5c808ac604d894e6ead5dcc27960143f45927928d64ebfe64629b5302b
```

`CodeInjectionValidator` + `PathTraversalValidator` are the sandbox canonical first-line defence.
The corpus + `run-graduation-gate.mjs` evaluator live at
`packages/core/benchmarks/sandbox-attack-corpus/`.

If you ship custom sandbox detection that ships with bonklm, run the gate before each release to
catch regressions.

---

## §9 — Multilingual Pass 2 retired

**Released: v0.6.0, Sprint 23**

Multilingual prompt-injection Pass 2 (next 10 languages: Bengali, Urdu, Vietnamese, Thai, Tamil,
Telugu, Marathi, Punjabi, Gujarati, Persian) was retired after 5 sprints of stall against limited
maintainer capacity + no native-reviewer pipeline. The current shipping corpus covers 10 languages
with native-reviewer-validated patterns.

Multilingual Pass 2 is **deferred to v0.7+ Story 4.2 CONDITIONAL** — will reopen only when a
native-reviewer pipeline materialises.

If you depend on detection in a language outside the shipping 10, either:

1. Add your patterns via the `MultilingualDetector` config
   (`additionalPatterns: { [langCode]: RegExp[] }`); or
2. Open a GitHub issue with native-speaker corpus contribution (we'll merge with attribution).

See `docs/user/known-limitations.md` §25.

---

## §10 — `_*`-prefix internal naming

**Released: v0.7.0 → enforced at v1.0-RC1**

We now prefix all `@internal` exports with a leading underscore. If you imported one of these, you
are reaching INTO unstable surface:

```
_resetFailOpenWarnState         (sandbox-utils, voice-webhooks)
_defaultCodeValidator           (sandbox-utils)
```

The leading underscore is the canonical marker. If you see a symbol without `_` and it is also NOT
in the published barrel, it's still internal — but the underscore is the explicit signal.

---

## §11 — Telemetry: `bonklmTrace()` caller-provides-tracer

**Released: v0.6.0, Sprint 23**

If you wired any OTel-style telemetry into a custom validator path, note that `bonklmTrace()`
follows a strict **caller-provides-tracer** contract:

```ts
import { bonklmTrace } from '@blackunicorn/bonklm';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('my-app');

const r = bonklmTrace(await validator.validate(input), {
  tracer,
  validator: 'prompt-injection',
  surface: 'text_input' // R2-10 locked vocabulary
});
```

Bonklm will **never** instantiate its own SDK / exporter / processor. This is part of the v1.0
freeze and is non-negotiable — it lets you choose vendor (Langfuse / Arize / Phoenix / VoltOps /
Datadog / OTLP collector) without bonklm pinning a version.

See `docs/user/otel-vendor-recipes.md` for per-vendor wiring recipes.

---

## §12 — Engine entry-point semantics (informational)

**Mostly unchanged in v1.0** — listed for clarity because operators ask. The one behavioural change:
`validateInput` now runs guards (previously it skipped them).

- `engine.validate(input)` runs validators **AND** guards.
- `engine.validateInput(input)` also runs validators **AND** guards — v1.0 unifies guard execution
  across both entry points; guards inspect a canonical text surface derived from the structured
  input (see `docs/user/known-limitations.md` §10 for the `tool_call` args JSON-encode residual).
- `engine.notifyCachedResult(result)` is **telemetry-only**, never a validation entry point.
- `createUnsaltedKeyFn(...)` is **explicit opt-in** — never default-routed when a cache is provided.
  Per-engine salt (`createSaltedKeyFn(engine.getInstanceId())`) prevents cross-instance cache
  poisoning.

---

## §13 — Wrap-once defence pattern (connector authors)

**Released: v0.7.0, Sprint 22**

If you are building a custom connector that wraps a client:

```ts
import {
  assertNotWrapped,
  markWrapped,
  ensureWrappedOnce // combo helper
} from '@blackunicorn/bonklm/core/connector-utils';

const SENTINEL = Symbol.for('myconnector.wired');

export function wrapClient<C>(client: C, opts: MyOpts): C {
  return ensureWrappedOnce({ ...client /* wrapped methods */ }, SENTINEL, 'wrapClient');
}
```

The wrap-sentinel descriptor (non-enumerable, non-writable, non-configurable) is part of the v1.0
freeze. Don't roll your own symbol marker — use these helpers.

---

## Reading list

- `docs/user/public-api-surface.md` — full PUBLIC vs INTERNAL catalog
- `docs/user/package-matrix.md` — package matrix with bundle tags
- `docs/user/known-limitations.md` — accepted limitations
- `docs/user/otel-vendor-recipes.md` — telemetry wiring
- `docs/user/connector-style-guide.md` — for connector authors

## Filing bugs

If you hit a v1.0 break that isn't covered above, please file an issue with:

- BonkLM version (`@blackunicorn/bonklm@X`)
- Connector packages + versions
- The import path that broke
- A minimal repro

We treat any breakage of a `@public` symbol after v1.0.0 as a major bug — please tag the issue
`breaking-change`.
