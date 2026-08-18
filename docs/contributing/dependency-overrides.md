# Dependency overrides policy (dev/test closure)

> Scope: the `pnpm.overrides` block in the root `package.json`. Authority: ADR-0008 amendment
> (2026-08-16). The block is owned by `@BlackUnicornSecurity` via CODEOWNERS — every change to it is
> reviewed as a security-relevant surface.

## Why overrides exist here

BonkLM's CI, UAT, and connector test suites execute the workspace dependency tree. The overrides
keep that **dev/test closure** free of known-vulnerable transitive versions. They are **not** a
consumer protection: overrides do not propagate to consumer installs. The release bar for what
BonkLM ships remains `pnpm audit:prod` / `pnpm license-check` over the default install closure
(ADR-0008). Consumer guidance lives in `docs/user/supply-chain.md`.

## Binding rules for every entry

1. **Per-major scoped selector where multiple majors coexist** (`protobufjs@8`, `js-yaml@3`,
   `nanoid@3`, `next@16`, …). Never force a package's consumers across a major line implicitly.
2. **Upper ceiling on every floor** (`>=x.y.z <nextMajor`). An unbounded floor silently force-jumps
   the whole graph the first time a new major ships.
3. **No exact pins** unless the reason is documented here (none today; the temporary `undici` /
   `vite` exact pins used during the 2026-08 mitigation were converted to bounded ranges).
4. **Cross-major forces need justification + CI evidence.** Current ones:
   - `uuid@9` / `uuid@10` → `>=11.1.1 <12`: uuid's public API (`v4()` etc.) is stable across these
     majors; full suite green on the forced version.
   - `undici` single-line `>=8.10.0 <9`: collapses the 5/6/7/8 coexistence to one patched line.
     Note: undici 8.x declares `engines: node >=22.19`; the library's own runtime floor is
     unaffected (undici is never shipped — peer SDKs carry it), but dev/CI Node should be ≥ 22.19
     when running the workspace tree.
5. **Regenerate from scratch when touching overrides**:
   `rm -rf node_modules pnpm-lock.yaml && pnpm install`. pnpm 9 reuses cached peer-group resolutions
   (including stale auto-installed peers) across plain installs — the exact mechanism that
   historically made a `vite` override inert (ADR-0008). A clean regen is the only trustworthy
   verification.
6. **Verify after every change**: `pnpm audit` (target: zero HIGH/CRITICAL/MODERATE), `pnpm test`,
   `pnpm lint`, `pnpm typecheck`.
7. **Sort keys alphabetically** (scoped selectors sort by package name) so the block is diffable and
   reviewable.

## Deliberate carve-outs

- **protobufjs 7.x is intentionally un-floored.** `@temporalio/proto` requires `^7.6.4`; protobufjs
  8.x breaks its converter at module load. The 7.x line currently carries no known advisories (the
  audit scans it); if one lands, temporal-middleware tests will surface the conflict before any
  override does.
- **`@opentelemetry/sdk-node` / `auto-instrumentations-node` are floored (`>=0.217.0 <1` /
  `>=0.75.0 <1`) because genkit pins pre-advisory versions of both.** Forcing the patched lines is
  validated by the genkit-connector test suite; if a genkit release bumps its own OTel pins past
  these floors, drop the overrides.
- **`@qdrant/js-client-rest` is pinned to `~1.16.2` (peer ceiling `<1.17.0`).** The connector wraps
  `client.search()`, which the SDK removed in the 1.19 universal-`query()` consolidation; the
  guarded surface and the tsd conformance lock are verified against 1.16.x. Migrating the connector
  onto the `query()` API is a feature task — until then the peer range honestly reflects the
  supported surface.

## Accepted LOW findings (workspace audit)

| Package                                              | Reason it stays                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `elliptic` (via `@elizaos/core` → crypto-browserify) | No patched release exists (advisory offers none).                                                                                                                                                                                                                                                                                       |
| `@ai-sdk/provider-utils` (via `agents`, `ai`)        | No patched release exists (advisory offers none).                                                                                                                                                                                                                                                                                       |
| `ai@4.3.19` (vercel-connector devDep)                | Fix requires the `ai@5` major. The connector's type surface imports `LanguageModelV1`, which `ai@5` no longer exports; the declared `^3–^6` peer range is validated against `ai@4`. Advisory is a file-upload whitelist bypass, not exercised by the connector (type-only + generateText/streamText usage, dev/test-only in this repo). |

Review this table whenever a new `ai` major ships or an advisory gains a patched release.
