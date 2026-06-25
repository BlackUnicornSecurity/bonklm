# BonkLM Public API Surface (v1.0.0-rc.4 freeze)

Audit baseline for the v1.0-RC API freeze (Sprints 26-28 / Story 4.7, extended across Sprints 29–51
post-rc.3 hardening). This document enumerates what is **PUBLIC** (frozen for v2.0) vs **INTERNAL**
(may change without notice in v1.x).

## Versioning policy

- **PUBLIC** exports follow SemVer. Breaking changes require a major bump (v2.0).
- **INTERNAL** exports — names prefixed `_` or under `/internal/` paths — may change in any minor /
  patch.
- Items NOT exported from a package's main barrel (`./index.ts`) are internal regardless of file
  location.

## `@blackunicorn/bonklm` (core)

### PUBLIC — frozen at v1.0

#### Engine

- `GuardrailEngine` (class)
- `GuardrailEngineConfig` (interface)
- `Validator` (interface)
- `Guard` (interface)
- `ValidatorInput` (discriminated union)
- `ValidatorResult` (interface)
- `EngineResult` (interface)
- `ExecutionOrder` (type)
- `InterceptCallback` (type)
- `CircuitBreaker` (class)
- `CircuitBreakerState` (enum)
- `CircuitBreakerMetrics` (interface)

#### Validators

- `PromptInjectionValidator` (class) — `name = 'prompt-injection'`
- `JailbreakValidator` (class) — `name = 'jailbreak'`
- `EncodedRescanValidator` (class) — decode-then-rescan; with `validateEncodedRescan` (function) and
  `EncodedRescanConfig` (interface)
- `MultilingualDetector` (class) — `name = 'multilingual'`
- `AudioStreamValidator` (class) — `name = 'audio_stream'`
- `CodeInjectionValidator` (class) — `name = 'code_injection'`
- `PathTraversalValidator` (class) — `name = 'path_traversal'`
- `ComposedContextValidator` (factory)
- `createMemoryWriteValidator` (factory) — `name = 'MemoryWriteValidator'`
- `createRetrievedDocValidator` (factory) — `name = 'RetrievedDocValidator'`
- `ToolCallArgsValidator` (class)
- `IndirectInjectionValidator` (class) — `name = 'IndirectInjectionValidator'`; with
  `createIndirectInjectionValidator` (factory) and `IndirectInjectionConfig` (interface).
  Provenance-gated connector-boundary indirect prompt-injection detection; appended automatically
  into the four connector factories above. Never runs on raw user text.
- `appendIndirectInjectionArm` / `appendToolResultInjectionArm` (functions) — the shared composer
  that appends the surface-tagged `IndirectInjectionValidator` onto a caller's validator chain
  (returns a new chain; never mutates the input). The append-ordering + surface tag live here once;
  the four composite factories call it instead of re-pasting the literal, and connector inbound
  tool-result paths call `appendToolResultInjectionArm` for the same one-place guarantee.

#### Provenance (connector-boundary contract)

- `ProvenanceBoundary` (type) — the surface tag (`retrieved_doc` / `composed_context` /
  `tool_result` / `memory_write`) the shipped arms gate on; **stable**.
- `Provenance`, `ToolResultRef`, `ProvenanceSource` (types) — the wire-envelope contract; tagged
  `@experimental` (the connector stamping that populates it is a later increment) — may change
  before the v1.0 surface freeze.
- `hasToolResultProvenance`, `isToolDerivedRef` (functions) — the chain-level and per-ref
  tool-derived predicates that gate every provenance consumer
- `MemoryWriteMetadata` (interface) — types the `metadata.provenance` slot on `MemoryWritePayload`
- `rescanLaunderedProvenance` (function) + `ProvenanceRescanResult` (interface) + the
  `RAW_UPSTREAM_MATCH_REDACTED` marker — the Home-E laundering re-scan consumer that
  `createMemoryWriteValidator` runs over a write's provenance chain (Node-only; depends on the
  raw-upstream cache, so not a named `/edge` export — transitively reachable on Node-compat edge)
- `INDIRECT_INJECTION_PATTERNS`, `detectIndirectInjection` and the `runWithRawUpstreamCache` /
  `putRawUpstream` / `getRawUpstream` / `rawUpstreamCacheActive` primitives are barrel-reachable but
  **tactical / forward-contract** (the cache is populated by later connector increments) — treat as
  experimental, not part of the frozen v1.0 surface, until the connector increments land.
  (Classification pending maintainer confirmation — see the PR-A audit triage.)

#### Cache + replay

- `cachedValidate` (function)
- `InMemoryLRUCache` (class)
- `ValidatorCache` (interface)
- `createSaltedKeyFn` / `createUnsaltedKeyFn` (factories)
- `defaultKeyFn` (function)

#### Connector utilities

- `BufferedReleaseGate` (class)
- `StreamValidator` (class)
- `applyRetrievedDocValidatorToMatches` (function)
- `adaptValidatorToUniversalInput` (function)
- `extractStringContent` (function)
- `assertNotWrapped` / `markWrapped` / `ensureWrappedOnce` (functions) — imported from the
  `@blackunicorn/bonklm/core/connector-utils` subpath (these three are intentionally NOT re-exported
  from the root barrel)
- **`validateWithTimeoutSecure` (function)** — Sprint 30 SEC-008 canonical timeout primitive. ALL
  connector authors MUST use this instead of rolling their own AbortController-based timeout (the
  AbortSignal does not propagate to `engine.validate()`).
- **`ValidateWithTimeoutOptions<R>` (interface)** — options bag for `validateWithTimeoutSecure`.
  Frozen at rc.2: `operation` + `timeoutMs` + `timeoutSentinel` + optional `logger`. Future
  extensions are additive.
- **`TimeoutSentinelShape` (interface)** — minimum shape every `R` must satisfy
  (`{ allowed: boolean }`). The `allowed: false` invariant is the SEC-008 security boundary on
  timeout. Connectors that surface `GuardrailResult` / `EngineResult` / wrapped shapes automatically
  satisfy this via structural typing.

The hardcoded fallback sentinel (used when the caller's `timeoutSentinel()` factory itself throws)
is shaped like `GuardrailResult` with `Severity.CRITICAL`. Connectors should keep their factory
shape compatible with `GuardrailResult` to avoid sentinel-shape divergence in BonklmBlockEvent
telemetry sinks.

#### Telemetry

- `BonklmBlockEvent` (discriminated union, 7 kinds)
- `BonklmBlockEventKind` (type)
- `isBonklmBlockEvent` (type guard)
- `bonklmTrace` (function)
- `BonklmTracer` / `BonklmSpan` (interfaces)
- `BonklmTraceSurface` (R2-10 locked vocab)

#### Result types

- `GuardrailResult` (interface)
- `Severity` (enum)
- `RiskLevel` (enum)
- `Finding` (interface)
- `createResult` (factory)

#### Guards

- `SecretGuard` (class)
- `BashSafetyGuard` (class)
- `XSSGuard` (class)

#### Hooks

- `HookManager` (class)
- `HookContext` (interface)

#### Config validation (Sprint 29)

- `Schema` (class) — composable per-key rule schema.
- `Validators` (registry) — pre-defined rules accessor.
- `ConfigValidationError` (class).
- Rule classes: `NumberRangeRule`, `TypeRule`, `EnumRule`, `FunctionRule`, `ValidatorInstanceRule`,
  `LoggerInstanceRule`, `AttackLoggerInstanceRule`, `ArrayRule`, `ObjectRule`, `OptionalRule`,
  `CustomRule`.
- Rule accessors:
  `Validators.{positiveNumber, percentage, timeout, boolean, string, number, function, validatorInstance, loggerInstance, attackLoggerInstance, array, object, enum, optional, custom}`.
- **`validatorInstance`** + **`loggerInstance`** + **`attackLoggerInstance`** added Sprint 29 to
  match the canonical object-shape `Validator` / `Logger` / `AttackLogger` interfaces (the older
  `function` rule rejects class instances). Use these for connector middleware schemas that accept
  user-supplied validators / loggers.
- **`OptionalRule` semantics (Sprint 29)**: short-circuits on `undefined` only. Explicit `null`
  flows into the inner rule (typically rejected by `TypeRule`). Callers should omit the key or pass
  `undefined` to signal absence — the JS-canonical pattern.

#### Additional PUBLIC surface (root-barrel exports referenced in the user guides)

Per the policy above, every non-`_` symbol re-exported from the root barrel is `@public`. These are
documented in the Getting Started / security guides but were not previously enumerated here;
catalogued for completeness (not a surface change):

- **Function-form validators** — `validatePromptInjection`, `validateSecrets` (functions; one-shot
  wrappers over the validator classes).
- **Logging** — `MonitoringLogger` (class) / `createMonitoringLogger` (factory) /
  `MonitoringLogLevel` (enum); `ConsoleLogger` / `NullLogger` (classes);
  `createLogger('console' | 'null' | 'custom')` (factory); `Logger` (interface).
- **Additional guards** — `PIIGuard` (class); `checkBashSafety` (function — function form of
  `BashSafetyGuard`).
- **Connector error classes** — `ConnectorValidationError`, `StreamValidationError`,
  `ConnectorConfigurationError`, `ConnectorTimeoutError` (also exported from the
  `@blackunicorn/bonklm/core/connector-utils` subpath).
- **Edge hooks** — `EdgeHookManager` (class) + `HookPhase` (enum); edge-portable surface via the
  `@blackunicorn/bonklm/edge` subpath.
- **Rate limiting** — `RateLimiter` (class) / `createRateLimiter` (factory) / `CommonRateLimiters`
  (presets) / `DEFAULT_RATE_LIMIT`; opt-in per-instance limiter (see
  `docs/user/security/rate-limiting.md`).

> Note: the root barrel currently re-exports a number of lower-level helpers (pattern arrays,
> `analyze*` / `detect*` families, internal constants) that are intended as **INTERNAL / tactical**
> (see below) despite being reachable from the barrel. A maintainer-led full surface re-audit to
> reconcile the "barrel = `@public`" policy with these tactical exports is tracked as a follow-up.

### INTERNAL — may change without notice

- `_resetFailOpenWarnState` (function) — test-only WARN-state reset.
- `_defaultCodeValidator`, `_defaultCodeWrapperKey` (lazy singletons).
- `RegexCache` (class) — internal regex compilation cache.
- `pattern-engine.ts` named exports beyond `PatternFinding` / `PatternDefinition` — pattern arrays +
  the `detectPatterns` function are tactical and may be re-organised.
- `validateBytes` / `analyze*` family on individual validators — prefer the unified
  `validate(input)` entry.

## Per-connector packages

### Shared API patterns

All `@blackunicorn/bonklm-*` connector packages expose:

- ONE wrap function (e.g. `wrapMistral`, `wrapLlamaParse`, `withBonklmAgent`) OR
- ONE handler factory (e.g. `createVapiHandler`, `bonklmGuardrails`).
- ONE block-event type matching the core `BonklmBlockEvent` discriminated union (kind-stamped).
- ONE error class extending Error (e.g. `MistralGuardrailBlockedError`, `LiveKitGuardrailError`).
- Type re-exports for the SDK surfaces wrapped (`*Like` structural types).

### PUBLIC convention

Anything re-exported from a package's main `./index.ts` is PUBLIC.

### INTERNAL convention

Anything NOT in `./index.ts` is internal. The pattern:

- `src/index.ts` → barrel of public surface
- `src/<wrap-file>.ts` → implementation (some symbols exported for internal use across files within
  the package; not part of public API)
- `src/types.ts` → public types

## Deprecated paths slated for removal at v1.0-RC

Per Story 4.7 (Sprints 26-28):

| Symbol                      | Reason                                                                                                                              | Removal Sprint                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `messagesToTextLegacy`      | Replaced by `messagesToText` (Story 1.5)                                                                                            | Sprint 26                                                                                                             |
| `GuardrailsCallbackHandler` | Replaced by `wrapLangChain` (Story 1.5)                                                                                             | Sprint 26                                                                                                             |
| sync `validateToken`        | Replaced by async `validate` (Story 1.6)                                                                                            | Sprint 27                                                                                                             |
| `openclaw-adapter` package  | **REMOVED FROM PUBLISH SET v1.0.0**. Pre-existing deprecation banner retained at `docs/openclaw-integration.md` for rc.x consumers. | Migrate to native framework middleware (Express, Fastify, NestJS, Hono, Elysia, Next.js) before 2026-07-01 date gate. |

## API freeze plan

**Sprint 26 (v1.0-RC1)**:

- Audit every barrel export across the publishable package surface.
- Mark each as `@public` (frozen) or `@internal` (free to change).
- Remove deprecated paths above.
- Cut v1.0-RC1 tag.

**Sprint 27 (v1.0-RC2)**:

- Open 30-day public-comment window on the frozen surface.
- Triage incoming feedback.
- Bug-fix-only commits.

**Sprint 28 (v1.0.0)**:

- Final compatibility audit.
- v1.0.0 publish.
- API freeze: no removal until v2.0.

## Compatibility statement

After v1.0.0, removing any `@public` symbol triggers a major version bump. Adding symbols is a minor
bump. Bug fixes and internal-only changes are patches.

Last updated: v1.0.0-rc.4.
