# Licensing FAQ

BonkLM is an **open-core** project. This page explains, in plain language, what is free, what is
paid, and how the two tiers relate. The authoritative terms are in [`LICENSE`](LICENSE) (Apache-2.0)
and [`LICENSE-BUSL-1.1.txt`](LICENSE-BUSL-1.1.txt) (Business Source License 1.1).

## TL;DR

| Tier               | License                    | What it is                                                                                                                                            | Cost               |
| ------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **Community core** | Apache-2.0                 | The deterministic guardrail library — validators, guards, engine, hooks, fault-tolerance — and every framework / provider / platform connector.       | Free, forever      |
| **Enterprise**     | BSL-1.1 (source-available) | Curated rule content, signed threat-feed delivery, industry policy packs, control-mapping evidence export, advanced detectors, governance primitives. | Commercial license |
| **Hosted SaaS**    | Terms of Service           | The managed platform (dashboard, governance, storage, alerting). Never shipped as source.                                                             | Subscription       |

## Is BonkLM open source?

**The community core is** — it is licensed under the **Apache License 2.0**, an OSI-approved open
source license. Use it, modify it, redistribute it, and build commercial products on it, for free,
forever.

**The enterprise tier is _source-available_, not open source.** It is licensed under the **Business
Source License 1.1 (BSL-1.1)**, which is not OSI-approved. You can read and audit the source (it
matters for a security product), but production use requires a commercial license until the tier
converts (see below).

## What can I do with the Apache-2.0 community core?

Everything Apache-2.0 permits: run it in production, modify it, redistribute it, embed it in
proprietary or commercial software, and fork it — at no cost. Apache-2.0 also grants an explicit
patent license. The only thing it does not grant is the right to use the **BonkLM** or
**BlackUnicorn** trademarks (Apache-2.0 §6).

## What is in the paid enterprise tier?

Additive **content and services** layered on top of the free engine — not the scanner engine itself,
which is free. The enterprise tier is curated rule content, signed threat-feed freshness/delivery,
industry policy packs, control-mapping evidence export, advanced (ML-assisted) detectors, and
governance primitives.

## When does the enterprise tier become Apache-2.0?

BSL-1.1 auto-converts to the **Change License (Apache-2.0)** on its **Change Date** — **three
years** after each version is published. Each released version converts on its own third
anniversary. After conversion, that version is Apache-2.0 with no further restriction.

## Can I use the enterprise tier without buying a license?

BSL-1.1 grants **non-production use** — evaluation, development, and testing — for free.
**Production use of the enterprise tier requires a commercial license** until that version reaches
its Change Date. For commercial licensing, contact info@blackunicorn.tech.

## How do I contribute?

Contributions to the community core are welcome under the **Developer Certificate of Origin (DCO)**:
sign off each commit with `git commit -s` to certify you have the right to submit the work under the
project license. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full contributor terms, including
the relicensing clause that keeps the dual-license model workable.

## Questions

Licensing, trademark, or alternative-arrangement inquiries: **info@blackunicorn.tech**.
