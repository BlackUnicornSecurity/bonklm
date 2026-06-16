# @blackunicorn/bonklm-langchain

LangChain connector for BonkLM. Provides security guardrails for LangChain operations including
input validation, output validation, and streaming validation.

## Features

- **Input Validation**: Validate prompts and messages before they are sent to LLMs
- **Output Validation**: Validate LLM responses before returning to users
- **Streaming Validation**: Real-time validation of streaming responses with early termination
- **Tool Call Validation**: Validate tool inputs and outputs
- **Chain Validation**: Optional validation of chain inputs and outputs
- **Buffer Size Limits**: Prevent DoS via memory exhaustion
- **Production Mode**: Generic error messages in production
- **Validation Timeout**: Configurable timeout with AbortController

## Installation

```bash
npm install @blackunicorn/bonklm-langchain
npm install @blackunicorn/bonklm
```

## Quick Start

```typescript
import { GuardrailsCallbackHandler } from '@blackunicorn/bonklm-langchain';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';

// Create the guardrails callback handler
const handler = new GuardrailsCallbackHandler({
  validators: [new PromptInjectionValidator()],
  validateStreaming: true,
  streamingValidationInterval: 10
});

// Create your LangChain components
const llm = new ChatOpenAI({
  model: 'gpt-4',
  callbacks: [handler],
  temperature: 0.7
});

const prompt = PromptTemplate.fromTemplate('Tell me a joke about {topic}');

// Use the chain with guardrails
const chain = prompt.pipe(llm);

// The handler will validate both input and output
const response = await chain.invoke({ topic: 'programming' });
console.log(response);
```

## Configuration Options

### GuardrailsCallbackHandlerOptions

| Option                        | Type                        | Default                                 | Description                                           |
| ----------------------------- | --------------------------- | --------------------------------------- | ----------------------------------------------------- |
| `validators`                  | `Validator[]`               | `[]`                                    | Validators to apply to inputs and outputs             |
| `guards`                      | `Guard[]`                   | `[]`                                    | Guards to apply to inputs and outputs                 |
| `logger`                      | `Logger`                    | `console`                               | Logger instance for validation events                 |
| `validateStreaming`           | `boolean`                   | `false`                                 | Whether to validate streaming responses incrementally |
| `streamingMode`               | `'incremental' \| 'buffer'` | `'incremental'`                         | Stream validation mode                                |
| `maxStreamBufferSize`         | `number`                    | `1048576` (1MB)                         | Maximum buffer size for stream accumulation           |
| `productionMode`              | `boolean`                   | `process.env.NODE_ENV === 'production'` | Production mode flag for generic errors               |
| `validationTimeout`           | `number`                    | `30000` (30s)                           | Validation timeout in milliseconds                    |
| `streamingValidationInterval` | `number`                    | `10`                                    | Tokens between streaming validations                  |
| `onBlocked`                   | `(result) => void`          | `undefined`                             | Callback when content is blocked                      |
| `onStreamBlocked`             | `(accumulated) => void`     | `undefined`                             | Callback when stream is blocked                       |
| `onValidationError`           | `(error, runId) => void`    | `undefined`                             | Callback on validation error                          |

## Usage Examples

### Basic Input/Output Validation

```typescript
import { GuardrailsCallbackHandler } from '@blackunicorn/bonklm-langchain';
import { PromptInjectionValidator, JailbreakValidator } from '@blackunicorn/bonklm';

const handler = new GuardrailsCallbackHandler({
  validators: [new PromptInjectionValidator(), new JailbreakValidator()]
});

// Use with any LangChain component
const result = await chain.invoke(input, { callbacks: [handler] });
```

### Streaming with Validation

```typescript
const handler = new GuardrailsCallbackHandler({
  validators: [new PromptInjectionValidator()],
  validateStreaming: true,
  streamingMode: 'incremental',
  streamingValidationInterval: 10, // Validate every 10 tokens
  maxStreamBufferSize: 1024 * 1024, // 1MB limit
  onStreamBlocked: accumulated => {
    console.warn('Stream blocked:', accumulated);
  }
});

const stream = await chain.stream(input, { callbacks: [handler] });

for await (const chunk of stream) {
  process.stdout.write(chunk.content);
}
```

### Production Mode

```typescript
const handler = new GuardrailsCallbackHandler({
  validators: [new PromptInjectionValidator()],
  productionMode: true, // Generic error messages
  onBlocked: result => {
    // Log the detailed reason internally
    logger.warn('Content blocked', { reason: result.reason });
  }
});
```

### Custom Validation Timeout

```typescript
const handler = new GuardrailsCallbackHandler({
  validators: [new PromptInjectionValidator()],
  validationTimeout: 5000 // 5 second timeout
});
```

## Error Handling

The handler throws two types of errors:

### GuardrailsViolationError

Thrown when input or output validation fails:

```typescript
import {
  GuardrailsViolationError,
  isGuardrailsViolationError
} from '@blackunicorn/bonklm-langchain';

try {
  await chain.invoke(input, { callbacks: [handler] });
} catch (error) {
  if (isGuardrailsViolationError(error)) {
    console.error('Content blocked:', error.reason);
    console.error('Risk score:', error.riskScore);
    console.error('Findings:', error.findings);
  }
}
```

### StreamValidationError

Thrown when stream buffer size is exceeded:

```typescript
import { StreamValidationError, isStreamValidationError } from '@blackunicorn/bonklm-langchain';

try {
  for await (const chunk of stream) {
    // Process chunk
  }
} catch (error) {
  if (isStreamValidationError(error)) {
    console.error('Stream validation error:', error.reason);
  }
}
```

## How It Works

The GuardrailsCallbackHandler integrates with LangChain's callback system:

1. **handleLLMStart/handleChatModelStart**: Validates input prompts/messages before they are sent to
   the LLM
2. **handleLLMNewToken**: Accumulates streaming tokens for incremental validation
3. **handleLLMEnd**: Validates LLM outputs and performs final stream validation
4. **handleToolStart/handleToolEnd**: Validates tool inputs and outputs
5. **handleChainStart/handleChainEnd**: Optionally validates chain inputs and outputs

## Security Features

- **SEC-002**: Incremental stream validation with early termination prevents malicious content from
  being sent before validation
- **SEC-003**: Max buffer size enforcement prevents DoS via memory exhaustion
- **SEC-006**: Complex message content handling prevents validation bypass via structured data
- **SEC-007**: Production mode prevents information leakage via detailed error messages
- **SEC-008**: Validation timeout with AbortController prevents hanging on slow inputs

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn

## Contributing

Contributions are welcome! Please read the contributing guidelines before submitting PRs.
