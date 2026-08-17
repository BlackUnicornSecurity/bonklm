# Privacy Policy

> **Status:** This is the privacy notice we operate under as of the effective date below — it is
> **operator-approved but not yet ratified by legal counsel.** The §5 lawful-basis analysis is
> pending counsel review and may be refined; this document is not legal advice.
>
> **Effective date:** 2026-06-16 (notice in force; §5 basis pending counsel review) · **Last
> updated:** 2026-06-16

This policy explains what personal data is — and is not — involved when you use **BonkLM**, the
open-source LLM security-guardrails library (`@blackunicorn/bonklm` and the related
`@blackunicorn/bonklm-*` connector packages), the `bonklm` command-line tool, and the self-hosted
`bonklm-server`.

The short version: **the software collects nothing about you and sends nothing back to us.** It runs
entirely inside your own process or on your own infrastructure. The only time we hold any personal
data is when you choose to contact us directly — for example by opening a GitHub issue, sending a
security report, or emailing us. The rest of this document explains that in full.

---

## 1. Who we are

BonkLM is published and maintained by **BlackUnicorn OÜ**, a private limited company incorporated in
Estonia.

| Field                   | Value                                 |
| ----------------------- | ------------------------------------- |
| Legal entity            | BlackUnicorn OÜ                       |
| Registry (registrikood) | `16604183`                            |
| Registered office       | Tornimäe tn 5, 10145 Tallinn, Estonia |
| VAT status              | Not registered for VAT                |

> The registration details above are carried from a prior Estonian Business Register (e-Äriregister)
> lookup; the source company card is not held in this repository, and legal counsel re-verifies this
> registration block at ratification.

In this policy, "we", "us", "our", and "BlackUnicorn" refer to that entity. "BonkLM", "the
software", "the library", and "the package" refer to the published code.

- **General contact:** info@blackunicorn.tech
- **Privacy / data-protection contact:** **info@blackunicorn.tech** — for all data-protection
  enquiries and rights requests. (Under GDPR Art. 37(7), where a Data Protection Officer is
  appointed we publish their contact details, not necessarily their name; the formal appointment
  status is confirmed by counsel at ratification.)
- **EU/UK representative:** not applicable — the controller (BlackUnicorn OÜ) is established inside
  the EU, so no Art. 27 representative is required.

---

## 2. Scope — what this policy covers

This policy covers the **published, self-hosted software** only:

| Component                                                    | Who controls the data flowing through it                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `@blackunicorn/bonklm` core library + guards/validators      | **You** (the operator who installs it). It runs in your process.      |
| `@blackunicorn/bonklm-*` connector packages                  | **You.** They wrap your own framework/provider calls in your process. |
| `bonklm` CLI (`doctor`, `connector`, `status`, setup wizard) | **You.** It runs on your machine against config you supply.           |
| `bonklm-server` (self-hosted Fastify guardrail server)       | **You.** You deploy and run it on your own infrastructure.            |

In every one of these, **you are the data controller** for any content you pass through BonkLM, and
**BlackUnicorn is neither a controller nor a processor** of that content — we never receive it. We
are the data controller only for the limited direct-contact data described in §5.

**Out of scope:** any future **hosted / managed SaaS** offering is a separate service that does not
exist in this package, is not covered here, and will carry its own privacy notice and
data-processing agreement when and if it launches. Do not infer hosted-service data practices from
this document.

---

## 3. What the software collects

**Nothing is collected by us.** BonkLM contains:

- **no telemetry uplink to BlackUnicorn** — there is no analytics endpoint, no "phone-home", no
  usage beacon, and no hardcoded BlackUnicorn URL anywhere in the runtime code;
- **no install-time scripts** — none of the published packages define a `postinstall`/`preinstall`
  hook that runs on `npm install`;
- **no background network calls of its own.** The only outbound requests the software makes are to
  endpoints **you configure** — your LLM provider, your local model server (e.g. an Ollama instance
  you point it at), your vector database, and so on.

BonkLM does expose **observability hooks**, but they are entirely under your control and emit only
to sinks **you** wire up:

- `engine.onIntercept(callback)` — your in-process callback;
- `TelemetryService` — dispatches typed events only to collectors **you** pass in (console, your own
  callback, your own buffered sink); it has no default remote destination, and if constructed via
  the convenience factory with no collector it falls back to a local console sink (your stdout —
  still never networked);
- `bonklmTrace(result, opts)` — emits OpenTelemetry spans to a `Tracer` **you** supply. BonkLM does
  not bundle an OTel SDK or exporter and chooses no destination on your behalf.

If you route these signals to a third party (Langfuse, Datadog, Arize, your SIEM, etc.), that flow
is between **you and that vendor** under **your** privacy policy — not ours. The built-in event
paths sanitize control characters and redact PII before they reach a sink (see §11), but you remain
the controller of whatever you choose to forward.

> Code references for verification: `packages/core/src/telemetry/TelemetryService.ts`,
> `packages/core/src/telemetry/otlp-export.ts`, `docs/user/telemetry.md`.

---

## 4. What the software never collects or transmits to us

To be explicit, BonkLM never sends us, and we never receive:

- the **prompts, completions, documents, tool calls, or any content** you validate;
- your **API keys, tokens, or secrets**. Credentials entered into the setup wizard are held in
  memory in a `SecureCredential` wrapper, zeroed after use, and redacted from logs,
  `JSON.stringify`, and `util.inspect`; they are used only to talk to the provider **you**
  configured, and any configuration the wizard persists is written to **your** local
  filesystem/environment, never to us (`packages/core/src/cli/utils/secure-credential.ts`);
- your **IP address, device identifiers, installation identifiers, or usage metrics**;
- any **personal data of your end users**.

There is no corpus, dataset, or model trained on anything that passes through your deployment.

---

## 5. The only personal data we process, and our lawful basis

We process personal data only when **you reach out to us directly** through the project's public
channels:

| Activity                                           | Data involved                                       | Purpose                                              |
| -------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| Opening a GitHub issue / pull request / discussion | Your GitHub handle, profile, and whatever you write | Maintaining the open-source project, triage, support |
| Submitting a security report / advisory            | Your identity/handle and report contents            | Investigating and fixing vulnerabilities             |
| Emailing us (e.g. info@blackunicorn.tech)          | Your email address and message contents             | Responding to your enquiry                           |

**Lawful basis — GDPR Art. 6(1)(f), legitimate interests.** Our legitimate interest is to operate,
support, and secure an open-source project and to respond to the people who contact us. This is
limited, expected processing that does not override your rights. We do **not** rely on "consent or
pay", on treating telemetry as payment, or on any data-as-counter-performance model — there is no
product telemetry to which such a basis could apply.

For data you submit **through GitHub**, GitHub, Inc. is an independent controller under its own
privacy statement; we act as a controller only for the copy we receive and process for the purposes
above.

> Counsel to confirm this basis before publication. No special-category data (GDPR Art. 9) is sought
> or required; please do not include it in correspondence — anything inadvertently sent is deleted
> rather than processed.

---

## 6. How data is transmitted (current build — stated honestly)

- **From the software to us:** never. No build of BonkLM in this repository transmits anything to a
  BlackUnicorn endpoint. There is no such endpoint in the code.
- **From the software outward at all:** only to the provider/model/database/telemetry endpoints
  **you** configure, over whatever transport that integration uses (typically HTTPS to your LLM
  provider). BonkLM is the in-line guardrail around those calls; it does not add destinations of its
  own.
- **`bonklm-server`:** runs on your infrastructure and authenticates requests with HMAC-SHA256 plus
  a replay window. Its traffic is between your own clients and your own server; we never see it.
- **Direct-contact data (§5):** travels over the channel you choose — GitHub (HTTPS) or email.

This section is verified against the build in this repository and must be re-checked if the
transport behaviour ever changes.

---

## 7. Sharing and sub-processors

**We do not sell personal data, and we do not share it for advertising.**

Because the software sends us nothing, there are no product-data sub-processors. For the limited
direct-contact data in §5, the platforms that necessarily handle it are:

- **GitHub, Inc.** — hosts the repository, issues, pull requests, and security advisories.
- **npm, Inc.** — distributes the packages; npm collects aggregate, non-identifying download counts
  that we do not control and cannot tie to you (npm's own platform logging is governed by npm's
  privacy statement).
- **Our email provider** — _[confirm: email host, e.g. the provider behind blackunicorn.tech mail]_
  — receives email you send us.

If a hosted service is launched in future, its sub-processor list (e.g. payment, identity, hosting
providers) will be published in that service's own notice, not here.

---

## 8. International data transfers

We are established in **Estonia (EU/EEA)**. The software itself triggers no transfers, because it
sends us no data. The direct-contact data in §5 may be processed outside the EEA by the platforms
above (for example, GitHub and npm operate in the United States). Those providers maintain their own
transfer safeguards (such as Standard Contractual Clauses or an equivalent mechanism) under their
respective terms. _[confirm: state the specific mechanism for the chosen email host if it is outside
the EEA.]_

---

## 9. Data retention

- **Product data:** none is held, so none is retained.
- **GitHub issues / PRs / advisories:** retained on GitHub for as long as the project history is
  kept, consistent with running an open-source project; you can edit or delete your own GitHub
  content subject to GitHub's platform rules.
- **Email and security correspondence:** retained only as long as needed to handle your enquiry and
  any follow-up, then deleted in the ordinary course. _[confirm: a specific retention period if you
  wish to commit to one.]_

---

## 10. Your rights

Under the GDPR (Chapter III) you have the rights of access, rectification, erasure, restriction,
objection, and data portability; under the CCPA/CPRA (where applicable) you have the rights to know,
delete, correct, and opt out, and the right not to be discriminated against for exercising them.

- For the **software**, these rights are largely moot: we hold no data about your use of it, and as
  a self-hosted operator you already control your own deployment, configuration, and any telemetry
  you emit.
- For the **direct-contact data** in §5, exercise any of these rights by emailing
  **info@blackunicorn.tech**. We respond within the statutory time limits.

You also have the right to lodge a complaint with a supervisory authority — in our case the Estonian
Data Protection Inspectorate (Andmekaitse Inspektsioon), or your local EU/EEA authority.

---

## 11. Security

Verifiable, code-grounded statements:

- **Secrets stay local and are minimised in memory.** API keys handled by the CLI use
  `SecureCredential` (8 KB cap, zero-initialised buffer, automatic zeroing after use, redaction in
  logs/JSON/inspect) — `packages/core/src/cli/utils/secure-credential.ts`.
- **No egress to us**, so there is no BlackUnicorn-side store of your data to breach.
- **Log-injection defence (CWE-117).** Attacker-influenceable strings are sanitized before they
  reach log/telemetry sinks via `sanitizeLogString` / `sanitizeMeta` (ADR-0001) — see
  `docs/contributing/adr/0001-log-sanitization.md`.
- **PII redaction** is applied to logging contexts by `MonitoringLogger`, and the bundled
  `AttackLogger` sanitizes stored content.
- **`bonklm-server`** authenticates with HMAC-SHA256 and enforces a replay window.

No software is perfectly secure; report suspected vulnerabilities privately per
[`SECURITY.md`](SECURITY.md).

---

## 12. Children

BonkLM is a developer / business security tool. It is not directed to children, is not intended for
anyone under 16, and we do not knowingly collect data from children. The direct-contact channels in
§5 are likewise intended for developers and operators.

---

## 13. Changes to this policy

We may update this policy as the project evolves. Material changes will be reflected by updating the
**Last updated** date above and noting the change in the repository history (and, for significant
changes, in the release notes). Continued use of the software after an update constitutes awareness
of the revised policy; because we collect nothing, no re-consent is required.

---

## 14. Contact

- **General:** info@blackunicorn.tech
- **Privacy / data protection:** info@blackunicorn.tech
- **Security / vulnerability reports:** via the GitHub Security Advisory page per
  [`SECURITY.md`](SECURITY.md) — not by email, and never as a public issue (privacy and data-subject
  requests use the email above).
- **Technical companion:** [`docs/user/telemetry.md`](docs/user/telemetry.md) explains, in
  engineering detail, exactly which observability signals exist and where they go.
