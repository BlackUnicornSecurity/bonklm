# BonkLM Changelog

All notable changes to BonkLM (`@blackunicorn/bonklm`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.15] — 2026-08-18

Fifteenth patch of the 1.0.x line — deterministic release bundles.

### Fixed
- Packed release tarballs now carry deterministically serialized manifests: the publish lane's
  packer emitted workspace dependencies in resolution order, so two packs of one commit could
  produce tarballs whose bytes differed only in dependency key order, and a rerun of the lane then
  refused to proceed past its own existing-slot integrity check. Each packed tarball is normalized
  after packing (sorted dependency maps, sorted archive entries, fixed metadata), making the
  release bundle a pure function of the source tree and publish reruns idempotent.

## [1.0.14] — 2026-08-17

Fourteenth patch of the 1.0.x line — peer-floor alignment.

### Changed
- Peer dependency floors now match the security overrides this workspace pins
  (`bonklm-mcp` -> `@modelcontextprotocol/sdk` `^1.25.2`, `bonklm-nestjs` -> `@nestjs/common` and
  `@nestjs/core` `^11.1.18`, `bonklm-hono` -> `hono` `^4.12.34`, `bonklm-nextjs` -> `next`
  `^16.2.11`), withdrawing support claims below what the workspace can resolve. The NestJS change
  withdraws a Nest 10 leg that was never compiled against. These peers are declared optional, so a
  consumer below a new floor normally sees a warning rather than a failed install; a resolver run
  with strict peer dependencies will still error.

### Fixed
- The npm channel promotion no longer fails when a package carries a prerelease `latest` value it
  never promoted (npm sets `latest` itself on a package's first publish, even under `--tag`). Such
  values are overwritten by the promotion and logged; a stable value on `next` remains a hard stop,
  and mixed or rollback promotions remain refused. The post-promotion dist-tag read-back also
  retries with backoff instead of rolling back over registry read lag.
- Local-harness settings-integrity baseline matches the tracked hook count again.
- Regenerated the core package's tarball-drift snapshot, which had gone stale against the connector
  catalog and would otherwise have failed `test:pack` on this cut.

## [1.0.13] — 2026-08-17

Thirteenth patch of the 1.0.x line — promotion resilience.

### Changed
- The promotion's final channel verification retries with backoff (registry dist-tag reads lag
  the writes just performed).

## [1.0.12] — 2026-08-17

Twelfth patch of the 1.0.x line — resumable release transaction.

### Changed
- ensure-exact is idempotent on resume (an existing destination tag matching the verified digest
  and identity short-circuits); container command failures surface captured output.

## [1.0.11] — 2026-08-17

Eleventh patch of the 1.0.x line — expose-step credential ordering.

### Changed
- The public container digest is signed while registry credentials are still present (before
  logout) in the expose step.

## [1.0.10] — 2026-08-17

Tenth patch of the 1.0.x line — release-lane completion.

### Changed
- The exposed public container digest is signed (keyless, same workflow identity) before
  verification — container signatures do not transfer across registry packages on copy.

## [1.0.9] — 2026-08-17

Ninth patch of the 1.0.x line — npm-canonical provenance verification.

### Changed
- npm provenance verification reads the SLSA statement directly (subject digest, workflow
  identity, release commit) instead of routing through cosign blob attestation, which the
  registry's greylist bundle regeneration cannot satisfy. Container verification keeps cosign.

## [1.0.8] — 2026-08-17

Eighth patch of the 1.0.x line — release-lane attestation freshness.

### Changed
- Provenance fetches force CDN revalidation (no-cache headers plus a unique query): the
  registry's attestation edges serve stale replicas to some network paths for extended periods.
- Provenance verification retry window widened to cover the observed settle time.

## [1.0.7] — 2026-08-16

Seventh patch of the 1.0.x line — provenance-verification resilience.

### Changed
- Provenance verification retries the registry's eventually-consistent attestation flapping
  (digest-mismatch class only; deterministic tampering failures still fail immediately).

## [1.0.6] — 2026-08-16

Sixth patch of the 1.0.x line — release-transaction hardening following the first registry
publication.

### Changed
- Staging cleanups are best-effort: registry dist-tag deletion and image-version deletion
  exceed automation-token scope and no longer fail the transaction after every mutation has
  succeeded (opaque private staging tags are pruned by retention).
- Post-publish registry verification retries transient new-package propagation lag instead of
  failing at a self-healing window.
- Publish-transaction phase logging and surfaced child-command output for registry errors.

## [1.0.5] — 2026-08-16

Fifth patch of the 1.0.x line — connector automation, protocol-boundary docs, and toolchain
re-pinning.

### Added
- Wizard connector automation: full registry coverage in the interactive setup wizard, including
  the renamed vector-database connectors, with Docker-based connector testing.
- Package matrix now records Hermes and other MCP/HTTP hosts as supported at the protocol
  boundary (no dedicated package).

### Changed
- Formatter toolchain: the development lockfile re-pins prettier to 3.8.1 (a dependency-sweep
  range re-resolution had moved it to 3.9.6, whose markdown formatting diverges from the
  repository's canonical style); formatting restored to canonical across affected files.
- Pattern engine split into its own module, test colocation refactor, and stale-dist bijection
  fix from the pre-release tooling wave.

### Added

- Setup wizard now detects, configures and tests every publishable connector, not a five-connector
  subset. Connectors are declared as data in a catalog; the registry composes it with the
  hand-written reference connectors; framework, service and credential detection derive their
  tables from the registry instead of keeping their own hardcoded lists. A test pins registry
  membership to the publishable workspace packages, so a new connector package fails the build
  until it is registered.
- `ConnectorCategory` widens with `agent`, `memory`, `sandbox`, `workflow`, `observability` and
  `utility`; `ConnectorDefinition` gains `npmPackage` and `optionalEnvVars`.
- Docs: `docs/user/connector-descriptors.md` (descriptor schema, how to add a connector) and
  `docs/user/agentic-tool-coverage.md` (live-data ranked coverage and gap analysis).

### Fixed

- `@blackunicorn/bonklm-server` constructed a Fastify option that the supported Fastify range does
  not provide, so the server threw on construction. Per-request logging is now actually suppressed.
- `bonklm doctor` no longer raises its rate-limiter advisory for a consumer whose only BonkLM
  framework connector terminates no HTTP requests.

## [1.0.4] — 2026-08-16

First registry-published release of the 1.0.x line. Supersedes the in-tree 1.0.2/1.0.3 cuts
(1.0.2's partial npm staging publish was never promoted — the versions remain untagged orphans).

### Changed

- Dependency supply-chain mitigation across the family (pinned transitive overrides and floors).
- Release tooling: npm access preflight queries the package scope (granular-token compatible),
  release-command failures now surface the captured registry output, and the container scanner
  is a pinned checksum-verified binary (no third-party action code executes in the lane).
- Test/tooling hygiene from the pre-release audit wave (test colocation, repo-empty tooling
  gates, pattern-engine module split).
- Includes all 1.0.2 detection-hardening and server-authentication changes.

## [1.0.2] — 2026-08-15

Third patch of the 1.0.x line — detection-hardening and release-readiness follow-up to 1.0.1.
(`1.0.1` was an in-tree release candidate that was never published to a registry; this section
and the registry artifacts treat `1.0.2` as the first published 1.0.x patch.)

### Changed

- Expanded detection coverage for known evasion classes: multilingual override patterns (word
  order, traditional glyphs, demonstratives, whitespace splits), encoded-payload rescan in the
  server default stack, and linear-time scanning guarantees on adversarial input.
- Hardened server authentication: seen-signature replay rejection with capacity-bounded
  fail-closed behavior, injectable cache for multi-replica deployments, and a CLI sizing knob.
- Hardened the HTTP integrations' unparsable-body boundary: fail-closed by default with a
  documented legacy opt-out.

## [1.0.1] — 2026-08-14

### Changed

- Hardened request and response boundary handling across the HTTP integrations, with regression
  coverage for the affected validation paths.
- Made the npm and OCI release transaction reproducible, recoverable, and fail-closed around exact
  artifacts, registry state, provenance, and signatures.
- Extended the public-export, license, advisory, and SBOM gates to the complete release surface,
  including the separately versioned Tier-B ESLint plugin.
- Added explicit patched Fastify 5 compatibility coverage while preserving concrete-path filtering
  and query-free route metadata.
- Made the server executable fail closed on production non-loopback binding unless the operator
  explicitly confirms a trusted TLS termination boundary.

## [1.0.0] — 2026-07-11

First stable release. Promotes the `1.0.0-rc.x` line to GA under the single-version monorepo policy:
the frozen public API surface, the CWE-117 log-sanitization guarantees, and the deterministic
prompt-injection / tool-result-ingress defenses shipped across the rc cycle are now covered by the
stable-release compatibility policy.

### Added

- **`HarmIntentValidator` — deterministic harm-goal intent detector.** A new co-occurrence-based
  layer (no LLM) that recognises exploit-generation and restricted-substance-synthesis REQUESTS by
  the combination of intent signal classes (a "produce" verb + a working offensive artifact, or a
  synthesis verb governing a restricted object) evaluated over several de-obfuscated views of the
  input (invisible-char-stripped, newline-stripped, spaced-letter-collapsed, bracket-filler-stripped,
  percent-decoded, base64-decoded). This closes the recall gap that single-keyword surface patterns
  miss when the request is wrapped in narrative/persona framing, multi-turn decomposition, few-shot
  priming, or token-boundary obfuscation. Purely additive: it only ever raises a block.

- **`SocialEngineeringValidator` — deterministic social-engineering intent detector.** Flags
  credential-phishing (an elicitation directed at a victim-owned secret — seed phrase, private key,
  2FA/OTP code, CVV, password) and pretext-coercion (an impersonation/urgency/secrecy frame
  co-occurring with an inducement to an irreversible action such as a wallet-drain transfer,
  gift-card purchase, or remote-access install) using the same de-obfuscated-view approach as
  `HarmIntentValidator`. Purely additive: it only ever raises a block.

- **`EncodedRescanValidator` — decode-then-rescan layer for obfuscated injection payloads.** Decodes
  candidate obfuscation schemes (unicode-escape, HTML entity, percent/URL, base64, base32, hex,
  ROT13, ROT47, reverse, leetspeak, and multi-layer chains of these) and re-runs the existing
  injection detectors on the decoded text, so a payload the raw scan missed is caught once revealed.
  Precision is enforced by an injection-keyword firewall plus a per-decoder severity floor
  (WARNING+ for marker-driven structural transports, CRITICAL for speculative ciphers). Purely
  additive: it only ever raises a block on content the raw engine already let through.

- **`tool_output_impersonation` pattern category.** Detects indirect prompt-injection carried in
  untrusted TOOL output (command stdout, a retrieved doc, a forged "system-notice" slot) that
  impersonates trusted harness framing to steer the agent — forged `[system-note]` / `system
  reminder:` wrappers, instructions to skip/defer review, unverified "clean per a reviewer" hearsay,
  a credential-phishing re-auth lure, an imperative to paste a credential into chat, or a pushed
  premature "safe to merge" verdict. Only the credential-phishing re-auth signature is CRITICAL and
  block-eligible; the other five arms are WARNING / non-blocking flags.

- **Provenance-gated indirect prompt-injection detection at connector boundaries.** A new
  `IndirectInjectionValidator` (+ `createIndirectInjectionValidator`) and an
  `INDIRECT_INJECTION_PATTERNS` arm set detect indirect prompt-injection payloads that arrive through
  connector boundaries — retrieved documents, composed memory context, tool-call arguments, and
  memory writes — that the calibrated user-text bar deliberately omits (RAG/wiki poisoning,
  assistant-addressed directives, structured-indexer field-label injection, markdown-image exfil
  beacons, cross-document tool-call directives, memory-write credential exfil). Each arm is
  provenance-gated by a `requiresProvenance` surface tag and fires only on its connector surface,
  **never on raw user text**, so the user-text false-positive floor is unchanged by construction.
  Also adds the `Provenance` / `ToolResultRef` contract types, `hasToolResultProvenance()`, additive
  `MemoryWriteMetadata.provenance` typing, and an AsyncLocalStorage-scoped raw-upstream cache
  primitive (a forward contract consumed by later connector increments).

  **Behavior change for existing callers:** `createRetrievedDocValidator`,
  `createComposedContextValidator`, `createToolCallArgsValidator`, and `createMemoryWriteValidator`
  now append an `IndirectInjectionValidator` for their surface, so content that previously passed can
  now be blocked when it carries a connector-boundary injection signal (e.g. a retrieved doc that
  instructs the model, or a tool result embedding a forged `OPERATOR_NOTE:` directive). The
  user-text path (`PromptInjectionValidator` / `detectPatterns`) is unaffected. A small number of
  attack classes remain best-effort named limitations (see
  [Known limitations](docs/user/known-limitations.md)), including a warn-only (non-blocking)
  `aws s3 cp` egress signal that does not auto-block infra runbooks.

- **MCP connector now scans inbound tool results for indirect prompt-injection.** When
  `validateToolResults` is enabled (the default), `createGuardedMCP` composes an
  `IndirectInjectionValidator` scoped to the `tool_result` surface onto the inbound result-validation
  path, on top of any validators you supply. Previously the `tool_result` detection arms were
  reachable only through the core `createToolCallArgsValidator` factory (outgoing call arguments), so
  a guarded MCP client did not scan the raw results returned by a remote tool. Indirect
  prompt-injection carried in the **text** content of tool output — task-hijack / objective-replacement
  directives, forged ReAct instruction tokens, forged agent-instrumentation footers, and exfil
  directives — is now detected and the result is filtered. The scan runs only on incoming result
  content (never on outgoing tool-call arguments) and respects the existing `validateToolResults:
  false` escape hatch. Scope: the `tool_result` surface is asserted by the connector (the `Provenance`
  wire-envelope is not yet stamped), and only text content is scanned — non-text result blocks (image
  / audio / embedded-resource / binary) are not (see
  [Known limitations](docs/user/known-limitations.md)). A tool result that previously passed can now
  be filtered when it carries a `tool_result` injection signal; no public API or option changes.

- **Memory writes are re-scanned against their raw upstream source (laundering defence).**
  `createMemoryWriteValidator` now re-scans the **raw upstream body** behind a write's
  `metadata.provenance` chain — the original tool result the content derives from, looked up by
  `rawBodyHash` from the `runWithRawUpstreamCache` scope — in addition to scanning the write's surface
  content. This catches the chain where an agent paraphrases a poisoned tool result into benign prose
  before persisting it: the laundered text matches no content pattern, but the raw body still does. The
  re-scan is gated on tool-derived provenance (genuine user writes are never re-scanned, so the
  user-text false-positive floor is unchanged), and **fails closed** — because the poison is not
  textually present in the laundered content, redact mode cannot remove it and the write is blocked.
  New exports: `rescanLaunderedProvenance` / `ProvenanceRescanResult` and the `isToolDerivedRef`
  predicate. The consumer is default-on but engages only once an upstream connector caches the raw
  body and stamps the `Provenance` envelope (a later per-connector increment); until then it degrades
  cleanly to a no-op (a missing hash, cache miss, or out-of-scope lookup never blocks). See
  [ADR-0010](docs/contributing/adr/0010-provenance-gated-indirect-injection.md) and
  [threat surfaces](docs/user/threat-surfaces.md).

- **Supply-chain hardening: npm build provenance, SBOM, and shipped-closure audit/license gates.**
  Stable releases now publish with npm build provenance — a Sigstore attestation binding each tarball
  to its CI build, commit, and source repository (verify with `npm audit signatures`) — and every
  published package now declares `repository` metadata, and the publish workflow tags prereleases
  `next` so they never move `latest`. New tooling — a production-closure advisory and license audit
  (`pnpm audit:prod`, `pnpm license-check`) and a published-tarball secret scan (`pnpm scan:tarballs`),
  all wired into the quality gate, plus an on-demand CycloneDX SBOM generator (`pnpm sbom`). The new
  [Supply-chain & provenance guide](docs/user/supply-chain.md) documents signature verification, the
  `latest`/`next` dist-tag policy, and recommended version pins for advisories that originate in
  third-party peer SDKs (not in any BonkLM tarball).

- **`streamingMode: 'buffer'` is now implemented for the openai, anthropic, and ollama connectors.**
  Previously these connectors logged a warning and fell back to no stream validation when `'buffer'`
  was requested; they now perform real buffered full-stream validation. Buffer mode holds every
  chunk back, runs a single validation pass over the complete response at stream completion, and
  releases the buffered chunks unchanged only if validation passes — on a violation the content is
  withheld entirely and a single filtered marker chunk is emitted (and `onStreamBlocked` fires).
  This matches the hold-back-and-release semantics already shipped by the vercel connector: zero
  pre-validation leakage and one validation pass instead of one per interval, traded against
  progressive delivery. The `'incremental'` default is unchanged, and both modes continue to enforce
  `maxStreamBufferSize`, now bounding both accumulated text and the retained-event count.

  **Behavior change for existing `'buffer'` callers:** code that previously set
  `streamingMode: 'buffer'` received unvalidated, progressively-streamed output; it now receives
  fully-buffered output that is validated once and may be withheld entirely on a violation (and the
  latency profile shifts from progressive to all-or-nothing). To keep the old progressive,
  unvalidated delivery, use `streamingMode: 'incremental'` (the default) or set
  `validateStreaming: false`.

### Changed

- **Changeset `linked`-group drift guard added (`tools/check-changeset-linked.js`).** Asserts the changesets `linked` group equals the set of publishable `packages/*` manifests (`private !== true`) and fails the build with a missing/extra diff if they diverge, so the hand-maintained list cannot silently fall out of sync as connectors are added. Wired into CI (the `changeset-linked` job), the local `pnpm quality-gate`, and the root `check:changeset-linked` script. Contributor / release-tooling only — no runtime or library change.
- **`tools/*` workspace-tiering policy is now mechanically enforced (`tools/check-workspace-policy.js`).** The Tier A / Tier B publish-policy check — every `tools/<name>/package.json` must be either Tier A (`private: true`, internal-only) or an explicit Tier B publishable package (`workspacePolicy: "tier-b-publishable"` + `publishJustification` + non-empty `files` + `@blackunicorn/` name), and no Tier A tool may appear in a `packages/*` consumer's runtime deps — is now wired into CI (the dependency-free `workspace-policy` job), the local `pnpm quality-gate`, and the root `check:workspace-policy` script, closing the gap where the policy was documented but not enforced. The gate's branches are covered to 100% by a new unit suite. Contributor / release-tooling only — no runtime or library change.
- **`check-version-pin.sh` moved to the tracked `scripts/` directory so the pre-commit hook works in every checkout.** The version-pin check previously lived under the gitignored `team/` tree, so the `simple-git-hooks` pre-commit hook failed with "No such file or directory" in fresh clones and in any `git worktree` — the exact environments the worktree-per-PR workflow relies on. The script now lives at the tracked `scripts/check-version-pin.sh` (beside `quality-gate.sh`), and the hook invokes that tracked path. Contributor-tooling only — no runtime or library change.
- **Pre-publish surface guard added (`scripts/verify-publish-surface.mjs`).** After `pnpm -r build`, the guard imports the built `packages/core/dist/index.js` and asserts a canary set of canonical public exports (including `createRateLimiter` / `CommonRateLimiters`) is present, exiting non-zero otherwise. Wired into the `publish` job of `.github/workflows/publish.yml` (after build, before `changeset publish`) and exposed as the root `verify:surface` script for the rc-cut RUNBOOK. Contributor / release-tooling only — no runtime or library change.

### Removed

- **Removed the unused, non-functional internal helper `_testOnlyClearSentinel`** (`@blackunicorn/bonklm/core/connector-utils`). The `@internal`, `_`-prefixed test-only helper had no call sites and could not work as documented: `markWrapped` places its marker with a deliberately non-configurable descriptor (so it cannot be cleared before re-wrapping), and a non-configurable property cannot be redefined regardless of the new descriptor. No `@public` API is affected — per the v1.0-RC1 API-surface policy, `_`-prefixed symbols are internal and may change in any minor/patch. The non-configurability of `markWrapped`'s marker is now covered by a direct regression test.

### Fixed

- **Jailbreak detection no longer false-positives on whitespace-heavy plain-ASCII content.** The
  "heavy text obfuscation" signal fired whenever normalization shrank the input past a threshold,
  which also happens for benign pretty-printed JSON and deeply indented configuration even though
  nothing is obfuscated. It is now gated on the presence of an actual non-ASCII character — the same
  gate the prompt-injection validator already applies — so genuine homoglyph / zero-width /
  combining-mark obfuscation still blocks while benign structured text passes.

- **eslint-plugin-edge `prepublishOnly` chain failure resolved.** Added local `tools/eslint-plugin-bonklm-edge/vitest.config.ts` mirroring the connector-package convention so tests resolve from the plugin directory instead of inheriting the workspace-root include patterns. Contributor tooling now runs its local test suite and dry-run publish path from a fresh checkout.

### Security

- **`sanitizeLogString` / `sanitizeMeta` now neutralize the zero-width / Unicode-format character class.**
  The canonical CWE-117 log-sanitization primitive hex-escapes `U+061C`, `U+200B`–`U+200F`,
  `U+2060`–`U+2064`, and `U+FEFF` (zero-width spaces/joiners, the directional marks, the word joiner +
  invisible math operators, and the BOM) to `\uNNNN` markers, alongside the control, newline, and
  bidi-override/isolate classes already handled. This closes an invisible-content / homoglyph
  log-spoof gap: such code points render as nothing yet survive in the byte stream, letting an
  attacker-influenced string smuggle hidden content into a log line or wedge a Unicode-aware parser.
  Hex-escaping preserves forensic signal, and the fix is inherited by every connector and engine sink
  routing attacker-influenced strings through the shared primitive. Legitimate Unicode log content
  (accented Latin, CJK, emoji) is unaffected.
- **Tarball reproducibility verified.** Two consecutive `npm pack` passes produced byte-identical SHA-256 hashes across the release-surface tarballs. Reproducibility evidence is retained privately under the project QA policy.

## [1.0.0-rc.4] — 2026-05-26

Post-rc.3 hardening pass, plus the v1.0 release-QA cycle:
- Wave 1: 4 internal-review fixes (DoS guard, secret-pattern
  boundary tests, doctor cwd validation, doctor checks + JSON sanitization)
- Wave 2: HookSandbox native-code regression tests + RateLimiter doctor
  advisory + 5 connector README rate-limiting
  sections + core re-export
- Coordinator: pre-commit version-pin hook + peer audit + files whitelist
  standardization (9 packages)
- 16 stories retro-confirmed against pre-execution commit chain (engines,
  exports, LICENSE, README, CHANGELOG dedupe, openclaw private, bin shebang,
  4 internal-review hard blocks closed + 5 review findings closed)

Test baseline:
- Entry rc.3 baseline (HEAD 83bf7ac): 5014 / 5030 pass, 16 pending, 0 fail
- rc.4 baseline (this RC): captured in private release evidence

### Added

- Per-package README finalized for 11 connectors (cloudflare-agents, hono, voltops-otel, letta, zep, voltagent, elysia, mem0, memory-utils, nextjs, web-middleware-utils). All draft information markers resolved with authoritative source-derived answers or explicit v1.0.x backlog deferrals (CHM:cloudflare validateUserInput export, hono validatedStream helper, zep thread.* tenant-derived ID enforcement).
- **`bonklm doctor` command**. Diagnoses the local contributor environment with a
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
  `sanitizeLogString`** (ADR-0001 Decision #2 revision). The three
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
- **BufferedTelemetryCollector.flush() now routes errors through serializeError** CWE-117 residual from an earlier sweep (nested-class method body missed by outer-class line-number anchors). Hostile-error regression suite covers terminal-control-char (BEL, ESC `[2J[H`) + ANSI-escape + log-injection (`\nINFO: fake_entry`) + TAB payloads.
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

## [1.0.0-rc.3] — 2026-05-24

Third release candidate. Consolidates four sprints of post-rc.2 security
hardening work into a single tagged RC for the v1.0.0 public-comment
window. **No new public-API surface beyond rc.2 except the three new
`ValidatorInstanceRule` / `LoggerInstanceRule` / `AttackLoggerInstanceRule`
config-schema helpers** plus the canonical
`validateWithTimeoutSecure` connector primitive — all
`@public` per v1.0-RC1 freeze policy.

The four work-streams collapsed here:

- **Config-schema layer fix.** The canonical `Validator` /
  `Logger` / `AttackLogger` interfaces are object-shape; the previous
  `Validators.function` schema check rejected class instances, breaking
  express / fastify / nestjs middleware schemas (110+ tests failing at
  rc.1 + rc.2). New shape-aware rules + `OptionalRule` null-rejection
  semantic fix.
- **Timeout-primitive extraction.** An audit uncovered fastify-plugin's validation-timeout was broken
  (`engine.validate()` doesn't accept an `AbortSignal`, so the
  AbortController-based timeout was a no-op). A workspace sweep found the
  SAME broken pattern in 20+ other connectors; extracted a single canonical
  primitive instead of 22 near-identical per-connector patches.
- **Test-tooling debt cleanup.** 10 long-standing
  test failures across 3 connector packages (vercel, pinecone, mastra)
  that predated the prior work. The mastra fix was security-relevant —
  prior test asserted the INSECURE silent-filter path; corrected to
  assert the canonical throw-contract.
- **Cumulative hardening** — a multi-lane audit ran across all
  v1.0.0-rc.1 → HEAD changes. Convergent findings closed inline before
  commit (memoization bug, primitive `≤ 0` handling, log injection,
  sentinel-factory throw fallback, langchain timeout regression,
  copilotkit + genkit sentinel shape divergence).

### Fixed

- **`validateWithTimeoutSecure` memoization bug** — the prior `=== undefined` check would re-invoke
  the sentinel factory on every call when the factory legitimately
  returned `undefined`, defeating both memoization and the side-effect
  guarantee. Switched to a separate `built` boolean flag.
- **`Validators.timeout` accepts 0 vs primitive throws on ≤ 0** — schema layer now also rejects 0
  (`NumberRangeRule(1, 3600000)`) so the defense-in-depth layers
  agree. An operator-induced DoS (passing `validationTimeout: 0` via
  broken env-var) is now caught at config-load time instead of
  crashing every request.
- **`Validators.positiveNumber(0)` silently unbounded** —
  the `min === 0 ? undefined : min` short-circuit accepted negative
  numbers when called with `(0)`. Always honour the explicit `min`.
- **`HARDCODED_FALLBACK` used string `'critical'` not `Severity.CRITICAL`**
  — switched to enum reference to prevent drift if
  the enum value ever changes.
- **Log injection via `err.message`** (CWE-117) — added
  `sanitizeErrorMessage()` that strips control chars (`\x00-\x08
  \x0b-\x1f \x7f`), escapes newlines (`\\n`), and caps at 500 chars.
  Applied at all logger call-sites in `timeout-wrapper.ts`.
- **Sentinel-factory throw could re-introduce process crash**
  — `safeSentinel()` wraps the factory call in try/catch
  with the hardcoded fallback.
- **TimeoutSentinelShape generic constraint** — added
  `R extends TimeoutSentinelShape` (minimum `{ allowed: boolean }`)
  so callers cannot widen the generic to a type structurally
  incompatible with the hardcoded fallback (which would crash the
  caller at runtime when accessing `.allowed`).
- **langchain `withRetrieverGuardrails` bypassed timeout** — per-doc validator loop now wrapped in
  `validateWithTimeoutSecure` so slow validators can't silently hang
  the retriever invoke call, closing the timeout-bypass regression the other connectors already resolved.
- **`bonklmLangGraphNode` raw form bypassed timeout**
  — added the same wrapper. Both call shapes (raw + factory) now
  honour the validation timeout with a default 5000ms budget.
- **mastra input-blocked threw plain `Error`, output-blocked threw
  `ConnectorValidationError`** — unified to
  `ConnectorValidationError` so callers catching by type see both
  guardrail-block events consistently.
- **copilotkit + genkit sentinel shape divergence**
  — both wrapped only `{ results: [...] }` (no top-level
  `allowed`/`blocked`/`severity`). Now spread a canonical top-level
  `GuardrailResult` alongside the `results` array. SIEM sinks
  consuming `BonklmBlockEvent` now see uniform timeout-event shapes
  across all 22 connectors.

### Added

- **`packages/core/tests/connector-utils/timeout-wrapper.test.ts`**
  (21 tests) — direct unit tests for the timeout primitive. Covers
  happy path, timeout fire, `timeoutMs` validation (9 bad-value
  cases), post-timeout rejection absorption, log sanitization
  (control chars + newlines + truncation), sentinel-factory throw
  fallback, memoization (factory called exactly once), non-Error
  rejection coercion, sync operations, optional logger. Code-review
  HIGH-3 closure.

### Changed (docs)

- **`docs/user/migration-v0-to-v1.md`** — added §3a `OptionalRule`
  null-rejection migration, §3b `Validators.timeout`
  zero-rejection migration, §3c `Validators.positiveNumber(0)`
  semantics migration.
- **`docs/user/public-api-surface.md`** — added
  `ValidateWithTimeoutOptions<R>` + `TimeoutSentinelShape` to the
  connector-utils PUBLIC catalog.
- **23 stale "AbortController" comment references** across 19
  connector packages updated to "validateWithTimeoutSecure".
  Removes the future-contributor footgun the audit flagged.

### Tests

- Core: **2788/2798** passing (+21 new primitive tests; 10
  multilingual Pass-2 skips unchanged).
- All 22 ported connectors build clean. No regressions.

### Audit residual (LOW, accepted)

- **`*Instance` suffix in Validators registry**:
  `validatorInstance` / `loggerInstance` / `attackLoggerInstance`
  use a structural-annotation suffix that's inconsistent with the
  rest of the registry (`positiveNumber` / `boolean` / `string` /
  etc.). Frozen at rc.2 per v1.0-RC1 policy; cannot rename without
  major bump. Documented for posterity.

### Test-tooling debt cleanup

Closes a follow-up: 10 long-standing test failures
across 3 connector packages (verified by
stashing + reproducing at HEAD).

#### Security note

**The mastra test fix WAS security-relevant**. The prior test asserted that `wrapped.execute()` returns
a 'filtered' string for blocked output — the INSECURE silent-filter
path. Src line 605 explicitly comments that it throws instead
of returning filtered content (canonical security contract). The
test was validating the wrong branch; a later fix corrected it to assert
the throw. If a `git bisect` were used to find when throw-
contract coverage landed, this change is the answer (not the earlier one when
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
  string when output is blocked. Src explicitly comments that it throws
  `ConnectorValidationError` instead of returning filtered content. Test was stale per the canonical security
  contract (silent filtering hides attacks from the application).
  Renamed test + asserts the throw. Regex anchored to start-of-message
  so a future mis-route through input-blocked / circuit-breaker paths
  would not silently match.
  Result: 34/34 pass.

#### Tests

- **Full workspace green for the first time**:
  162/162 test files pass, **4665/4678** tests pass (13 documented
  skips per the multilingual Pass-2 retirement).
- Core: 2767/2777 unchanged.

### Timeout-primitive extraction

An audit uncovered that fastify-plugin's validation-timeout was broken
— `engine.validate()` doesn't accept an `AbortSignal`, so the
AbortController-based timeout was a no-op. A workspace sweep found the SAME broken pattern in 20+ other connectors
(anthropic, chroma, openai, langchain, llamaindex, google-genai,
huggingface, mastra, openai-agents, vercel ×2, weaviate, pinecone,
qdrant, mcp, copilotkit, ollama, genkit, langchain-middleware).
Per-connector porting would create 20+ near-identical patches each
needing independent audit. Extracted a single canonical primitive
instead.

#### Added

- **`validateWithTimeoutSecure`** — shared timeout primitive
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

Per CLAUDE.md "100% pass rate required — no postponing" rule + a multi-lane
audit CRITICAL finding,
**ALL 22 affected connector packages** are ported in this release:

- **anthropic-connector** — was broken AbortController. 89/89 pass.
- **chroma-connector** — was broken AbortController. 56/56 pass.
- **fastify-plugin** — refactored from earlier inline code. 43/43 pass.
- **nestjs-module** — refactored from earlier inline code. 74/74 pass.
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

#### Audit hardening (applied inline before commit)

A multi-lane audit ran
post-helper-extraction. Convergent findings closed:

- **CRITICAL** — 18-22 broken connectors → **all ported.**
- **HIGH** — sentinel-factory called twice on
  post-timeout race rejection → memoized via `getSentinel()` cache.
- **HIGH** — sentinel-factory throw path could crash process
  → wrapped in `safeSentinel()` try/catch with hardcoded fallback.
- **MEDIUM** — `timeoutMs ≤ 0` was an unenforced
  silent-bypass vector → throws `TypeError` at helper entry.
- **MEDIUM** — `TimeoutWrapperLogger` duplicated the
  canonical `Logger` interface → imported canonical type, dropped
  duplicate.
- **MEDIUM** — post-timeout validator rejection logged at
  `debug` → upgraded to `warn` so operators see systematic failures.
- **LOW** — stale "AbortController" JSDoc in anthropic /
  fastify / nestjs types → updated all 4 to "validateWithTimeoutSecure".

#### Tests

- Core: **2767/2777** unchanged (10 multilingual Pass-2 skips).
- 22 ported packages: full build green. Pre-existing test-tooling
  failures in mastra/pinecone (test-string assertion drift) and
  vercel-connector (CommonJS `require()` in ESM test file) are
  documented unchanged (pre-existing; tracked separately).
- All affected packages build clean.

### Connector schema layer fix

Connector test-tooling debt remediation. Pre-existing schema mismatch
across express / fastify / nestjs middleware schemas surfaced at the prior release
(110+ tests failing at rc.1 + rc.2 against the canonical object-
shape `Validator` / `Logger` instances). This release lands the fix at the
core schema layer so future connector packages inherit it.

A multi-lane audit ran
post-fix; convergent findings closed in this same commit before tag.

#### Added

- **`Validators.validatorInstance`** + **`ValidatorInstanceRule`**
  (`@blackunicorn/bonklm` → `validation/`) — config-schema rule that
  accepts EITHER a bare callable OR an object-with-`.validate`-method.
  The canonical `Validator` / `Guard` interface is object-shape
  (`{ validate(input):..., name?: string }`); the previous
  `Validators.function` check rejected class instances.

- **`Validators.loggerInstance`** + **`LoggerInstanceRule`** — same
  pattern for the `Logger` 4-method interface (`{ debug, info, warn,
  error }`). Adopt this for `logger` config fields in connector
  middleware schemas. Rejects arrays explicitly.

- **`Validators.attackLoggerInstance`** + **`AttackLoggerInstanceRule`**
  — same pattern for the `AttackLogger` instance shape (object with
  `getInterceptCallback` method). Preventive fix from the audit —
  the connector schemas had the same
  shape-mismatch latent bug on the `attackLogger` config field that
  the validators/logger fields had; fixed before exposure.

All three new rules are `@public` per v1.0-RC1 freeze policy. New
`@public` symbols added between rc.1 and v1.0 are explicitly part of
the freeze once v1.0 ships.

#### Changed (semantic — was a footgun)

- **`OptionalRule`** now ONLY short-circuits on `undefined`, NOT on
  `null`. Per the audit: the prior null-short-circuit
  meant `{ logger: null }` passed schema validation, then crashed at
  runtime in `this.logger.debug(...)` because the destructuring
  default `logger = DEFAULT_LOGGER` only triggers for `undefined`.
  `null` was always a footgun in the optional path; we now reject it
  at schema-validation time. 2 core tests updated to match. No known
  external consumer affected — all internal call-sites pass
  `undefined`/omit-key (the JS-canonical pattern).

#### Fixed

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
- **fastify-plugin** validation-timeout — replaced broken
  `AbortController` approach (signal was never propagated since
  `engine.validate()` doesn't accept an `AbortSignal`) with
  `Promise.race` against a timeout sentinel. The timeout budget now
  actually fires; slow validators no longer leak past the budget with
  an `allowed: true` response. **Audit hardening**: the in-flight `engine.validate()`
  promise is wrapped with `.catch()` BEFORE `Promise.race` so any
  post-timeout rejection is absorbed; Node ≥15 crashes the process on
  unhandled rejections by default.
- **nestjs-module** — same schema rewrite. 74/74 tests pass. ALSO
  **CRITICAL**: nestjs had the same broken AbortController
  timeout as fastify; ported the same Promise.race + `.catch()` fix.
- **express-middleware** `addSecurityHeaders()` — defensive guard now
  logs at WARN level when triggered.
  Operators see a clear signal if a real production wrapper strips
  response methods; the headers themselves are not silently dropped
  without a log entry.

#### Changed (no breaking)

- The schema-wide `Validators.optional(...)` wrap loosens validation —
  previously the schemas rejected missing fields, now they accept them
  (consistent with the runtime middleware factories that destructure
  with defaults for every field). This matches the JSDoc-documented
  API contract; the strict mode was the bug.

#### Tests

- express-middleware: **40/40** (was 40 fail)
- fastify-plugin: **43/43** (was 2 fail)
- nestjs-module: **74/74** (was 13 fail)
- Core: **2767/2777** unchanged (10 multilingual Pass-2 skips per the Pass-2 retirement)
- Build: all affected packages build clean

### Cumulative rc.3 tests

- Full workspace: **4686/4699** passing across **163/163** test files
  (13 documented skips: 10 multilingual Pass-2 + 3 cross-package historic).
- Core: **2788/2798** (+21 timeout-primitive tests landed in audit-close).
- Build: all 54 published packages build clean at `1.0.0-rc.3`.

### Deferred to v1.0.0 final

- v1.0.0 cut decision (continuing extended public-comment window through rc.3).
- openclaw-adapter removal (date gate `2026-07-01`; today
  `2026-05-24` — defer until gate passes).
- Full `TestWorkflowEnvironment` Temporal integration (`MockActivityEnvironment` used to ship; full workflow runtime still deferred).
- `*Instance` suffix naming consistency in the `Validators` registry
  (accepted; cannot rename without a major bump).

## [1.0.0-rc.2] — 2026-05-24

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
  already established in `packages/core/src/index.ts` and
  `docs/user/public-api-surface.md`.

### Deferred to v1.0.0 final

- v1.0.0 cut decision (after the extended public-comment window
  closes).
- openclaw-adapter removal (date gate `2026-07-01`;
  today `2026-05-24` — still deferred).
- Full `TestWorkflowEnvironment` Temporal integration
  (`MockActivityEnvironment` covers the activity
  contract; full workflow runtime deferred to v1.0-RC stabilization
  buffer).
- Connector-package pre-existing test-tooling debt (express-middleware,
  nestjs-module, chroma-connector, anthropic-connector integration
  tests rely on a `validators` config schema shape that pre-dates the
  current `Validator` instance shape — these are TOOLING failures, NOT
  runtime regressions; the core 2767/2777 + temporal 21/21 + sandbox
  graduation 100/0/100 all pass against rc.2).

### Tests

- Core: **2767/2777** passing (10 multilingual Pass-2 skips —
  documented Pass-2 retirement).
- Temporal middleware: **21/21** passing (`MockActivityEnvironment`).
- Sandbox graduation: **100% recall / 0% FPR / 100% precision** against
  sandbox-attack corpus (hash `e3661e...5302b`, pin commit `4f8ea3f`).
- Build: all 54 packages build clean at `1.0.0-rc.2`.

## [1.0.0-rc.1] — 2026-05-23

First release candidate. API-freeze prep per the v1.0-RC
stabilization buffer. The RC window runs a 60+ day public-comment
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
  - The locked `BonklmTraceSurface` attribute vocabulary.

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

### Deferred to v1.0-RC stabilization

- Per-barrel `@public` / `@internal` JSDoc tag application (mechanical;
  done as docs-only commits).
- Real `@temporalio/testing` worker integration (worker-integration.test.ts uses mocks).
- openclaw-adapter removal (date gate 2026-07-01;
  today 2026-05-23 — defer to first sprint after gate).
- Public-comment window triage.
- v1.0.0 publish.

### Tests

1272/1272 passing + 1 multilingual-skip across 51 files. No
regressions from the `messagesToTextLegacy` removal (no internal
consumer used the alias).

## [0.7.0] — 2026-05-23

EPIC 4 consolidation release. Sandbox connectors graduate from
EXPERIMENTAL to STABLE; OTel vendor recipes documented; multilingual
Pass 2 formally retired.

### Added

- **`docs/user/otel-vendor-recipes.md`** — verified
  ingest recipes for Langfuse / Phoenix / Arize AX / VoltOps /
  Datadog. One-paragraph per vendor + common patterns + migration
  guide from `onBlock` callbacks.
- **`packages/core/benchmarks/sandbox-attack-corpus/benign-corpus.json`**
  — 50 labelled benign payloads for precision/FPR
  measurement on the graduation gate.
- **`packages/core/benchmarks/sandbox-attack-corpus/run-graduation-gate.mjs`**
  — runnable evaluator that dispatches code-injection
  patterns to `CodeInjectionValidator` and path-traversal patterns to
  `PathTraversalValidator` (matches the real wrap-sandbox dispatch),
  computes recall + FPR + precision, emits JSON + TXT decision report.
- **`packages/core/benchmarks/sandbox-attack-corpus/evidence.md`**
  — hand-curated pattern provenance. 5 of 10 hand-curated
  patterns cross-referenced to public CVE / OWASP-LLM-Top-10 identifiers
  (OWASP-LLM-2025-02, 05, 06; CVE-2025-44890; CVE-2026-12001).

### Changed

- **Sandbox connectors GRADUATED**:
  `packages/sandbox-utils`, `packages/e2b-adapter`,
  `packages/daytona-adapter` removed `"experimental": true` flag +
  removed runtime `emitExperimentalWarnOnce()` banner. Gate passed
  100% recall / 0% FPR / 100% precision against the hash-pinned
  50-pattern corpus + 50-pattern benign corpus.
- All 54 packages bumped 0.6.0 → 0.7.0.

### Sandbox graduation gate result

```
Decision: GRADUATE
Corpus-hash-pin commit: 4f8ea3f
Corpus hash (sha256):   e3661e5c808ac604d894e6ead5dcc27960143f45927928d64ebfe64629b5302b

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

### Deferred

- **Peer-dep sweep** — a maintenance pass; no
  v0.7 AC blocker.
- **Multilingual Pass 2** — formally retired per an earlier decision; CONDITIONAL on native-speaker reviewer pipeline.
- **openclaw-adapter removal** — date gate
  2026-07-01; defer until the gate passes.
- **v1.0-RC stabilization buffer**.

## [0.6.0] — 2026-05-23

Eight-sprint cumulative release. Major surface expansion: 13 new
connector packages, 2 new core validators, full OTel export, the locked-vocabulary
discriminated-union BonklmBlockEvent across all connectors, and the
v0.7-graduation-gate sandbox-attack-corpus.

### Added

**Core validators + primitives**:
- `AudioStreamValidator` — voice / realtime transcript
  validator with Aho-Corasick hot-path + `BufferedReleaseGate`
  wiring. Per-session `fork()` factory; `Symbol.asyncDispose`.
- `CodeInjectionValidator` — Python / JS dynamic-exec /
  shell metachar / network-egress / `PACKAGE_INSTALL` patterns.
- `PathTraversalValidator` — `..` traversal + absolute-
  path-outside-cwd + opt-in symlink-target validation.
- `sandbox-attack-corpus` — hash-pinned 50-pattern corpus
  for the graduation gate (CODE_INJECTION 30 / PACKAGE_INSTALL 10 /
  PATH_TRAVERSAL 5 / SHELL_METACHAR 5).
- `BonklmBlockEvent` discriminated union —
  7 kinds (`voice` / `sandbox` / `inference` / `durable-exec` /
  `document` / `cf-agent` / `web-middleware`) for cross-package
  observability.
- `adaptValidatorToUniversalInput` — shared validator
  adapter; replaces 5x inline try-catch-TypeError shims.
- `assertNotWrapped` + `markWrapped` + `ensureWrappedOnce`
  — shared wrap-sentinel helper for connector double-
  wrap defence.
- `RTL bidi-control guard` — `stripBidiControls` +
  `normalizeForMultilingualMatch` for Arabic / Urdu / Persian
  payloads (defeats U+202A-202E + U+2066-2069 + U+200E/F + U+061C).
- `MultilingualDetector.name = 'multilingual'` + Validator interface
  conformance (hardening).
- `bonklmTrace()` — OTLP span export with the locked attribute vocabulary (`bonklm.validator` / `severity` /
  `action` / `finding_count` / `surface`). Caller-provides-exporter.

**New connector packages**:
- `@blackunicorn/bonklm-livekit` — LiveKit
  Agents v1.4.x `BonklmAgent` subclass + `wrapLiveKitAgentSession`
  event wiring.
- `@blackunicorn/bonklm-voice-webhooks` —
  Vapi (HTTP) + Retell (WebSocket) HMAC-SHA256 handlers.
- `@blackunicorn/bonklm-sandbox-utils` —
  shared validateCode / validatePath / wrapStream primitives.
- `@blackunicorn/bonklm-e2b` — E2B
  sandbox `wrapSandbox` (EXPERIMENTAL).
- `@blackunicorn/bonklm-daytona` —
  Daytona workspace `wrapWorkspace` (EXPERIMENTAL).
- `@blackunicorn/bonklm-inference-providers` —
  `wrapGroq` + `wrapCerebras` + `wrapTogether` (OpenAI-compatible).
- `@blackunicorn/bonklm-restate` —
  `withRestateGuardrails` with full `ObjectContext` support
  (`key()` / `set()` / `get()`).
- `@blackunicorn/bonklm-temporal` —
  `createValidateInputActivity` + `guardrailGate` workflow helper.
- `@blackunicorn/bonklm-document-ingest` —
  `wrapLlamaParse` + `wrapUnstructured` + `wrapReducto` +
  `validateExtractedText` DIY helper.
- `@blackunicorn/bonklm-cloudflare-agents` —
  Cloudflare Agents Durable Object `withBonklmAgent` subclass mixin
  (edge-only).
- `@blackunicorn/bonklm-web-middleware-utils` —
  shared `runRequestValidation` / `runResponseValidation` /
  `getRequestBody`.
- `@blackunicorn/bonklm-elysia` —
  `bonklmGuardrails` Elysia plugin (peer `elysia ^1.4.0`).
- `@blackunicorn/bonklm-nextjs` —
  `withBonklm` Server Action + `bonklmRouteHandler` Route Handler +
  `bonklmEdgeMiddleware` middleware.ts factory (peer `next ^16.0.0`).
- `@blackunicorn/bonklm-voltagent` —
  `wrapVoltAgent` for `@voltagent/core ^2.7.0`.
- `@blackunicorn/bonklm-voltops-otel` —
  VoltOps OTel adapter via `emitVoltOpsSpan`.

**Multilingual**:
- bn (Bengali) + ur (Urdu) patterns + 20+20 corpora. Now 12
  bundled languages.
- RTL bidi guard for ar / ur.
- Multilingual Pass 2 (id / tr / fa / vi / th / pl / nl) RETIRED to
  the v0.7+ backlog (CONDITIONAL: native-speaker
  reviewer pipeline). See
  internal planning record.

### Changed

- `PromptInjectionValidator.name = 'prompt-injection'` —
  was `constructor.name = 'PromptInjectionValidator'`. **SEMVER-
  observability**: downstream consumers keying on
  `result.results[].validatorName === 'PromptInjectionValidator'`
  must migrate to `'prompt-injection'`.
- `JailbreakValidator.name = 'jailbreak'` — same shape.
- `scoreToRiskLevel` thresholds unified to `≥10 HIGH / ≥5 MEDIUM`.
  AudioStream previously `≥7 / ≥3` — operators keying
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
  undefined` to `Response` (hardening). Accepts optional
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

- LangGraph / Mastra, Multilingual Pass 2 (CONDITIONAL), Mid-S4
  cross-validator suite, Sandbox graduation gate, Cross-cutting
  hardening.
- `@temporalio/testing` real-worker integration (current
  tests are activity-shape mocks).
- `createGuardedWrapper` migration completed for 4 packages
  (livekit + document-ingest 3x); 1 package remaining
  (voice-webhooks) ships in the next release.
- Documentation site overhaul + per-connector migration guides.

### v0.5.0 release notes
- See below for the original v0.5.0 release (cumulative).

## [0.5.0] — 2026-05-23

Cumulative release. Five new workspace packages, the
guardrail HTTP server, the Mistral SDK v2 wrapper, and 470/470 tests
green across the entire release surface.

### New packages

- **`@blackunicorn/bonklm-inngest`** — Inngest
  v4 middleware. Replay-safe via `cachedValidate` + step-history
  dedupe. Engine intercept callbacks fire on cached-validate
  decisions (carry-over closure).
- **`@blackunicorn/bonklm-browser-agents-core`** — shared event union + `withBrowserAgentGuardrails`
  helper consumed by Stagehand + Eko.
- **`@blackunicorn/bonklm-stagehand`** —
  Stagehand v3 wrapper. `act` monkey-patch documented with
  construction-order JSDoc (closure).
- **`@blackunicorn/bonklm-eko`** — Eko v4
  multi-agent + MCP-tool wrapper.
- **`@blackunicorn/bonklm-trigger`** —
  Trigger.dev v3/v4 middleware. CRIU-safe locals handle; retry-
  survival via `cachedValidate` keyed by `ctx.run.id`. Shape #5
  "Task-options bindings factory" — `withBonkLM(opts)` returns
  `{ middleware, onFailure }`.
- **`@blackunicorn/bonklm-lance`** —
  LanceDB Table wrapper. Multi-column write validation,
  Arrow-write reject default, retrieved-doc batch validation.
  Node-only.
- **`@blackunicorn/bonklm-turbopuffer`** —
  Turbopuffer Namespace wrapper. Edge-compatible (Workerd / Deno /
  Bun / Vercel Edge). Wraps `write` / `query` / `multiQuery` /
  `deleteAll`. README prominently warns about the
  `turbopuffer@1.0.1` placeholder package on npm.
- **`@blackunicorn/bonklm-mistral`** —
  Mistral SDK v2 wrapper. ESM-only. `defaultLocale: 'auto'`
  auto-wires `MultilingualDetector` + `ReformulationDetector`.
  Optional `enableModerateSecondOpinion` advisory via
  `classifiers.moderate`.
- **`@blackunicorn/bonklm-server`** —
  Fastify HTTP server exposing BonkLM guardrails. Three routes:
  `POST /litellm`, `POST /portkey`, `POST /openai-compatible`.
  HMAC-SHA256 auth via `X-Bonklm-Signature` + `X-Bonklm-Timestamp`.
  5-minute replay window. Includes Docker image
  `blackunicorn/bonklm-server`.

### Engine (core)

- **`GuardrailEngine.notifyCachedResult(results, content, ctx?)`**
  (carry-over closure):
  public method bridging `cachedValidate`-driven connectors to the
  engine's `onIntercept` callbacks. Inngest, Trigger.dev, Lance,
  and Turbopuffer all wire through this. Without it, validator
  decisions from those connectors were invisible to engine-wide
  audit telemetry.
- **`createGuardedLanceTable` + `createGuardedNamespace`** accept
  an optional `engine?` for `notifyCachedResult` dispatch on the
  read path (deferred closure).
- **`engine.getValidators()` fallback** in Inngest + Trigger
  middlewares — pass `engine` and omit `validators`; the connector
  derives the pipeline from `engine.getValidators()` (carry-over
  closure).
- **`sanitizeReasonText` canonical home** moved to
  `@blackunicorn/bonklm/core/connector-utils` (carry-over closure).
  Browser-agents-core retains the export for back-compat. New
  connectors should import from the core subpath.

### Connector-style ADR amendments

- **Shape #5** (Task-options bindings factory) — added
  for Trigger.dev's `task({ middleware, onFailure, run })` shape.
- **Shape #2b** (Vector-database sub-client wrap with
  validators-in-opts) — added for LanceDB,
  retroactively documenting the qdrant / pinecone / weaviate
  `createGuarded<X>(subject, options)` convention.
- **Epic-2 deviations table** — Inngest reclassified as shape #4
  (host-constrained); Trigger.dev assigned shape #5; Lance +
  Turbopuffer assigned shape #2b.

### Documentation

- `docs/user/known-limitations.md` §11–20 added, documenting:
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

### Workerd compat re-audit

- Audited workerd CHANGELOG between v0.3.0 and v0.5.0
  release prep (~8 weeks). **No ALS / `nodejs_compat` regressions
  identified.** `compatibility_date` pin remains at `2024-09-23`.
  Consumers do NOT need to bump `wrangler.toml`
  `compatibility_date` when upgrading from 0.4.x to 0.5.0.
  Audit baseline filed internally.

### Tests

- 470/470 passing across the release packages (core + 10 connectors
  + server + integration + eslint-plugin).
- Cross-connector composition smoke test added
  closure pass (`packages/inngest-connector/tests/cross-connector-composition.test.ts`)
  combining `wrapStagehand` + `bonklmInngestMiddleware` sharing
  one engine.
- Shared vector-connector UAT attack corpus added
  closure pass (`packages/core/tests/integration/vector-connector-corpus.test.ts`).
- Wrapped-method-drift CI smoke
  (`packages/core/tests/integration/wrapped-method-drift.test.ts`)
  catches peer-dep SDK signature changes BEFORE release.

### Pre-publish blockers resolved

- READMEs written for trigger / lance / inngest / turbopuffer /
  mistral / bonklm-server packages.
- LICENSE files added to all release connectors.
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

### Added (en route to v0.5.0)

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

### Security

- AsyncLocalStorage migration hardens against hostile direct-assignment
  to `runtime.bonklm.currentCallContext`.
- Sealed `updateMemory` — hardens the update path that was previously
  left unsealed.
- Startup HTTP probe with SSRF defence (LITERAL IP only, `localhost`
  BANNED) + 2000ms timeout (defeats hung-listener DoS amplification
  bounded by 50 plugins × 4s) + module-scope dedup memo (50-plugin
  parallel init resolves in <5s, not 200s).
- Probe cache key includes NODE_ENV — test/prod outcomes never share
  cache entries in shared-process deployments.
- `runtime.bonklm` namespace object frozen (`Object.freeze(sealedBonklm)`)
  in addition to the slot seal — hostile plugins cannot write
  `runtime.bonklm.foo =...` even on the empty namespace.
- `BonklmPluginOptions` frozen in `bonklmPlugin()` — hostile plugins
  sharing the options reference cannot mutate `acknowledgeClass4Risk`
  or other fields after construction.
- `agentId` URL-encoded in probe URL — defence-in-depth against path
  traversal if a future ElizaOS change surfaces user-controlled values
  through `runtime.agentId`.
- Typo-squat NFKC + format-character strip — defeats zero-width space
  embedding, fullwidth Latin variants, composed-vs-decomposed
  homograph attacks.
- `installSealedWrapMemory` synchronous seal block wrapped in
  try/catch — partial-install failures throw `ConnectorValidationError`
  loudly rather than leaving a half-wrapped runtime.
- `runDoctorRuntime` catch narrowed to `ConnectorValidationError` —
  future programming errors in `applyProbeOutcome` propagate for
  debuggability rather than being swallowed.

### Added (en route to v0.5.0)

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

**`ValidatorInput` discriminated union + `HookSurface` 7-string vocabulary lock**:
- 5 ValidatorInput kinds (`text` / `tool_call` / `retrieved_docs` / `memory_write` / `composed_context`); 7 canonical HookSurface strings.
- `Validator.validate(input: string | ValidatorInput)` overload — every existing validator compiles unchanged.
- `HookManager.registerHook` defaults `surface: 'text_input'` with one-shot deprecation warning; throws in 0.5.
- `GuardrailResult` gains optional `subResults?` and `metadata?` fields; engine propagates `metadata` through `aggregateResults` + `mergeResults`.

**Composite validator factories**:
- `createToolCallArgsValidator` — tree walker over `args` with Map/Set/Buffer/URL/Date support, WeakSet cycle protection, depth cap 5, ALWAYS-scanned tool name (raw + humanised).
- `createRetrievedDocValidator` — drop / block-all / redact modes; index-aligned `subResults`.
- `createMemoryWriteValidator` — block-write / redact modes; `validateWrite(payload)` connector convenience.
- `createComposedContextValidator` — wake-up attack defence; bidirectional concat scan; 32KB soft / 200KB hard caps; P99 < 200ms on 32KB benchmark gate.

**Stream release-gate primitive**:
- `BufferedReleaseGate` standalone primitive.
- `StreamValidator.processForClient` / `finalizeForClient` per-cycle validate-before-release with mode-mixing guard.
- `minBufferBeforeRelease: Infinity` (full-response mode) auto-selected when `chainHasSecretOrPii: true`.

**Web3 preference-setting patterns**:
- 8 phishing tripwires under `web3_preference_setting` category. All severity WARNING + `blockEligible: false` (does NOT auto-block on its own).

**Shared utilities**:
- `validator-utils.ts` consolidates `runValidatorChain`, `applyRedaction`, `RedactingValidator`, `VALIDATOR_ERROR_CATEGORIES`.
- `RedactingValidator` capability — `SecretGuard.redactContent` + `PIIGuard.redactContent` parity-aware with detection normalisation.
- `applyRetrievedDocValidatorToMatches` connector helper with position-stable synthetic IDs (`__pos_${i}`).
- `stripLogControlChars` — defeats log-injection via attacker-controlled names.

**Connector retrofits + new packages**:
- 4 vector-DB connectors (`pinecone`, `qdrant`, `weaviate`, `chroma`) gain opt-in `retrievedDocValidator` option.
- NEW `@blackunicorn/bonklm-vercel` Phase-1 — `bonkMiddleware(engine, options)` for `ai ^5 || ^6` `wrapLanguageModel`.
- NEW `@blackunicorn/bonklm-langchain` Phase-1 — `createBonklmMiddleware(engine, options?)`, `withRetrieverGuardrails`, `createBonklmLangGraphNode`.
- NEW `@blackunicorn/bonklm-google-genai` — full `wrapGenerateContent` / `wrapGenerateContentStream` / `wrapChat` / `wrapLive`.
- NEW `@blackunicorn/bonklm-openai-agents` Phase-1 — `wrapAgent` / `wrapHandoff` / `wrapRealtime` with tool-result-as-carrier handoff defence.
- NEW `@blackunicorn/bonklm-elizaos` Phase-1 — sealed `wrapMemory` with `Object.defineProperty` + closure-captured `currentCallContext` + verified-publisher allowlist + two-condition recipient gate + `bonklm doctor` static-audit CLI.

**Peer-dep sweep**:
- `anthropic` peer covers SDK majors through 0.98; `huggingface` covers `^2 || ^3 || ^4`; `llamaindex` covers `^0.11 || ^0.12`; `chromadb` covers `^1 || ^2 || ^3`.

**Documentation pass**:
- NEW `docs/user/threat-surfaces.md` — canonical 7-surface taxonomy + validator coverage map.
- NEW `docs/user/known-limitations.md` — 9 honest carve-outs.
- NEW migration guides at `docs/user/connectors/vercel-v6-migration.md` and `docs/user/connectors/langchain-v1-migration.md`.
- README ecosystem comparison vs Lakera / LLM Guard / NeMo Guardrails with honest caveats.

**Deprecations announced**:
- `@blackunicorn/bonklm-openclaw` deprecated at v0.4.0-rc1, removal in v0.6.0.

### Security

Adversarial review-loop security hardening was patched before merge. Highlights:

- `__depth_capped__` sentinel collision in `createToolCallArgsValidator`.
- Dot/Unicode-separator humanizer hole (`disable.safety.filter`).
- `Map` / `Set` / `Buffer` walker silent skip.
- Custom serializer dropping toolName scan.
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
- ElizaOS Class-4 PATCH-route attack window is deploy-time detected; structural shadow-log fix lands in v0.5.0.
- 127 pre-existing test failures (express / fastify / nestjs schema rejections + timeout flakes) remain unfixed in v0.4.0.

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
  - Path traversal protection
  - Production mode generic errors
  - Validation timeout with AbortController
  - Request size limits

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
  - Incremental stream validation
  - Buffer size limits (1MB default)
  - Complex message content handling
  - Production mode
  - Validation timeout

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
- Tool call protection
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
- Path traversal protection via path.normalize()
- Incremental stream validation with early termination
- Max buffer size enforcement (1MB default)
- Tool call injection protection
- Complex content handling for multimodal messages
- Production mode generic error messages
- Validation timeout with AbortController
- Request size limits

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

[Unreleased]: https://github.com/BlackUnicornSecurity/bonklm/compare/v1.0.15...HEAD
[1.0.1]: https://github.com/BlackUnicornSecurity/bonklm/releases/tag/v1.0.1
[1.0.0]: https://github.com/BlackUnicornSecurity/bonklm/releases/tag/v1.0.0
