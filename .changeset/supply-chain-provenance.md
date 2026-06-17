---
'@blackunicorn/bonklm': patch
---

supply chain: emit npm build provenance and declare repository metadata on all published packages.

Stable releases now publish with npm build provenance — a Sigstore attestation linking each tarball
to its CI build, commit, and source repository, verifiable with `npm audit signatures`. Provenance
requires a `repository` field, which every publishable package now declares. Prereleases are tagged
`next` so they never move `latest`. Also adds a production-closure advisory and license audit
(`pnpm audit:prod`, `pnpm license-check`) and a published-tarball secret scan (`pnpm scan:tarballs`)
wired into the quality gate, plus an on-demand CycloneDX SBOM generator (`pnpm sbom`). See
docs/user/supply-chain.md.
