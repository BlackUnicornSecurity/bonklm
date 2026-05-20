# BonkLM Changelog

All notable changes to BonkLM (`@blackunicorn/bonklm`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-05-20

### Removed
- Dropped the internal BMAD development framework from the repo: deleted `_bmad/`, `.claude/validators-node/`, `tools/`, `tests/` (root-level), `examples/automation/`, `examples/installer/`, `examples/versioning/`, `.githooks/`, BMAD scripts, stale BMAD build artifacts under `dist/`.

### Fixed
- `bash-safety` guard no longer crashes at runtime — replaced `require('path')` (which is unavailable in this ESM package) with a proper `node:path` import. Path containment for `rm -rf` targets now actually executes.
- Cross-platform build — removed BSD-only `sed -i ''` from the core build script in favour of a Node-based import-rewrite step. Ubuntu CI now builds successfully.
- Removed broken `cli` entry from `packages/core/package.json` `bin` field (pointed at a non-existent `.ts` source).
- Fixed three test fixtures in `secret.test.ts` that did not match the documented regex shapes for Slack / Stripe / OpenAI keys.

### Security
- Secret guard now detects 2024+ OpenAI `sk-proj-*` keys that lack the legacy `T3BlbkFJ` infix.
- Unicode normalization (`normalizeText`) is now applied at the entry of the bash-safety, XSS, and secret guards — defeats zero-width-character splitting (`r​m -rf /`) and homoglyph bypass.
- XSS guard no longer skips lines beginning with `//`. Adversarial LLM output prefixed with a comment marker is now scanned.
- Decoded base64 / multi-layer-encoding payloads in `PromptInjectionValidator` are now checked against the full pattern engine instead of a 4-keyword regex.
- New `hasUnvalidatedTail()` helper on the streaming validator — documents the post-stream final-validation contract for connectors.
- CI security audit step no longer suppresses HIGH findings (`|| true` dropped); now runs `pnpm audit --audit-level=high --prod` and fails the build on real advisories.

### Changed
- Node engine requirement raised to `>=20.0.0`. Node 18 removed from CI matrices (EOL April 2025).
- Coverage thresholds enforced in `vitest.config.ts` (80% lines / functions / statements, 75% branches) per project standard.
- All workspace packages aligned to version `0.3.0`. Wizard package no longer carries the `-deprecated` tag.

## [0.2.0] - 2026-02-17

### Added

#### Core Package (@blackunicorn/bonklm)

**Validators**
- PromptInjectionValidator - Multi-layer prompt injection detection with 35+ patterns across 6 categories
  - Unicode normalization and obfuscation detection
  - Base64 payload detection with decoding
  - Multi-layer encoding detection (up to 5 layers deep)
  - HTML comment injection detection
  - Text normalization with hidden character detection
- JailbreakValidator - Comprehensive jailbreak detection with 44 patterns across 10 categories
  - DAN (Do Anything Now) pattern detection
  - Roleplay and character adoption patterns
  - Social engineering and manipulation detection
  - Multi-turn conversation pattern tracking
  - Fuzzy matching for keyword variations
  - Heuristic behavioral analysis
  - Session risk tracking with decay and escalation
- ReformulationDetector - Detects encoded and obfuscated content
  - Code format injection detection
  - Character encoding detection
  - Context overload detection
- BoundaryDetector - Detects system prompt boundary violations
  - System prompt closing detection
  - Control token detection
  - Whitespace evasion pattern detection
- MultilingualPatterns - Multi-language injection detection
  - Support for 10 major languages
  - Language-specific pattern matching

**Guards**
- SecretGuard - Detects and filters 30+ types of secrets and credentials
  - AWS Access Keys and Secret Keys
  - GitHub tokens (PAT, OAuth, User, Server, Refresh)
  - Slack, Stripe, Google API keys
  - OpenAI and Anthropic API keys
  - Twilio, SendGrid, Mailgun keys
  - Azure SAS tokens, GitLab tokens
  - npm tokens, private keys
  - Database connection URLs
  - Shannon entropy validation for unknown secret patterns
  - Example/placeholder content detection
- PIIGuard - Personally Identifiable Information detection
  - Email addresses
  - Social Security Numbers
  - Credit card numbers
  - Phone numbers
  - IP addresses
  - Custom PII pattern support
- BashSafetyGuard - Bash command injection detection
- XSSSafetyGuard - Cross-site scripting pattern detection
- ProductionGuard - Production-mode content filtering

**Core Components**
- GuardrailEngine - Orchestrate multiple validators and guards
  - Short-circuit evaluation option
  - Configurable validation timeout
  - Session tracking integration
  - Telemetry and monitoring support
- SessionTracker - Track conversation state and risk across multiple turns
  - Pattern finding accumulation
  - Risk level escalation
  - Time-based decay
  - Per-session context management
- HookSandbox - Extensible hook system for custom validation logic
- TextNormalizer - Unicode and text normalization utilities
- PatternEngine - Centralized pattern detection with synonym expansion

**Utilities**
- MonitoringLogger - Enhanced logging with metrics collection
- TelemetryService - Observability and analytics support
- CircuitBreaker - Fault tolerance with circuit breaker pattern
- RetryPolicy - Configurable retry logic
- ConfigValidator - Schema-based configuration validation

#### Framework Middleware

**Express Middleware (@blackunicorn/bonklm-express)**
- Drop-in Express middleware for route-level protection
- Request body validation before LLM calls
- Response body validation after LLM responses
- Path-based inclusion/exclusion filters
- Security features:
  - SEC-001: Path traversal protection
  - SEC-007: Production mode generic errors
  - SEC-008: Validation timeout with AbortController
  - SEC-010: Request size limits

**Fastify Plugin (@blackunicorn/bonklm-fastify)**
- Fastify plugin integration
- Same security features as Express middleware
- Fastify-compatible error handling

**NestJS Module (@blackunicorn/bonklm-nestjs)**
- NestJS module with dependency injection
- Configurable guards as decorators
- Module-based configuration

#### AI SDK Connectors

**OpenAI Connector (@blackunicorn/bonklm-openai)**
- Drop-in wrapper for OpenAI SDK
- Input validation for user messages
- Output validation for completions
- Streaming support with incremental validation
- Complex content handling (images, structured data)
- Security features:
  - SEC-002: Incremental stream validation
  - SEC-003: Buffer size limits (1MB default)
  - SEC-006: Complex message content handling
  - SEC-007: Production mode
  - SEC-008: Validation timeout

**Anthropic Connector (@blackunicorn/bonklm-anthropic)**
- Anthropic SDK wrapper for Claude API
- Full streaming support
- Message validation for Anthropic message format
- Image content handling (vision models)

**Vercel AI SDK Connector (@blackunicorn/bonklm-vercel)**
- Integration with Vercel AI SDK
- Support for generateText and streamText
- Incremental stream validation
- Complex message content support

**LangChain Connector (@blackunicorn/bonklm-langchain)**
- LangChain integration
- Chain-level validation
- Tool call validation

**Ollama Connector (@blackunicorn/bonklm-ollama)**
- Local model support via Ollama
- Input/output validation for local LLMs

**HuggingFace Connector (@blackunicorn/bonklm-huggingface)**
- HuggingFace Inference API integration
- Model endpoint protection

#### Emerging Framework Connectors

**Mastra Connector (@blackunicorn/bonklm-mastra)**
- Mastra framework integration
- Agent input/output validation
- Tool call protection (SEC-005)
- Stream validation support
- wrapAgent convenience wrapper

**Genkit Connector (@blackunicorn/bonklm-genkit)**
- Google Genkit plugin
- Flow input/output validation
- Tool call validation
- wrapFlow convenience wrapper

**CopilotKit Connector (@blackunicorn/bonklm-copilotkit)**
- CopilotKit React integration
- User/assistant message validation
- Action call protection

**LlamaIndex Connector (@blackunicorn/bonklm-llamaindex)**
- RAG (Retrieval-Augmented Generation) protection
- Query engine validation
- Document retrieval validation
- createGuardedQueryEngine wrapper
- createGuardedRetriever wrapper

#### Vector Database Connectors

**Pinecone Connector (@blackunicorn/bonklm-pinecone)**
- Query validation for vector searches
- Retrieved vector content validation
- Metadata filter sanitization
- TopK enforcement
- Filter injection prevention

**ChromaDB Connector (@blackunicorn/bonklm-chroma)**
- ChromaDB collection protection
- Query and result validation

**Qdrant Connector (@blackunicorn/bonklm-qdrant)**
- Qdrant point validation
- Filter sanitization

**Weaviate Connector (@blackunicorn/bonklm-weaviate)**
- Weaviate search protection
- GraphQL query validation

#### Other Integrations

**MCP Connector (@blackunicorn/bonklm-mcp)**
- Model Context Protocol integration

**OpenClaw Adapter (@blackunicorn/bonklm-openclaw)**
- OpenClaw framework integration
- Pre/post action hooks

#### Examples

- Custom validator example
- Multi-validator setup example
- Streaming validation example
- Framework-specific examples (Express, Fastify, NestJS)
- AI SDK examples (OpenAI, Anthropic, Vercel)
- Emerging framework examples (Mastra, Genkit, CopilotKit)
- RAG/vector DB examples (LlamaIndex, Pinecone)

#### Documentation

- Getting started guide
- API reference documentation
- Security guide
- Framework middleware integration guide
- AI SDKs connector guide
- LLM providers connector guide
- Emerging frameworks connector guide
- RAG and vector stores connector guide
- Usage patterns and examples

### Changed

#### Core Architecture
- Framework-agnostic design allows use with any Node.js framework
- Modular package structure for tree-shaking
- TypeScript-first with full type definitions
- ESM-only support (Node.js 18+)

#### Configuration
- Flexible validator/guard configuration
- Production mode for generic error messages
- Configurable validation timeouts
- Buffer size limits for streaming

### Security

#### Security Standards Compliance
- OWASP LLM Top 10 (2025) alignment
- Prompt injection defense (LLM01)
- Output poisoning prevention (LLM06)
- Training data disclosure prevention (LLM05)
- Model denial of service protection (LLM07)

#### Security Features
- SEC-001: Path traversal protection via path.normalize()
- SEC-002: Incremental stream validation with early termination
- SEC-003: Max buffer size enforcement (1MB default)
- SEC-005: Tool call injection protection
- SEC-006: Complex content handling for multimodal messages
- SEC-007: Production mode generic error messages
- SEC-008: Validation timeout with AbortController
- SEC-010: Request size limits

#### Implementation Security
- No unsafe eval or Function constructor
- Input sanitization on all user inputs
- Secure handling of encoded content
- Protection against prototype pollution
- SQL/command injection prevention in guards

### Fixed

- Proper handling of complex message content (arrays, images)
- Stream termination on violation detection
- Memory exhaustion protection via buffer limits
- Timeout handling for long-running validations
- Path traversal in filter expressions (vector DBs)

### Performance

- Optimized pattern matching with regex caching
- Efficient text normalization
- Session tracking with automatic cleanup
- Circuit breaker for fault tolerance
- Configurable retry policies

### Testing

- Comprehensive test coverage for all validators
- Integration tests for all connectors
- Security-focused test cases
- Performance benchmarks

### Dependencies

- Node.js 18.0.0 or higher required
- TypeScript 5.3.3 or higher for development
- No runtime dependencies for core package

### License

MIT License - See LICENSE file for details

[Unreleased]: https://github.com/blackunicorn/bonklm/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/blackunicorn/bonklm/releases/tag/v1.0.0
