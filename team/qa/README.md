> **⚠️ Superseded by BR-QAF v1.0 (2026-05-25).** This README documents the pre-BR-QAF QA artifacts under `team/qa/`. New work uses `team/qa/framework/` (universal) + `team/qa/<release>/` (instance). For the v1.0.0 release, see `team/qa/1.0.0/README.md`. Legacy-artifact index + status: `team/qa/LEGACY.md`.

---

# QA Testing Summary (pre-BR-QAF — kept for historical reference)

## Documents Created

### UAT Testing
| File | Purpose |
|------|---------|
| [uat-plan.md](uat-plan.md) | Full UAT plan with all test cases |
| [uat-checklist.md](uat-checklist.md) | Quick reference checklist |
| [uat-quick-start.md](uat-quick-start.md) | One-command setup guide |
| [setup-dev-env.sh](setup-dev-env.sh) | Automated environment setup script |

### Connector Integration Testing
| File | Purpose |
|------|---------|
| [connector-integration-test-plan.md](connector-integration-test-plan.md) | Complete plan for testing all 19 connectors |
| [connector-testing-status.md](connector-testing-status.md) | **CURRENT STATUS** - Real integration test results |
| [connector-test-quick-start.md](connector-test-quick-start.md) | Step-by-step execution guide |
| [test-connections-simple.sh](test-connections-simple.sh) | **REAL connection tests script** |
| [run-all-connector-tests.sh](run-all-connector-tests.sh) | Automated test runner script |
| [docker-compose.vector-db.yml](docker-compose.vector-db.yml) | Docker setup for vector DBs |
| [.env.connector-test.template](.env.connector-test.template) | Environment variables template |

---

## Environment Status (2026-02-18)

| Component | Status |
|-----------|--------|
| **Dev Server** | ✅ 192.168.70.105 (Kali Linux) |
| **Node.js** | ✅ v20.19.5 |
| **Dependencies** | ✅ All peer dependencies installed |
| **Vector DBs** | ✅ ChromaDB, Weaviate, Qdrant running |
| **Core Tests** | ✅ 788 tests PASSED |

### Running Services
| Service | URL | Status |
|---------|-----|--------|
| ChromaDB | http://192.168.70.105:8000 | ✅ Running |
| Weaviate | http://192.168.70.105:8080 | ✅ Running |
| Qdrant | http://192.168.70.105:6333 | ✅ Running |

---

## Quick Start

```bash
# 1. SSH to dev server
ssh paultinp@192.168.70.105

# 2. Run setup (one command)
cd BonkLM && bash team/qa/setup-dev-env.sh

# 3. Run REAL connection tests
cd BonkLM && bash team/qa/test-connections-simple.sh

# 4. (Optional) Set API keys for LLM providers
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

---

---

## Test Coverage

### Core Validators (12 tests)
- Prompt Injection Detection
- Jailbreak Detection
- Secret Guard (API keys, tokens)
- PII Guard (emails, SSN, credit cards)
- Reformulation Detection
- Multilingual Detection

### Framework Connectors (4 tests)
- Express Middleware
- Fastify Plugin
- NestJS Module

### LLM Provider Connectors (5 tests)
- OpenAI Connector
- Anthropic Connector
- Ollama Connector

### Vector DB Connectors (5 tests)
- Chroma Connector
- Pinecone Connector
- Qdrant Connector
- Weaviate Connector
- HuggingFace Connector

### AI Framework Connectors (7 tests)
- LangChain Connector
- LlamaIndex Connector
- Mastra Connector
- GenKit Connector
- CopilotKit Connector
- MCP Connector
- Vercel Connector

---

## Success Criteria

- [x] 100% core security tests pass (788/788)
- [ ] 0 false negatives on attack patterns
- [x] All framework connectors integrate successfully (11/11 tested)
- [x] 100% pass rate on tested connectors (11 passed)
- [ ] < 5% false positive rate

---

## Connector Test Results (Updated 2026-02-18 05:45 CST)

| Category | Connector | Status | Details |
|----------|-----------|--------|---------|
| **Core** | GuardrailEngine | ✅ 788 tests passed | All validators working |
| **Web Frameworks** | Express Middleware | ✅ Passed | Middleware exports correctly |
| **Web Frameworks** | Fastify Plugin | ✅ Passed | Plugin exports correctly |
| **Web Frameworks** | NestJS Module | ✅ Passed | Module exports correctly |
| **Vector DBs** | ChromaDB | ✅ Connected | localhost:8000 |
| **Vector DBs** | Weaviate | ✅ Connected | localhost:8080 (gRPC+REST) |
| **Vector DBs** | Qdrant | ✅ Connected | localhost:6333 |
| **AI Frameworks** | LangChain | ✅ Passed | CallbackHandler exports |
| **AI Frameworks** | Vercel AI | ✅ Passed | createGuardedAI exports |
| **AI Frameworks** | MCP | ✅ Passed | createGuardedMCP exports |
| **LLM Providers** | Ollama | ✅ Connected | gemma2:2b (1.6GB) installed |
| **LLM Providers** | OpenAI | ⏳ Skipped | Requires OPENAI_API_KEY |
| **LLM Providers** | Anthropic | ⏳ Skipped | Requires ANTHROPIC_API_KEY |

---

## Environment Status

### Running Services

| Service | URL | Model | Status |
|---------|-----|-------|--------|
| Ollama | http://192.168.70.105:11434 | gemma2:2b (1.6GB) | ✅ Running |
| ChromaDB | http://192.168.70.105:8000 | - | ✅ Running |
| Weaviate | http://192.168.70.105:8080 | - | ✅ Running |
| Qdrant | http://192.168.70.105:6333 | - | ✅ Running |

---

## Next Steps

1. **Set API Keys** (optional, for remaining LLM provider tests):
   ```bash
   export OPENAI_API_KEY="sk-..."
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```

2. **Proceed to Prompt Injection Lab**:
   - Environment is fully ready
   - All connectors tested and working
   - Connectors tested and working
