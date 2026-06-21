---
id: bonklm-security-disclosure
tier: tier-1-required
title: Security disclosure policy (hardcoded per CLAUDE.md)
applies_to: [all]
priority: 10
---
**NEVER document security incidents in any public artifact.** This is hardcoded in CLAUDE.md (2026-05-27) in response to a real incident.

**Public artifacts that MUST NOT carry security incident details:**
- `CHANGELOG.md` (ships to npm consumers + visible on GitHub)
- Per-package `README.md` (ships in npm tarball)
- `docs/` directory (ships on the public docs site)
- Public commit messages (visible on GitHub)
- Public PR / Issue descriptions
- Any file outside the gitignored `team/` directory

**Prohibited content in public artifacts:**
- Specific scan-tool finding counts ("1 TRUE POSITIVE", "1,984 findings")
- Verbatim or partial leaked-secret values (`sk-ant-api03-...`, even after rotation)
- File paths to fixtures containing real secrets (`demo/<path>/.env.demo`)
- Defect IDs mapping to security incidents (`D-008`, etc.)
- Rotation timelines or remediation specifics
- Tool versions used in the scan ("gitleaks v8.30.1")
- Commit SHAs of incident-related changes

**Allowed public messaging (CHANGELOG only):**
"Hardened sanitizer", "Added regression coverage for known attack class", "Closed audit finding from internal review". These reference the fix, not the incident.

**Security-incident tracking (gitignored `team/` only):**
- `team/qa/<version>/03-defects.md` — full defect rows with evidence
- `team/qa/<version>/standups/` — coordinator standups
- `team/lessonslearned.md` — internal post-mortem
- `team/qa/<version>/evidence/` — full scan-output capture

**Remediation for past public disclosures:** History rewrite (`git filter-repo`) is the appropriate remediation. Force-push to `main` is the exception pattern sanctioned for security incidents.
