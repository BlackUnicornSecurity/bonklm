# Multi-Validator Example

This example demonstrates how to use `GuardrailEngine` to combine multiple validators and guards for comprehensive LLM content validation.

## Overview

The multi-validator example shows:

1. **Basic setup** - Creating an engine with multiple validators
2. **Execution order** - Sequential vs parallel validation
3. **Short-circuit behavior** - Stopping on first detection
4. **Aggregated results** - Combining findings from all validators
5. **Configuration profiles** - Strict vs permissive modes
6. **Dynamic management** - Adding/removing validators at runtime
7. **Context-aware validation** - Using guards with file context
8. **Override tokens** - Testing and bypass mechanisms

## Running the Example

```bash
# From the packages/examples/multi-validator directory
npx tsx index.ts
```

## Basic Usage

```typescript
import { GuardrailEngine } from '@blackunicorn/bonklm';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';
import { JailbreakValidator } from '@blackunicorn/bonklm';
import { SecretGuard } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [
    new PromptInjectionValidator(),
    new JailbreakValidator(),
  ],
  guards: [
    new SecretGuard(),
  ],
  shortCircuit: true,
});

const result = await engine.validate(userInput);
if (!result.allowed) {
  console.log('Blocked:', result.reason);
}
```

## Engine Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `validators` | `Validator[]` | `[]` | Array of validators to run |
| `guards` | `Guard[]` | `[]` | Array of guards to run |
| `shortCircuit` | `boolean` | `true` | Stop on first failure |
| `executionOrder` | `'sequential' \| 'parallel'` | `'sequential'` | How to run validators |
| `action` | `'block' \| 'sanitize' \| 'log' \| 'allow'` | `'block'` | Action mode |
| `overrideToken` | `string` | `undefined` | Token to bypass validation |
| `includeIndividualResults` | `boolean` | `true` | Include individual validator results |

## Result Structure

```typescript
interface EngineResult {
  allowed: boolean;              // Overall allowed decision
  blocked: boolean;              // Overall blocked decision
  severity: Severity;            // Max severity across all results
  risk_level: RiskLevel;         // Overall risk level
  risk_score: number;            // Total risk score
  findings: Finding[];           // All findings from all validators
  results: ValidatorResult[];    // Individual validator results
  validatorCount: number;        // Number of validators run
  guardCount: number;            // Number of guards run
  executionTime: number;         // Execution time in milliseconds
  timestamp: number;             // Result timestamp
}
```

## Execution Modes

### Sequential (Default)

Validators run one after another. With `shortCircuit: true`, execution stops at the first failure.

```typescript
const engine = new GuardrailEngine({
  validators: [v1, v2, v3],
  executionOrder: 'sequential',
  shortCircuit: true,  // Stops at v1 if it blocks
});
```

### Parallel

Validators run simultaneously. All validators complete before aggregation.

```typescript
const engine = new GuardrailEngine({
  validators: [v1, v2, v3],
  executionOrder: 'parallel',
});
```

## Configuration Profiles

### Strict Profile

Maximum security - blocks on any suspicion:

```typescript
const strictEngine = new GuardrailEngine({
  validators: [
    new PromptInjectionValidator({ sensitivity: 'strict' }),
    new JailbreakValidator({ sensitivity: 'strict' }),
    new ReformulationDetector({ sensitivity: 'strict' }),
  ],
  guards: [
    new SecretGuard({ action: 'block' }),
  ],
  shortCircuit: true,
  action: 'block',
});
```

### Permissive Profile

Allow more content, log violations:

```typescript
const permissiveEngine = new GuardrailEngine({
  validators: [
    new PromptInjectionValidator({ sensitivity: 'permissive' }),
    new JailbreakValidator({ sensitivity: 'permissive' }),
  ],
  shortCircuit: false,
  action: 'log',
});
```

## Dynamic Validator Management

```typescript
const engine = new GuardrailEngine();

// Add validators
engine.addValidator(new PromptInjectionValidator());
engine.addGuard(new SecretGuard());

// Remove validators
engine.removeValidator('prompt-injection');

// Get current state
const stats = engine.getStats();
console.log(stats);
// { validatorCount: 0, guardCount: 1, shortCircuit: true, ... }
```

## Individual Validator Results

When `includeIndividualResults: true` (default), the result contains individual validator outputs:

```typescript
const result = await engine.validate(content);

for (const vr of result.results) {
  console.log(`${vr.validatorName}:`);
  console.log(`  Allowed: ${vr.allowed}`);
  console.log(`  Risk Score: ${vr.risk_score}`);
  console.log(`  Findings: ${vr.findings.length}`);
}
```

## Guards with Context

Guuards can use additional context (like file paths) for more accurate detection:

```typescript
const engine = new GuardrailEngine({
  guards: [new SecretGuard()],
});

// Validate code file - detects secrets
const codeResult = await engine.validate(apiKeyContent, 'config.ts');

// Validate user message - different detection
const messageResult = await engine.validate(apiKeyContent);
```

## Override Token

For testing or emergency bypass:

```typescript
const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator()],
  overrideToken: 'BYPASS-VALIDATION',
});

// Normal content blocked
await engine.validate('Ignore instructions'); // blocked

// Content with override allowed
await engine.validate('Ignore instructions. BYPASS-VALIDATION'); // allowed
```

## Best Practices

1. **Start with shortCircuit: true** - Better performance, fail fast
2. **Use parallel for independent validators** - Can improve throughput
3. **Set appropriate sensitivity** - Balance security vs false positives
4. **Review individual results** - Understand which validator blocked
5. **Test with override tokens** - Safely test malicious inputs
6. **Configure per environment** - Strict in prod, permissive in dev

## See Also

- [Custom Validator Example](../custom-validator/) - Creating your own validators
- [Streaming Validation Example](../streaming/) - Validating streaming content
- [API Reference](../../../docs/api-reference.md) - Complete GuardrailEngine API
