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

If a release was ever published manually (outside CI), it will not carry provenance — provenance
proves _CI built this from that commit_, and a local publish cannot make that claim. Treat a missing
attestation on a version that should have one as a signal to investigate, not as proof of tampering.

## Software Bill of Materials (SBOM)

Generate a CycloneDX 1.5 SBOM for the core package's production dependency closure:

```bash
pnpm sbom            # writes bonklm-core.sbom.json
```

The SBOM lists every shipped dependency with its version, license, and package URL (purl). It is
reproducible — pass `SOURCE_DATE_EPOCH` for a byte-stable timestamp — and is intended for ingestion
into your own vulnerability- and license-tracking tooling.

## License posture

Every dependency in BonkLM's shipped production closure is permissively licensed (MIT / Apache-2.0 /
ISC / BSD / BlueOak). BonkLM's own packages are Apache-2.0 (community core); see
[ADR-0006](../contributing/adr/0006-license-apache-bsl.md).

Some peer SDKs you install alongside a connector carry non-permissive or proprietary licenses (for
example, SAP or LGPL components inside certain vector-store or document SDKs). Those are licensed to
you directly by their vendors and are outside BonkLM's distribution — review them as part of
adopting that SDK.

## Peer-SDK advisories — recommended pins

Some third-party SDKs pull in transitive packages with known advisories. These are **not** in any
BonkLM tarball, but they may appear in your install if you use the connector that wraps the SDK. If
your audit flags one, pin the patched version in your own project.

| Package         | Patched     | Reaches you via (connector → SDK)                                                                       |
| --------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `vite`          | `>=7.3.2`   | cloudflare-agents → `agents`                                                                            |
| `esbuild`       | `>=0.28.1`  | cloudflare-agents → `agents`                                                                            |
| `hono`          | `>=4.12.25` | cloudflare-agents/google-genai/llamaindex/document-ingest/mem0/openai-agents/stagehand/voltagent → SDKs |
| `ws`            | `>=8.21.0`  | chroma/daytona/elizaos/google-genai/langchain/mem0/openai-agents/stagehand/voltagent → SDKs             |
| `form-data`     | `>=4.0.6`   | chroma/daytona/document-ingest/inference-providers/mem0/stagehand/voltagent → SDKs                      |
| `@grpc/grpc-js` | `>=1.14.4`  | daytona → `@daytonaio/sdk`                                                                              |

With pnpm, add to your project's `package.json`:

```jsonc
{
  "pnpm": {
    "overrides": {
      "vite": ">=7.3.2",
      "esbuild": ">=0.28.1",
      "hono": ">=4.12.25",
      "ws": ">=8.21.0",
      "form-data": ">=4.0.6",
      "@grpc/grpc-js": ">=1.14.4"
    }
  }
}
```

The npm/yarn equivalent is a top-level `"overrides"` / `"resolutions"` block with the same entries.
Only the rows for SDKs you actually install are relevant. A few of these are optional or deeply
nested peers; if a flat override does not move the resolved version, use a scoped form
(`"<parent>>vite": ">=7.3.2"`) or upgrade the SDK to a release that has bumped it.

## Dist-tags: `latest` vs `next`

- **`latest`** — the newest stable release. `npm install @blackunicorn/bonklm` gives you this.
- **`next`** — prerelease builds (`1.0.0-rc.N`). Opt in explicitly:

```bash
npm install @blackunicorn/bonklm@next
```

Prerelease tags never move `latest`, so a release candidate can be published for testers without
changing what a default install resolves to.
