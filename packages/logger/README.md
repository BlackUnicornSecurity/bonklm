<div align="center">

# @blackunicorn/bonklm-logger

### **Attack Logger & Security Observability for BonkLM**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js Version](https://img.shields.io/node/v/%40blackunicorn%2Fbonklm-logger.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

**Security Observability • Attack Logging • Threat Analysis**

</div>

---

## Overview

The `@blackunicorn/bonklm-logger` package provides attack logging and security observability for
BonkLM. It captures validation events, analyzes attack patterns, and provides visibility into
security threats against your LLM applications.

This package contains:

- **AttackLogger** - Main logger class for capturing validation events
- **AttackLogStore** - In-memory storage with TTL and size limits
- **Transform Utilities** - Content sanitization and type derivation
- **Export Capabilities** - JSON export with path traversal protection

---

## Installation

```bash
npm install @blackunicorn/bonklm-logger
```

Or with pnpm:

```bash
pnpm add @blackunicorn/bonklm-logger
```

---

## Quick Start

### Basic Usage

```typescript
import { AttackLogger } from '@blackunicorn/bonklm-logger';
import { GuardrailEngine } from '@blackunicorn/bonklm';

// Create the logger
const logger = new AttackLogger({
  max_logs: 1000,
  ttl: 2592000000, // 30 days
  sanitize_pii: true
});

// Create the engine
const engine = new GuardrailEngine({
  validators: [...],
  guards: [...]
});

// Register the logger's intercept callback
engine.onIntercept(logger.getInterceptCallback());

// Validation results are automatically logged
await engine.validate(userInput);

// Display attack summary
logger.show('summary');
```

### Display Options

```typescript
// Table format (default)
logger.show('table');

// Summary with statistics
logger.show('summary');

// JSON format
logger.show('json');

// With filters
logger.show({
  format: 'table',
  filter: { injection_type: ['jailbreak'] },
  limit: 10
});
```

---

## API Reference

### AttackLogger

Main class for logging and managing attack entries.

```typescript
import { AttackLogger } from '@blackunicorn/bonklm-logger';

const logger = new AttackLogger({
  max_logs: 1000, // Maximum entries to store
  ttl: 3600000, // Time-to-live in ms (1 hour)
  enabled: true, // Enable/disable logging
  sanitize_pii: true, // Redact PII in logs
  origin_type: 'sessionId', // Origin tracking
  custom_origin: 'api', // Custom origin if origin_type='custom'
  max_content_size: 10000, // Max content size in bytes
  warn_before_ttl_clear: true
});
```

#### Methods

- **getInterceptCallback()** - Returns callback for GuardrailEngine integration
- **getLogs(filter?)** - Retrieve log entries with optional filtering
- **getSummary()** - Get attack statistics summary
- **clear()** - Clear all log entries
- **exportJSON(options?)** - Export entries as JSON string
- **exportJSONToFile(path, options?)** - Export to file with path validation
- **show(options)** - Display entries in console

### AttackLoggerConfig

Configuration options for AttackLogger.

| Option                  | Type                                | Default       | Description                         |
| ----------------------- | ----------------------------------- | ------------- | ----------------------------------- |
| `max_logs`              | `number`                            | `1000`        | Maximum entries to store            |
| `ttl`                   | `number`                            | `2592000000`  | Entry TTL in milliseconds (30 days) |
| `enabled`               | `boolean`                           | `true`        | Enable/disable logging              |
| `sanitize_pii`          | `boolean`                           | `true`        | Redact PII in logs                  |
| `origin_type`           | `'sessionId' \| 'custom' \| 'none'` | `'sessionId'` | Origin tracking mode                |
| `custom_origin`         | `string`                            | -             | Custom origin identifier            |
| `max_content_size`      | `number`                            | `1048576`     | Max content size in bytes (1MB)     |
| `warn_before_ttl_clear` | `boolean`                           | `true`        | Warn before clearing TTL entries    |

### LogFilter

Filter criteria for retrieving log entries.

```typescript
interface LogFilter {
  injection_type?: string | string[]; // Filter by type
  vector?: string | string[]; // Filter by vector
  risk_level?: 'LOW' | 'MEDIUM' | 'HIGH' | Array<RiskLevel>;
  blocked?: boolean; // Filter by blocked status
  since?: number; // Filter by start timestamp
  until?: number; // Filter by end timestamp
  origin?: string; // Filter by origin
  limit?: number; // Limit results
}
```

---

## Security Features

### Content Sanitization

All content is sanitized at storage time to prevent log injection attacks:

```typescript
// Control characters are escaped
// ANSI escape sequences are stripped
// PII is redacted if sanitize_pii is enabled
await engine.logFromIntercept(result, userInput);
```

### Path Validation

File export paths are validated to prevent path traversal:

```typescript
// These will be rejected:
await logger.exportJSONToFile('../etc/passwd'); // Path traversal
await logger.exportJSONToFile('/etc/attacks.json'); // Outside CWD

// This is allowed:
await logger.exportJSONToFile('./logs/attacks.json'); // Relative path
```

### Memory Protection

The logger enforces size limits to prevent memory exhaustion:

```typescript
const logger = new AttackLogger({
  max_logs: 1000, // Maximum entries
  max_content_size: 10000 // Max content size per entry
});
```

---

## Integration Examples

### With Express Middleware

```typescript
import express from 'express';
import { createGuardrailsMiddleware } from '@blackunicorn/bonklm-express';
import { AttackLogger } from '@blackunicorn/bonklm-logger';

const app = express();
const logger = new AttackLogger();

app.use(createGuardrailsMiddleware({
  attackLogger: logger,
  validators: [...],
  guards: [...]
}));

// View attack logs
app.get('/admin/security/attacks', (req, res) => {
  const logs = logger.getLogs({ limit: 100 });
  res.json(logs);
});
```

### With Fastify Plugin

```typescript
import Fastify from 'fastify';
import guardrails from '@blackunicorn/bonklm-fastify';
import { AttackLogger } from '@blackunicorn/bonklm-logger';

const fastify = Fastify();
const logger = new AttackLogger();

await fastify.register(guardrails, {
  attackLogger: logger,
  validators: [...],
  guards: [...]
});

// View attack summary
fastify.get('/admin/security/summary', async () => {
  return logger.getSummary();
});
```

### With NestJS Module

```typescript
import { Module } from '@nestjs/common';
import { GuardrailsModule } from '@blackunicorn/bonklm-nestjs';
import { AttackLogger } from '@blackunicorn/bonklm-logger';

const logger = new AttackLogger();

@Module({
  imports: [
    GuardrailsModule.forRoot({
      attackLogger: logger,
      validators: [...],
      guards: [...]
    })
  ],
  providers: [{ provide: 'ATTACK_LOGGER', useValue: logger }]
})
export class AppModule {}
```

---

## Export Options

### JSON Export

```typescript
// Export with PII sanitization
const json = logger.exportJSON({ sanitize_pii: true });

// Export without PII sanitization
const json = logger.exportJSON({ sanitize_pii: false });
```

### File Export

```typescript
// Set custom export directory
import { setExportDirectory } from '@blackunicorn/bonklm-logger';
setExportDirectory('/app/exports');

// Export to file
await logger.exportJSONToFile('attacks.json', { sanitize_pii: true });
```

---

## Attack Analysis

### Summary Statistics

```typescript
const summary = logger.getSummary();

console.log(`
  Total Attacks: ${summary.total_count}
  Blocked: ${summary.blocked_count}
  Allowed: ${summary.allowed_count}

  By Type:
    prompt-injection: ${summary.by_injection_type['prompt-injection']}
    jailbreak: ${summary.by_injection_type.jailbreak}

  By Vector:
    direct: ${summary.by_attack_vector.direct}
    encoded: ${summary.by_attack_vector.encoded}

  Highest Risk: ${summary.highest_risk_entry?.risk_level}
`);
```

### Filtered Retrieval

```typescript
// Get all jailbreak attempts from the last hour
const jailbreaks = logger.getLogs({
  injection_type: ['jailbreak'],
  since: Date.now() - 3600000
});

// Get all blocked high-risk attacks
const critical = logger.getLogs({
  blocked: true,
  risk_level: ['HIGH']
});
```

---

## Security Considerations

1. **PII Sanitization** - Enable `sanitize_pii` to redact personal information
2. **Path Validation** - File exports are validated to prevent path traversal
3. **Memory Limits** - Set appropriate `max_logs` and `max_content_size` for your environment
4. **TTL Management** - Use TTL to automatically expire old entries
5. **Access Control** - Protect endpoints that expose log data

---

## See Also

- [Core Package](../core) - Core security engine
- [Express Middleware](../express-middleware) - Express.js integration
- [Fastify Plugin](../fastify-plugin) - Fastify framework integration
- [NestJS Module](../nestjs-module) - NestJS framework integration

---

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn
