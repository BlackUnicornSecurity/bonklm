---
'@blackunicorn/bonklm-mcp': minor
---

mcp: scan inbound tool results for indirect prompt-injection on the ingress path.

`createGuardedMCP` now composes an `IndirectInjectionValidator` scoped to the `tool_result` surface
onto the inbound result-validation path (`validateToolResults`, on by default), on top of any
validators you pass. Previously the `tool_result` detection arms were reachable only through the
core `createToolCallArgsValidator` factory (outgoing call arguments), so a guarded MCP client did
not scan the raw results returned by a remote tool. It now does: task-hijack / objective-replacement
directives, forged ReAct instruction tokens, forged agent-instrumentation footers, and exfil
directives carried in the text content of tool output are detected and the result is filtered.

**Behavior change:** a tool result that previously passed can now be filtered when it carries a
`tool_result` injection signal. The scan runs only on incoming result content, never on outgoing
tool-call arguments, and respects the existing `validateToolResults: false` escape hatch. No public
API or option changes.

**Scope:** the `tool_result` surface is asserted by the connector (the `Provenance` wire-envelope is
not yet stamped), and only text content is scanned — non-text result blocks (image / audio /
embedded-resource / binary) are not extracted or scanned. See the MCP entry in the known-limitations
doc.
