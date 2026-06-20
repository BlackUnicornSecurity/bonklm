---
'@blackunicorn/bonklm': patch
---

fix(core): detect tool-call-hijack / structured-argument injection in PromptInjection

Adds a high-precision pattern category (`tool_call_injection`) that catches injected content sitting
inside a tool result or a retrieved/quoted document which directs the reading agent to invoke a tool
with attacker-chosen arguments — the indirect-tool-injection primitive aimed at the agent's next
tool call rather than its prose. Three intent-gated patterns:

- an indirect-injection directive — content that addresses the agent which _reads/quotes this
  excerpt itself_ ("guidance for any AI agent that quotes this … call the `<name>` tool");
- a directive that relays a tool call to a downstream sub-agent and leads to an exfiltration
  ("instruct the downstream agent to … call the `<name>` tool … exfiltrate …");
- an embedded `tool:` / `parameters:` directive block whose body stages an exfil (an
  `encrypted_value` / `exfil` field or a `base64(` of the environment).

The patterns are intent-gated, not vocabulary-gated: each pairs the tool-call shape with a genuine
attack signal, so ordinary agent / tool-use prose and config — "call the X tool with arguments",
"make another tool call", "instruct the downstream agent to call the search tool", a `tool:` /
`args:` YAML block, or a security write-up _describing_ an exfil attack — does not match.
Detection-only additions at warning severity (block-eligible); no behavioral change to non-matching
content.
