# Agentic tool coverage

Where BonkLM has a connector today, where it does not, and why. Ranked by live data, not by taste.

**Data fetched 2026-08-16.** Stars from the GitHub REST API
(`repos/{owner}/{repo}.stargazers_count`); weekly downloads from the npm registry API
(`downloads/point/last-week`). Reproduce with `gh api repos/<owner>/<repo> --jq .stargazers_count`
and `curl https://api.npmjs.org/downloads/point/last-week/<pkg>`. Both figures move continuously —
treat this as a one-day ranking, not a current statistic, and re-fetch before quoting any number
anywhere public.

---

## Method

Two rankings, because they answer different questions:

- **Stars** measure mindshare across the whole agentic landscape, including Python-only projects.
- **npm weekly downloads** measure the surface BonkLM can actually connect to, because every BonkLM
  connector is a TypeScript package that wraps a JavaScript SDK.

A Python-only framework cannot take a TypeScript connector. For those, the integration path is
`@blackunicorn/bonklm-mcp` (BonkLM sits on the MCP tool boundary) or `@blackunicorn/bonklm-server`
(BonkLM sits in front as an HTTP guardrail gateway). Both are language-agnostic and shipped.

---

## Ranked landscape vs. BonkLM coverage

| #   | Project                      | Stars   | Language | BonkLM connector                             |
| --- | ---------------------------- | ------- | -------- | -------------------------------------------- |
| 1   | NousResearch/hermes-agent    | 231,407 | Python   | **none** — MCP bridge today (see below)      |
| 2   | n8n-io/n8n                   | 200,874 | TS       | **none** — gap                               |
| 3   | ollama/ollama                | 178,691 | Go/JS    | `bonklm-ollama`                              |
| 4   | langgenius/dify              | 152,604 | TS       | **none** — gap (platform, see below)         |
| 5   | langchain-ai/langchain       | 144,342 | Py + TS  | `bonklm-langchain`                           |
| 6   | browser-use/browser-use      | 109,416 | Python   | **none** — MCP / gateway path                |
| 7   | modelcontextprotocol/servers | 89,611  | multi    | `bonklm-mcp`                                 |
| 8   | mem0ai/mem0                  | 63,376  | Py + TS  | `bonklm-mem0`                                |
| 9   | microsoft/autogen            | 60,454  | Python   | **none** — MCP / gateway path                |
| 10  | crewAIInc/crewAI             | 57,164  | Python   | **none** — MCP / gateway path                |
| 11  | FlowiseAI/Flowise            | 55,378  | TS       | **none** — gap                               |
| 12  | run-llama/llama_index        | 51,680  | Py + TS  | `bonklm-llamaindex`                          |
| 13  | agno-agi/agno                | 41,731  | Python   | **none** — MCP / gateway path                |
| 14  | langchain-ai/langgraph       | 39,801  | Py + TS  | **none** — gap (highest-value TS gap)        |
| 15  | stanfordnlp/dspy             | 37,296  | Python   | **none** — MCP / gateway path                |
| 16  | ComposioHQ/composio          | 29,715  | Py + TS  | **none** — gap                               |
| 17  | huggingface/smolagents       | 28,823  | Python   | **none** — MCP / gateway path                |
| 18  | openai/openai-agents-python  | 28,676  | Python   | TS sibling covered by `bonklm-openai-agents` |
| 19  | microsoft/semantic-kernel    | 28,455  | .NET/Py  | **none** — MCP / gateway path                |
| 20  | mastra-ai/mastra             | 27,229  | TS       | `bonklm-mastra`                              |

Below the top 20, already covered: `vercel/ai` (26,223) → `bonklm-vercel`; `deepset-ai/haystack`
(26,222) → none, Python; `letta-ai/letta` (24,271) → `bonklm-letta`; `browserbase/stagehand`
(23,955) → `bonklm-stagehand`; `pydantic/pydantic-ai` (19,331) → none, Python; `elizaOS/eliza`
(19,064) → `bonklm-elizaos`; `camel-ai/camel` (17,591) → none, Python; `VoltAgent/voltagent`
(10,367) → `bonklm-voltagent`; `FellouAI/eko` (4,949) → `bonklm-eko`; `getzep/zep` (4,842) →
`bonklm-zep`.

### npm reality check (the surface a TS connector can reach)

| Package                     | Weekly downloads | BonkLM connector       |
| --------------------------- | ---------------- | ---------------------- |
| `@modelcontextprotocol/sdk` | 35,101,265       | `bonklm-mcp`           |
| `ai` (Vercel AI SDK)        | 18,372,863       | `bonklm-vercel`        |
| `@langchain/core`           | 3,782,668        | `bonklm-langchain`     |
| `@langchain/langgraph`      | 2,238,160        | **none — top TS gap**  |
| `@mastra/core`              | 1,240,414        | `bonklm-mastra`        |
| `@browserbasehq/stagehand`  | 1,194,603        | `bonklm-stagehand`     |
| `@openai/agents`            | 1,084,033        | `bonklm-openai-agents` |
| `@composio/core`            | 487,540          | **none — gap**         |
| `n8n`                       | 111,550          | **none — gap**         |
| `llamaindex`                | 90,924           | `bonklm-llamaindex`    |
| `@voltagent/core`           | 22,814           | `bonklm-voltagent`     |
| `@elizaos/core`             | 15,247           | `bonklm-elizaos`       |

The three largest TypeScript surfaces are covered. The largest uncovered one — and the only gap
above a million weekly downloads — is **LangGraph**, at number four.

---

## Gap list, in build order

| Rank | Target    | Why                                                                                                                                                                                                    |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | LangGraph | 2.2M weekly npm downloads, first-class TS, adjacent to the LangChain connector we already ship. Graph nodes and checkpointed state are exactly the tool-call / memory-write surfaces BonkLM validates. |
| 2    | Composio  | 488k weekly npm downloads and it is a _tool_ provider — the tool-call boundary is BonkLM's core surface.                                                                                               |
| 3    | Dify      | 152k stars, TS, self-hosted. A platform, not an SDK — the integration is a plugin, not a wrapper.                                                                                                      |
| 4    | n8n       | 200k stars, TS, self-hosted; a node wrapping BonkLM would put guardrails in a workflow builder. Different shape (an n8n node, not an SDK wrapper) — needs its own design pass.                         |
| 5    | Flowise   | 55k stars, TS, same shape as n8n and Dify.                                                                                                                                                             |
| 6    | Hermes    | Largest single target by stars, but Python — see below.                                                                                                                                                |

Python-only frameworks (browser-use, AutoGen, CrewAI, Agno, DSPy, smolagents, Semantic Kernel,
Haystack, PydanticAI, CAMEL) are **not** individual connector work. They are one shared problem, and
the answer already ships: MCP or the HTTP gateway. Building eleven Python packages BonkLM cannot
test in its own CI would be worse coverage, not better.

---

## Hermes

**NousResearch/hermes-agent** — 231,407 stars, Python, MIT, actively maintained (all four verified
against the GitHub API on 2026-08-16). The single largest agentic target measured, and BonkLM has no
connector.

### Recommendation: do not build a `bonklm-hermes` npm package

Hermes is Python. A TypeScript connector package for a Python framework has nothing to wrap. What
Hermes _is_, architecturally, is an **MCP host** — and BonkLM already guards the MCP tool boundary.

### Integration path (available today, no new package)

Hermes is documented by its own README as an MCP host; `@blackunicorn/bonklm-mcp` wraps the MCP SDK
surface so tool calls and tool results pass through BonkLM validators. Because MCP is a wire
protocol, this works from a Python host without any Python BonkLM code:

1. Run a BonkLM-guarded MCP server (Node) that Hermes connects to as a normal MCP server.
2. Or run `@blackunicorn/bonklm-server` and point Hermes' model traffic at its `/openai-compatible`
   endpoint, so prompts and completions are validated in front of the model.

Both are language-agnostic and already covered by BonkLM's test suite.

### If a first-class integration is wanted later

Hermes documents a plugin system. The first-class path is a **Hermes plugin** (Python) that calls
BonkLM over the `bonklm-server` HTTP gateway at the tool boundary — mirroring how the ElizaOS
connector sits at that boundary in the JS world. That is a Python deliverable in a Python repo, with
its own release lane; it is deliberately out of scope for this TypeScript monorepo and should be
filed as its own story rather than smuggled in as a 53rd npm package.

### Detection today

The wizard surfaces the MCP connector whenever `@modelcontextprotocol/sdk` is in the project, which
is the reachable signal from a Node project. A Python Hermes install is not visible in a
`package.json` and is not claimed to be.

---

## Status of the mem0 provider catalog

The upstream **mem0 provider catalog** (`mem0ai/mem0`, Apache-2.0) offers LLM providers, vector
stores and embedders, each a small Python module with a uniform provider-name + config-schema
descriptor.

That catalog informed the **descriptor shape** used in
[`connector-descriptors.md`](./connector-descriptors.md). Its provider _list_ was deliberately not
imported: BonkLM cannot guard a vector store it has no connector for, so registering
`azure_ai_search` or `neptune_analytics` in the wizard would offer the user configuration for
something that does nothing. BonkLM's own six vector-store connectors (Chroma, LanceDB, Pinecone,
Qdrant, Turbopuffer, Weaviate) are the honest surface. No mem0 schema text was copied, so no NOTICE
attribution is required.
