# Sprint 11 — Story 2.1b Implementer Checklist

> **Status**: Living document. Sprint 11 day 0 owner: the implementer.
> **Updated**: 2026-05-22 (initial scaffold at Story 2.1b-connector-style-ADR ship).

Per iteration-3 architect A&D-4 + iteration-4 senior-dev BLOCK-A, this checklist
extracts the ACs + cross-iteration amendments for Story 2.1b by sub-story so
a Sprint 11 implementer (potentially different from the planner) can execute
without missing any of the ~65 plan amendments threaded through the story.

This document is COMMITTED (not in gitignored `team/`) so fresh-clone implementers
can access it from `git checkout`.

---

## Sub-story 1 of 3: `2.1b-connector-style-ADR` (Sprint 11 day 1, ~0.5d)

**Status as of 2026-05-22**: SHIPPED at this commit (the file you are reading
references back to `docs/user/connector-style-guide.md` which was authored in
the same commit as this checklist).

**Definition of done**:
- [x] `docs/user/connector-style-guide.md` ships with 4 canonical sub-conventions.
- [x] Mem0 PRIMARY worked example uses real shipping API (`createMemoryWriteValidator` + `createComposedContextValidator`).
- [x] Zep illustrative footnote fenced with `ts-skip` + `<!-- skip-doc-tsc-validation -->`.
- [x] Epic-1 deviations table enumerates all 5 connectors with sunset cadence.
- [x] Documented-exceptions table enumerates in-place-mutation exceptions.
- [x] Cross-references to `tools/audit-baselines/sprint-11-story-2.1b-checklist.md` (this file) and `tools/WORKSPACE-POLICY.md` resolve.
- [x] 3-lane audit (architect + code-reviewer + adversarial) passes clean.

**Next stop**: user fires `2.1b-edge-core`.

---

## Sub-story 2 of 3: `2.1b-edge-core` (Sprint 11 first week, ~5d)

**Status as of 2026-05-22**: NOT STARTED — gated on user go-ahead.

**Pre-flight checklist**:
- [ ] Backup repo to `team/backups/` (timestamped).
- [ ] Read plan lines 537-560 (Story 2.1b-edge-core ACs) + threaded amendments.
- [ ] Read `team/lessonslearned.md` entries for `node:events` ESM hazard + `process.env` X2 hazard.

**ACs**:
- [ ] `EdgeHookManager` class in `packages/core/src/hooks/HookSandbox.ts` throws `ConnectorValidationError('configuration_error')` at engine construction if string-handler hooks registered.
- [ ] `HookManager` re-exported from `@blackunicorn/bonklm/edge` as alias to `EdgeHookManager`.
- [ ] `validateToken` async ships; sync becomes a `@deprecated` proxy that THROWS `TypeError` synchronously per R2-6.
- [ ] `process.env` reads in `production.ts` + `CircuitBreaker.ts` + `override-token.ts` + `elizaos-connector/src/wrap-memory.ts` + `elizaos-connector/src/tool-call-args-gate.ts` switched to `GuardrailEngineConfig.envBindings` injection.
- [ ] New `envBindings` shape on `GuardrailEngineConfig`: `{ NODE_ENV?, RAILS_ENV?, FLASK_ENV?, BONKLM_OVERRIDE_SECRET?, LLM_GUARDRAILS_OVERRIDE_SECRET?, BONKLM_SKIP_RUNTIME_PROBE? }`.
- [ ] EventEmitter replaced with ~30-line portable local emitter (no `node:events` import).
- [ ] `.github/workflows/ci-edge.yml` runs wrangler `dev --local` + Deno + Bun matrix.
- [ ] `wrangler.toml` template includes `compatibility_flags = ["nodejs_compat"]` + `compatibility_date = "2024-09-23"`.
- [ ] Inline guard at engine construction throws if `globalThis.AsyncLocalStorage === undefined`.
- [ ] ALS canary post-guard: `portableRandomUUID()` token + object-valued canary + reference-equality + per-field deep-equal (see plan ~lines 595-625).
- [ ] Canonical `wrangler.toml` fragment lives ONLY at `docs/user/migration/edge-string-handlers.md#cloudflare-workers-required-setup`; every Workerd-shipping story references by anchor.
- [ ] `pnpm test:edge` smoke tests against wrangler / deno / bun.

**Cut-line decision rubric (plan ~lines 645-670)**:
- [ ] edge-core green by Sprint 11 day 5 → PROCEED.
- [ ] green by day 7 → defer ElizaOS Phase-2 to Sprint 12.
- [ ] NOT green by day 10 → PARTIAL SHIP + re-block Tier-3.
- [ ] NOT green by Sprint 12 day 3 → ESCALATE.

---

## Sub-story 3 of 3: `2.1b-connectors` (Sprint 11 second week, ~5d)

**Status as of 2026-05-22**: NOT STARTED — gated on sub-story 2 completion + user go-ahead.

**Per-connector ACs**:
- [ ] **Vercel Phase-2**: full v5/v6 stream-event-type handling, `onInputAvailable`, tool-approval persistence, `wrapMCPClient`, `processForClient` migration.
- [ ] **LangChain Phase-2**: streaming-aware `wrapModelCall`, `processForClient` migration, OpenAIModerationMiddleware composition test.
- [ ] **OpenAI Agents Phase-2**: `wrapRealtime` per-delta `RealtimeOutputGuardrail`, composition test, 3-chain handoff regression.
- [ ] **ElizaOS Phase-2**: `updateMemory` hook sealed in same sync block as `createMemory` (race-resistance test); `bonklm doctor --runtime` ships; startup HTTP probe with probe-await semantics; `acknowledgeClass4Risk: true` escape hatch; Levenshtein typo-squat detection.

**Cross-cutting (CRITICAL — read plan lines ~560-700)**:
- [ ] AsyncLocalStorage migration for `runtime.bonklm.currentCallContext` (replaces WeakMap; uses `als.run(ctx, fn)`).
- [ ] Probe per-attempt `AbortController` 2000ms deadline.
- [ ] IPv6 fallback: `127.0.0.1` → `[::1]` sequential.
- [ ] Probe runs inside `als.run(undefined, () => doProbe())` to clear ambient context.
- [ ] `bonklmPlugin.init()` awaits probe to completion (fire-and-forget PROHIBITED).
- [ ] Probe-outcome 4-branch enumeration.
- [ ] Probe dedup: module-scope `Map<(IP,port), Promise>` with FIFO at 100 entries; multi-isolate Workerd caveat in `known-limitations.md`.
- [ ] `updateMemory` seal regression race-test (attacker plugin via `Promise.resolve().then()` cannot capture).
- [ ] HMAC `crypto.subtle.timingSafeEqual` on equal-length Uint8Arrays + zero-pad short input.
- [ ] `process.env` enumeration sweep + ESLint plugin scaffold (Tier B per `tools/WORKSPACE-POLICY.md`).
- [ ] `brokenAt` containment: log CRITICAL internally; never propagate to public surfaces.

**Regression test budget**:
- [ ] ≥50 new tests covering each enumerated AC line (≥5 per Tier-1 connector + ≥25 across edge-core + probe-outcome scenarios).

---

## Amendment history

| Date | Sub-story | Change |
|---|---|---|
| 2026-05-22 | 2.1b-connector-style-ADR | Initial scaffold. Sub-story 1 marked SHIPPED. Sub-stories 2-3 enumerated for future execution sessions. |
