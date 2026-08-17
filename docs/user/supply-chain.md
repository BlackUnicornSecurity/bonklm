# Supply-chain & provenance

How BonkLM is built, signed, and what you can verify about a package you install. For the rationale
behind these choices see [ADR-0008](../contributing/adr/0008-supply-chain-posture.md).

## What BonkLM ships

BonkLM is a set of framework- and provider-agnostic connectors around a small core. Each connector
declares the third-party SDK it wraps (`openai`, `chromadb`, `@google/genai`, `llamaindex`, …) as a
**peer dependency**, not a bundled dependency — you install the SDK you already use, and BonkLM
never ships a copy of it.

A consequence worth understanding: when you audit your own project, advisories and licenses from
those SDKs show up because **you** installed them, not because BonkLM bundled them. BonkLM's own
shipped dependency closure is deliberately tiny and permissively licensed; the peer SDKs are yours
to manage. The two sections below help you do that.

## Verifying npm provenance

Stable BonkLM releases are published from CI with
[npm build provenance](https://docs.npmjs.com/generating-provenance-statements): each tarball
carries a Sigstore attestation binding it to the exact GitHub Actions run, commit, and source
repository that produced it.

Verify the packages you installed:

```bash
npm audit signatures
```

A provenance-signed package reports a verified provenance attestation. You can also inspect a
specific version on its npm page ("Provenance" section) to see the source commit and build.

Direct or manual publication is not a valid BonkLM release path. Current releases must carry
workflow-bound provenance proving the source commit and exact build identity. Treat a missing or
invalid attestation as a release-integrity failure and do not use that version.

## Software Bill of Materials (SBOM)

From a source checkout, generate a CycloneDX 1.5 SBOM for the core package's production dependency
closure:

```bash
pnpm sbom            # writes bonklm-core.sbom.json
```

The source SBOM lists every workspace-resolved shipped dependency with its version, license, and
package URL (purl). It is reproducible — pass `SOURCE_DATE_EPOCH` for a byte-stable timestamp — and
is intended for ingestion into your own vulnerability- and license-tracking tooling.

Publish preflight separately installs the exact retained tarballs in a clean npm consumer, with
lifecycle scripts disabled. It validates every declared entrypoint and relative module edge, blocks
on HIGH/CRITICAL production advisories, enforces the permissive-license policy on the npm-resolved
tree, and emits one CycloneDX SBOM per package. Those release SBOMs bind the source SHA, root
tarball, and transitive SHA-512 identities and are retained with the exact release bundle. This
artifact-specific pass catches registry resolution drift that the source workspace lock cannot
represent.

Release preflight also retains separate CycloneDX SBOMs for the `linux/amd64` and `linux/arm64`
server images. The workflow scans and smoke-tests those exact platform images before it stages their
shared OCI digest in GHCR. Both image SBOMs must pass the image-license gate. The gate accepts
permissive components and an exact, version-pinned set of reviewed Alpine runtime GPL/LGPL
components; any new component, version, missing license, or changed license set blocks publication
until it is reviewed.

## Verifying the container

The release workflow publishes stable and prerelease server images under exact version tags. The
release workflow enforces immutability for the exact version tag and does not create mutable GHCR
channel tags. Verify the keyless workflow-identity signature with Cosign:

```bash
VERSION=1.0.14
cosign verify \
  --certificate-identity "https://github.com/BlackUnicornSecurity/bonklm/.github/workflows/publish.yml@refs/tags/v${VERSION}" \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  "ghcr.io/blackunicornsecurity/bonklm-server:${VERSION}"
```

The release pipeline builds the multi-architecture OCI artifact once, scans both platform payloads,
and stages and signs its digest in a private staging package. It then publishes the exact npm family
and verifies registry signatures and source-bound provenance. Only after those immutable versions
verify does it copy the signed image to the public exact SemVer tag, verify anonymous image and
signature access, and promote the npm channel — monotonic across promoted values; a prerelease
`latest` left by npm's own first-publish side effect is overwritten by the promotion, never adopted.

### One-time GHCR bootstrap

The public `bonklm-server` package must exist and be **Public** before a family release is
published. An organization administrator provisions it through the separately reviewed
package-provisioning procedure and confirms anonymous access. This release workflow does not create
or change the visibility of the public package; it fails before registry mutation when the target is
missing or private. The separate `bonklm-server-staging` package may be absent initially and must
remain private whenever it exists.

Create a protected `public-release` environment with required human review and place its `NPM_TOKEN`
and `BONKLM_RELEASE_DENY_TERMS` secrets there. Create a separate `public-release-recovery`
environment with only narrowly scoped recovery credentials; its automatic cleanup must not wait for
the original release approval. The registry workflow and recovery workflow share one FIFO
concurrency queue.

Do not force-cancel after the first registry mutation. An independent recovery workflow marks the
commit unready, restores an uploaded npm channel snapshot when one exists, and removes the failed
run's opaque npm and private GHCR staging references. A force-cancel or control-plane outage can
still interrupt recovery, so remove any remaining `staging-<run>-<attempt>` references and verify
the complete npm channel vector before retrying. Recovery refuses to overwrite a channel changed by
another publisher after the snapshot was captured.

The public GitHub Release is a trigger, not the completion signal. Announce or promote a release in
downstream systems only after the exact release commit reports a successful `bonklm/release-ready`
status. A missing, pending, or failed status means the registry transaction is not reconciled.

Release operators must also configure the encrypted `BONKLM_RELEASE_DENY_TERMS` repository secret.
It supplies the private deny-policy overlay used to scan exact npm tarballs without exposing raw
internal identifiers or reversible fingerprints in the public repository. A missing policy fails
release preflight closed; local public-export checks still run the generic tarball surface gate.

## License posture

Every dependency in BonkLM's default npm install closure is permissively licensed (MIT / Apache-2.0
/ ISC / BSD / BlueOak). The 52-package linked BonkLM family is Apache-2.0 (community core).
Separately versioned Tier-B tooling is also public OSS and must declare an approved permissive
license; the current `@blackunicorn/eslint-plugin-edge` tool is MIT. See
[ADR-0006](../contributing/adr/0006-license-apache-bsl.md).

Optional peer SDKs you install alongside a connector can carry non-permissive or proprietary
licenses (for example, SAP or LGPL components inside certain vector-store or document SDKs). Those
are licensed to you directly by their vendors and are outside BonkLM's distribution — review them as
part of adopting that SDK.

## Peer-SDK advisories

Some third-party SDKs pull in transitive packages with known advisories. These are **not** in any
BonkLM tarball, but they may appear in your install if you use the connector that wraps the SDK.
Treat your package manager's current audit output as authoritative: upgrade the owning SDK first,
then use a parent-scoped override only when its declared dependency range admits the patched
version. Do not copy a static global override list across projects; advisory floors and compatible
ranges change independently. Reinstall and rerun the production audit after every override.

Frequently useful SDK upgrades (verify against your own audit before applying):

- `@turbopuffer/turbopuffer` and `@e2b/code-interpreter` resolve old `undici` lines; a parent-scoped
  `undici` floor at the current patched 7.x/8.x release clears several HIGH advisories if your Node
  runtime supports it.
- `@temporalio/*` pins `protobufjs ^7` — do **not** force protobufjs 8.x onto it.
- `@trigger.dev/sdk` ≥ 4.5.6 carries the prototype-pollution fix for run metadata.
- `next` ≥ 16.2.11 carries the middleware-bypass and SSRF fixes for the 16.x line.

## Dist-tags: `latest` vs `next`

- **`latest`** — the newest stable release. `npm install @blackunicorn/bonklm` gives you this.
- **`next`** — prerelease builds (`1.0.0-rc.N`). Opt in explicitly:

```bash
npm install @blackunicorn/bonklm@next
```

Prerelease tags never move `latest`, so a release candidate can be published for testers without
changing what a default install resolves to.
