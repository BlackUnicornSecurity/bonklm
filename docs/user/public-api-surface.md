# BonkLM Public API Surface (v0.7.0 → v1.0-RC freeze prep)

Sprint 25 audit prep for v1.0-RC API freeze (Sprints 26-28 / Story 4.7).
This document enumerates what is **PUBLIC** (frozen for v2.0) vs
**INTERNAL** (may change without notice in v1.x).

## Versioning policy

- **PUBLIC** exports follow SemVer. Breaking changes require a major
  bump (v2.0).
- **INTERNAL** exports — names prefixed `_` or under `/internal/`
  paths — may change in any minor / patch.
- Items NOT exported from a package's main barrel (`./index.ts`) are
  internal regardless of file location.

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
- `MultilingualDetector` (class) — `name = 'multilingual'`
- `AudioStreamValidator` (class) — `name = 'audio_stream'`
- `CodeInjectionValidator` (class) — `name = 'code_injection'`
- `PathTraversalValidator` (class) — `name = 'path_traversal'`
- `ComposedContextValidator` (factory)
- `createMemoryWriteValidator` (factory) — `name = 'MemoryWriteValidator'`
- `createRetrievedDocValidator` (factory) — `name = 'RetrievedDocValidator'`
- `ToolCallArgsValidator` (class)

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
- `assertNotWrapped` / `markWrapped` / `ensureWrappedOnce` (functions)

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

### INTERNAL — may change without notice
- `_testOnlyClearSentinel` (function) — test-only sentinel reset.
- `_resetFailOpenWarnState` (function) — test-only WARN-state reset.
- `_defaultCodeValidator`, `_defaultCodeWrapperKey` (lazy singletons).
- `RegexCache` (class) — internal regex compilation cache.
- `pattern-engine.ts` named exports beyond `PatternFinding` /
  `PatternDefinition` — pattern arrays + the `detectPatterns` function
  are tactical and may be re-organised.
- `validateBytes` / `analyze*` family on individual validators —
  prefer the unified `validate(input)` entry.

## Per-connector packages

### Shared API patterns

All `@blackunicorn/bonklm-*` connector packages expose:
- ONE wrap function (e.g. `wrapMistral`, `wrapLlamaParse`,
  `withBonklmAgent`) OR
- ONE handler factory (e.g. `createVapiHandler`,
  `bonklmGuardrails`).
- ONE block-event type matching the core `BonklmBlockEvent`
  discriminated union (kind-stamped).
- ONE error class extending Error (e.g.
  `MistralGuardrailBlockedError`, `LiveKitGuardrailError`).
- Type re-exports for the SDK surfaces wrapped (`*Like` structural
  types).

### PUBLIC convention
Anything re-exported from a package's main `./index.ts` is PUBLIC.

### INTERNAL convention
Anything NOT in `./index.ts` is internal. The pattern:
- `src/index.ts` → barrel of public surface
- `src/<wrap-file>.ts` → implementation (some symbols exported for
  internal use across files within the package; not part of public API)
- `src/types.ts` → public types

## Deprecated paths slated for removal at v1.0-RC

Per Story 4.7 (Sprints 26-28):

| Symbol | Reason | Removal Sprint |
|---|---|---|
| `messagesToTextLegacy` | Replaced by `messagesToText` (Story 1.5) | Sprint 26 |
| `GuardrailsCallbackHandler` | Replaced by `wrapLangChain` (Story 1.5) | Sprint 26 |
| sync `validateToken` | Replaced by async `validate` (Story 1.6) | Sprint 27 |
| `openclaw-adapter` package | Story 2.14a date gate (2026-07-01) | Sprint 26 if no consumers |

## API freeze plan

**Sprint 26 (v1.0-RC1)**:
- Audit every barrel export across 31 publishable packages.
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

After v1.0.0, removing any `@public` symbol triggers a major version
bump. Adding symbols is a minor bump. Bug fixes and internal-only
changes are patches.

Last updated: Sprint 25 (v0.7.0 + audit prep).
