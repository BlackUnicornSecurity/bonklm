---
'@blackunicorn/bonklm': patch
---

fix(core): detect forged system-override delimiter-block injection in PromptInjection

Adds a high-precision pattern category (`forged_override_block`) that catches the Greshake-style
indirect-prompt-injection primitive: a fabricated `<<… SYSTEM … OVERRIDE … key=value …>>`
pseudo-directive block embedded in content the model reads (a PDF text stream, a tool result's
trailing context, a retrieved document) to forge a runtime-authority instruction that countermands
the surrounding document. This is the double-angle pseudo-tag form that the bare-phrase
`system override: …` pattern, the third-person forged-authorization prose patterns, and the
conversation-role tag patterns do not reach.

The pattern is intent-gated, not vocabulary-gated: the `<<…>>` shape alone is the native register of
benign content — shell here-docs (`cat <<EOF`), AsciiDoc cross-references
(`<<system-override-policy,System Override Policy>>`), template placeholders (`<<SYSTEM_NAME>>`),
wiki/titled references (`<<System Override Matrix>>`), and C++ stream operators
(`cout << "SYSTEM" << endl`). It therefore pairs the forged tag with an attack hallmark that benign
`<<…>>` forms do not carry — an elevated-authority `key=value` / `key: value` attribute
(`trust_level=…`, `priority="…"`, `trust="…"`; the keys are attack-flavoured only, not ordinary ACL
keys) — and an attack-specific directive, so ordinary documentation that references or describes a
"system override" does not match. Detection-only addition at warning severity (block-eligible); no
behavioral change to non-matching content.
