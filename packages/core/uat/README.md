# UAT Test Suite for @blackunicorn/bonklm

This directory contains the comprehensive User Acceptance Testing (UAT) suite for the
`@blackunicorn/bonklm` package.

## Overview

The UAT suite validates all features and scenarios of the LLM guardrails package:

- **47 test cases** across 7 categories
- **All validators**: PromptInjection, Jailbreak, Reformulation, Boundary, Multilingual
- **All guards**: Secret, XSS, PII, BashSafety, Production
- **Core components**: GuardrailEngine, StreamingValidator, HookSystem, SessionManager
- **Configuration options**: Sensitivity levels, action modes, and more

## Directory Structure

```
packages/core/uat/
├── fixtures/
│   ├── attack-patterns.ts    # Test data for attack vectors
│   ├── safe-content.ts       # Test data for safe/legitimate content
│   └── performance-payloads.ts # Test data for performance testing
├── reports/                  # Generated test reports (created at runtime)
├── uat-suite.ts             # Main UAT test suite implementation
├── run-uat.ts               # CLI runner for executing tests
└── README.md                # This file
```

## Running the UAT Suite

### Run All Tests

```bash
tsx packages/core/uat/run-uat.ts
```

### Run Specific Category

```bash
tsx packages/core/uat/run-uat.ts --category security
tsx packages/core/uat/run-uat.ts --category happy-path
tsx packages/core/uat/run-uat.ts -c performance
```

### Run with Verbose Output

```bash
tsx packages/core/uat/run-uat.ts --verbose
```

### Generate HTML Report

```bash
tsx packages/core/uat/run-uat.ts --report
```

The HTML report will be saved to `packages/core/uat/reports/uat-report-<timestamp>.html`.

### List All Test Cases

```bash
tsx packages/core/uat/run-uat.ts --list
```

### Output JSON Results

```bash
tsx packages/core/uat/run-uat.ts --json
```

## Test Categories

| Category         | Description                           | Tests |
| ---------------- | ------------------------------------- | ----- |
| `happy-path`     | Expected normal usage scenarios       | 5     |
| `security`       | Attack detection effectiveness        | 10    |
| `edge-cases`     | Boundary conditions and edge cases    | 7     |
| `error-handling` | Invalid inputs and failure recovery   | 5     |
| `performance`    | Performance benchmarks                | 6     |
| `integration`    | Multi-component integration scenarios | 7     |
| `configuration`  | Configuration variants                | 7     |

## Test Cases by Category

### Happy Path (UAT-HP-XXX)

- `UAT-HP-001`: Basic Simple API Usage
- `UAT-HP-002`: GuardrailEngine with Multiple Validators
- `UAT-HP-003`: Streaming Validation with Safe Content
- `UAT-HP-004`: Configuration Profile Variations
- `UAT-HP-005`: Integration with Framework Examples

### Security (UAT-SEC-XXX)

- `UAT-regression`: Direct Prompt Injection Attacks
- `UAT-regression`: Jailbreak Pattern Detection (10 categories)
- `UAT-regression`: Secret and Credential Detection (30+ types)
- `UAT-regression`: Multi-Layer Encoding Attacks
- `UAT-regression`: Reformulation Detection
- `UAT-regression`: Boundary Manipulation Detection
- `UAT-regression`: PII Detection
- `UAT-regression`: Bash Safety Detection
- `UAT-regression`: XSS Pattern Detection
- `UAT-regression`: Multilingual Detection (12 languages)

### Edge Cases (UAT-EDGE-XXX)

- `UAT-EDGE-001`: Empty and Null Input Handling
- `UAT-EDGE-002`: Very Long Content (up to 10MB)
- `UAT-EDGE-003`: Special Characters and Unicode
- `UAT-EDGE-004`: Mixed Safe and Unsafe Content
- `UAT-EDGE-005`: Boundary Value Testing
- `UAT-EDGE-006`: Fake Data Exclusion
- `UAT-EDGE-007`: Session Edge Cases

### Error Handling (UAT-ERR-XXX)

- `UAT-ERR-001`: Invalid Configuration Handling
- `UAT-ERR-002`: Type Coercion and Invalid Types
- `UAT-ERR-003`: Broken Validators in Engine
- `UAT-ERR-004`: Circular Reference Prevention
- `UAT-ERR-005`: Resource Exhaustion Prevention

### Performance (UAT-PERF-XXX)

- `UAT-PERF-001`: Large Payload Processing (1KB to 10MB)
- `UAT-PERF-002`: Streaming Performance
- `UAT-PERF-003`: Multi-Validator Performance
- `UAT-PERF-004`: Sequential vs Parallel Execution
- `UAT-PERF-005`: Memory Usage (10,000 iterations)
- `UAT-PERF-006`: Cache Performance

### Integration (UAT-INT-XXX)

- `UAT-INT-001`: Full Stack Protection
- `UAT-INT-002`: Session-Based Multi-Turn Protection
- `UAT-INT-003`: Short-Circuit vs Full Validation
- `UAT-INT-004`: Dynamic Validator Management
- `UAT-INT-005`: Override Token Bypass
- `UAT-INT-006`: Streaming with Multiple Validators
- `UAT-INT-007`: Framework Integration Pattern

### Configuration (UAT-CONF-XXX)

- `UAT-CONF-001`: Sensitivity Levels (strict/standard/permissive)
- `UAT-CONF-002`: Action Modes (block/sanitize/log/allow)
- `UAT-CONF-003`: Include/Exclude Findings
- `UAT-CONF-004`: Custom Logger Configuration
- `UAT-CONF-005`: Max Decode Depth Configuration
- `UAT-CONF-006`: Guard-Specific Configurations
- `UAT-CONF-007`: Engine-Level vs Validator-Level Config

## Success Criteria

| Category           | Pass Criteria                              |
| ------------------ | ------------------------------------------ |
| Happy Path         | 100% of safe content allowed through       |
| Security Detection | 90%+ attack detection rate                 |
| Edge Cases         | Graceful handling, no crashes              |
| Error Handling     | No unhandled exceptions                    |
| Performance        | < 100ms for typical content, < 2s for 10MB |
| Integration        | All integration patterns work              |
| Configuration      | All options work as documented             |

## Adding New Tests

To add a new test case:

1. Open `uat-suite.ts`
2. Find the appropriate category section
3. Add a new test using the `runTest` helper:

```typescript
await this.runTest(
  'UAT-XXX-000', // Unique test ID
  'Test Name', // Human-readable name
  'category', // Category slug
  async () => {
    // Test implementation
    // Use throw new Error() to indicate failure
  }
);
```

## Exit Codes

- `0`: All tests passed
- `1`: One or more tests failed

## CI/CD Integration

To integrate UAT into your CI/CD pipeline:

```yaml
# Example GitHub Actions
- name: Run UAT
  run: tsx packages/core/uat/run-uat.ts --json --report

- name: Upload UAT Report
  uses: actions/upload-artifact@v3
  with:
    name: uat-report
    path: packages/core/uat/reports/*.html
```

## Troubleshooting

### Tests Fail with Module Not Found

Ensure the package is built:

```bash
npm run build
```

### Performance Tests Fail

Performance tests may be sensitive to system load. Run them on a quiet system or adjust thresholds
in `uat-suite.ts`.

### Memory Issues

If you encounter memory issues, try running tests in smaller batches:

```bash
tsx packages/core/uat/run-uat.ts --category happy-path
tsx packages/core/uat/run-uat.ts --category security
# ... etc
```
