# Custom Validator Example

This example demonstrates how to create custom validators that extend the BonkLM framework.

## Overview

The custom validator example shows:

1. **Creating a custom validator class** that implements the `Validator` interface
2. **Returning proper `GuardrailResult` objects** with findings
3. **Integrating with GuardrailEngine** to combine multiple validators
4. **Adding custom configuration** for your validator
5. **Implementing additional methods** like `sanitize()`

## Running the Example

```bash
# From the packages/examples/custom-validator directory
npx tsx index.ts
```

## Code Structure

### ProfanityFilter Validator

A simple validator that detects and blocks profanity:

```typescript
import { Validator, GuardrailResult, Severity, RiskLevel, Finding } from '@blackunicorn/bonklm';

class ProfanityFilter implements Validator {
  name = 'ProfanityFilter';
  private readonly blockedWords: Set<string>;

  constructor(config: { blockedWords?: Set<string> }) {
    this.blockedWords = config.blockedWords ?? new Set();
  }

  validate(content: string): GuardrailResult {
    const findings: Finding[] = [];

    for (const word of this.blockedWords) {
      if (content.toLowerCase().includes(word.toLowerCase())) {
        findings.push({
          category: 'profanity',
          severity: Severity.WARNING,
          weight: 5,
          description: `Blocked word detected: "${word}"`,
          confidence: 'high'
        });
      }
    }

    const blocked = findings.length > 0;
    return {
      allowed: !blocked,
      blocked,
      severity: findings.length > 0 ? Severity.WARNING : Severity.INFO,
      risk_level: findings.length > 5 ? RiskLevel.HIGH : RiskLevel.LOW,
      risk_score: findings.length * 5,
      findings,
      timestamp: Date.now()
    };
  }
}
```

### PIIDetector Validator

A validator that detects personally identifiable information:

```typescript
class PIIDetector implements Validator {
  name = 'PIIDetector';

  private readonly patterns = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/g
  };

  validate(content: string): GuardrailResult {
    // Implementation...
  }
}
```

### Using with GuardrailEngine

```typescript
import { GuardrailEngine } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new ProfanityFilter(), new PIIDetector()],
  shortCircuit: false
});

const result = await engine.validate(userInput);
if (!result.allowed) {
  console.log('Blocked:', result.reason);
}
```

## Custom Validator Interface

Your custom validator must implement:

```typescript
interface Validator {
  validate(content: string): GuardrailResult;
  name?: string;
}
```

### Required Methods

- **`validate(content: string): GuardrailResult`** - Main validation method

### Optional Properties

- **`name`** - Validator name for identification in results

### GuardrailResult Structure

```typescript
interface GuardrailResult {
  allowed: boolean; // Whether content is allowed
  blocked: boolean; // Whether content is blocked (opposite of allowed)
  severity: Severity; // INFO | WARNING | BLOCKED | CRITICAL
  risk_level: RiskLevel; // LOW | MEDIUM | HIGH
  risk_score: number; // Numeric risk score
  findings: Finding[]; // Array of detected issues
  timestamp: number; // Unix timestamp
  reason?: string; // Optional reason for blocking
}
```

### Finding Structure

```typescript
interface Finding {
  category: string; // Category of the finding
  severity: Severity; // Severity level
  weight?: number; // Weight for risk score calculation
  match?: string; // Matched text
  description: string; // Human-readable description
  line_number?: number; // Line number where found
  confidence?: 'critical' | 'high' | 'medium' | 'low';
}
```

## Best Practices

1. **Always return a complete GuardrailResult** - Include all required fields
2. **Use appropriate severity levels** - Match severity to the actual risk
3. **Provide clear descriptions** - Help users understand why content was blocked
4. **Set reasonable weights** - Weights contribute to the overall risk score
5. **Include confidence levels** - Indicate how certain the detection is
6. **Handle edge cases** - Empty input, null values, etc.

## Advanced Features

### Adding Custom Configuration

```typescript
interface MyValidatorConfig {
  threshold?: number;
  patterns?: RegExp[];
  action?: 'block' | 'sanitize' | 'log';
}

class MyValidator implements Validator {
  constructor(private config: MyValidatorConfig = {}) {}
  // ...
}
```

### Adding Additional Methods

```typescript
class ProfanityFilter implements Validator {
  validate(content: string): GuardrailResult {
    // ...
  }

  // Custom method for sanitization
  sanitize(content: string): string {
    let sanitized = content;
    for (const word of this.blockedWords) {
      sanitized = sanitized.replace(new RegExp(word, 'gi'), '***');
    }
    return sanitized;
  }
}
```

### Session-Aware Validators

```typescript
class SessionValidator implements Validator {
  private sessionState = new Map<string, number>();

  validate(content: string, sessionId?: string): GuardrailResult {
    const violations = this.sessionState.get(sessionId ?? '') ?? 0;
    // Track violations across requests...
  }
}
```

## See Also

- [Multi-Validator Example](../multi-validator/) - Using GuardrailEngine with multiple validators
- [Streaming Validation Example](../streaming/) - Validating streaming content
- [API Reference](../../../docs/api-reference.md) - Complete API documentation
