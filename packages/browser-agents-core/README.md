# @blackunicorn/bonklm-browser-agents-core

Shared event union + guardrail factory used by all BonkLM browser-agent connectors (`@blackunicorn/bonklm-stagehand`, `@blackunicorn/bonklm-eko`, future entrants).

---

## ⚠️ SECURITY WARNING — Screenshot-based / CUA mode is NOT validated

Browser-agent SDKs (Stagehand, Eko, ...) increasingly support a **Computer-Use Agent (CUA) mode** in which the LLM receives raw page **screenshots** instead of (or alongside) DOM text. BonkLM validators inspect **text + tool args** only — they **do not** decode pixel data.

Prompt-injection text rendered as page pixels (e.g. an attacker-controlled banner) reaches the LLM **unvalidated** when CUA mode is on, bypassing every guardrail in the pipeline.

The shared factory `withBrowserAgentGuardrails(client, opts)` accepts an `allowCuaMode: boolean` option (default `false`). Connectors built on this core MUST surface the CUA refusal at construction. When CUA is opted in, the wrapper emits a `[browser-agents-core] CUA mode opted in — ...` warning to the supplied logger (or `console.warn` if absent) — the warning is **unmissable** by design.

---

## Install

```bash
npm install @blackunicorn/bonklm @blackunicorn/bonklm-browser-agents-core
```

You usually install a vendor-specific connector (e.g. `@blackunicorn/bonklm-stagehand`) rather than calling this core directly.

---

## Public surface

```ts
import {
  withBrowserAgentGuardrails,
  BrowserAgentGuardrailBlockedError,
  type BrowserAgentEvent,
  type BrowserAgentGuardOptions,
} from '@blackunicorn/bonklm-browser-agents-core';
```

### `BrowserAgentEvent`

```ts
type BrowserAgentEvent =
  | { kind: 'act'; action: string; args?: Record<string, unknown> }
  | { kind: 'extract'; schema: unknown; result: unknown }
  | { kind: 'observe'; prompt: string; result?: string }
  | { kind: 'agent.execute'; task: string; result?: unknown }
  | { kind: 'file'; op: 'read' | 'write' | 'delete'; path: string; content?: string }
  | { kind: 'mcp.tool'; server: string; tool: string; args?: Record<string, unknown> };
```

### Surface mapping

| Event kind | BonkLM validator surface |
|---|---|
| `act`, `file`, `mcp.tool` | `tool_call` |
| `extract` | `retrieved_doc` (POST-call) |
| `observe` | `text_input` |
| `agent.execute` | `composed_context` |

### `BrowserAgentGuardrailBlockedError`

Shared base class — every browser-agent connector (`StagehandGuardrailBlockedError`, future `EkoGuardrailBlockedError`) extends it. Catch once for all connectors:

```ts
try {
  await guarded.act('click submit');
} catch (err) {
  if (err instanceof BrowserAgentGuardrailBlockedError) {
    console.error(`Blocked: connector=${err.connector} surface=${err.surface}`);
  }
}
```

The error's `reason` field is sanitized at construction (non-printable chars stripped, capped at 200 chars) to prevent attacker-controlled validator output from polluting downstream error tracking.

---

## License

MIT
