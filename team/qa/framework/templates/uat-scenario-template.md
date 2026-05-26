# UAT Scenario Template

User-acceptance-testing scenarios are run from the perspective of a consumer with a fresh `node_modules`. Distinct from the in-tree UAT harness at `packages/core/uat/` which exercises BonkLM from its own monorepo. Goal: prove that the documented quick-start works end-to-end without the tester reading source, fixing a doc bug inline, or overriding any default.

## Personas

| Persona | Typical connector class | Scenario complexity |
|---|---|---|
| Web developer | express-middleware, fastify-plugin, nestjs-module, hono-middleware, elysia-plugin | Install + register middleware + assert request blocked |
| AI engineer | openai-connector, anthropic-connector, vercel-connector, langchain-connector, openai-agents-connector, mistral-connector, google-genai-connector | Install + wrap client + assert hostile-prompt blocked |
| Vector-DB integrator | chroma, pinecone, qdrant, weaviate, turbopuffer, lance | Install + wrap retrieval + assert hostile-doc blocked |
| Edge developer | cloudflare-agents-connector, nextjs-helpers, browser-agents-core | Install + deploy to edge + assert validator fires |
| Agent runtime developer | elizaos-connector, openai-agents-connector, mastra-connector, eko-connector, voltagent-connector | Install + register plugin + assert blocked action |
| CLI consumer | core (`bonklm` CLI) | Install via `npx` + run `wizard` + run `doctor` |
| Voice / Realtime developer | voice-webhooks, livekit-connector | Install + wire webhook handler + assert HMAC + body validation |
| Memory integrator | letta-connector, mem0-connector, zep-connector | Install + wrap memory client + assert sealed-write |
| Sandbox integrator | e2b-adapter, daytona-adapter, sandbox-utils | Install + wrap sandbox + assert code-injection block |
| Document ingestion engineer | document-ingest | Install + wrap parser + assert PI in document blocked |

## Scenario skeleton (copy per connector)

```markdown
## UAT Scenario — `{{NAME}}`

### Persona
{{Web developer | AI engineer | …}}

### Environment
- Host: Battlefield (`ssh paultinp@192.168.0.107`) OR clean local container
- Runtime: Clean Node {{LTS}} container (`docker run --rm -it node:20-alpine sh`)
- No prior `node_modules` state
- Network sandbox: only allow LLM-provider + vector-DB hosts as the scenario requires
- Reset policy: `docker run --rm` per scenario; no state leakage between scenarios

### Steps

1. `mkdir /tmp/uat-{{name}} && cd /tmp/uat-{{name}}`
2. `npm init -y`
3. `npm install @blackunicorn/bonklm @blackunicorn/bonklm-{{name}} {{peerSDK}}`
4. Copy the quick-start code block from `docs/user/connectors/{{name}}.md` into `index.ts` verbatim
5. Set required env vars (per the docs — DO NOT improvise):
   - `{{ENV_VAR_1}}=…`
6. Run ALLOW invocation: `node --import tsx index.ts allow`
7. Run BLOCK invocation: `node --import tsx index.ts block` with hostile input from dojoLM corpus (category: `{{category}}`)

### Pass criteria (binary)

- Step 4: code from docs compiles without modification
- Step 5: env vars from docs are sufficient (no undocumented vars surface)
- Step 6: ALLOW returns expected response within {{timeout}} seconds
- Step 7: BLOCK returns guardrail error with expected reason text + telemetry event captured

### Evidence captured

- `install.log` — full `npm install` transcript
- `run-allow.log` — stdout + stderr of ALLOW run
- `run-block.log` — stdout + stderr of BLOCK run
- `block.png` — terminal screenshot of the BLOCK response (if UI-adjacent)
- `summary.md` — PASS / FAIL + total duration + any deviation from documented quick-start

### Failure-mode triage

- If step 4 fails (doc code doesn't compile): file Gate 7 defect against `docs/user/connectors/{{name}}.md`
- If step 5 surface undocumented vars: file Gate 7 defect with the missing vars enumerated
- If step 6 ALLOW returns BLOCK or vice-versa: file Gate 4 defect against connector logic
- If step 7 BLOCK returns wrong reason text: file Gate 4 defect; document expected vs actual

### Sign-off

- UAT tester: ___ Date: ___ Result: PASS | FAIL
- Senior QA: ___ Date: ___ Result: PASS | FAIL
```

## UAT environment requirements (universal)

1. **Clean Node {{LTS}} container per scenario.** No host state contamination. Use `docker run --rm`.
2. **Network sandboxing.** Default deny; allow only the providers the scenario explicitly needs.
3. **Recorded fixtures preferred over live API calls** where the connector supports it, to avoid flakes and quota drain. Document which scenarios use live vs recorded.
4. **Time budget per scenario:** 15 minutes max from cold start to PASS / FAIL determination. If a scenario exceeds 15 minutes, file a Gate 7 defect against the connector's quick-start.
5. **Evidence storage:** `team/qa/<version>/evidence/gate-4/ST-04-NNN/uat/` per scenario.

## Aggregated PASS criterion

The UAT plan PASSes when:
- 100 % of scenarios reach PASS state
- 0 unresolved Gate 7 doc defects
- 0 unresolved Gate 4 connector defects
- Senior QA signs off via `05-senior-qa-signoff.md` item #15

## Source-of-truth corpus

Hostile inputs for BLOCK steps come from the dojoLM corpus at `/Users/paultinp/BU-TPI/packages/bu-tpi/fixtures/<category>/`. Categories map to connector types:

| Connector class | dojoLM category |
|---|---|
| LLM SDK wrapper | `prompt-injection/`, `jailbreaks/` |
| Framework middleware | `prompt-injection/` via POST body |
| Vector-DB | `rag/`, `document-attacks/` |
| Memory | `prompt-injection/` (sealed-write attempts) |
| Agent / tool | `agent/`, `mcp/`, `webmcp/` |
| Sandbox | `dos/`, `output/` |
| Document ingest | `document-attacks/`, `encoded/` |
| Voice / Realtime | `audio-attacks/`, `audio/` |

Corpus snapshot hash + license review status: see `team/qa/<version>/04-risk-register.md` R-3.
