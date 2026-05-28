# @blackunicorn/bonklm-express

Express middleware for LLM security guardrails.

## Installation

```bash
npm install @blackunicorn/bonklm-express
```

## Quick Start

```typescript
import express from 'express';
import { createGuardrailsMiddleware } from '@blackunicorn/bonklm-express';
import { PromptInjectionValidator, JailbreakValidator } from '@blackunicorn/bonklm';

const app = express();

app.use(express.json());

// Apply guardrails to AI endpoints
app.use(
  '/api/ai',
  createGuardrailsMiddleware({
    validators: [new PromptInjectionValidator(), new JailbreakValidator()],
    validateRequest: true,
    validateResponse: false // Recommended for production
  })
);

app.post('/api/ai/chat', async (req, res) => {
  // Content is pre-validated
  const { message } = req.body;

  // Call your LLM here
  const response = await callLLM(message);

  res.json({ response });
});

app.listen(3000);
```

## Options

| Option                 | Type                     | Default                     | Description                         |
| ---------------------- | ------------------------ | --------------------------- | ----------------------------------- |
| `validators`           | `Validator[]`            | `[]`                        | List of validators to run           |
| `guards`               | `Guard[]`                | `[]`                        | List of guards to run               |
| `validateRequest`      | `boolean`                | `true`                      | Validate incoming request bodies    |
| `validateResponse`     | `boolean`                | `false`                     | Validate outgoing response bodies   |
| `validateResponseMode` | `'buffer' \| 'disabled'` | `'buffer'`                  | Response validation mode            |
| `onRequestOnly`        | `boolean`                | `false`                     | Skip response validation            |
| `paths`                | `string[]`               | `[]`                        | Only process these paths            |
| `excludePaths`         | `string[]`               | `[]`                        | Exclude these paths from validation |
| `logger`               | `Logger`                 | `console`                   | Custom logger instance              |
| `productionMode`       | `boolean`                | `NODE_ENV === 'production'` | Generic errors in production        |
| `validationTimeout`    | `number`                 | `5000`                      | Validation timeout in milliseconds  |
| `maxContentLength`     | `number`                 | `1048576`                   | Max content length in bytes (1MB)   |
| `onError`              | `Function`               | -                           | Custom error handler                |
| `bodyExtractor`        | `Function`               | -                           | Custom request body extractor       |

## Security Features

- **Path Traversal Protection** (SEC-001): Uses `path.normalize()` to prevent path traversal attacks
- **Request Size Limits** (SEC-010): Blocks requests exceeding configured size limit
- **Validation Timeout** (SEC-008): Prevents DoS via slow validations
- **Production Mode** (SEC-007): Generic error messages in production to prevent info leakage

## Security Best Practices

### Rate Limiting

This middleware does **not** include rate limiting. We recommend adding a rate limiter **before**
the guardrails middleware to prevent brute force and DoS attacks:

```typescript
import rateLimit from 'express-rate-limit';

// Apply rate limiter BEFORE guardrails
app.use(
  '/api/ai',
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP'
  })
);

app.use(
  '/api/ai',
  createGuardrailsMiddleware({
    validators: [new PromptInjectionValidator()]
  })
);
```

### Security Headers

For production deployments, add security headers using
[helmet](https://www.npmjs.com/package/helmet):

```typescript
import helmet from 'helmet';

// Apply security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:']
      }
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    noSniff: true,
    xssFilter: true,
    frameguard: { action: 'deny' }
  })
);
```

### Additional Security Recommendations

1. **Enable HTTPS**: Always use HTTPS in production with proper SSL/TLS configuration
2. **Input Validation**: Use a validation library like [joi](https://www.npmjs.com/package/joi) or
   [zod](https://www.npmjs.com/package/zod) for schema validation
3. **CORS Configuration**: Configure CORS properly to only allow trusted origins
4. **Authentication**: Add authentication middleware before guardrails for protected endpoints
5. **Logging**: Monitor blocked requests for potential attack patterns

## Examples

### Exclude Health Check Endpoints

```typescript
app.use(
  createGuardrailsMiddleware({
    validators: [new PromptInjectionValidator()],
    excludePaths: ['/api/health', '/api/status']
  })
);
```

### Custom Error Handler

```typescript
app.use(
  createGuardrailsMiddleware({
    validators: [new PromptInjectionValidator()],
    onError: (result, req, res) => {
      res.status(400).json({
        error: 'Content blocked',
        code: 'GUARDRAIL_VIOLATION'
      });
    }
  })
);
```

### Custom Body Extractor

```typescript
app.use(
  createGuardrailsMiddleware({
    validators: [new PromptInjectionValidator()],
    bodyExtractor: req => req.body?.prompt || req.body?.message || ''
  })
);
```

### Production Mode

```typescript
app.use(
  createGuardrailsMiddleware({
    validators: [new PromptInjectionValidator()],
    productionMode: true // Generic error messages
  })
);
```

## License

MIT © Black Unicorn
