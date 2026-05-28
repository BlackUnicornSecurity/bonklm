# Migrating @blackunicorn/bonklm-langchain to LangChain.js v1

This guide covers migration from the `@langchain/core@^0.3.x` `CallbackHandler` integration to the
`langchain@1.x` middleware pattern.

## TL;DR

```bash
npm install langchain@latest @langchain/core@latest @blackunicorn/bonklm-langchain@latest
```

The connector now supports `@langchain/core ^0.3.0 || ^0.4.0 || ^1.0.0` plus `langchain ^1.0.0` in a
single package. Existing `GuardrailsCallbackHandler` consumers continue to work; new projects should
adopt `createBonklmMiddleware` from `@blackunicorn/bonklm-langchain`.

## Before — CallbackHandler (`@langchain/core@^0.3.x`)

```ts
import { GuardrailsCallbackHandler } from '@blackunicorn/bonklm-langchain';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const handler = new GuardrailsCallbackHandler({
  validators: [new PromptInjectionValidator()],
  validateStreaming: true
});

await chain.invoke(input, { callbacks: [handler] });
```

## After — Middleware (`langchain@1.x`)

```ts
import { createBonklmMiddleware } from '@blackunicorn/bonklm-langchain';
import { PromptInjectionValidator, SecretGuard } from '@blackunicorn/bonklm';

const middleware = createBonklmMiddleware({
  scope: ['text_input', 'text_output', 'tool_call'],
  validators: [new PromptInjectionValidator(), new SecretGuard()],
  priority: 0 // run BEFORE openAIModerationMiddleware (lower = earlier)
});

// Wire into your langchain@1.x agent / runnable per the SDK docs.
```

## Hook surfaces

`createBonklmMiddleware` installs the following hooks based on the configured `scope`:

| Scope           | Hook                                                        | When                                                                                                      |
| --------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `text_input`    | `beforeModel(state)`                                        | Validates the prompt / messages BEFORE the model invocation. Throws on block.                             |
| `text_output`   | `afterModel(state, response)`                               | Validates the model response BEFORE persistence / forwarding.                                             |
| `tool_call`     | `wrapToolCall(toolCall, next)`                              | Validates EACH tool-call's args. Parallel tool calls each pass through their own validation, NOT batched. |
| `retrieved_doc` | use `withRetrieverGuardrails` (separate wrapper, see below) | Wraps the retriever directly — middleware hooks don't cover the retriever surface in v1.                  |

## Retriever wrap

Retrievers live outside the agent/runnable middleware lifecycle, so the wrap is a separate API:

```ts
import { withRetrieverGuardrails } from '@blackunicorn/bonklm-langchain';

const guardedRetriever = withRetrieverGuardrails(myRetriever, {
  validators: [new PromptInjectionValidator()]
});
const docs = await guardedRetriever.invoke('search query');
// Blocked docs are silently filtered (matches RetrievedDocValidator
// 'drop' mode default from Story 1.2).
```

## LangGraph (low-level)

For raw `StateGraph` setups not running under `createAgent` / `createReactAgent`:

```ts
import { bonklmLangGraphNode } from '@blackunicorn/bonklm-langchain';

graph.addNode('bonklm', state => bonklmLangGraphNode(state, engine));
graph.addEdge('start', 'bonklm');
```

## Coexistence with `openAIModerationMiddleware`

LangChain v1's middleware ordering is priority-driven: LOWER priority runs EARLIER. Register BonkLM
with a lower priority (the default `0` is correct) so deterministic pattern detection short-circuits
the chain BEFORE OpenAI's moderation endpoint is called — saves a network round-trip on every
blocked input.

```ts
// Recommended composition:
agent.use(createBonklmMiddleware({ scope: 'text_input', validators, priority: 0 }));
agent.use(openAIModerationMiddleware({ priority: 10 })); // runs after BonkLM
```

## `GuardrailsCallbackHandler` deprecation

`GuardrailsCallbackHandler` is `@deprecated` as of Story 1.5 but remains exported for
`@langchain/core@^0.3.x` consumers. Will be removed when the 0.3.x line reaches EOL. Migrate to
`createBonklmMiddleware` for v1 codebases.

## Phase-2+ follow-ups (tracked in Story 1.5 backlog)

The full Story 1.5 acceptance criteria split into Phase-2+ follow-up PRs after the Phase-1
foundation lands:

- Real integration tests against `langchain@1.4.x` + `@langchain/core@0.3.x` npm tags (Phase-1 tests
  are mock-based)
- Streaming-aware `wrapModelCall` semantics
- `openAIModerationMiddleware` composition test asserting BonkLM's short-circuit suppresses the
  downstream moderation call
- Full retriever shape coverage (currently covers `BaseRetriever`'s `invoke` surface; v1 adds
  streaming retrievers)
