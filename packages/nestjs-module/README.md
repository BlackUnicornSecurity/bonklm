# @blackunicorn/bonklm-nestjs

NestJS integration for BonkLM - Request/response validation for NestJS applications using
interceptors and decorators.

## Features

- **Decorator-based validation** - Use `@UseGuardrails()` to protect endpoints
- **Interceptor integration** - Automatic validation via NestJS interceptors
- **Service injection** - Inject `GuardrailsService` for manual validation
- **Flexible configuration** - Configure validators, guards, timeouts, and more
- **Production mode** - Generic error messages in production
- **Custom extractors** - Extract content from any request/response field
- **Type safety** - Full TypeScript support

## Installation

```bash
npm install @blackunicorn/bonklm @blackunicorn/bonklm-nestjs
```

## Quick Start

### 1. Import the Module

```typescript
import { Module } from '@nestjs/common';
import { GuardrailsModule } from '@blackunicorn/bonklm-nestjs';
import { PromptInjectionValidator, JailbreakValidator } from '@blackunicorn/bonklm';

@Module({
  imports: [
    GuardrailsModule.forRoot({
      validators: [new PromptInjectionValidator(), new JailbreakValidator()],
      global: true
    })
  ]
})
export class AppModule {}
```

### 2. Use the Decorator

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { UseGuardrails } from '@blackunicorn/bonklm-nestjs';

@Controller('chat')
export class ChatController {
  @Post()
  @UseGuardrails()
  async chat(@Body() body: { message: string }) {
    return { response: `You said: ${body.message}` };
  }
}
```

## Configuration

### Module Options

```typescript
import { GuardrailsModule } from '@blackunicorn/bonklm-nestjs';
import { PromptInjectionValidator, SecretGuard } from '@blackunicorn/bonklm';

GuardrailsModule.forRoot({
  // Validators for content checking
  validators: [new PromptInjectionValidator(), new JailbreakValidator()],

  // Guards for context-aware checking
  guards: [new SecretGuard(), new PIIGuard()],

  // Make interceptor available globally
  global: true,

  // Generic error messages in production
  productionMode: process.env.NODE_ENV === 'production',

  // Validation timeout in milliseconds
  validationTimeout: 5000,

  // Maximum content size in bytes (1MB default)
  maxContentLength: 1024 * 1024,

  // Custom error handler
  onError: (result, context) => {
    console.log('Blocked:', result.reason);
  },

  // Custom content extractors
  bodyExtractor: req => req.body?.prompt || '',
  responseExtractor: res => res.text || ''
});
```

### Async Configuration

```typescript
import { GuardrailsModule } from '@blackunicorn/bonklm-nestjs';
import { ConfigService } from '@nestjs/config';

GuardrailsModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (config: ConfigService) => ({
    validators: config.get('guardrails.validators'),
    productionMode: config.get('NODE_ENV') === 'production',
    validationTimeout: config.get('guardrails.timeout')
  }),
  inject: [ConfigService],
  global: true
});
```

## Decorator Options

### Input Validation Only (Default)

```typescript
@Post('chat')
@UseGuardrails()
async chat(@Body() body: { message: string }) {
  return { response: '...' };
}
```

### Input + Output Validation

```typescript
@Post('generate')
@UseGuardrails({
  validateInput: true,
  validateOutput: true,
})
async generate(@Body() body: { prompt: string }) {
  return { text: 'Generated text...' };
}
```

### Custom Body Field

```typescript
@Post('generate')
@UseGuardrails({
  bodyField: 'prompt', // Extract from 'prompt' instead of 'message'
})
async generate(@Body() body: { prompt: string }) {
  return { text: '...' };
}
```

### Custom Response Field

```typescript
@Post('complete')
@UseGuardrails({
  validateOutput: true,
  responseField: 'text', // Validate the 'text' field in response
})
async complete(@Body() body: { input: string }) {
  return { text: 'Completion...', usage: {...} };
}
```

### Per-Endpoint Content Limit

```typescript
@Post('summarize')
@UseGuardrails({
  maxContentLength: 500, // 500 bytes for this endpoint only
})
async summarize(@Body() body: { text: string }) {
  return { summary: '...' };
}
```

### Custom Error Handler

```typescript
@Post('process')
@UseGuardrails({
  onError: (result, context) => {
    // Log security incidents
    console.error('Security violation:', result.reason);
  },
})
async process(@Body() body: { data: string }) {
  return { result: '...' };
}
```

## Manual Validation

Inject the `GuardrailsService` for manual validation:

```typescript
import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { GuardrailsService } from '@blackunicorn/bonklm-nestjs';

@Controller('manual')
export class ManualController {
  constructor(private readonly guardrails: GuardrailsService) {}

  @Post('validate')
  async validate(@Body() body: { content: string }) {
    const results = await this.guardrails.validateInput(body.content);

    if (!this.guardrails.isAllowed(results)) {
      const blocked = this.guardrails.getBlockedResult(results);
      throw new BadRequestException({
        error: this.guardrails.getErrorMessage(blocked),
        risk_level: blocked.risk_level
      });
    }

    return { valid: true };
  }
}
```

## Security Features

### Path Traversal Protection (SEC-001)

All paths are normalized using `path.normalize()` before matching.

### Validation Timeout (SEC-008)

Enforce maximum validation time using `AbortController`.

### Content Size Limits (SEC-010)

Reject requests/responses exceeding configured size limits.

### Production Mode (SEC-007)

Generic error messages in production to prevent information leakage.

## Example Application

A complete example is available in `examples/nestjs-example/`:

```bash
cd examples/nestjs-example
npm install
npm run start:dev
```

## API Reference

### GuardrailsModule

| Method                     | Description                                |
| -------------------------- | ------------------------------------------ |
| `forRoot(options)`         | Configure module with static options       |
| `forRootAsync(options)`    | Configure module with async factory        |
| `forFeature(options)`      | Non-global module for specific controllers |
| `forFeatureAsync(options)` | Async non-global module                    |

### UseGuardrails Decorator

| Option             | Type     | Default | Description                      |
| ------------------ | -------- | ------- | -------------------------------- |
| `validateInput`    | boolean  | `true`  | Validate request body            |
| `validateOutput`   | boolean  | `false` | Validate response body           |
| `bodyField`        | string   | -       | Custom request field to extract  |
| `responseField`    | string   | -       | Custom response field to extract |
| `maxContentLength` | number   | -       | Per-endpoint size limit          |
| `onError`          | function | -       | Custom error handler             |

### GuardrailsService

| Method                              | Description                     |
| ----------------------------------- | ------------------------------- |
| `validateInput(content, context?)`  | Validate input content          |
| `validateOutput(content, context?)` | Validate output content         |
| `isAllowed(results)`                | Check if validation passed      |
| `getBlockedResult(results)`         | Get first blocked result        |
| `getErrorMessage(result)`           | Get user-friendly error message |
| `getEngine()`                       | Get underlying GuardrailEngine  |
| `getConfig()`                       | Get service configuration       |

## Security: rate limiting

This module does **not** include rate limiting. Per the BonkLM rate-limiting policy, ingress rate
limiting belongs at the edge / load-balancer layer or in a NestJS-native limiter ahead of the
guardrails — see [`docs/user/security/rate-limiting.md`](../../docs/user/security/rate-limiting.md)
for the multi-instance / deployment-shape rationale.

Wire `@nestjs/throttler` (or a distributed alternative for production) **before** the guardrails
interceptor:

```typescript
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BonkLMModule, GuardrailsInterceptor } from '@blackunicorn/bonklm-nestjs';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 15 * 60 * 1000, limit: 100 }]),
    BonkLMModule.forRoot({ validators: [new PromptInjectionValidator()] })
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard }, // limiter FIRST
    { provide: APP_INTERCEPTOR, useClass: GuardrailsInterceptor }
  ]
})
export class AppModule {}
```

To suppress the `bonklm doctor` rate-limiter advisory after acknowledging the policy, add to your
project's `package.json`:

```json
{ "bonklm": { "rateLimit": "documented" } }
```

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn

---

**@blackunicorn/bonklm-nestjs** - Part of the BonkLM ecosystem by BlackUnicorn
