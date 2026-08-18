# @blackunicorn/bonklm-logger

## 1.0.16

### Patch Changes

- Staging image cleanup now tolerates GHCR refusing manifest deletions (UNSUPPORTED) and the tarball
  normalizer reads GNU long-name entries, so the publish lane completes end to end on the CI image.

## 1.0.15

### Patch Changes

- Deterministic release bundles: packed tarballs now have sorted dependency maps and normalized
  archive metadata, so a rerun of the publish lane produces bytes identical to the original run.

## 1.0.14

### Patch Changes

- a8c6181: Peer dependency floors now match the security overrides this workspace pins.

  Four connectors advertised a peer range reaching below their root `pnpm.overrides` floor. Nothing
  under that floor can resolve here, so the lower span of each range advertised support that could
  not be built or tested even deliberately.
  - `@blackunicorn/bonklm-mcp` requires `@modelcontextprotocol/sdk` `^1.0.0` -> `^1.25.2`
  - `@blackunicorn/bonklm-nestjs` requires `@nestjs/common` and `@nestjs/core` `^10.0.0 || ^11.0.0`
    -> `^11.1.18`
  - `@blackunicorn/bonklm-hono` requires `hono` `^4.12.0` -> `^4.12.34`
  - `@blackunicorn/bonklm-nextjs` requires `next` `^16.0.0` -> `^16.2.11`

  The NestJS change withdraws a Nest 10 support claim that was never compiled against. All four are
  declared optional in `peerDependenciesMeta`, so a consumer below a new floor normally sees a peer
  warning rather than a failed install; a resolver run with strict peer dependencies will still
  error.

  The floor is the lowest version the workspace can RESOLVE, not the version installed — the
  resolver takes the highest match in the range. Peers with no override are out of scope of this
  rule and may still advertise a low end the workspace does not build.

## 1.0.13

### Patch Changes

- Release-lane fix: the promotion''s final channel verification retries with backoff (registry
  dist-tag reads lag the writes just performed).

## 1.0.12

### Patch Changes

- Release-lane fix: ensure-exact is idempotent on resume (an existing destination tag matching the
  verified digest and identity short-circuits) and container command failures surface captured
  output.

## 1.0.11

### Patch Changes

- Release-lane fix: the public container digest is signed while registry credentials are still
  present (before logout) in the expose step.

## 1.0.10

### Patch Changes

- Release-lane completion: the exposed public container digest is signed (keyless, same workflow
  identity) before verification — container signatures do not transfer across registry packages on
  copy.

## 1.0.9

### Patch Changes

- npm provenance verification reads the SLSA statement directly (subject digest, workflow identity,
  release commit) instead of routing through cosign blob attestation, which the registry's greylist
  bundle regeneration cannot satisfy.

## 1.0.8

### Patch Changes

- Release-lane attestation freshness: provenance fetches force CDN revalidation (no-cache headers
  plus a unique query — the registry''s attestation edges serve stale replicas to some network paths
  for extended periods), and the verification retry window covers the observed settle time.

## 1.0.7

### Patch Changes

- Release-transaction hardening follow-up: provenance verification retries the registry's
  eventually-consistent attestation flapping (digest-mismatch class only; deterministic failures
  still fail immediately).

## 1.0.6

### Patch Changes

- Release-transaction hardening: staging cleanups are best-effort (registry dist-tag deletion and
  image-version deletion exceed token scope and no longer fail the transaction after all mutations
  succeed), post-publish verification retries transient registry lag, and publish phases are logged.

## 1.0.5

### Patch Changes

- c0b2255: The setup wizard now covers every publishable connector.

  The connector registry was a frozen array of five hand-written definitions while the project
  published fifty-one connector packages, and the three detection modules each kept their own
  hardcoded pattern table. Connectors are now declared as data in a catalog, the registry composes
  that catalog with the hand-written reference connectors, and framework / service / credential
  detection all build their tables from the registry — so a connector is detectable the moment it is
  registered.
  - `defineConnector()` turns a declarative descriptor (detection signals, credentials, probe) into
    a full `ConnectorDefinition`.
  - `ConnectorCategory` gains `agent`, `memory`, `sandbox`, `workflow`, `observability` and
    `utility` alongside the existing `llm`, `framework` and `vector-db` (additive).
  - `ConnectorDefinition` gains `npmPackage` and `optionalEnvVars`. Optional env vars accept an
    empty answer at the prompt, are not written to `.env`, and no longer make `connector test`
    report `not-configured`.
  - The wizard's selection list sorts detected connectors first, pre-selects them, and shows each
    connector's category.
  - `DetectedFramework` gains `package` (the dependency that matched); `name` remains the connector
    id. `FrameworkId` and `CredentialName` widen from closed unions to `string`.
  - New test asserts registry membership matches the publishable workspace packages exactly, so a
    new connector package fails the build until it is registered.

  > Released as a family `patch`, deliberately. On this repository a `minor` changeset does not
  > produce 1.1.0: with all 52 members of the `linked` group at 1.0.4 and no prerelease mode, a
  > one-line `minor` probe changeset makes `changeset version` write **2.0.0** to every package
  > (verified by running it on a clean tree and reverting). Shipping that would signal a breaking
  > change to every consumer of 52 published packages, which this change is not — the entire new
  > surface is in-tree, because `packages/core` exposes no `./cli` export subpath.
  >
  > Two maintainer follow-ups, neither blocking: the linked-group bump escalation looks like a
  > tooling defect worth its own investigation, and the release line can be promoted at cut time if
  > this feature deserves a 1.1.0 headline.

## 1.0.4

### Patch Changes

- eee1352: Bumped development and test dependency floors and tightened lockfile-wide version
  overrides to pull in upstream security fixes for known-vulnerable transitive dependencies. The
  `protobufjs` override is now scoped to the 8.x line only, un-forcing packages that legitimately
  require the 7.x line (which carries no known advisories). The shipped production closure is
  unchanged and remains free of known high or critical advisories.

## 1.0.2

### Patch Changes

- 61e3c94: Expanded detection coverage for known evasion classes.
  - Chinese system-override detection now accepts both natural word orders (`所有之前的` and
    `之前的所有`), closing a reversal evasion.
  - Prompt-injection and jailbreak detection close mid-word line-break splits (`prev\nious`) by
    scanning a collapsed copy alongside the line-preserved text, so word-boundary wrapped prose is
    unaffected.
  - SecretGuard: Anthropic keys accept the real key-length range instead of one exact length; added
    plain legacy OpenAI `sk-` keys, AWS access-key + secret pairs presented together, and
    entropy-validated generic `*_PASSWORD` / `*_SECRET` / `*_TOKEN` assignments (quoted or bare).
  - BashSafetyGuard: pipe-to-shell covers `sh`/`zsh`/`dash`/`ksh`/`fish` (not just `bash`); added
    `/dev/tcp` reverse shells, `nc -e` execution, environment and credential-file exfiltration into
    network tools, and system auth-file tampering.
  - BashSafetyGuard staging and inline-code chains: download followed by shell execution or by
    `chmod` make-executable (including `tee`-staged variants), pipes into scripted interpreters in
    stdin-code form (`| python3`, flags-only) or inline-code form (`-c` / `-e` / `--eval`, with
    flag-value pairs skipped), `xargs` staging, and `awk system()` execution — while data-pipes into
    pre-existing scripts (`curl … | python3 analyze.py`) stay allowed.
  - SecretGuard: JSON-quoted credential keys (`"api_key": "…"`), case-insensitive and dot-bearing
    assignment values, and linear-time scanning on match-dense adversarial input with a bounded
    findings cap; common keyboard/alphabet sequences are never treated as secrets.
  - Multilingual detection scans a whitespace-stripped copy (CJK glyph-split evasions such as
    `忽略 所有 指令`), covers traditional-Chinese glyphs and demonstrative-qualified forms
    (`忽略上述指令`), and tolerates CJK punctuation between verb and object.
  - Documented the inherent semantic-limiter class (hypothetical framing, translation laundering,
    markdown-image exfil, tool-call abuse) in known-limitations.md with layered-defence guidance.

- e656d87: Hardened the request body extraction boundary.
  - Bodies the default extractor cannot serialize (circular references, BigInt values) are now
    rejected by default instead of scanning a placeholder string that always validated clean. Set
    `unparsableBodyPolicy: 'scan-literal'` to restore the previous lenient behavior.
  - Fixed the JSON replacer collapsing every body without message/prompt/content/text keys to the
    literal `[Circular]`; such bodies are now scanned as their real serialized content.
  - Pinned the engine contract that a crashing validator or guard produces a blocked verdict on
    every execution path.

- 90e4947: Hardened request authentication, replay rejection, and the default validator stack.
  - Accepted request signatures are remembered for the replay window and duplicates are rejected
    (`replay_detected`, HTTP 401), so a captured request cannot be replayed. A `replayCacheSize`
    option bounds the cache.
  - The CLI default stack now ships the full documented validator set (PromptInjection, Jailbreak,
    CodeInjection, Multilingual, EncodedRescan, IndirectInjection) plus the SecretGuard guard,
    closing a gap where encoded payloads were scanned only by two validators.
  - `createBonklmGuardrailServer` accepts a `guards` option for the internal engine.

## 1.0.1

### Patch Changes

- Harden the server dependency closure, enforce the patched Fastify 5 runtime floor with
  segment-aware path filters and query-free route metadata. Ensure clean workspace builds compile
  core before packages that resolve its published exports. Keep structurally wrapped SDK peers
  opt-in so a clean npm install does not auto-resolve their upstream trees. Publish npm packages and
  the multi-architecture, read-only-code server image from the same human-approved GitHub Release,
  with version parity, smoke, vulnerability, SBOM, provenance, and signature gates.

## 1.0.0

First stable release. Version aligned to `1.0.0` under the single-version monorepo policy; no
functional changes to this package during the release-candidate cycle.
