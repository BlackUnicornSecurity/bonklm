# User Acceptance Testing Guide

This guide explains how to run and interpret User Acceptance Testing (UAT) for
`@blackunicorn/bonklm`.

## What is UAT?

User Acceptance Testing validates that the package meets real-world requirements and works as
expected in production-like scenarios. Unlike unit tests which check individual functions, UAT
verifies end-to-end functionality from a user's perspective.

## Quick Start

### Prerequisites

- Node.js 18+ installed
- Package dependencies installed (`npm install`)
- Package built (`npm run build`)

### Running UAT

```bash
# Run all UAT tests
npm run uat

# Or using tsx directly
tsx packages/core/uat/run-uat.ts

# Run specific category
npm run uat -- --category security

# Generate HTML report
npm run uat -- --report
```

## Understanding the Output

### Console Output

```
╔════════════════════════════════════════════════════════════╗
║     UAT Test Suite for @blackunicorn/bonklm      ║
╚════════════════════════════════════════════════════════════╝

📝 Running Happy Path Tests...
🔒 Running Security Tests...
...

📊 Summary:
   Total Tests: 47
   ✅ Passed: 45
   ❌ Failed: 2
   Pass Rate: 95.7%
   Duration: 1234ms
```

### HTML Report

When using `--report`, an interactive HTML report is generated at
`packages/core/uat/reports/uat-report-<timestamp>.html`.

The report includes:

- Summary metrics (total, passed, failed, pass rate, duration)
- Per-category breakdowns
- Detailed test results with error messages
- Expandable test lists

## UAT Categories

### 1. Happy Path

Tests normal, expected usage scenarios.

**What it validates:**

- Safe content passes through validators
- GuardrailEngine works with multiple validators
- Streaming validation processes safe chunks
- Different sensitivity levels work

**Success criteria:** 100% of safe content allowed

### 2. Security

Tests attack detection capabilities.

**What it validates:**

- Prompt injection detection (35+ patterns)
- Jailbreak detection (10 categories, 44 patterns)
- Secret detection (30+ credential types)
- XSS, PII, and bash command detection
- Multilingual attack detection

**Success criteria:** 90%+ attack detection rate

### 3. Edge Cases

Tests boundary conditions and unusual inputs.

**What it validates:**

- Empty and null input handling
- Very long content (up to 10MB)
- Unicode and special characters
- Mixed safe/unsafe content
- Fake data exclusion

**Success criteria:** Graceful handling, no crashes

### 4. Error Handling

Tests error recovery and invalid inputs.

**What it validates:**

- Invalid configuration handling
- Type coercion
- Broken validators in engine
- Circular reference prevention
- Resource exhaustion prevention

**Success criteria:** No unhandled exceptions

### 5. Performance

Tests performance benchmarks.

**What it validates:**

- Large payload processing
- Streaming performance
- Multi-validator performance
- Memory usage
- Cache behavior

**Success criteria:** < 100ms for typical content

### 6. Integration

Tests multi-component scenarios.

**What it validates:**

- Full stack protection
- Session-based tracking
- Framework integration patterns
- Dynamic validator management

**Success criteria:** All integrations work correctly

### 7. Configuration

Tests configuration options.

**What it validates:**

- Sensitivity levels (strict/standard/permissive)
- Action modes (block/sanitize/log/allow)
- Custom logger configuration
- Engine vs validator-level config

**Success criteria:** All options work as documented

## Interpreting Results

### Pass Rate

- **100%**: All tests passed. Package is ready for production.
- **90-99%**: Minor issues. Review failures before deployment.
- **< 90%**: Significant issues. Address failures before deployment.

### Category Breakdown

Review each category:

| Category Status | Meaning                                    |
| --------------- | ------------------------------------------ |
| ✅ All passed   | This area is working well                  |
| ⚠️ Some failed  | Investigate failures before production use |
| ❌ Many failed  | Significant issues in this area            |

### Common Failure Types

**Detection Rate Failures:**

- Attack detection below threshold
- May indicate pattern updates needed
- Review failed attack patterns

**Performance Failures:**

- Tests exceeded time limits
- May need optimization or hardware upgrade
- Check system load

**Integration Failures:**

- Component interaction issues
- May require API review
- Check configuration

## Running UAT in CI/CD

### GitHub Actions Example

```yaml
name: UAT

on: [push, pull_request]

jobs:
  uat:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm run build
      - name: Run UAT
        run: tsx packages/core/uat/run-uat.ts --json --report
      - name: Upload Report
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: uat-report
          path: packages/core/uat/reports/*.html
```

### GitLab CI Example

```yaml
uat:
  script:
    - npm ci
    - npm run build
    - tsx packages/core/uat/run-uat.ts --json --report
  artifacts:
    paths:
      - packages/core/uat/reports/*.html
    when: always
```

## Best Practices

1. **Run UAT before each release** - Catch regressions early
2. **Review HTML reports** - Get detailed insights into failures
3. **Track pass rate over time** - Monitor quality trends
4. **Update test data regularly** - Keep attack patterns current
5. **Run on target environment** - Test on production-like hardware

## Support

For issues or questions about UAT:

- Review failed test details in the report
- Check [GitHub Issues](https://github.com/your-repo/issues)
- Consult the main [API Reference](./api-reference.md)
