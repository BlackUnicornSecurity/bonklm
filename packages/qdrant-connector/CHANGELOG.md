# @blackunicorn/bonklm-qdrant

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

- Updated dependencies [a8c6181]
  - @blackunicorn/bonklm@1.0.14

## 1.0.13

### Patch Changes

- Release-lane fix: the promotion''s final channel verification retries with backoff (registry
  dist-tag reads lag the writes just performed).
- Updated dependencies
  - @blackunicorn/bonklm@1.0.13

## 1.0.12

### Patch Changes

- Release-lane fix: ensure-exact is idempotent on resume (an existing destination tag matching the
  verified digest and identity short-circuits) and container command failures surface captured
  output.
- Updated dependencies
  - @blackunicorn/bonklm@1.0.12

## 1.0.11

### Patch Changes

- Release-lane fix: the public container digest is signed while registry credentials are still
  present (before logout) in the expose step.
- Updated dependencies
  - @blackunicorn/bonklm@1.0.11

## 1.0.10

### Patch Changes

- Release-lane completion: the exposed public container digest is signed (keyless, same workflow
  identity) before verification — container signatures do not transfer across registry packages on
  copy.
- Updated dependencies
  - @blackunicorn/bonklm@1.0.10

## 1.0.9

### Patch Changes

- npm provenance verification reads the SLSA statement directly (subject digest, workflow identity,
  release commit) instead of routing through cosign blob attestation, which the registry's greylist
  bundle regeneration cannot satisfy.
- Updated dependencies
  - @blackunicorn/bonklm@1.0.9

## 1.0.8

### Patch Changes

- Release-lane attestation freshness: provenance fetches force CDN revalidation (no-cache headers
  plus a unique query — the registry''s attestation edges serve stale replicas to some network paths
  for extended periods), and the verification retry window covers the observed settle time.
- Updated dependencies
  - @blackunicorn/bonklm@1.0.8

## 1.0.7

### Patch Changes

- Release-transaction hardening follow-up: provenance verification retries the registry's
  eventually-consistent attestation flapping (digest-mismatch class only; deterministic failures
  still fail immediately).
- Updated dependencies
  - @blackunicorn/bonklm@1.0.7

## 1.0.6

### Patch Changes

- Release-transaction hardening: staging cleanups are best-effort (registry dist-tag deletion and
  image-version deletion exceed token scope and no longer fail the transaction after all mutations
  succeed), post-publish verification retries transient registry lag, and publish phases are logged.
- Updated dependencies
  - @blackunicorn/bonklm@1.0.6

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

- Updated dependencies [c0b2255]
  - @blackunicorn/bonklm@1.0.5

## 1.0.4

### Patch Changes

- eee1352: Bumped development and test dependency floors and tightened lockfile-wide version
  overrides to pull in upstream security fixes for known-vulnerable transitive dependencies. The
  `protobufjs` override is now scoped to the 8.x line only, un-forcing packages that legitimately
  require the 7.x line (which carries no known advisories). The shipped production closure is
  unchanged and remains free of known high or critical advisories.
- Updated dependencies [eee1352]
  - @blackunicorn/bonklm@1.0.4

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

- Updated dependencies [61e3c94]
- Updated dependencies [e656d87]
- Updated dependencies [90e4947]
  - @blackunicorn/bonklm@1.0.2

## 1.0.1

### Patch Changes

- Harden the server dependency closure, enforce the patched Fastify 5 runtime floor with
  segment-aware path filters and query-free route metadata. Ensure clean workspace builds compile
  core before packages that resolve its published exports. Keep structurally wrapped SDK peers
  opt-in so a clean npm install does not auto-resolve their upstream trees. Publish npm packages and
  the multi-architecture, read-only-code server image from the same human-approved GitHub Release,
  with version parity, smoke, vulnerability, SBOM, provenance, and signature gates.
- Updated dependencies
  - @blackunicorn/bonklm@1.0.1

## 1.0.0

### Patch Changes

- b8279a1: chroma, huggingface, llamaindex, pinecone, qdrant, vercel, weaviate: drop a redundant
  `resolution-mode` import attribute from the connector type definitions.

  These connectors publish as ESM (`type: module`), so their type-only import of the core package
  already resolves in import mode. The explicit
  `import type { ... } from '@blackunicorn/bonklm' with { 'resolution-mode': 'import' }` attribute —
  only needed back when the connectors were CommonJS — is now redundant and has been removed. The
  exported type surface and runtime behavior are unchanged.

- 9b62d9b: chroma, huggingface, llamaindex, pinecone, qdrant, vercel, weaviate: publish as ESM-only
  (`type: module`), matching the other connectors.

  These seven connectors were CommonJS (or typeless), and their built CommonJS output `require()`d
  the ESM-only core. As a result, on Node 20.4–22.11 — squarely inside the declared `engines.node`
  `>=20.4.0` range — both `import()` and `require()` of the connector failed (`ERR_REQUIRE_ESM`;
  `vercel` threw a `SyntaxError`). They worked only on Node 22.12+ where `require(esm)` is
  unflagged.

  Switching them to `type: module` (and the `.` export condition from `require` to `import`) makes
  them load across the entire supported Node range, identical to the other connectors. CommonJS
  consumers on Node `<22.12` now hit the same intentional ESM boundary as the rest of the library.

- d8371c7: Harden the qdrant connector's payload-filter log and error sinks against
  control-character (CWE-117) log injection. A retrieved-point payload field name could reach the
  `filterPayload` regex-path log entries unescaped; that field name — along with the remaining
  filter-validation log/throw boundaries in the guarded client — is now routed through the shared
  log-sanitizer before it reaches a logger or a thrown error message, so attacker-influenced content
  can no longer carry raw newlines or other control bytes into a consumer's logs. Added regression
  coverage for the known attack class.
- 9eaa4e4: qdrant/pinecone: harden caller-option forwarding so only known, validated native options
  reach the underlying client (defense-in-depth, CWE-20).
  - **qdrant `search`** now forwards only an allow-list of native `SearchRequest` options (`offset`,
    `params`, `shard_key`). Any other caller-supplied key — including one that could carry an
    unvalidated filter via the options index signature — is dropped instead of being passed through
    verbatim, and a negative, fractional, or non-numeric `offset` is now rejected. This supersedes
    the previous "unrecognized options are still forwarded verbatim" behavior.
  - **pinecone `query`** now structurally validates `namespace` before it is used to target the
    index: it must be a string matching `^[a-zA-Z0-9_-]+$` within a length cap, so a non-string
    (`{}` / `123`) or malformed namespace is rejected rather than handed to the SDK. The outgoing
    query body is now built from an allow-list of real Pinecone query fields (`vector`,
    `includeValues`, `includeMetadata`, plus the connector's normalized `topK` and sanitized
    `filter`), so unrecognized caller keys are no longer forwarded.

- 970776e: qdrant/pinecone: fix the vector-DB connector request shapes so guarded operations reach
  the real client correctly.
  - **qdrant `upsert`** now sends the points wrapped in a `{ points }` object (a `PointsList`), as
    `@qdrant/js-client-rest` requires — previously it passed a bare array, producing a
    schema-invalid request body with no `points`/`batch` key.
  - **qdrant `search`** now translates its camelCase options to the client's snake_case
    `SearchRequest` fields (`scoreThreshold` → `score_threshold`, `withPayload` → `with_payload`,
    `withVector` → `with_vector`), which were silently ignored before. The positional collection
    name no longer leaks into the request body, and unrecognized options are still forwarded
    verbatim.
  - **pinecone `query`** now targets a namespace via `index.namespace(ns).query(...)` when
    `namespace` is set — previously `namespace` was placed inside the query body, which the SDK
    ignores, so queries silently ran against the default namespace. The dead `result.vectors`
    response fallback was removed.
  - A shared `normalizeLimit` helper (exported from `@blackunicorn/bonklm/core/connector-utils`) now
    clamps result limits to `[1, max]` — flooring fractional values and defaulting non-finite ones —
    across the qdrant and pinecone connectors, so a zero, negative, or over-large limit can no
    longer reach the client. Pinecone previously rejected an out-of-range `topK` with an error; it
    now clamps consistently with the qdrant and weaviate connectors.

- Updated dependencies [d6cbcef]
- Updated dependencies [8b31abb]
- Updated dependencies [0921e05]
- Updated dependencies [01e5aac]
- Updated dependencies [15952df]
- Updated dependencies [c23243f]
- Updated dependencies [54ea06f]
- Updated dependencies [8b4d81f]
- Updated dependencies [4f37193]
- Updated dependencies [d6d6c91]
- Updated dependencies [68500c5]
- Updated dependencies [530efec]
- Updated dependencies [953d17e]
- Updated dependencies [f92be10]
- Updated dependencies [bba07d1]
- Updated dependencies [b5e127e]
- Updated dependencies [a2038c8]
- Updated dependencies [d78dfa6]
- Updated dependencies [aff1034]
- Updated dependencies [291b100]
- Updated dependencies [f704672]
- Updated dependencies [73061e4]
- Updated dependencies [68f38af]
- Updated dependencies [f948818]
- Updated dependencies [813fec1]
- Updated dependencies [f1662aa]
- Updated dependencies [5c80956]
- Updated dependencies [4668195]
- Updated dependencies [b14111a]
- Updated dependencies [97c0ff9]
- Updated dependencies [0f397d8]
- Updated dependencies [ac523a7]
- Updated dependencies [9e0e391]
- Updated dependencies [dc6e369]
- Updated dependencies [1929f24]
- Updated dependencies [a4d3cc4]
- Updated dependencies [c5bca0b]
- Updated dependencies [62b339c]
- Updated dependencies [e29b47f]
- Updated dependencies [ce91ff0]
- Updated dependencies [f27bf03]
- Updated dependencies [3b3e125]
- Updated dependencies [e6786ee]
- Updated dependencies [0198472]
- Updated dependencies [4b7941e]
- Updated dependencies [9d54166]
- Updated dependencies [a96183a]
- Updated dependencies [40ca86f]
- Updated dependencies [696335f]
- Updated dependencies [501cfe1]
- Updated dependencies [055e943]
- Updated dependencies [f42bd50]
- Updated dependencies [76c74a9]
- Updated dependencies [06660cf]
- Updated dependencies [746d48a]
- Updated dependencies [d79dbd3]
- Updated dependencies [d063633]
- Updated dependencies [548b41b]
- Updated dependencies [0521106]
- Updated dependencies [9c0b738]
- Updated dependencies [588cd48]
- Updated dependencies [970776e]
- Updated dependencies [5500af4]
  - @blackunicorn/bonklm@1.0.0
