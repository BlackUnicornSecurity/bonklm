# Security Policy

## Supported Versions

BonkLM is currently in the **RC track** ahead of v1.0.0 general availability.
The RC period runs an extended public-comment window; security fixes are
backported as described below.

| Version         | Track         | Security updates |
|-----------------|---------------|-----------------|
| `1.0.0-rc.3`    | RC (current)  | Yes — active    |
| `1.0.0-rc.2`    | RC (prior)    | Critical only, until rc.4 ships |
| `1.0.0-rc.1`    | RC (prior)    | No              |
| `0.7.x`         | Pre-RC stable | No              |
| `0.6.x` and earlier | Legacy   | No              |

Once v1.0.0 ships, the support table will be updated to track the two most
recent minor releases. Until then, **upgrade to `1.0.0-rc.3` or later** to
receive security patches.

All 54 packages in the monorepo (1 `@blackunicorn/bonklm` core + 53 connector
packages prefixed `@blackunicorn/bonklm-*`) share a version line. A security
fix to core is released as a coordinated bump across the affected packages.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security reports.**

### Where to send reports

Email: `[needs-info: security contact address, e.g. security@blackunicorn.tech or a dedicated alias]`

If the project adds a GitHub Security Advisory page, you may also use the
"Report a vulnerability" button at
`https://github.com/BlackUnicornSecurity/bonklm/security/advisories`.

### What to include

A useful report covers:

1. **Affected package(s)** — which `@blackunicorn/bonklm-*` package and which
   version(s) are affected.
2. **Reproduction** — a minimal code sample or steps that trigger the
   vulnerability. Attach a proof-of-concept if one exists.
3. **Impact** — what an attacker can achieve (e.g. bypass a specific validator,
   extract a secret from LLM output, cause a DoS via a crafted payload).
4. **Environment** — Node.js version, framework, LLM provider, relevant config
   options.
5. **Suggested severity** — your assessment of CVSS or OWASP severity (we will
   independently verify, but your view helps triage).

Reports that include a working reproduction are triaged faster.

### Response timeline

- **Acknowledgment**: `[needs-info: target acknowledgment window, e.g. 3 business days]`
- **Triage + severity assessment**: `[needs-info: target window, e.g. 7 business days]`
- **Patch + coordinated disclosure**: `[needs-info: target embargo window, e.g. 90 days maximum, or 30 days for CRITICAL]`

If you do not receive acknowledgment within the window above, follow up via
`[needs-info: fallback contact method]`.

## Scope

### In scope

The following are in scope for vulnerability reports:

- **Core validators** — `PromptInjectionValidator`, `JailbreakValidator`,
  `ReformulationDetector`, `CodeInjectionValidator`, `PathTraversalValidator`,
  `AudioStreamValidator`, `MultilingualDetector`, `OverrideTokenValidator`.
- **Core guards** — `SecretGuard`, `XSSGuard`, `BashSafetyGuard`,
  `ProductionGuard`.
- **`GuardrailEngine`** — validator orchestration, timeout handling
  (`validateWithTimeoutSecure`), wrap-sentinel logic, streaming gate.
- **All connector packages** — the 53 `@blackunicorn/bonklm-*` packages
  (express, fastify, nestjs, openai, anthropic, langchain, etc.). Connector
  scope includes: validation bypass, incorrect block/allow decisions, timeout
  no-ops, log injection, and error-message information leakage.
- **`bonklm` CLI** — the `bonklm doctor`, `bonklm connector`, and
  `bonklm status` commands; the interactive setup wizard.
- **`bonklm-server`** — the Fastify HTTP guardrail server, its HMAC-SHA256
  auth, and replay-window logic.
- **The config schema layer** — `Validators.*` rules, `OptionalRule` semantics,
  type-narrowing correctness.

### Out of scope

- **Your application's own logic** — vulnerabilities in code you write that
  uses BonkLM as a dependency are not our responsibility to fix, though we
  are happy to advise.
- **Third-party LLM provider bugs** — issues in OpenAI, Anthropic, Mistral,
  etc. APIs or models. Report those directly to the provider.
- **False-negative rate on novel jailbreaks** — BonkLM is a deterministic
  pattern engine, not an ML model. A new jailbreak that no existing pattern
  matches is not a vulnerability in BonkLM; it is a gap in the pattern set.
  See [Known Limitations](#known-limitations-reference) and the comparison
  table in the README for honest positioning. That said, if you discover a
  pattern gap covering a well-known, widely-reproduced attack class, please
  do report it — we will treat it as a pattern addition request.
- **Denial-of-service via legitimate large inputs** — BonkLM enforces internal
  byte caps and truncation; exhausting those caps by sending a 10 MB prompt is
  not a vulnerability.
- **npm package name typosquatting** — report those to npm security
  (security@npmjs.com).

## Known Limitations Reference

BonkLM is a **deterministic pattern + structural defence** library. It is not
an ML model. There are documented classes of attack it does not catch, and
surfaces where it operates in a best-effort posture by design.

These are not vulnerabilities; they are architectural trade-offs explicitly
enumerated so operators can layer additional defences:

**[`docs/user/known-limitations.md`](docs/user/known-limitations.md)**

Key limitations relevant to security posture:

- Multilingual coverage is regex breadth, not depth (§4, §25).
- Stream partial-leak prevention requires full-response mode (`minBufferBeforeRelease: Infinity`) (§5, §9).
- Sandbox validators (`CodeInjectionValidator`, `PathTraversalValidator`) are
  first-line defence only — sandbox isolation is true containment (§24).
- Guards do not fire on `validateInput` paths used by browser-agent, Inngest,
  and Eko connectors (§10).
- `AudioStreamValidator.validatePartial` is ASCII-fold only; homoglyph /
  mixed-script attacks require `validateFinal` (§22).

If you believe a documented limitation is being exploited in a way that goes
beyond the scope described in `known-limitations.md`, that is in scope for a
report.

## Coordinated Disclosure

We follow **responsible / coordinated disclosure**:

1. Reporter submits a private report (see above).
2. We acknowledge, triage, and agree on a severity assessment with the reporter.
3. We develop and test a fix.
4. We notify the reporter before public disclosure, giving them an opportunity
   to review the fix.
5. We publish a security advisory and release the fix simultaneously.
6. The embargo period is `[needs-info: default embargo length, e.g. 90 days for HIGH/CRITICAL, 30 days for CRITICAL with active exploitation]`.
   We may request an extension with justification; reporters may request
   acceleration if evidence of active exploitation emerges.

We do not operate a bug-bounty program at this time.
`[needs-info: if a bug-bounty program is added, replace this line with scope + reward table]`

## Hall of Fame / Acknowledgments

We credit researchers who responsibly disclose valid security issues, with
their consent. Credit appears in the release notes for the fixing version and
in this section.

_No entries yet. If you report a valid vulnerability we will add your name or
handle here (with your permission)._
