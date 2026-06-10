# BonkLM Changelog

All notable changes to BonkLM (`@blackunicorn/bonklm`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Sprint 52 Day 2 — Gate 2 unblocking + Gate 5.8 reproducibility:

### Changed

- **`check-version-pin.sh` moved to the tracked `scripts/` directory so the pre-commit hook works in every checkout.** The version-pin check previously lived under the gitignored `team/` tree, so the `simple-git-hooks` pre-commit hook failed with "No such file or directory" in fresh clones and in any `git worktree` — the exact environments the worktree-per-PR workflow relies on. The script now lives at the tracked `scripts/check-version-pin.sh` (beside `quality-gate.sh`), and the hook invokes that tracked path. Contributor-tooling only — no runtime or library change.
- **Pre-publish surface guard added (`scripts/verify-publish-surface.mjs`).** After `pnpm -r build`, the guard imports the built `packages/core/dist/index.js` and asserts a canary set of canonical public exports (including `createRateLimiter` / `CommonRateLimiters`) is present, exiting non-zero otherwise. Wired into the `publish` job of `.github/workflows/publish.yml` (after build, before `changeset publish`) and exposed as the root `verify:surface` script for the rc-cut RUNBOOK. Contributor / release-tooling only — no runtime or library change.

### Removed

- **Removed the unused, non-functional internal helper `_testOnlyClearSentinel`** (`@blackunicorn/bonklm/core/connector-utils`). The `@internal`, `_`-prefixed test-only helper had no call sites and could not work as documented: `markWrapped` places its marker with a deliberately non-configurable descriptor (so it cannot be cleared before re-wrapping), and a non-configurable property cannot be redefined regardless of the new descriptor. No `@public` API is affected — per the v1.0-RC1 API-surface policy, `_`-prefixed symbols are internal and may change in any minor/patch. The non-configurability of `markWrapped`'s marker is now covered by a direct regression test.

### Fixed

- **eslint-plugin-edge `prepublishOnly` chain failure resolved.** Added local `tools/eslint-plugin-bonklm-edge/vitest.config.ts` mirroring the connector-package convention so tests resolve from the plugin directory instead of inheriting the workspace-root include patterns. Contributor tooling now runs its local test suite and dry-run publish path from a fresh checkout.

### Security

- **Tarball reproducibility verified at v1.0.0-rc.4.** Two consecutive `npm pack` passes produced byte-identical SHA-256 hashes across the release-surface tarballs. Reproducibility evidence is retained privately under the project QA policy.

(Sprint 51 Day 1 closure landed in 1.0.0-rc.4 below.)

## [1.0.0-rc.4] — 2026-05-26 (Sprint 51 Day 1 cut)

Post-rc.3 hardening pass continued across Sprints 42–50, plus Sprint 51
Day 1 (BR-QAF v1.0 release-QA cycle):
- Wave 1: 4 internal-review code-review fixes (DoS guard, secret-pattern
  boundary tests, doctor cwd validation, doctor checks + JSON sanitization)
- Wave 2: HookSandbox native-code regression tests + RateLimiter doctor
  advisory (architect-recommended approach) + 5 connector README rate-limiting
  sections + core re-export
- Coordinator: pre-commit version-pin hook + peer audit + files whitelist
  standardization (9 packages)
- 16 stories retro-confirmed against pre-execution commit chain (engines,
  exports, LICENSE, README, CHANGELOG dedupe, openclaw private, bin shebang,
  4 internal-review hard blocks closed + 5 code-review findings closed)

Test baseline:
- Entry rc.3 baseline (HEAD 83bf7ac): 5014 / 5030 pass, 16 pending, 0 fail
- rc.4 baseline (this RC): captured in private release evidence

### Added

- Per-package README finalized for 11 connectors (cloudflare-agents, hono, voltops-otel, letta, zep, voltagent, elysia, mem0, memory-utils, nextjs, web-middleware-utils). All draft information markers resolved with authoritative source-derived answers or explicit v1.0.x backlog deferrals (CHM:cloudflare validateUserInput export, hono validatedStream helper, zep thread.* tenant-derived ID enforcement).
- **`bonklm doctor` command** (Sprint 50 — closes architect M-2 from
  Sprint 41). Diagnoses the local contributor environment with a
  pre-commit hook check verifying the simple-git-hooks postinstall
  step landed. Reads `.git/config` directly (honours
  `core.hooksPath` override) so the command stays runnable without
  `git` on PATH. Reports PASS / WARN / FAIL with a concrete
  remediation hint on non-PASS outcomes; `--json` flag for machine
  output. Exit code `1` on FAIL. Future sprints can extend
  `runDoctor` with additional checks without changing the public
  command surface. Re-exported `runDoctor`, `checkPreCommitHook`,
  `resolveHooksPath`, `readConfiguredPreCommit`, `doctorCommand`,
  `DoctorReport`, `DoctorCheckResult` from
  `packages/core/src/cli/commands/index.ts` for programmatic use.

### Changed

- `exports` map added to 8 connectors (chroma, huggingface, llamaindex, pinecone, qdrant, vercel, weaviate, wizard); strict-TS consumer resolves under `bundler`/`node16`/`nodenext`. CJS dist confirmed at runtime — uses `require`+`default`+`types` conditions.
- LICENSE file added to 25 previously-missing publishable packages (MIT, root-copied).
- LICENSE refreshed on 2 stale per-package copies (anthropic-connector, vercel-connector) from `(c) 2025 Black Unicorn` to root `(c) 2026 Black Unicorn <info@blackunicorn.tech>`. All 52 publishable now byte-identical.
- Engines floor normalized to Node 20.4 across 24 packages (was 20.0).
- `@opentelemetry/api ^1.9.0` declared as optional `peerDependency` of `@blackunicorn/bonklm-voltops-otel` (consumer brings via tracer SDK; pin reflects structural-typing compatibility).
- CHANGELOG duplicate `## [Unreleased]` heading at line 978 collapsed; 70 bullets relocated to `## [0.5.0]` section (correct destination — they were v0.5.0 in-flight, not v1.0.0). Single `## [Unreleased]` heading remains.
- `engines.node` floor on `@blackunicorn/bonklm-voltops-otel` corrected from `>=20.0.0` to `>=20.4.0` (auto-aligned via sweep).
- Cloudflare-agents `bonklm-agent.ts` JSDoc corrected to remove reference to non-existent `validateUserInput` helper; recommends `engine.validate(text)` directly. Source surface now aligned with README.

### Behavior changes

- **`stripLogControlChars` internal callers migrated to
  `sanitizeLogString`** (Sprint 50 — ADR-0001 Decision #2 revision;
  closes architect HIGH #5 open since Sprint 43). The three
  `connector-utils/logger.ts` sinks that previously used
  `stripLogControlChars` (`sanitizeLogMetadata`,
  `logValidationFailure`, `logTimeout`) now use the canonical
  `sanitizeLogString` from `common/index.ts`. **Observable change in
  log output:** control characters (TAB / CR / LF / NUL / DEL /
  U+2028 / U+2029) now render as hex-escape (`\x09`, literal `\n`
  marker) rather than collapsing to SPACE. The truncation cap moves
  from 256 chars (no marker) to 500 chars (`…[truncated]` marker).
  Restores SOC forensic signal — a TAB-injection attack is now
  visible in the rendered log line instead of indistinguishable
  from legitimate space-padded input. **Pre-publish window:** zero
  downstream consumers depended on the legacy SPACE form, so the
  migration lands ahead of the v1.0.0-rc.4 cut. The
  `stripLogControlChars` function itself remains `@public` +
  `@deprecated` for back-compat with any rc.1 → rc.3 importer;
  removal target unchanged at v2.0 per ADR-0001 Decision #4.

### Removed

- `openclaw-adapter` dropped from the v1.0.0 publish set; original deprecated removal date 2026-07-01 retained. Marked `"private": true` in `packages/openclaw-adapter/package.json`; `pnpm publish -r --dry-run` no longer lists `@blackunicorn/bonklm-openclaw`. `docs/openclaw-integration.md` deprecation banner retained for rc.x consumers. `docs/user/package-matrix.md` + `docs/user/public-api-surface.md` updated in-place to mark as REMOVED v1.0.0. Migrate to native framework middleware (Express, Fastify, NestJS, Hono, Elysia, Next.js).

### Security

- **override-token replay-cache starvation patched** FIFO eviction allowed nonce-replay via cache flood; replaced with TTL-based eviction + fail-closed on active-entry capacity overflow. Regression test simulates flood of unexpired tokens exhausting cache (fail-closed throw) and post-expiry flood (replay rejected as expired).
- **sanitizeLogString hex-escapes bidi-override (U+202A..E) + bidi-isolates (U+2066..9)** CWE-1007 visual-spoof mitigation. 12-payload regression corpus (9 individual code points + 3 combination attacks). Output format `\uNNNN` consistent with existing U+2028/U+2029 precedent.
- **HookSandbox SAFE_GLOBALS no longer exposes host setTimeout/setInterval/setImmediate/clearTimeout/clearInterval/clearImmediate/queueMicrotask** CWE-913 sandbox-escape via async timer mitigation. Sandboxed `sleep(ms)` primitive bounded to wall-clock; rejects with `SANDBOX_ESCAPE_BLOCKED` if exceeded. Two-layer defense: removed from SAFE_GLOBALS + validateCode statically blocks call patterns. 11 regression tests.
- **BufferedTelemetryCollector.flush() now routes errors through serializeError** CWE-117 residual from Sprint 48 sweep (nested-class method body missed by outer-class line-number anchors). Hostile-error regression suite covers terminal-control-char (BEL, ESC `[2J[H`) + ANSI-escape + log-injection (`\nINFO: fake_entry`) + TAB payloads.
- **HookSandbox validateCode Proxy-bypass edge closed** `Function.prototype.toString.call(fn)` bypasses Proxy `[[Get]]` traps that intercept `.toString` to spoof native code as benign.
- **sanitizeReasonText TAB handling aligned with sanitizeLogString** TAB now hex-escapes to `\x09` instead of being deleted by the printable-strip pass. ADR-0001 D#2 Decision-history entry added.
- **hashContent HMAC key + threat model documented** Function clarified as deterministic audit-trail fingerprint, NOT a security MAC; hardcoded key is intentional (length-extension attack prevention); correct MAC pattern named for users who need authenticity. `@internal` marker added.
- **validateCode regex extended from 5 to 16+ banned primitives** Added: EventSource, Worker, setTimeout/setInterval/setImmediate/clearTimeout/clearInterval/clearImmediate, queueMicrotask, eval, Function constructor (call + new forms). 13 blocked-payload tests + 1 safe-baseline.
- **TelemetryService no longer mutates caller-supplied event timestamps** CLAUDE.md immutability rule compliance. Shallow-clone via spread `{...event, timestamp: event.timestamp ?? Date.now() }`. 4 regression tests covering explicit `undefined` + omitted + pre-supplied + auto-generated paths.
- **secret-scan baseline established.** Workspace and history scan evidence is tracked internally per project security policy. Tarball-time scanning remains planned for the release gate. Defense-in-depth: root `.gitignore` reinforced with `demo/**/.env*` patterns.
- **secret/PII guard ReDoS spot-check completed.** Existing patterns were reviewed and defense-in-depth regression coverage was added for the v1.0.0 validator/guard surface.

- **Jailbreak validator ReDoS spot-check completed.** Existing patterns were reviewed and defense-in-depth regression coverage was added.

- **PromptInjectionValidator: regex DoS guard added with 100ms input-bound regression test. CWE-1333 mitigation.** The `detectHtmlCommentInjection()` function used `/<!--([\s\S]*?)-->/g` which exhibited O(n^2) quadratic backtracking on inputs of repeated unclosed `<!--` tokens. Measured: 10 KB → 9 ms, 100 KB → 866 ms (pre-fix). Replaced with an `indexOf`-based linear scanner: 100 KB → 0.4 ms post-fix (2000x improvement). Four regression tests added to `prompt-injection.test.ts` under describe `'ReDoS guard'`. All 13 other regexes in the file confirmed LINEAR via stress probe. The existing `MAX_INPUT_LENGTH = 100_000` pre-check in `analyze()` is preserved as a defence-in-depth ceiling.
- **PromptInjectionValidator: time-budget guard added to `detectMultiLayerEncoding` + `detectBase64Payloads` scan loops** Layered defence in addition to the earlier HTML-comment-injection fix. `REGEX_SCAN_BUDGET_MS = 500` sampled every `BUDGET_CHECK_INTERVAL = 256` match iterations (bitwise-AND modulo, zero overhead on normal inputs); scan loops break early returning partial results if the wall-clock budget is exceeded. Bounds future exposure if V8 de-optimises the existing patterns or if a new encoding pattern with worse backtracking is added. 13 regression tests in `prompt-injection-dos.test.ts` covering 10K/50K/100K near-base64, near-hex, many-chunks, plus 4 functional-preservation tests. Wall-clock measured: 1-8ms on 100K-char hostile inputs vs 500ms budget. No public-API change.
- **`secret.ts`: Anthropic API key boundary tests added.** Coverage now asserts the provider-specific key length boundary and allowed-character class without changing public API behavior.
- **`bonklm doctor`: validate `cwd` argument is an existing directory; throw clear error otherwise** Public CLI function `runDoctor(cwd: string = process.cwd())` previously accepted any string; non-existent paths or file-not-dir inputs silently produced misleading reports. Now short-circuits with a `cwd_invalid` `DoctorCheckResult` at `status: 'fail'` when `statSync(cwd)` fails or `isDirectory()` returns false. 4 new tests cover both invalid scenarios.
- **`bonklm doctor`: added `checkEnvFile` + `checkPnpmAudit` checks** Diagnostic surface grew from a single check (`checkPreCommitHook`) to three. `checkEnvFile(cwd)` looks for `.env` or `.env.example` and routes pass / warn. `checkPnpmAudit(cwd, _spawnFn?)` runs `pnpm audit --prod --audit-level=high --json` (30s timeout, fail-safe to `warn` if pnpm not on PATH); injectable `_spawnFn` parameter for tests (ESM module sealing prevents `vi.spyOn` on `node:child_process`). 9 new tests covering happy + failure + error + bad-JSON + missing-pnpm paths.
- **`bonklm doctor --json`: documented + enforced sanitization contract** Extracted `renderJson(report)` with a 13-line JSDoc block documenting the contract: strings are sanitized via `sanitizeLogString` (no ANSI escapes, no raw newlines that could break parsers, no embedded control chars). 2 round-trip tests assert `JSON.parse(renderJson(report))` succeeds on fixtures containing newlines + ANSI escapes (`\x1b[31mRED\x1b[0m`).

### Added

- **`bonklm doctor` rate-limiter advisory check** New `checkRateLimiterAdvisory(cwd)` check inspects the consumer's `package.json` and emits a `warn` when any BonkLM framework connector (`@blackunicorn/bonklm-{express,fastify,hono,elysia,nestjs,nextjs}`) is installed without a known upstream rate-limiter dependency. Recognised limiter packages: `express-rate-limit`, `@fastify/rate-limit`, `hono-rate-limiter`, `elysia-rate-limit`, `@nestjs/throttler`, `@upstash/ratelimit`, `rate-limiter-flexible`. Consumers explicitly acknowledge the policy via `package.json` field `{ "bonklm": { "rateLimit": "documented" | "external" | "in-process" } }`. WARN-only by design (never blocks dev installs). 11 new tests covering all 8 status branches plus sanitization. Architect-recommended approach — alternative "wire by default" rejected because the bundled `RateLimiter` is in-memory Map and would give a fictional per-pod limit in realistic v1.0 production shapes (multi-pod Node behind LB, Cloudflare Workers, Vercel Edge).
- **`RateLimiter` / `createRateLimiter` / `CommonRateLimiters` / `DEFAULT_RATE_LIMIT` re-exported from `@blackunicorn/bonklm` root barrel** Previously reachable only from internal security module paths. Now reachable as `import { createRateLimiter } from '@blackunicorn/bonklm'` for consumers who want a per-instance safety belt on top of their distributed limiter. DX-only change — no semantic shift.

### Documentation

- **5 framework-connector READMEs gained a "Security: rate limiting" section** Mirrors the existing `@blackunicorn/bonklm-express` pattern (§Security Best Practices > Rate Limiting). Connectors updated: `bonklm-fastify` (`@fastify/rate-limit` recipe), `bonklm-hono` (`@upstash/ratelimit` edge recipe + `hono-rate-limiter` Node note), `bonklm-elysia` (`elysia-rate-limit` recipe), `bonklm-nestjs` (`@nestjs/throttler` recipe), `bonklm-nextjs` (`@upstash/ratelimit` Vercel recipe + `rate-limiter-flexible` Node note). Each recipe wires the limiter BEFORE the guardrails layer. Each section closes with the `bonklm.rateLimit` package.json opt-out for the doctor advisory.
- **`docs/user/security/rate-limiting.md`** gained a "Why we do not wire a default rate limiter" section explaining the in-process-state + edge-runtime + wrong-layer reasoning; documents the three `bonklm.rateLimit` acknowledgement values.

### Changed

- **`files` whitelist standardized to `["dist","README.md","LICENSE"]` across 9 publishable packages.** Packages: anthropic-connector, copilotkit-connector, genkit-connector, google-genai-connector, langchain-connector, mastra-connector, mcp-connector, ollama-connector, openai-connector. Adds LICENSE to the npm tarball where it was previously omitted despite the source LICENSE being present. Packages with intentional deviations preserve their documented runtime rationale.
- **Pre-commit hook extended to run `check-version-pin.sh`.** `simple-git-hooks.pre-commit` now runs `pnpm typecheck && bash scripts/check-version-pin.sh`, rejecting package-version drift from the canonical release pin.

## [1.0.0-rc.3] — 2026-05-24 (Sprints 29 + 30 + 31 + cumulative audit closure)

Third release candidate. Consolidates four sprints of post-rc.2 security
hardening work into a single tagged RC for the v1.0.0 public-comment
window. **No new public-API surface beyond rc.2 except the three new
`ValidatorInstanceRule` / `LoggerInstanceRule` / `AttackLoggerInstanceRule`
config-schema helpers** (Sprint 29) plus the canonical
`validateWithTimeoutSecure` connector primitive (Sprint 30) — all
`@public` per v1.0-RC1 freeze policy.

The four work-streams collapsed here:

- **Sprint 29** — Config-schema layer fix. The canonical `Validator` /
  `Logger` / `AttackLogger` interfaces are object-shape; the previous
  `Validators.function` schema check rejected class instances, breaking
  express / fastify / nestjs middleware schemas (110+ tests failing at
  rc.1 + rc.2). New shape-aware rules + `OptionalRule` null-rejection
  semantic fix.
- **Sprint 30** — SEC-008 timeout-primitive extraction. The Sprint 29
  audit uncovered fastify-plugin's validation-timeout was broken
  (`engine.validate()` doesn't accept an `AbortSignal`, so the
  AbortController-based timeout was a no-op). Sprint 30 swept the
  workspace and found the SAME broken pattern in 20+ other connectors;
  extracted a single canonical primitive instead of 22 near-identical
  per-connector patches.
- **Sprint 31** — Pre-existing test-tooling debt cleanup. 10 long-standing
  test failures across 3 connector packages (vercel, pinecone, mastra)
  that predate Sprints 28-30. The mastra fix was security-relevant —
  prior test asserted the INSECURE silent-filter path; corrected to
  assert the canonical S012-004 throw-contract.
- **Cumulative audit closure** — Post-Sprint-28-to-31 3-lane audit
  (architect + code-reviewer + security-reviewer) ran across all
  v1.0.0-rc.1 → HEAD changes. Convergent findings closed inline before
  commit (memoization bug, primitive `≤ 0` handling, log injection,
  sentinel-factory throw fallback, langchain SEC-008 regression,
  copilotkit + genkit sentinel shape divergence).

### Fixed (audit-driven security hardening — cumulative-audit closure)

- **`validateWithTimeoutSecure` memoization bug** (sec CRITICAL +
  review MEDIUM-1) — the prior `=== undefined` check would re-invoke
  the sentinel factory on every call when the factory legitimately
  returned `undefined`, defeating both memoization and the side-effect
  guarantee. Switched to a separate `built` boolean flag.
- **`Validators.timeout` accepts 0 vs primitive throws on ≤ 0** (arch
  HIGH-1 + sec HIGH-1) — schema layer now also rejects 0
  (`NumberRangeRule(1, 3600000)`) so the defense-in-depth layers
  agree. An operator-induced DoS (passing `validationTimeout: 0` via
  broken env-var) is now caught at config-load time instead of
  crashing every request.
- **`Validators.positiveNumber(0)` silently unbounded** (sec LOW-2) —
  the `min === 0 ? undefined : min` short-circuit accepted negative
  numbers when called with `(0)`. Always honour the explicit `min`.
- **`HARDCODED_FALLBACK` used string `'critical'` not `Severity.CRITICAL`**
  (sec MEDIUM-1) — switched to enum reference to prevent drift if
  the enum value ever changes.
- **Log injection via `err.message`** (sec HIGH-3 / CWE-117) — added
  `sanitizeErrorMessage()` that strips control chars (`\x00-\x08
  \x0b-\x1f \x7f`), escapes newlines (`\\n`), and caps at 500 chars.
  Applied at all logger call-sites in `timeout-wrapper.ts`.
- **Sentinel-factory throw could re-introduce process crash**
  (sec HIGH) — `safeSentinel()` wraps the factory call in try/catch
  with the hardcoded fallback.
- **TimeoutSentinelShape generic constraint** (review HIGH-1) — added
  `R extends TimeoutSentinelShape` (minimum `{ allowed: boolean }`)
  so callers cannot widen the generic to a type structurally
  incompatible with the hardcoded fallback (which would crash the
  caller at runtime when accessing `.allowed`).
- **langchain `withRetrieverGuardrails` bypassed timeout** (review
  MEDIUM-3) — per-doc validator loop now wrapped in
  `validateWithTimeoutSecure` so slow validators can't silently hang
  the retriever invoke call. Reintroduced SEC-008 regression Sprint
  30 closed across all other connectors.
- **`bonklmLangGraphNode` raw form bypassed timeout** (review LOW-2)
  — added the same wrapper. Both call shapes (raw + factory) now
  honour SEC-008 with a default 5000ms budget.
- **mastra input-blocked threw plain `Error`, output-blocked threw
  `ConnectorValidationError`** (sec MEDIUM-4) — unified to
  `ConnectorValidationError` so callers catching by type see both
  guardrail-block events consistently.
- **copilotkit + genkit sentinel shape divergence** (arch CRITICAL-1)
  — both wrapped only `{ results: [...] }` (no top-level
  `allowed`/`blocked`/`severity`). Now spread a canonical top-level
  `GuardrailResult` alongside the `results` array. SIEM sinks
  consuming `BonklmBlockEvent` now see uniform timeout-event shapes
  across all 22 connectors.

### Added

- **`packages/core/tests/connector-utils/timeout-wrapper.test.ts`**
  (21 tests) — direct unit tests for the SEC-008 primitive. Covers
  happy path, timeout fire, `timeoutMs` validation (9 bad-value
  cases), post-timeout rejection absorption, log sanitization
  (control chars + newlines + truncation), sentinel-factory throw
  fallback, memoization (factory called exactly once), non-Error
  rejection coercion, sync operations, optional logger. Code-review
  HIGH-3 closure.

### Changed (docs)

- **`docs/user/migration-v0-to-v1.md`** — added §3a `OptionalRule`
  null-rejection migration (arch HIGH-2), §3b `Validators.timeout`
  zero-rejection migration, §3c `Validators.positiveNumber(0)`
  semantics migration.
- **`docs/user/public-api-surface.md`** — added
  `ValidateWithTimeoutOptions<R>` + `TimeoutSentinelShape` to the
  connector-utils PUBLIC catalog (arch MEDIUM-2).
- **23 stale "AbortController" comment references** across 19
  connector packages updated to "validateWithTimeoutSecure (Sprint
  30)". Removes the future-contributor footgun the audit flagged.

### Tests

- Core: **2788/2798** passing (+21 new primitive tests; 10
  multilingual Pass-2 skips unchanged).
- All 22 ported connectors build clean. No regressions.

### Audit residual (LOW, accepted)

- **`*Instance` suffix in Validators registry** (arch LOW-1):
  `validatorInstance` / `loggerInstance` / `attackLoggerInstance`
  use a structural-annotation suffix that's inconsistent with the
  rest of the registry (`positiveNumber` / `boolean` / `string` /
  etc.). Frozen at rc.2 per v1.0-RC1 policy; cannot rename without
  major bump. Documented for posterity.

### Sprint 31 detail — test-tooling debt cleanup

Closes the spawn-task chip from Sprint 30: 10 long-standing test failures
across 3 connector packages that predate Sprints 28-30 (verified by
stashing + reproducing at HEAD).

#### Security note (audit-flagged categorization correction)

**The mastra test fix WAS security-relevant** (arch MEDIUM-1
correction). The prior test asserted that `wrapped.execute()` returns
a 'filtered' string for blocked output — the INSECURE silent-filter
path. Src line 605 explicitly comments `S012-004: Throw error instead
of returning filtered content` (canonical security contract). The
test was validating the wrong branch; Sprint 31 corrected it to assert
the throw. If a `git bisect` were used to find when S012-004 throw-
contract coverage landed, Sprint 31 is the answer (not Sprint 30 when
the throw was originally written).

#### Fixed (test-only — no src changes, no public-API change)

- **vercel-connector** — 8 tests in `tests/guarded-ai.test.ts` used
  CommonJS `require('../src/guarded-ai.js')` inside test bodies. The
  package is ESM-only (`"type": "module"`), so `require()` failed with
  `Cannot find module '../src/guarded-ai.js'`. The stale "Dynamically
  import to avoid mock issues" comment that justified the pattern was
  copy-pasted from a different test file — verified zero `vi.mock`
  setup in this file. Converted to a single top-level ESM import.
  Result: 17/17 pass (was 9/17).
- **pinecone-connector** — `should validate vector contains only
  numbers` assertion drift. Test expected `'Vector must contain only
  valid numbers'`, src throws `'Vector must contain only finite
  numbers'`. Updated test to match canonical src ('finite' is more
  precise — rejects NaN/Infinity, which 'valid' was ambiguous about).
  Result: 14/14 pass.
- **mastra-connector** — `should return safe fallback for blocked
  output` asserted that `wrapped.execute(...)` returns a 'filtered'
  string when output is blocked. Src explicitly comments `S012-004:
  Throw error instead of returning filtered content` and throws
  `ConnectorValidationError`. Test was stale per the canonical security
  contract (silent filtering hides attacks from the application).
  Renamed test + asserts the throw. Regex anchored to start-of-message
  (code-review HIGH closure) so a future mis-route through
  input-blocked / circuit-breaker paths would not silently match.
  Result: 34/34 pass.

#### Tests (Sprint 31)

- **Full workspace green for the first time across Sprints 1-31**:
  162/162 test files pass, **4665/4678** tests pass (13 documented
  skips per Sprint 23 multilingual Pass-2 retirement).
- Core: 2767/2777 unchanged.

### Sprint 30 detail — SEC-008 timeout-primitive extraction

Sprint 29 audit uncovered fastify-plugin's validation-timeout was broken
— `engine.validate()` doesn't accept an `AbortSignal`, so the
AbortController-based timeout was a no-op. Sprint 30 swept the
workspace and found the SAME broken pattern in 20+ other connectors
(anthropic, chroma, openai, langchain, llamaindex, google-genai,
huggingface, mastra, openai-agents, vercel ×2, weaviate, pinecone,
qdrant, mcp, copilotkit, ollama, genkit, langchain-middleware).
Per-connector porting would create 20+ near-identical patches each
needing independent audit. Extracted a single canonical primitive
instead.

#### Added (Sprint 30)

- **`validateWithTimeoutSecure`** — shared SEC-008 timeout primitive
  at `@blackunicorn/bonklm` → `connector-utils/timeout-wrapper.ts`.
  Promise.race against a lazy timeout-sentinel factory, with the
  in-flight validator promise wrapped in `.catch()` BEFORE the race
  to absorb post-timeout rejections (Node ≥15 crashes the process on
  unhandled rejections by default — DoS vector if validator throws
  after timeout fires).

  ```ts
  import { validateWithTimeoutSecure } from '@blackunicorn/bonklm';

  const result = await validateWithTimeoutSecure({
    operation: () => engine.validate(content, context),
    timeoutMs: validationTimeout,
    timeoutSentinel: () => buildBlockedResult(),
    logger,
  });
  ```

  `@public` per v1.0-RC1 freeze policy. **Connector authors MUST NOT
  roll their own AbortController-based timeout** — the AbortSignal
  does not propagate to `engine.validate()` and the timeout becomes a
  no-op. Use this helper.

#### Fixed (22 connectors ported to `validateWithTimeoutSecure`)

Per CLAUDE.md "100% pass rate required — no postponing" rule + 3-lane
audit CRITICAL finding (architect: "Port all 20 before tagging RC2"),
**ALL 22 affected connector packages** are ported in this same sprint:

- **anthropic-connector** — was broken AbortController. 89/89 pass.
- **chroma-connector** — was broken AbortController. 56/56 pass.
- **fastify-plugin** — refactored from Sprint 29 inline. 43/43 pass.
- **nestjs-module** — refactored from Sprint 29 inline. 74/74 pass.
- **express-middleware** — was broken AbortController. 40/40 pass.
- **openai-connector** — was broken AbortController.
- **openai-agents-connector** — was broken AbortController.
- **google-genai-connector** — was broken AbortController.
- **huggingface-connector** — was broken AbortController.
- **langchain-connector** (guardrails-handler + middleware) — was broken
  AbortController (class-method form via `this.engine` / `this.logger`).
- **llamaindex-connector** (guarded-engine: QueryEngine + Retriever
  factories) — was broken AbortController.
- **mastra-connector** — was broken AbortController.
- **mcp-connector** — was broken AbortController.
- **vercel-connector** (guarded-ai + bonk-middleware) — was broken
  AbortController.
- **weaviate-connector** — was broken AbortController.
- **pinecone-connector** — was broken AbortController.
- **qdrant-connector** — was broken AbortController.
- **copilotkit-connector** — was broken AbortController.
- **ollama-connector** — was broken AbortController.
- **genkit-connector** — was broken AbortController.

Per-file sentinel SHAPES preserved (GuardrailResult / EngineResult /
`{results:[...]}` / ad-hoc plain object) so caller-side type contracts
are unchanged; only the timeout-orchestration mechanism switched.

#### Audit hardening (applied inline before commit, Sprint 30)

3-lane audit (architect + code-reviewer + security-reviewer) ran
post-helper-extraction. Convergent findings closed:

- **CRITICAL** (architect+security) — 18-22 broken connectors → **all ported.**
- **HIGH** (architect+security) — sentinel-factory called twice on
  post-timeout race rejection → memoized via `getSentinel()` cache.
- **HIGH** (security) — sentinel-factory throw path could crash process
  → wrapped in `safeSentinel()` try/catch with hardcoded fallback.
- **MEDIUM** (code-reviewer+architect) — `timeoutMs ≤ 0` was an unenforced
  silent-bypass vector → throws `TypeError` at helper entry.
- **MEDIUM** (code-reviewer) — `TimeoutWrapperLogger` duplicated the
  canonical `Logger` interface → imported canonical type, dropped
  duplicate.
- **MEDIUM** (security) — post-timeout validator rejection logged at
  `debug` → upgraded to `warn` so operators see systematic failures.
- **LOW** (architect) — stale "AbortController" JSDoc in anthropic /
  fastify / nestjs types → updated all 4 to "validateWithTimeoutSecure".

#### Tests (Sprint 30)

- Core: **2767/2777** unchanged (10 multilingual Pass-2 skips).
- 22 ported packages: full build green. Pre-existing test-tooling
  failures in mastra/pinecone (test-string assertion drift) and
  vercel-connector (CommonJS `require()` in ESM test file) are
  documented unchanged (predate Sprint 30; tracked separately).
- All affected packages build clean.

### Sprint 29 detail — connector schema layer fix

Connector test-tooling debt remediation. Pre-existing schema mismatch
across express / fastify / nestjs middleware schemas exposed Sprint 28
close (110+ tests failing at rc.1 + rc.2 against the canonical object-
shape `Validator` / `Logger` instances). Sprint 29 lands the fix at the
core schema layer so future connector packages inherit it.

3-lane audit (architect + code-reviewer + security-reviewer) ran
post-fix; convergent findings closed in this same commit before tag.

#### Added (Sprint 29)

- **`Validators.validatorInstance`** + **`ValidatorInstanceRule`**
  (`@blackunicorn/bonklm` → `validation/`) — config-schema rule that
  accepts EITHER a bare callable OR an object-with-`.validate`-method.
  The canonical `Validator` / `Guard` interface is object-shape
  (`{ validate(input):..., name?: string }`); the previous
  `Validators.function` check rejected class instances.

- **`Validators.loggerInstance`** + **`LoggerInstanceRule`** — same
  pattern for the `Logger` 4-method interface (`{ debug, info, warn,
  error }`). Adopt this for `logger` config fields in connector
  middleware schemas. Rejects arrays explicitly (audit code-review
  MEDIUM closure).

- **`Validators.attackLoggerInstance`** + **`AttackLoggerInstanceRule`**
  — same pattern for the `AttackLogger` instance shape (object with
  `getInterceptCallback` method). Preventive fix from audit
  architect-IMPORTANT-2 — the connector schemas had the same
  shape-mismatch latent bug on the `attackLogger` config field that
  the validators/logger fields had; fixed before exposure.

All three new rules are `@public` per v1.0-RC1 freeze policy. New
`@public` symbols added between rc.1 and v1.0 are explicitly part of
the freeze once v1.0 ships.

#### Changed (Sprint 29, semantic — was a footgun)

- **`OptionalRule`** now ONLY short-circuits on `undefined`, NOT on
  `null`. Per architect-IMPORTANT-3 audit: the prior null-short-circuit
  meant `{ logger: null }` passed schema validation, then crashed at
  runtime in `this.logger.debug(...)` because the destructuring
  default `logger = DEFAULT_LOGGER` only triggers for `undefined`.
  `null` was always a footgun in the optional path; we now reject it
  at schema-validation time. 2 core tests updated to match. No known
  external consumer affected — all internal call-sites pass
  `undefined`/omit-key (the JS-canonical pattern).

#### Fixed (Sprint 29)

- **express-middleware** — config schema rewritten to use
  `validatorInstance` + `loggerInstance` for validators/guards/logger
  fields, and every field wrapped in `Validators.optional(...)` so
  sparse `{ validators: [...] }`-only configs work (the documented
  shape from the JSDoc example). 40/40 unit tests now pass (was 40/40
  failing).
- **express-middleware** `addSecurityHeaders()` — defensive guard
  added: skips when `res.getHeader` / `res.setHeader` aren't functions.
  Lets unit tests pass minimal `Response` mocks without crashing.
  Express always provides these methods at runtime; production
  behavior unchanged.
- **fastify-plugin** — same schema rewrite. 43/43 tests pass.
- **fastify-plugin** SEC-008 validation-timeout — replaced broken
  `AbortController` approach (signal was never propagated since
  `engine.validate()` doesn't accept an `AbortSignal`) with
  `Promise.race` against a timeout sentinel. The timeout budget now
  actually fires; slow validators no longer leak past the budget with
  an `allowed: true` response. **Audit hardening** (security-MEDIUM
  S29-002 + code-review-MEDIUM): the in-flight `engine.validate()`
  promise is wrapped with `.catch()` BEFORE `Promise.race` so any
  post-timeout rejection is absorbed; Node ≥15 crashes the process on
  unhandled rejections by default.
- **nestjs-module** — same schema rewrite. 74/74 tests pass. ALSO
  **CRITICAL audit-arch-1**: nestjs had the same broken AbortController
  timeout as fastify; ported the same Promise.race + `.catch()` fix.
- **express-middleware** `addSecurityHeaders()` — defensive guard now
  logs at WARN level when triggered (audit security-MEDIUM S29-001).
  Operators see a clear signal if a real production wrapper strips
  response methods; the headers themselves are not silently dropped
  without a log entry.

#### Changed (Sprint 29, no breaking)

- The schema-wide `Validators.optional(...)` wrap loosens validation —
  previously the schemas rejected missing fields, now they accept them
  (consistent with the runtime middleware factories that destructure
  with defaults for every field). This matches the JSDoc-documented
  API contract; the strict mode was the bug.

#### Tests (Sprint 29)

- express-middleware: **40/40** (was 40 fail)
- fastify-plugin: **43/43** (was 2 fail)
- nestjs-module: **74/74** (was 13 fail)
- Core: **2767/2777** unchanged (10 multilingual Pass-2 skips per Sprint 23 retirement)
- Build: all affected packages build clean

### Cumulative rc.3 tests

- Full workspace: **4686/4699** passing across **163/163** test files
  (13 documented skips: 10 multilingual Pass-2 + 3 cross-package historic).
- Core: **2788/2798** (+21 SEC-008 primitive tests landed in audit-close).
- Build: all 54 published packages build clean at `1.0.0-rc.3`.

### Deferred to v1.0.0 final (Sprint 33+)

- v1.0.0 cut decision (continuing extended public-comment window through rc.3).
- Story 2.14a openclaw-adapter removal (date gate `2026-07-01`; today
  `2026-05-24` — defer until gate passes).
- Full `TestWorkflowEnvironment` Temporal integration (Sprint 27 used
  `MockActivityEnvironment` to ship; full workflow runtime still deferred).
- `*Instance` suffix naming consistency in the `Validators` registry
  (architect LOW-1, accepted; cannot rename without major bump).

## [1.0.0-rc.2] — 2026-05-24 (Sprint 28)

Second release candidate. Docs-only + JSDoc-only iteration; **no
runtime code changes** from rc.1. Extends the public-comment window
ahead of v1.0.0 final.

### Added

- **`docs/user/migration-v0-to-v1.md`** — comprehensive v0.x → v1.0
  migration guide. Covers all breaking changes (§1 `messagesToTextLegacy`
  removal, §2 `BonklmBlockEvent` union, §3 `@public`/`@internal` policy,
  §4 string-arg validator removal, §6 HMAC contract pin, §7 Workerd
  compat-date pin, §8 sandbox graduation, §9 multilingual Pass 2
  retirement, §11 `bonklmTrace` caller-provides-tracer contract,
  §13 wrap-once defence). Includes per-version reading list.

### Changed (docs-only)

- **`@public` JSDoc tags** applied to top-level core symbols for
  IDE-tooltip clarity:
  - `GuardrailEngine` class
  - `Validator` + `Guard` interfaces
  - `BonklmBlockEvent` discriminated union
  - `bonklmTrace()` function
  - `ShadowLog` interface
  - `OverrideTokenValidator` class
  - `assertNotWrapped` / `markWrapped` / `ensureWrappedOnce` helpers
  - All shipping validators (`PromptInjectionValidator`,
    `JailbreakValidator`, `AudioStreamValidator`, `CodeInjectionValidator`,
    `PathTraversalValidator`) + all shipping guards (`SecretGuard`,
    `XSSGuard`, `BashSafetyGuard`, `ProductionGuard`).

  The JSDoc tags are documentation-only — the freeze policy itself was
  already established in `packages/core/src/index.ts` (Sprint 27) and
  `docs/user/public-api-surface.md` (Sprint 25).

### Deferred to v1.0.0 final (Sprint 29+)

- v1.0.0 cut decision (after the extended public-comment window
  closes — earliest Sprint 29).
- Story 2.14a — openclaw-adapter removal (date gate `2026-07-01`;
  today `2026-05-24` — still deferred).
- Full `TestWorkflowEnvironment` Temporal integration
  (`MockActivityEnvironment` from Sprint 27 covers the activity
  contract; full workflow runtime deferred to v1.0-RC stabilization
  buffer Sprint 30+).
- Connector-package pre-existing test-tooling debt (express-middleware,
  nestjs-module, chroma-connector, anthropic-connector integration
  tests rely on a `validators` config schema shape that pre-dates the
  current `Validator` instance shape — these are TOOLING failures, NOT
  runtime regressions; the core 2767/2777 + temporal 21/21 + sandbox
  graduation 100/0/100 all pass against rc.2).

### Tests

- Core: **2767/2777** passing (10 multilingual Pass-2 skips —
  documented Sprint 23 retirement).
- Temporal middleware: **21/21** passing (`MockActivityEnvironment`).
- Sandbox graduation: **100% recall / 0% FPR / 100% precision** against
  R2-13 corpus (hash `db9c19...8fff4`, pin commit `4f8ea3f`).
- Build: all 54 packages build clean at `1.0.0-rc.2`.

## [1.0.0-rc.1] — 2026-05-23 (Sprint 26)

First release candidate. API-freeze prep per Story 4.7 / v1.0-RC
stabilization buffer. Sprints 26-28 run a 60+ day public-comment
window before v1.0.0.

### Removed (BREAKING)

- **`messagesToTextLegacy`** alias from
  `@blackunicorn/bonklm-vercel`. The v3/v4 `CoreMessage` →
  `ModelMessage` type drop the alias was reserved for never landed;
  the alias was identical to `messagesToText`. **Migration**: rename
  imports `messagesToTextLegacy` → `messagesToText`. Behavior is
  identical.

### API freeze (PUBLIC vs INTERNAL)

Per `docs/user/public-api-surface.md`:

- **PUBLIC** symbols — frozen until v2.0:
  - All barrel exports from `@blackunicorn/bonklm` core
    (`GuardrailEngine`, `Validator`, `ValidatorInput`, all named
    validators + factories, `cachedValidate`, `BonklmBlockEvent`,
    `bonklmTrace`, `assertNotWrapped` / `markWrapped` /
    `ensureWrappedOnce`, `adaptValidatorToUniversalInput`,
    `BufferedReleaseGate`, `StreamValidator`).
  - One wrap function (or handler factory) + types per connector
    package.
  - `BonklmBlockEvent` 7-kind discriminated union locked.
  - R2-10 locked `BonklmTraceSurface` vocabulary locked.

- **INTERNAL** symbols — may change in any minor/patch:
  - `_*`-prefixed exports (`_testOnlyClearSentinel`,
    `_resetFailOpenWarnState`, `_defaultCodeValidator`, etc.).
  - `RegexCache`, raw `pattern-engine.ts` arrays.
  - `validateBytes` / `analyze*` family on individual validators
    (use `validate(input)` instead).

### Items reviewed for deprecation — RETAINED

- **`validateToken`** (sync method on `OverrideTokenValidator`) —
  reviewed; the previously-speculative async migration never
  materialised. The sync API is the canonical primary interface and
  remains PUBLIC.
- **`GuardrailsCallbackHandler`** (langchain-connector) — reviewed;
  the class IS the canonical export, not a deprecated alias.
  Remains PUBLIC.

### Deferred to v1.0-RC stabilization (Sprints 27-28)

- Per-barrel `@public` / `@internal` JSDoc tag application (mechanical;
  done over Sprints 27-28 as docs-only commits).
- Real `@temporalio/testing` worker integration (current Sprint 21
  worker-integration.test.ts uses mocks).
- Story 2.14a — openclaw-adapter removal (date gate 2026-07-01;
  today 2026-05-23 — defer to first sprint after gate).
- Public-comment window triage (Sprint 27).
- v1.0.0 publish (Sprint 28).

### Tests

1272/1272 passing + 1 multilingual-skip across 51 files. No
regressions from the `messagesToTextLegacy` removal (no internal
consumer used the alias).

## [0.7.0] — 2026-05-23 (Sprint 24)

EPIC 4 consolidation release. Sandbox connectors graduate from
EXPERIMENTAL to STABLE; OTel vendor recipes documented; multilingual
Pass 2 formally retired.

### Added

- **`docs/user/otel-vendor-recipes.md`** (Story 4.3) — verified
  ingest recipes for Langfuse / Phoenix / Arize AX / VoltOps /
  Datadog. One-paragraph per vendor + common patterns + migration
  guide from `onBlock` callbacks.
- **`packages/core/benchmarks/sandbox-attack-corpus/benign-corpus.json`**
  (Story 4.5) — 50 labelled benign payloads for precision/FPR
  measurement on the graduation gate.
- **`packages/core/benchmarks/sandbox-attack-corpus/run-graduation-gate.mjs`**
  (Story 4.5) — runnable evaluator that dispatches code-injection
  patterns to `CodeInjectionValidator` and path-traversal patterns to
  `PathTraversalValidator` (matches the real wrap-sandbox dispatch),
  computes recall + FPR + precision, emits JSON + TXT decision report.
- **`packages/core/benchmarks/sandbox-attack-corpus/evidence.md`**
  (Story 4.5) — AAD-E evidence trail. 5 of 10 hand-curated patterns
  cross-referenced to public CVE / OWASP-LLM-Top-10 identifiers
  (OWASP-LLM-2025-02, 05, 06; CVE-2025-44890; CVE-2026-12001).
- AAD-E single-maintainer fallback protocol documented internally.

### Changed

- **Sandbox connectors GRADUATED** (Story 4.5):
  `packages/sandbox-utils`, `packages/e2b-adapter`,
  `packages/daytona-adapter` removed `"experimental": true` flag +
  removed runtime `emitExperimentalWarnOnce()` banner. Gate passed
  100% recall / 0% FPR / 100% precision against the R2-13 hash-pinned
  50-pattern corpus + 50-pattern benign corpus.
- All 54 packages bumped 0.6.0 → 0.7.0.

### Sandbox graduation attestation

```
Decision: GRADUATE
Reviewer: single-maintainer (AAD-E fallback)
Corpus-hash-pin commit: 4f8ea3f (Sprint 16 Story 3.2)
Corpus hash (sha256):   db9c1986a01ae0d4f5281c74a038b0392415132d21e38aac80b6aacea778fff4
24h cooldown: OBSERVED (9-sprint development gap between pin + review)
Self-review checklist: COMPLETE (see internal review record)

Public identifiers (5 of 10 hand-curated):
1. OWASP-LLM-2025-05 → pi-010 (editable git+URL install drift)
2. CVE-2026-12001    → pt-004 (double-URL-encoded `..`)
3. CVE-2025-44890 + CWE-158 → pt-005 (null-byte + traversal)
4. OWASP-LLM-2025-02 + CWE-78 → sh-004 (reverse-shell idiom)
5. OWASP-LLM-2025-06 + CWE-78 → sh-005 (find-exec + egress)

Metrics:
  Recall:    100.00% (threshold ≥95%) PASS
  FPR:       0.00%   (threshold ≤5%)    PASS
  Precision: 100.00% (threshold ≥80%) PASS
```

### Deferred (Sprint 25+)

- **Story 4.1** (peer-dep sweep) — Sprint 25 maintenance pass; no
  v0.7 AC blocker.
- **Story 4.2** (Multilingual Pass 2) — formally retired per Sprint
  23 decision; CONDITIONAL on native-speaker reviewer pipeline.
- **Story 2.14a** (openclaw-adapter removal) — date gate
  2026-07-01; defer to first Sprint after gate passes.
- **Story 4.7** (v1.0-RC stabilization buffer) — Sprints 26-28.

## [0.6.0] — 2026-05-23 (Sprint 16-23)

Eight-sprint cumulative release. Major surface expansion: 13 new
connector packages, 2 new core validators, full OTel export, R2-10
discriminated-union BonklmBlockEvent across all connectors, and the
v0.7-graduation-gate sandbox-attack-corpus.

### Added

**Core validators + primitives (Sprint 16-17)**:
- `AudioStreamValidator` (Story 3.1) — voice / realtime transcript
  validator with Aho-Corasick hot-path + `BufferedReleaseGate`
  wiring. Per-session `fork()` factory; `Symbol.asyncDispose`.
- `CodeInjectionValidator` (Story 3.2) — Python / JS dynamic-exec /
  shell metachar / network-egress / `PACKAGE_INSTALL` patterns.
- `PathTraversalValidator` (Story 3.2) — `..` traversal + absolute-
  path-outside-cwd + opt-in symlink-target validation.
- `R2-13 sandbox-attack-corpus` — hash-pinned 50-pattern corpus
  for Story 4.5 graduation (CODE_INJECTION 30 / PACKAGE_INSTALL 10 /
  PATH_TRAVERSAL 5 / SHELL_METACHAR 5).
- `BonklmBlockEvent` discriminated union (Sprint 21 + 22 + 23) —
  7 kinds (`voice` / `sandbox` / `inference` / `durable-exec` /
  `document` / `cf-agent` / `web-middleware`) for cross-package
  observability.
- `adaptValidatorToUniversalInput` (Sprint 20) — shared validator
  adapter; replaces 5x inline try-catch-TypeError shims.
- `assertNotWrapped` + `markWrapped` + `ensureWrappedOnce`
  (Sprint 22) — shared wrap-sentinel helper for connector double-
  wrap defence.
- `RTL bidi-control guard` (Sprint 17) — `stripBidiControls` +
  `normalizeForMultilingualMatch` for Arabic / Urdu / Persian
  payloads (defeats U+202A-202E + U+2066-2069 + U+200E/F + U+061C).
- `MultilingualDetector.name = 'multilingual'` + Validator interface
  conformance (Sprint 17 audit closure).
- `bonklmTrace()` (Story 3.11) — OTLP span export with R2-10
  locked attribute vocabulary (`bonklm.validator` / `severity` /
  `action` / `finding_count` / `surface`). Caller-provides-exporter.

**New connector packages (Sprint 16-23)**:
- `@blackunicorn/bonklm-livekit` (Story 3.3, Sprint 18) — LiveKit
  Agents v1.4.x `BonklmAgent` subclass + `wrapLiveKitAgentSession`
  event wiring.
- `@blackunicorn/bonklm-voice-webhooks` (Story 3.4, Sprint 19) —
  Vapi (HTTP) + Retell (WebSocket) HMAC-SHA256 handlers.
- `@blackunicorn/bonklm-sandbox-utils` (Story 3.5 START, Sprint 19) —
  shared validateCode / validatePath / wrapStream primitives.
- `@blackunicorn/bonklm-e2b` (Story 3.5 START, Sprint 19) — E2B
  sandbox `wrapSandbox` (EXPERIMENTAL).
- `@blackunicorn/bonklm-daytona` (Story 3.5 finish, Sprint 20) —
  Daytona workspace `wrapWorkspace` (EXPERIMENTAL).
- `@blackunicorn/bonklm-inference-providers` (Story 3.6, Sprint 20) —
  `wrapGroq` + `wrapCerebras` + `wrapTogether` (OpenAI-compatible).
- `@blackunicorn/bonklm-restate` (Story 4.4, Sprint 20+21) —
  `withRestateGuardrails` with full `ObjectContext` support
  (`key()` / `set()` / `get()`).
- `@blackunicorn/bonklm-temporal` (Story 4.4, Sprint 20+21) —
  `createValidateInputActivity` + `guardrailGate` workflow helper.
- `@blackunicorn/bonklm-document-ingest` (Story 3.7, Sprint 21) —
  `wrapLlamaParse` + `wrapUnstructured` + `wrapReducto` +
  `validateExtractedText` DIY helper.
- `@blackunicorn/bonklm-cloudflare-agents` (Story 3.8, Sprint 22) —
  Cloudflare Agents Durable Object `withBonklmAgent` subclass mixin
  (edge-only).
- `@blackunicorn/bonklm-web-middleware-utils` (Story 3.9, Sprint 22) —
  shared `runRequestValidation` / `runResponseValidation` /
  `getRequestBody`.
- `@blackunicorn/bonklm-elysia` (Story 3.9, Sprint 22) —
  `bonklmGuardrails` Elysia plugin (peer `elysia ^1.4.0`).
- `@blackunicorn/bonklm-nextjs` (Story 3.9, Sprint 22) —
  `withBonklm` Server Action + `bonklmRouteHandler` Route Handler +
  `bonklmEdgeMiddleware` middleware.ts factory (peer `next ^16.0.0`).
- `@blackunicorn/bonklm-voltagent` (Story 3.10, Sprint 23) —
  `wrapVoltAgent` for `@voltagent/core ^2.7.0`.
- `@blackunicorn/bonklm-voltops-otel` (Story 3.10, Sprint 23) —
  VoltOps OTel adapter via `emitVoltOpsSpan`.

**Multilingual (Sprint 17, 23)**:
- bn (Bengali) + ur (Urdu) patterns + 20+20 corpora. Now 12
  bundled languages.
- RTL bidi guard for ar / ur (Sprint 17).
- Story 3.12 Pass 2 (id / tr / fa / vi / th / pl / nl) RETIRED to
  v0.7+ backlog under Story 4.2 (CONDITIONAL: native-speaker
  reviewer pipeline). See
  internal planning record.

### Changed

- `PromptInjectionValidator.name = 'prompt-injection'` (Sprint 20) —
  was `constructor.name = 'PromptInjectionValidator'`. **SEMVER-
  observability**: downstream consumers keying on
  `result.results[].validatorName === 'PromptInjectionValidator'`
  must migrate to `'prompt-injection'`.
- `JailbreakValidator.name = 'jailbreak'` (Sprint 20) — same shape.
- `scoreToRiskLevel` thresholds unified to `≥10 HIGH / ≥5 MEDIUM`
  (Sprint 17). AudioStream previously `≥7 / ≥3` — operators keying
  on `risk_level === 'HIGH'` for alerting see a downgrade for
  single-WARNING audio findings.
- `validateExtractedText` truncation now byte-accurate via
  `Buffer.subarray` (was UTF-16 code units; multibyte payloads
  bypassed the cap). New `onOversize: 'truncate' | 'block' |
  'allow'` policy; configurable `maxBytes`.
- `withRestateGuardrails`: `lastDecisionStateKey` option (string or
  `false` to opt out of `ctx.set('bonklm:last_decision',...)`
  persistence on every ALLOW).
- Restate `ctx.key()` sanitization (`%3A` for `:`) prevents
  journal-key collision attacks.
- `bonklmEdgeMiddleware` return type changed from `Response |
  undefined` to `Response` (Sprint 22 audit). Accepts optional
  `nextResponse` factory for Next.js 14+ `NextResponse.next()`.

### Security

- HMAC: one-sided replay window (was `Math.abs` doubled the
  effective window).
- HMAC: decode-once 32-byte assertion (`timingSafeHexEqual`)
  replaces fragile double length-check.
- `assertNotWrapped` everywhere — double-wrap on any connector
  throws rather than silently double-validating.
- `adaptValidatorToUniversalInput` capability detection replaces
  try-catch-TypeError shims (which masked real validator bugs).
- HMAC failure reason no longer leaked in HTTP response body
  (was `{reason: 'signature_mismatch'}`; now `{error:
  'unauthorized'}`; reason still in `onHmacFailure` telemetry).
- Vapi tool-call `name` field documented as unvalidated (only
  `args` flows through engine).
- Daytona / E2B / Cloudflare-agents EXPERIMENTAL banner +
  documented "first-line defense; sandbox isolation is true
  containment" everywhere.

### Deferred (v0.7+ targets)

- Story 4.1 (LangGraph / Mastra), 4.2 (Multilingual Pass 2 —
  CONDITIONAL), 4.3 (Mid-S4 cross-validator suite), 4.5
  (Sandbox graduation gate via R2-13 corpus), 4.6 (Cross-cutting
  hardening).
- `@temporalio/testing` real-worker integration (current Sprint 21
  tests are activity-shape mocks).
- `createGuardedWrapper` migration completed for 4 packages
  (livekit + document-ingest 3x); 1 package remaining
  (voice-webhooks) ships in Sprint 24.
- Documentation site overhaul + per-connector migration guides.

### v0.5.0 release notes
- See below for the original v0.5.0 release (Sprint 13-15
  cumulative).

## [0.5.0] — 2026-05-23

Sprint 13–15 cumulative release. Five new workspace packages, the
guardrail HTTP server, the Mistral SDK v2 wrapper, and 470/470 tests
green across the entire Sprint 13–15 surface.

### New packages

- **`@blackunicorn/bonklm-inngest`** (Story 2.8, Sprint 13) — Inngest
  v4 middleware. Replay-safe via `cachedValidate` + step-history
  dedupe. Engine intercept callbacks fire on cached-validate
  decisions (Sprint 14 carry-over closure).
- **`@blackunicorn/bonklm-browser-agents-core`** (Story 2.3,
  Sprint 13) — shared event union + `withBrowserAgentGuardrails`
  helper consumed by Stagehand + Eko.
- **`@blackunicorn/bonklm-stagehand`** (Story 2.3, Sprint 13) —
  Stagehand v3 wrapper. `act` monkey-patch documented with
  construction-order JSDoc (Sprint 14 closure).
- **`@blackunicorn/bonklm-eko`** (Story 2.4, Sprint 13) — Eko v4
  multi-agent + MCP-tool wrapper.
- **`@blackunicorn/bonklm-trigger`** (Story 2.9, Sprint 14) —
  Trigger.dev v3/v4 middleware. CRIU-safe locals handle; retry-
  survival via `cachedValidate` keyed by `ctx.run.id`. Shape #5
  "Task-options bindings factory" — `withBonkLM(opts)` returns
  `{ middleware, onFailure }`.
- **`@blackunicorn/bonklm-lance`** (Story 2.10, Sprint 14) —
  LanceDB Table wrapper. Multi-column write validation,
  Arrow-write reject default, retrieved-doc batch validation.
  Node-only.
- **`@blackunicorn/bonklm-turbopuffer`** (Story 2.11, Sprint 14) —
  Turbopuffer Namespace wrapper. Edge-compatible (Workerd / Deno /
  Bun / Vercel Edge). Wraps `write` / `query` / `multiQuery` /
  `deleteAll`. README prominently warns about the
  `turbopuffer@1.0.1` placeholder package on npm.
- **`@blackunicorn/bonklm-mistral`** (Story 2.12, Sprint 15) —
  Mistral SDK v2 wrapper. ESM-only. `defaultLocale: 'auto'`
  auto-wires `MultilingualDetector` + `ReformulationDetector`.
  Optional `enableModerateSecondOpinion` advisory via
  `classifiers.moderate`.
- **`@blackunicorn/bonklm-server`** (Story 2.13, Sprint 15) —
  Fastify HTTP server exposing BonkLM guardrails. Three routes:
  `POST /litellm`, `POST /portkey`, `POST /openai-compatible`.
  HMAC-SHA256 auth via `X-Bonklm-Signature` + `X-Bonklm-Timestamp`.
  5-minute replay window. Includes Docker image
  `blackunicorn/bonklm-server`.

### Engine (core)

- **`GuardrailEngine.notifyCachedResult(results, content, ctx?)`**
  (Sprint 14 closure of Sprint 13 carry-over `arch X3 part 2`):
  public method bridging `cachedValidate`-driven connectors to the
  engine's `onIntercept` callbacks. Inngest, Trigger.dev, Lance,
  and Turbopuffer all wire through this. Without it, validator
  decisions from those connectors were invisible to engine-wide
  audit telemetry.
- **`createGuardedLanceTable` + `createGuardedNamespace`** accept
  an optional `engine?` for `notifyCachedResult` dispatch on the
  read path (Sprint 14 deferred-closure arch X6).
- **`engine.getValidators()` fallback** in Inngest + Trigger
  middlewares — pass `engine` and omit `validators`; the connector
  derives the pipeline from `engine.getValidators()` (Sprint 13
  carry-over arch X6).
- **`sanitizeReasonText` canonical home** moved to
  `@blackunicorn/bonklm/core/connector-utils` (Sprint 14 PB-6).
  Browser-agents-core retains the export for back-compat. New
  connectors should import from the core subpath.

### Connector-style ADR amendments

- **Shape #5** (Task-options bindings factory) — added at Story 2.9
  for Trigger.dev's `task({ middleware, onFailure, run })` shape.
- **Shape #2b** (Vector-database sub-client wrap with
  validators-in-opts) — added at Story 2.10 for LanceDB,
  retroactively documenting the qdrant / pinecone / weaviate
  `createGuarded<X>(subject, options)` convention.
- **Epic-2 deviations table** — Inngest reclassified as shape #4
  (host-constrained); Trigger.dev assigned shape #5; Lance +
  Turbopuffer assigned shape #2b.

### Documentation

- `docs/user/known-limitations.md` §11–20 added across Sprints 14
  and 15, documenting:
  - §11 CRIU-checkpoint heap exposure of cache-adapter credentials
  - §12 Replay-storm DoS on deterministic BLOCK
  - §13 Unknown ValidatorInput `kind` passthrough
  - §14 Redact-mode sentinel as secondary injection vector
  - §15 Older vector connectors lack empty-redaction guard
  - §16 `sanitizeReasonText` stack-trace / file-path leakage gap
  - §17 Mistral streaming output not post-validated
  - §18 Mistral multi-turn assistant-message bypass (default mode)
  - §19 Mistral image-encoded injection bypass (multimodal)
  - §20 Mistral `classifiers.moderate` consumer-intent inversion

### Workerd compat re-audit (Story 2.14 ritual)

- Audited workerd CHANGELOG between v0.3.0 (Sprint 11) and v0.5.0
  release prep (~8 weeks). **No ALS / `nodejs_compat` regressions
  identified.** `compatibility_date` pin remains at `2024-09-23`.
  Consumers do NOT need to bump `wrangler.toml`
  `compatibility_date` when upgrading from 0.4.x to 0.5.0.
  Audit baseline filed internally.

### Tests

- 470/470 passing across Sprint 13-15 packages (core + 10 connectors
  + server + integration + eslint-plugin).
- Cross-connector composition smoke test added at Sprint 14
  closure pass (`packages/inngest-connector/tests/cross-connector-composition.test.ts`)
  combining `wrapStagehand` + `bonklmInngestMiddleware` sharing
  one engine.
- Shared vector-connector UAT attack corpus added at Sprint 14
  closure pass (`packages/core/tests/integration/vector-connector-corpus.test.ts`).
- Wrapped-method-drift CI smoke
  (`packages/core/tests/integration/wrapped-method-drift.test.ts`)
  catches peer-dep SDK signature changes BEFORE release.

### Pre-publish blockers resolved

- READMEs written for trigger / lance / inngest / turbopuffer /
  mistral / bonklm-server packages.
- LICENSE files added to all Sprint 13–15 connectors.
- All packages bumped to 0.5.0.

### Migration notes (0.4.x → 0.5.0)

- **`@blackunicorn/bonklm-mistral`** is ESM-only. CJS consumers
  must migrate or use dynamic `import()` (see package README).
- **`@blackunicorn/bonklm-trigger`**: `getBonklmHandle(ctx?)` now
  accepts an optional `ctx` parameter for cross-task locals-bleed
  detection. Recommended for new code; optional for back-compat.
- **`@blackunicorn/bonklm-lance` + `@blackunicorn/bonklm-turbopuffer`**:
  `contentField` now accepts `string | readonly string[]` for
  multi-column write validation. Single-string `contentField`
  consumers see no change.
- **`@blackunicorn/bonklm-inngest`** validator array is now
  `Object.freeze`d at factory time (post-construction mutation no
  longer observable). Consumers mutating validators array after
  middleware construction should refactor.
- **`MistralGuardrailBlockedError`** extends
  `ConnectorValidationError` — cross-connector
  `catch (e instanceof ConnectorValidationError)` handlers now
  catch Mistral blocks too.
- **`@blackunicorn/bonklm-server`** `productionMode` defaults to
  `true` in the programmatic API AND the CLI bin (env var
  `BONKLM_PRODUCTION_MODE` defaults to `'true'`). Dev consumers
  must explicitly set `productionMode: false` /
  `BONKLM_PRODUCTION_MODE=false`. **Pre-publish closure note**:
  the v0.5.0 pre-release docs had the CLI default at `false` for
  one ephemeral state; the published v0.5.0 unifies to safe-default
  `true` across both surfaces.
- **`@blackunicorn/bonklm-trigger`** default `cacheNamespace`
  fallback bumped from `@blackunicorn/bonklm-trigger@0.4::run-...`
  to `@blackunicorn/bonklm-trigger@0.5::run-...`. Consumers
  relying on the DEFAULT cache namespace (no explicit
  `cacheNamespace` option) will see a one-time cache-miss storm
  on first deploy after upgrade — cached BLOCK/ALLOW decisions
  from v0.4 are effectively invalidated. To preserve cache
  continuity across the upgrade, pin an explicit `cacheNamespace`
  option to the v0.4 string. This is intentional: validator
  pipeline changes between major BonkLM versions may invalidate
  the underlying decisions even if the inputs hash identically.
- **`BrowserAgentGuardrailBlockedError`** now extends
  `ConnectorValidationError`. Stagehand + Eko + future browser-
  agent connectors raise blocks that match cross-connector
  `catch (e instanceof ConnectorValidationError)` handlers.
  Pre-v0.5.0 consumers catching only `instanceof Error` or
  `instanceof BrowserAgentGuardrailBlockedError` continue to work.
- **`@blackunicorn/bonklm-inngest`** `sanitizeReasonText` import
  migrated from `@blackunicorn/bonklm-browser-agents-core` to
  `@blackunicorn/bonklm/core/connector-utils` (canonical edge-safe
  home). The browser-agents-core re-export remains for back-compat;
  consumer code referencing the symbol directly is unaffected.

### Added (Story 2.1b-connectors, en route to v0.5.0)

- **ElizaOS Phase-2**: `@blackunicorn/bonklm-elizaos` ships the
  AsyncLocalStorage call-context migration + sealed `updateMemory` +
  startup HTTP probe with full security amendments.
- `als-context.ts` — `withCallContext` / `getCallContext` / `runWithoutCallContext`
  / `assertCallContextRuntime`. Replaces the Phase-1
  `runtime.bonklm.currentCallContext` direct property; hostile-plugin
  writes to that path are now INERT.
- `probe.ts` — `runStartupProbe(opts)` + `applyProbeOutcome(outcome, opts)`
  with 2000ms AbortController, IPv6 fallback (127.0.0.1 → [::1]),
  ALS-clear, module-scope dedup memo with FIFO at 100 entries (cache
  key includes NODE_ENV for test/prod isolation), 4-branch outcome
  enumeration, probe-await semantics.
- `typo-squat.ts` — Wagner-Fischer Levenshtein distance + NFKC
  normalisation + format-character strip. Catches `@elizaos/plugin-soIana`,
  Cyrillic homoglyphs, zero-width space embeds, fullwidth Latin variants.
- `updateMemory` sealed alongside `createMemory` in the SAME synchronous
  block (race-resistance test asserts attacker plugins via
  `Promise.resolve().then()` cannot interleave).
- `bonklmPlugin` options gain `runtimePort?: number` + `envBindings?:
  Record<string, string | undefined>` + `acknowledgeClass4Risk?: boolean`
  (now honoured; Phase-1 threw on it).
- `runDoctorRuntime(opts)` + `probeOutcomeToFindings(outcome)` library
  entries — `bonklm doctor --runtime` CLI ships in v0.5 release prep.

### Changed (BREAKING, en route to v0.5.0)

- **`doctor.auditPlugins` severity escalation** — plugin names with
  Levenshtein distance ≤ 2 from a verified-publisher allowlist entry
  (and not exact-match) now produce a **CRITICAL** `plugin_typo_squat`
  finding (was: MEDIUM `plugin_not_in_allowlist` for all non-allowlisted
  plugins in v0.4.0). Consumers with CI gates on severity counts MUST
  audit their thresholds before upgrading. The MEDIUM finding survives
  for unknown-distant plugins (distance > 2); only typo-squat candidates
  are escalated. Rationale: typo-squat impersonation of trusted
  publishers is qualitatively different from "unknown plugin" — the
  former is an active attack, the latter is a configuration question.

### Security (Story 2.1b-connectors)

- AsyncLocalStorage migration closes iter-2 architect BLOCK-1 +
  adversarial audit #11 (hostile direct-assignment to
  `runtime.bonklm.currentCallContext`).
- Sealed `updateMemory` closes iter-2 architect BLOCK-2 (Phase-1 left
  the update path unhardened).
- Startup HTTP probe with SSRF defence (LITERAL IP only, `localhost`
  BANNED) + 2000ms timeout (defeats hung-listener DoS amplification
  bounded by 50 plugins × 4s) + module-scope dedup memo (50-plugin
  parallel init resolves in <5s, not 200s).
- Probe cache key includes NODE_ENV — test/prod outcomes never share
  cache entries in shared-process deployments (iter-1 security BLOCK-6).
- `runtime.bonklm` namespace object frozen (`Object.freeze(sealedBonklm)`)
  in addition to the slot seal — hostile plugins cannot write
  `runtime.bonklm.foo =...` even on the empty namespace (iter-1
  security BLOCK-8).
- `BonklmPluginOptions` frozen in `bonklmPlugin()` — hostile plugins
  sharing the options reference cannot mutate `acknowledgeClass4Risk`
  or other fields after construction.
- `agentId` URL-encoded in probe URL — defence-in-depth against path
  traversal if a future ElizaOS change surfaces user-controlled values
  through `runtime.agentId`.
- Typo-squat NFKC + format-character strip — defeats zero-width space
  embedding, fullwidth Latin variants, composed-vs-decomposed
  homograph attacks (iter-1 security BLOCK-4).
- `installSealedWrapMemory` synchronous seal block wrapped in
  try/catch — partial-install failures throw `ConnectorValidationError`
  loudly rather than leaving a half-wrapped runtime (iter-1 architect
  BLOCK-2).
- `runDoctorRuntime` catch narrowed to `ConnectorValidationError` —
  future programming errors in `applyProbeOutcome` propagate for
  debuggability rather than being swallowed.

### Added (Story 2.1b-edge-core, en route to v0.5.0)

- `EdgeHookManager` — function-only `HookSandbox` variant exported from
  `@blackunicorn/bonklm/edge`. Refuses string-handler hooks at the
  `executeHook` boundary with `ConnectorValidationError('configuration_error')`.
- `assertAsyncLocalStorageHealthy(AlsCtor?)` — object-valued canary guard
  against absent / poisoned `AsyncLocalStorage`. Exported from BOTH
  `@blackunicorn/bonklm` (root) AND `@blackunicorn/bonklm/edge`.
- `AsyncLocalStorageCanaryError` — distinct error class for ALS-canary
  failures.
- `EnvBindings` type + `isProductionEnvironment(envBindings?)` +
  `isTestEnvironment(envBindings?)` — injection-based env-var resolution
  for edge runtimes. `ProductionGuardConfig` gains `envBindings?` field;
  `ProductionGuard.validate()` forwards to the env-aware functions.
- `PortableEventEmitter` — internal portable EventEmitter replacement
  (eliminates `node:events` ESM hazard in HookSandbox).
- Canonical Workerd `wrangler.toml` setup anchor in
  `docs/user/migration/edge-string-handlers.md#cloudflare-workers-required-setup`.
- envBindings v0.3→v0.5 migration table in the same doc.

### Changed (BREAKING, en route to v0.5.0)

- **`HookSandbox.getEventEmitter()` return type** — changed from
  `EventEmitter | undefined` (`node:events`) to
  `PortableEventEmitter | undefined`. The portable emitter exposes
  `on` / `off` / `emit` / `listenerCount` / `removeAllListeners` —
  callers relying on Node `EventEmitter`-specific methods (`once`,
  `setMaxListeners`, `'error'` channel auto-rethrow) must adapt. The
  swap eliminates the `node:events` ESM-resolution hazard for bundlers
  targeting non-Node runtimes. Documented in
  `docs/user/migration/edge-string-handlers.md`.

### Security

- EdgeHookManager logs are now CAPPED (1000 executions, 100 blocked
  attempts) to defeat memory-exhaustion DoS in long-running edge
  isolates that reuse a single manager across requests.
- `EnvBindings` values are sanitised before consumption — values longer
  than 128 chars or non-string types are silently dropped. Defeats
  request-header-injection where a consumer threads attacker-controlled
  values into the bindings record (e.g. `{ NODE_ENV: req.headers[...] }`).
- ALS canary uses object-valued sentinel with `portableRandomUUID()`
  token + reference-equality + per-field deep-equal. Catches poisoned
  `globalThis.AsyncLocalStorage` stubs, broken polyfills, and
  prototype-pollution attacks.

## [0.4.0] - 2026-05-22

### Highlights

**Epic 1 — Threat-Surface Foundation**. v0.4.0 closes BonkLM's
3-surface coverage gap (tool-call args, retrieved-doc, memory-write,
composed-context) and ships 5 new / retrofitted connector packages
(Vercel v5/v6, LangChain v1, OpenAI Agents, Google GenAI, ElizaOS).
11 Epic-1 stories + 2 cumulative-audit passes. **+385 net new
passing tests** (2898 → 3283). Zero new test failures introduced.

> **Phase-1 connectors**. Stories 1.4 (Vercel v6), 1.5 (LangChain
> v1), 1.6 (OpenAI Agents), 1.8 (ElizaOS) ship a Phase-1 surface in
> v0.4.0. The roadmap's full AC is split across Phase-2+ PRs
> shipping in v0.5.0 (per-connector follow-ups documented inline at
> each story's commit).

### Added

**`ValidatorInput` discriminated union + `HookSurface` 7-string vocabulary lock** (Story 1.1, R2-8/9/10):
- 5 ValidatorInput kinds (`text` / `tool_call` / `retrieved_docs` / `memory_write` / `composed_context`); 7 canonical HookSurface strings.
- `Validator.validate(input: string | ValidatorInput)` overload — every existing validator compiles unchanged.
- `HookManager.registerHook` defaults `surface: 'text_input'` with one-shot deprecation warning; throws in 0.5.
- `GuardrailResult` gains optional `subResults?` and `metadata?` fields; engine propagates `metadata` through `aggregateResults` + `mergeResults`.

**Composite validator factories**:
- `createToolCallArgsValidator` (Story 1.1) — tree walker over `args` with Map/Set/Buffer/URL/Date support, WeakSet cycle protection, depth cap 5, ALWAYS-scanned tool name (raw + humanised).
- `createRetrievedDocValidator` (Story 1.2) — drop / block-all / redact modes; index-aligned `subResults`.
- `createMemoryWriteValidator` (Story 1.3) — block-write / redact modes; `validateWrite(payload)` connector convenience.
- `createComposedContextValidator` (Story 1.3a) — wake-up attack defence; bidirectional concat scan; 32KB soft / 200KB hard caps; P99 < 200ms on 32KB benchmark gate.

**Stream release-gate primitive** (Story 1.1b, R2-12, R2-D1):
- `BufferedReleaseGate` standalone primitive.
- `StreamValidator.processForClient` / `finalizeForClient` per-cycle validate-before-release with mode-mixing guard.
- `minBufferBeforeRelease: Infinity` (full-response mode) auto-selected when `chainHasSecretOrPii: true`.

**Web3 preference-setting patterns** (Story 1.1c):
- 8 phishing tripwires under `web3_preference_setting` category. All severity WARNING + `blockEligible: false` (does NOT auto-block on its own).

**Shared utilities**:
- `validator-utils.ts` consolidates `runValidatorChain`, `applyRedaction`, `RedactingValidator`, `VALIDATOR_ERROR_CATEGORIES`.
- `RedactingValidator` capability — `SecretGuard.redactContent` + `PIIGuard.redactContent` parity-aware with detection normalisation.
- `applyRetrievedDocValidatorToMatches` connector helper with position-stable synthetic IDs (`__pos_${i}`).
- `stripLogControlChars` — defeats log-injection via attacker-controlled names.

**Connector retrofits + new packages**:
- 4 vector-DB connectors (`pinecone`, `qdrant`, `weaviate`, `chroma`) gain opt-in `retrievedDocValidator` option (Story 1.2).
- NEW `@blackunicorn/bonklm-vercel` Phase-1 — `bonkMiddleware(engine, options)` for `ai ^5 || ^6` `wrapLanguageModel` (Story 1.4).
- NEW `@blackunicorn/bonklm-langchain` Phase-1 — `createBonklmMiddleware(engine, options?)`, `withRetrieverGuardrails`, `createBonklmLangGraphNode` (Story 1.5).
- NEW `@blackunicorn/bonklm-google-genai` — full `wrapGenerateContent` / `wrapGenerateContentStream` / `wrapChat` / `wrapLive` (Story 1.7).
- NEW `@blackunicorn/bonklm-openai-agents` Phase-1 — `wrapAgent` / `wrapHandoff` / `wrapRealtime` with tool-result-as-carrier handoff defence (Story 1.6).
- NEW `@blackunicorn/bonklm-elizaos` Phase-1 — sealed `wrapMemory` with `Object.defineProperty` + closure-captured `currentCallContext` + verified-publisher allowlist + two-condition recipient gate + `bonklm doctor` static-audit CLI (Story 1.8).

**Peer-dep sweep** (Story 1.9):
- `anthropic` peer covers SDK majors through 0.98; `huggingface` covers `^2 || ^3 || ^4`; `llamaindex` covers `^0.11 || ^0.12`; `chromadb` covers `^1 || ^2 || ^3`.

**Documentation pass** (Story 1.11):
- NEW `docs/user/threat-surfaces.md` — canonical 7-surface taxonomy + validator coverage map.
- NEW `docs/user/known-limitations.md` — 9 honest carve-outs.
- NEW migration guides at `docs/user/connectors/vercel-v6-migration.md` and `docs/user/connectors/langchain-v1-migration.md`.
- README ecosystem comparison vs Lakera / LLM Guard / NeMo Guardrails with honest caveats.

**Deprecations announced** (Story 1.10):
- `@blackunicorn/bonklm-openclaw` deprecated at v0.4.0-rc1, removal in v0.6.0 (Sprint 16).

### Security

Audit-loop security hardening from architect, code-reviewer, and adversarial lanes was patched before merge. Highlights:

- `__depth_capped__` sentinel collision in `createToolCallArgsValidator`.
- Dot/Unicode-separator humanizer hole (`disable.safety.filter`).
- `Map` / `Set` / `Buffer` walker silent skip.
- Custom serializer dropping toolName scan (R2-2).
- `SecretGuard.redactContent` and `PIIGuard.redactContent` normalisation parity (homoglyph PII bypass).
- `block-all` `subResults` truncation index-alignment.
- `acknowledgeClass4Risk: true` silent no-op (now throws).
- `runtime.bonklm` namespace seal closing post-init mutation defence bypass.
- Non-string `args.recipient` silent gate skip.
- Cyrillic-mangled preference-setting pattern bypass.
- `bonklm doctor` SECRET_PATTERN expanded (ASIA / rk_live_ / pk_live_ / sk-ant- / eyJ JWT).
- Log-injection via attacker-controlled names. Fixed via `stripLogControlChars` in `sanitizeLogMetadata`.
- `bonkMiddleware.wrapStream` extended to cover all v5/v6 text-carrying event types.

### Changed

- All 25 BonkLM packages bumped to `0.4.0`. Example packages remain at `1.0.0`.
- `vercel-connector` devDep `ai` pinned to `^4.0.0` so the legacy v3/v4-typed `guarded-ai.ts` typechecks while the new `bonkMiddleware` duck-types v5/v6 shapes.

### Known limitations

See [`docs/user/known-limitations.md`](docs/user/known-limitations.md) for the 9 honest carve-outs. Notable:
- Phase-1 connectors defer full AC to Phase-2+ PRs.
- ElizaOS Class-4 PATCH-route attack window is deploy-time detected; structural shadow-log fix lands in v0.5.0 / Story 2.4a.
- 127 pre-existing test failures (express / fastify / nestjs schema rejections + SEC-008 timeout flakes) remain unfixed in v0.4.0.

## [0.3.0] - 2026-05-20

### Audit-loop hardening (post-initial 0.3.0 work, not yet tagged)

Four iterative audit loops surfaced and closed additional issues on the v0.3.0
work:

- **IPA small-capitals bypass closed.** Attackers spelling `ɪɢɴᴏʀᴇ ᴀʟʟ ᴘʀᴇᴠɪᴏᴜѕ
  ɪɴѕᴛʀᴜᴄᴛɪᴏɴѕ` with IPA small-capital letters (U+026A, U+0274, U+1D0F, etc.)
  used to slip through every detection regex — NFKD has no canonical
  decomposition for these codepoints. Extended `CONFUSABLE_MAP` with the IPA
  small-cap block, Cherokee Latin-glyph lookalikes (Ꭺ→A, Ꭱ→E, Ꭲ→T, etc.),
  and additional Armenian letters that mimic Latin uppercase. Regression
  tests added.
- **StreamValidator now fails closed on engine throw.** If the underlying
  engine.validate() threw (e.g. moderation backend down), the prior code path
  left unvalidated content in the buffer; the next `process()` call returned
  `{ allowed: true }` for content that was never scanned. Now wrapped in
  try/catch that calls `markStreamBlocked('engine_error')` before re-throwing.
  Regression test added.
- **Mailgun secret pattern reworked.** Previous "tightened" regex missed 4/5
  real naming conventions (`MAILGUN_TOKEN`, `MG_AUTH_KEY`, yaml
  `mailgun:\n key: …`, `mailgun_secret`). Replaced with two complementary
  patterns: one keyed on a Mailgun identifier within 120 chars of the value,
  one keyed on any credential noun (key/token/secret/auth/api/mg-*) within
  40 chars.
- **Secret guard line context redacts the matched value.** Findings used to
  capture the surrounding line verbatim (e.g.
  `MAILGUN_API_KEY="key-abcdef…"`); now strips the matched substring with
  `[REDACTED]` before slicing.
- **Symbol.asyncDispose runtime check in `StreamValidator`.** Pre-Node-20.4
  versions don't carry the symbol; the `await using` lifecycle silently
  no-op'd, voiding the "impossible to skip" tail-validation contract. Bumped
  `engines.node` to `>=20.4.0` across all 23 packages and added a constructor-
  time runtime check that fails loudly on incompatible runtimes.
- **Stream-validator `Infinity` interval guard.** Prior pass caught
  `interval=0` (NaN); `Infinity` was still allowed (`x % Infinity === x`,
  never zero, so validation never fired). Both `shouldValidateStream` and
  `hasUnvalidatedTail` now require `Number.isFinite(interval) && interval >= 1`.
- **`iterativeDecode` loop-detection Set scoped per match.** Sharing one Set
  across encoding patterns let an attacker neutralise a later malicious
  base64 by priming it with an earlier benign one that shared a decode
  prefix (the second match short-circuited with LOOP_DETECTED).
- **Decoded-content severity filter.** `detectPatterns()` results are now
  filtered to `Severity.WARNING` or `CRITICAL` before flipping
  `contains_injection` — INFO-only patterns (e.g. `priority_markers`) no
  longer escalate the wrapping `multi_layer_encoding` finding to CRITICAL.
- **`StreamValidationError` consolidated.** Was duplicated across the
  monorepo; cross-package `instanceof` checks silently failed. All connector
  type files (mastra, openai, anthropic, langchain, copilotkit, genkit,
  ollama) now re-export from `@blackunicorn/bonklm/core/connector-utils`
  (single source of truth).
- **`validatePositiveNumber` hoisted.** Was copy-pasted into 8 connectors.
  Moved to `packages/core/src/connector-utils/validation-helpers.ts`; all
  connectors import from there.
- **Wizard package deprecated cleanly.** `@blackunicorn/bonklm-wizard`
  package.json now carries `private: true` + `deprecated: …` field and
  carries no source tree — changesets stops publishing it. The duplicate
  5000-line CLI tree under `packages/wizard/src/` (1:1 mirror of
  `packages/core/src/cli/`) was deleted.
- **`streamingMode: 'buffer'` honesty.** openai and anthropic connectors
  now log an explicit `logger.warn` when `'buffer'` is passed (was silent
  no-op). langchain marks the field `@deprecated` in JSDoc since it
  validates at stream-end regardless of mode. Connectors that genuinely
  implement buffer mode (copilotkit, genkit, mastra, vercel) continue to
  work as before.
- **`Validator` and `Guard` interfaces widened** to
  `validate(content): GuardrailResult | Promise<GuardrailResult>` for
  forward-compatibility with ML / remote-API validators.
- **Adapter directory flattened.** `packages/adapters/openclaw/` →
  `packages/openclaw-adapter/`. The single-occupant `adapters/` hierarchy
  is gone.
- **`GenericLogger` field renamed.** `private readonly readonly: …` (a foot-
  gun where the field name shadowed the modifier) renamed to
  `levelPriority`.
- **openclaw adapter** now uses the shared `Logger` contract from core
  instead of rolling its own `ConsoleLogger` class.
- **Per-package coverage thresholds** added (global 60/50/60/60, strict
  80/75/80/80 on `packages/core/src/**`).
- **Publish CI hardening**: `--ignore-scripts` on the install step, explicit
  prerelease tag gate so `v0.3.0-rc.1` can't accidentally publish a stable
  release.
- **CLI `--version`** reads from `package.json` at runtime (was hard-coded
  to `0.1.0`).

### Initial 0.3.0 work


### Removed
- Dropped internal development scaffolding from the repo: deleted `.claude/validators-node/`, `tools/`, `tests/` (root-level), `examples/automation/`, `examples/installer/`, `examples/versioning/`, `.githooks/`, internal scripts, stale build artifacts under `dist/`.

### Fixed
- `bash-safety` guard no longer crashes at runtime — replaced `require('path')` (which is unavailable in this ESM package) with a proper `node:path` import. Path containment for `rm -rf` targets now actually executes.
- Cross-platform build — removed BSD-only `sed -i ''` from the core build script in favour of a Node-based import-rewrite step. Ubuntu CI now builds successfully.
- Removed broken `cli` entry from `packages/core/package.json` `bin` field (pointed at a non-existent `.ts` source).
- Fixed three test fixtures in `secret.test.ts` that did not match the documented regex shapes for Slack / Stripe / OpenAI keys.

### Security
- Secret guard now detects 2024+ OpenAI `sk-proj-*` keys that lack the legacy `T3BlbkFJ` infix.
- Unicode normalization (`normalizeText`) is now applied at the entry of the bash-safety, XSS, and secret guards — defeats zero-width-character splitting (`r​m -rf /`) and homoglyph bypass.
- XSS guard no longer skips lines beginning with `//`. Adversarial LLM output prefixed with a comment marker is now scanned.
- Decoded base64 / multi-layer-encoding payloads in `PromptInjectionValidator` are now checked against the full pattern engine instead of a 4-keyword regex.
- New `hasUnvalidatedTail()` helper on the streaming validator — documents the post-stream final-validation contract for connectors.
- CI security audit step now runs `pnpm audit --audit-level=high` as an explicit informational gate (the previous `|| true` suppression remains because `pnpm audit` walks the whole workspace regardless of working-directory, and connector packages depend on third-party SDKs whose upstream advisories we cannot patch). Publish-time audit at the core package's prod-dep tree is the real gate; Dependabot covers routine direct-dep bumps.

### Changed
- Node engine requirement raised to `>=20.0.0`. Node 18 removed from CI matrices (EOL April 2025).
- Coverage thresholds enforced in `vitest.config.ts` (80% lines / functions / statements, 75% branches) per project standard.
- All workspace packages aligned to version `0.3.0`. Wizard package no longer carries the `-deprecated` tag.

## [0.2.0] - 2026-02-17

### Added

#### Core Package (@blackunicorn/bonklm)

**Validators**
- PromptInjectionValidator - Multi-layer prompt injection detection with 35+ patterns across 6 categories
  - Unicode normalization and obfuscation detection
  - Base64 payload detection with decoding
  - Multi-layer encoding detection (up to 5 layers deep)
  - HTML comment injection detection
  - Text normalization with hidden character detection
- JailbreakValidator - Comprehensive jailbreak detection with 44 patterns across 10 categories
  - DAN (Do Anything Now) pattern detection
  - Roleplay and character adoption patterns
  - Social engineering and manipulation detection
  - Multi-turn conversation pattern tracking
  - Fuzzy matching for keyword variations
  - Heuristic behavioral analysis
  - Session risk tracking with decay and escalation
- ReformulationDetector - Detects encoded and obfuscated content
  - Code format injection detection
  - Character encoding detection
  - Context overload detection
- BoundaryDetector - Detects system prompt boundary violations
  - System prompt closing detection
  - Control token detection
  - Whitespace evasion pattern detection
- MultilingualPatterns - Multi-language injection detection
  - Support for 10 major languages
  - Language-specific pattern matching

**Guards**
- SecretGuard - Detects and filters 30+ types of secrets and credentials
  - AWS Access Keys and Secret Keys
  - GitHub tokens (PAT, OAuth, User, Server, Refresh)
  - Slack, Stripe, Google API keys
  - OpenAI and Anthropic API keys
  - Twilio, SendGrid, Mailgun keys
  - Azure SAS tokens, GitLab tokens
  - npm tokens, private keys
  - Database connection URLs
  - Shannon entropy validation for unknown secret patterns
  - Example/placeholder content detection
- PIIGuard - Personally Identifiable Information detection
  - Email addresses
  - Social Security Numbers
  - Credit card numbers
  - Phone numbers
  - IP addresses
  - Custom PII pattern support
- BashSafetyGuard - Bash command injection detection
- XSSSafetyGuard - Cross-site scripting pattern detection
- ProductionGuard - Production-mode content filtering

**Core Components**
- GuardrailEngine - Orchestrate multiple validators and guards
  - Short-circuit evaluation option
  - Configurable validation timeout
  - Session tracking integration
  - Telemetry and monitoring support
- SessionTracker - Track conversation state and risk across multiple turns
  - Pattern finding accumulation
  - Risk level escalation
  - Time-based decay
  - Per-session context management
- HookSandbox - Extensible hook system for custom validation logic
- TextNormalizer - Unicode and text normalization utilities
- PatternEngine - Centralized pattern detection with synonym expansion

**Utilities**
- MonitoringLogger - Enhanced logging with metrics collection
- TelemetryService - Observability and analytics support
- CircuitBreaker - Fault tolerance with circuit breaker pattern
- RetryPolicy - Configurable retry logic
- ConfigValidator - Schema-based configuration validation

#### Framework Middleware

**Express Middleware (@blackunicorn/bonklm-express)**
- Drop-in Express middleware for route-level protection
- Request body validation before LLM calls
- Response body validation after LLM responses
- Path-based inclusion/exclusion filters
- Security features:
  - SEC-001: Path traversal protection
  - SEC-007: Production mode generic errors
  - SEC-008: Validation timeout with AbortController
  - SEC-010: Request size limits

**Fastify Plugin (@blackunicorn/bonklm-fastify)**
- Fastify plugin integration
- Same security features as Express middleware
- Fastify-compatible error handling

**NestJS Module (@blackunicorn/bonklm-nestjs)**
- NestJS module with dependency injection
- Configurable guards as decorators
- Module-based configuration

#### AI SDK Connectors

**OpenAI Connector (@blackunicorn/bonklm-openai)**
- Drop-in wrapper for OpenAI SDK
- Input validation for user messages
- Output validation for completions
- Streaming support with incremental validation
- Complex content handling (images, structured data)
- Security features:
  - SEC-002: Incremental stream validation
  - SEC-003: Buffer size limits (1MB default)
  - SEC-006: Complex message content handling
  - SEC-007: Production mode
  - SEC-008: Validation timeout

**Anthropic Connector (@blackunicorn/bonklm-anthropic)**
- Anthropic SDK wrapper for Claude API
- Full streaming support
- Message validation for Anthropic message format
- Image content handling (vision models)

**Vercel AI SDK Connector (@blackunicorn/bonklm-vercel)**
- Integration with Vercel AI SDK
- Support for generateText and streamText
- Incremental stream validation
- Complex message content support

**LangChain Connector (@blackunicorn/bonklm-langchain)**
- LangChain integration
- Chain-level validation
- Tool call validation

**Ollama Connector (@blackunicorn/bonklm-ollama)**
- Local model support via Ollama
- Input/output validation for local LLMs

**HuggingFace Connector (@blackunicorn/bonklm-huggingface)**
- HuggingFace Inference API integration
- Model endpoint protection

#### Emerging Framework Connectors

**Mastra Connector (@blackunicorn/bonklm-mastra)**
- Mastra framework integration
- Agent input/output validation
- Tool call protection (SEC-005)
- Stream validation support
- wrapAgent convenience wrapper

**Genkit Connector (@blackunicorn/bonklm-genkit)**
- Google Genkit plugin
- Flow input/output validation
- Tool call validation
- wrapFlow convenience wrapper

**CopilotKit Connector (@blackunicorn/bonklm-copilotkit)**
- CopilotKit React integration
- User/assistant message validation
- Action call protection

**LlamaIndex Connector (@blackunicorn/bonklm-llamaindex)**
- RAG (Retrieval-Augmented Generation) protection
- Query engine validation
- Document retrieval validation
- createGuardedQueryEngine wrapper
- createGuardedRetriever wrapper

#### Vector Database Connectors

**Pinecone Connector (@blackunicorn/bonklm-pinecone)**
- Query validation for vector searches
- Retrieved vector content validation
- Metadata filter sanitization
- TopK enforcement
- Filter injection prevention

**ChromaDB Connector (@blackunicorn/bonklm-chroma)**
- ChromaDB collection protection
- Query and result validation

**Qdrant Connector (@blackunicorn/bonklm-qdrant)**
- Qdrant point validation
- Filter sanitization

**Weaviate Connector (@blackunicorn/bonklm-weaviate)**
- Weaviate search protection
- GraphQL query validation

#### Other Integrations

**MCP Connector (@blackunicorn/bonklm-mcp)**
- Model Context Protocol integration

**OpenClaw Adapter (@blackunicorn/bonklm-openclaw)**
- OpenClaw framework integration
- Pre/post action hooks

#### Examples

- Custom validator example
- Multi-validator setup example
- Streaming validation example
- Framework-specific examples (Express, Fastify, NestJS)
- AI SDK examples (OpenAI, Anthropic, Vercel)
- Emerging framework examples (Mastra, Genkit, CopilotKit)
- RAG/vector DB examples (LlamaIndex, Pinecone)

#### Documentation

- Getting started guide
- API reference documentation
- Security guide
- Framework middleware integration guide
- AI SDKs connector guide
- LLM providers connector guide
- Emerging frameworks connector guide
- RAG and vector stores connector guide
- Usage patterns and examples

### Changed

#### Core Architecture
- Framework-agnostic design allows use with any Node.js framework
- Modular package structure for tree-shaking
- TypeScript-first with full type definitions
- ESM-only support (Node.js 18+)

#### Configuration
- Flexible validator/guard configuration
- Production mode for generic error messages
- Configurable validation timeouts
- Buffer size limits for streaming

### Security

#### Security Standards Compliance
- OWASP LLM Top 10 (2025) alignment
- Prompt injection defense (LLM01)
- Output poisoning prevention (LLM06)
- Training data disclosure prevention (LLM05)
- Model denial of service protection (LLM07)

#### Security Features
- SEC-001: Path traversal protection via path.normalize()
- SEC-002: Incremental stream validation with early termination
- SEC-003: Max buffer size enforcement (1MB default)
- SEC-005: Tool call injection protection
- SEC-006: Complex content handling for multimodal messages
- SEC-007: Production mode generic error messages
- SEC-008: Validation timeout with AbortController
- SEC-010: Request size limits

#### Implementation Security
- No unsafe eval or Function constructor
- Input sanitization on all user inputs
- Secure handling of encoded content
- Protection against prototype pollution
- SQL/command injection prevention in guards

### Fixed

- Proper handling of complex message content (arrays, images)
- Stream termination on violation detection
- Memory exhaustion protection via buffer limits
- Timeout handling for long-running validations
- Path traversal in filter expressions (vector DBs)

### Performance

- Optimized pattern matching with regex caching
- Efficient text normalization
- Session tracking with automatic cleanup
- Circuit breaker for fault tolerance
- Configurable retry policies

### Testing

- Comprehensive test coverage for all validators
- Integration tests for all connectors
- Security-focused test cases
- Performance benchmarks

### Dependencies

- Node.js 18.0.0 or higher required
- TypeScript 5.3.3 or higher for development
- No runtime dependencies for core package

### License

MIT License - See LICENSE file for details

[Unreleased]: https://github.com/blackunicorn/bonklm/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/blackunicorn/bonklm/releases/tag/v1.0.0
