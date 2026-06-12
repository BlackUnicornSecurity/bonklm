# BonkLM User Documentation

Complete documentation for BonkLM (`@blackunicorn/bonklm`), the LLM security library.

## Quick Start

```bash
npm install @blackunicorn/bonklm
```

```typescript
import { validatePromptInjection } from '@blackunicorn/bonklm';

const result = validatePromptInjection(userInput);

if (!result.allowed) {
  console.log('Blocked:', result.reason);
} else {
  // Content is safe to process
}
```

---

## Documentation

### Getting Started

- [Getting Started Guide](../getting-started.md) - Installation and basic usage
- [API Reference](../api-reference.md) - Complete API documentation

### Connector Guides

Integrate guardrails with your favorite frameworks and platforms:

| Category                                                     | Connectors                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| [Framework Middleware](./connectors/framework-middleware.md) | Express, Fastify, NestJS                                      |
| [AI SDKs](./connectors/ai-sdks.md)                           | OpenAI, Anthropic, Vercel AI SDK, MCP                         |
| [LLM Providers](./connectors/llm-providers.md)               | LangChain, Ollama                                             |
| [Emerging Frameworks](./connectors/emerging-frameworks.md)   | Mastra, Genkit, CopilotKit                                    |
| [RAG & Vector Stores](./connectors/rag-vector-stores.md)     | LlamaIndex, Pinecone, ChromaDB, Weaviate, Qdrant, HuggingFace |

### Guides

- [Security Guide](./guides/security-guide.md) - Security best practices and attack prevention
- [Usage Examples](./examples/usage-patterns.md) - Common patterns and code examples

---

## Installation

### Core Package

```bash
npm install @blackunicorn/bonklm
```

### With Connectors

```bash
# Express middleware
npm install @blackunicorn/bonklm-express

# Fastify plugin
npm install @blackunicorn/bonklm-fastify

# NestJS module
npm install @blackunicorn/bonklm-nestjs

# OpenAI SDK
npm install @blackunicorn/bonklm-openai

# Anthropic SDK
npm install @blackunicorn/bonklm-anthropic

# Vercel AI SDK
npm install @blackunicorn/bonklm-vercel

# LangChain
npm install @blackunicorn/bonklm-langchain

# Ollama
npm install @blackunicorn/bonklm-ollama

# LlamaIndex
npm install @blackunicorn/bonklm-llamaindex

# Pinecone
npm install @blackunicorn/bonklm-pinecone

# ChromaDB
npm install @blackunicorn/bonklm-chroma

# Weaviate
npm install @blackunicorn/bonklm-weaviate

# Qdrant
npm install @blackunicorn/bonklm-qdrant

# HuggingFace
npm install @blackunicorn/bonklm-huggingface

# Mastra
npm install @blackunicorn/bonklm-mastra

# Genkit
npm install @blackunicorn/bonklm-genkit

# CopilotKit
npm install @blackunicorn/bonklm-copilotkit

# MCP
npm install @blackunicorn/bonklm-mcp
```

---

## Core Features

| Feature                        | Description                                                          |
| ------------------------------ | -------------------------------------------------------------------- |
| **Prompt Injection Detection** | 35+ patterns across 6 categories with multi-layer encoding detection |
| **Jailbreak Detection**        | 44 patterns across 10 categories                                     |
| **Secret Guard**               | Detects 30+ types of API keys and credentials                        |
| **PII Guard**                  | Personal information detection and redaction                         |
| **Reformulation Detection**    | Code format, encoding, and context overload                          |
| **Bash Safety Guard**          | Command injection detection                                          |
| **XSS Safety Guard**           | Cross-site scripting pattern detection                               |
| **GuardrailEngine**            | Orchestrate multiple validators                                      |
| **Hook System**                | Extensible middleware for custom logic                               |

---

## Quick Examples

### Express Middleware

```typescript
import express from 'express';
import { createGuardrailsMiddleware } from '@blackunicorn/bonklm-express';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const app = express();
app.use(express.json());

app.use(
  '/api/ai',
  createGuardrailsMiddleware({
    validators: [new PromptInjectionValidator()]
  })
);

app.post('/api/ai/chat', async (req, res) => {
  const response = await callLLM(req.body.message);
  res.json({ response });
});
```

### OpenAI SDK

```typescript
import OpenAI from 'openai';
import { createGuardedOpenAI } from '@blackunicorn/bonklm-openai';

const openai = new OpenAI();
const guardedOpenAI = createGuardedOpenAI(openai, {
  validators: [new PromptInjectionValidator()]
});

const response = await guardedOpenAI.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: userInput }]
});
```

### LlamaIndex RAG

```typescript
import { createGuardedQueryEngine } from '@blackunicorn/bonklm-llamaindex';

const guardedEngine = createGuardedQueryEngine(queryEngine, {
  validators: [new PromptInjectionValidator()]
});

const response = await guardedEngine.query({ query: userInput });
```

---

## Security Best Practices

1. **Always validate both input and output** - Don't trust LLM responses
2. **Use production mode** - Enable generic error messages in production
3. **Set validation timeouts** - Prevent DoS attacks
4. **Use short-circuit mode** - Stop validation on first detection
5. **Monitor blocked requests** - Track attack patterns
6. **Update validators regularly** - Keep up with new attack techniques

See the [Security Guide](./guides/security-guide.md) for complete best practices.

---

## Support

- **Issues**: Report bugs on [GitHub](https://github.com/blackunicorn/bonklm/issues)
- **Documentation**: [https://docs.bonklm.dev](https://docs.bonklm.dev)
- **Examples**: [examples/](./examples/) directory

---

## License

MIT © Black Unicorn
