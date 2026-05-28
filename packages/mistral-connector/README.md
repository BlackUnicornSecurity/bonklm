# @blackunicorn/bonklm-mistral

Mistral SDK v2 wrapper that runs the BonkLM validator pipeline on every `chat` / `agents` / `fim` /
`embeddings` / `classifiers` call. Pre-validates user inputs BEFORE the API call; post-validates
model responses + tool-call arguments AFTER. Optional second-opinion advisory via Mistral's own
`classifiers.moderate`.

**Peer dep:** `@mistralai/mistralai ^2.2.0`. **ESM-only** (Mistral SDK v2 ships ESM-only; the
connector inherits — see CJS migration note below).

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-mistral @mistralai/mistralai
```

## Quick start

```ts
import { Mistral } from '@mistralai/mistralai';
import { wrapMistral } from '@blackunicorn/bonklm-mistral';
import { GuardrailEngine, PromptInjectionValidator, SecretGuard } from '@blackunicorn/bonklm';

const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator(), new SecretGuard()]
});

// `defaultLocale: 'auto'` (the default) auto-wires
// MultilingualDetector + ReformulationDetector into your engine if
// they aren't already there — covers non-English injection variants
// symmetrically with the English baseline.
const guarded = wrapMistral(client, engine, {
  productionMode: process.env.NODE_ENV === 'production' // ← REQUIRED for prod
});

const r = await guarded.chat.complete({
  model: 'mistral-large-latest',
  messages: [{ role: 'user', content: userPrompt }]
});
```

## ⚠️ SECURITY: `productionMode: true` is REQUIRED in production

`productionMode` defaults to `false`. In non-production mode, `MistralGuardrailBlockedError.message`
includes the validator's `reason` text — sanitized (control chars stripped, 200-char cap) but still
containing attacker-controlled fragments of the blocked input. If your error handler / logger / APM
emits the error message downstream, that content leaks.

**Always set `productionMode: true` in production deployments.** The sanitized reason still goes to
`engine.onIntercept(...)` listeners (your audit logger sees the full picture); the consumer-facing
error message just becomes generic.

## What gets wrapped

| Sub-resource                                    | Pre-validation         | Post-validation                                       |
| ----------------------------------------------- | ---------------------- | ----------------------------------------------------- |
| `chat.complete` / `chat.stream`                 | user messages          | response content + tool_calls.arguments               |
| `agents.complete` / `agents.stream`             | user messages          | response content + tool_calls.arguments               |
| `fim.complete` / `fim.stream`                   | `prompt` + `suffix`    | response content                                      |
| `embeddings.create`                             | every `inputs[]` entry | (none — embeddings return vectors)                    |
| `classifiers.moderate` / `classifiers.classify` | every `inputs[]` entry | (none — connector trusts Mistral's classifier output) |

Non-wrapped sub-resources (`audio`, `files`, `models`, `beta`, `batch`, `fineTuning`, `ocr`,
`workflows`, `events`) pass through unchanged via the Proxy `get` trap.

## `defaultLocale: 'auto'` — multilingual default-on

The connector auto-wires `MultilingualDetector` + `ReformulationDetector` into the engine when
`defaultLocale === 'auto'` (default). This is idempotent: if your engine already carries these
validators, they are not re-added.

To opt out (e.g. English-only deployment):

```ts
wrapMistral(client, engine, { defaultLocale: 'en' });
```

## `enableModerateSecondOpinion`

When `true`, every `chat.complete` / `agents.complete` call ALSO fires `classifiers.moderate` on the
response content + dispatches the result as an advisory finding to `engine.onIntercept(...)`
listeners.

```ts
const guarded = wrapMistral(client, engine, {
  enableModerateSecondOpinion: true
});
```

**Cost note**: enabling this adds an extra `classifiers.moderate` round-trip to every completion
call. Use selectively.

## Multi-turn conversations: `validateAllMessages: true`

By default the connector validates ONLY `role === 'user'` messages. If your application replays
multi-turn history where `assistant` messages may be attacker-influenced (RAG-retrieved history,
vector- store poisoning, repeated context-feed-in), opt into full-message validation:

```ts
wrapMistral(client, engine, { validateAllMessages: true });
```

## CJS migration note

Mistral SDK v2 ships **ESM-only** (no CJS dist). If your application is CJS-only (older Express /
older Webpack configs), you have three options:

1. **Migrate your app to ESM** (`"type": "module"` in package.json + adjust your build to handle
   `.js`/`.mjs` correctly). Recommended.
2. **Pin `@mistralai/mistralai@^1.x`** which still ships CJS. This connector does NOT support the v1
   API surface — you would also need to roll your own validator wiring.
3. **Use dynamic `import()`** inside your CJS code:

   ```ts
   const { Mistral } = await import('@mistralai/mistralai');
   const { wrapMistral } = await import('@blackunicorn/bonklm-mistral');
   ```

## Catching guardrail blocks

`MistralGuardrailBlockedError` extends `ConnectorValidationError`:

```ts
try {
  await guarded.chat.complete({...});
} catch (e) {
  if (e instanceof MistralGuardrailBlockedError) {
    // Mistral-specific block handling.
  } else if (e instanceof ConnectorValidationError) {
    // Generic cross-connector validation block.
  } else {
    throw e;
  }
}
```

## What this connector does NOT validate

See `docs/user/known-limitations.md` sections 17–20 for the full list. Headline items:

- **Multi-turn assistant history** unless `validateAllMessages: true`.
- **Streaming output** — `chat.stream` / `agents.stream` / `fim.stream` pre-validate inputs but
  return the underlying `ReadableStream` unchanged. Per-chunk output validation requires
  consumer-side accumulation.
- **Image-encoded injections** — OCR-readable injection payloads inside `image_url` parts of
  structured content arrays.
- **Tool-call arguments** with malformed JSON — logged + skipped (not blocked), per AC #5's
  defensive-parse requirement.
- **Double-wrap** the same client — not recommended; second wrap produces an extra validation pass
  on advisory inputs.

## License

MIT
