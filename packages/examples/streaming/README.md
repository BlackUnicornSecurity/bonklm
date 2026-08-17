# Streaming Validation Example

This example demonstrates how to validate streaming content, such as LLM responses or real-time user
input.

## Overview

The streaming validation example shows:

1. **Basic streaming validation** - Processing chunks incrementally
2. **Early termination** - Stopping when violations are detected
3. **Buffer strategies** - Accumulate vs chunk-by-chunk validation
4. **LLM response validation** - Real-time response monitoring
5. **Stateful sessions** - Multi-turn conversation validation
6. **Performance tuning** - Validation frequency optimization

## Running the Example

```bash
# From the packages/examples/streaming directory
npx tsx index.ts
```

## Basic Usage

```typescript
import { StreamingValidator } from './streaming-validator';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

const validator = new StreamingValidator(
  [new PromptInjectionValidator()],
  [], // guards
  {
    maxBufferSize: 4096,
    validateEveryNChunks: 5
  }
);

// Process streaming chunks
for await (const chunk of stream) {
  const { result, shouldTerminate } = await validator.processChunk(chunk);

  if (shouldTerminate) {
    console.log('Content blocked:', result?.reason);
    break;
  }
}
```

## Configuration Options

| Option                 | Type      | Default | Description                              |
| ---------------------- | --------- | ------- | ---------------------------------------- |
| `maxBufferSize`        | `number`  | `4096`  | Max buffer size before forced validation |
| `validateEveryNChunks` | `number`  | `5`     | Validate after N chunks                  |
| `accumulateContent`    | `boolean` | `true`  | Accumulate chunks across validations     |
| `minChunkSize`         | `number`  | `10`    | Minimum chunk size to process            |

## StreamingValidator API

### `processChunk(chunk: string)`

Process a single chunk of streaming content.

```typescript
const result = await validator.processChunk(chunk);

// Returns:
{
  result?: GuardrailResult;  // Validation result (if validation occurred)
  shouldTerminate: boolean;  // Whether to stop streaming
  bufferSize: number;        // Current buffer size
}
```

### `validate()`

Manually trigger validation of accumulated content.

```typescript
const { result, shouldTerminate } = await validator.validate();
```

### `reset()`

Reset the streaming state (buffer, counters).

```typescript
validator.reset();
```

### `getStats()`

Get current streaming statistics.

```typescript
const stats = validator.getStats();

// Returns:
{
  chunkCount: number; // Total chunks processed
  validationCount: number; // Total validations performed
  bufferSize: number; // Current buffer size
}
```

## Validation Strategies

### 1. Accumulate Content (Default)

Content is accumulated across chunks and validated as a whole.

```typescript
const validator = new StreamingValidator([new PromptInjectionValidator()], [], {
  accumulateContent: true
});

// Chunks: "Hello " + "world " + "testing"
// Validated: "Hello world testing"
```

**Use when:**

- Full context matters for detection
- Smaller chunks that form complete thoughts
- You want to detect patterns across chunk boundaries

### 2. Chunk-by-Chunk Validation

Each chunk is validated independently.

```typescript
const validator = new StreamingValidator([new PromptInjectionValidator()], [], {
  accumulateContent: false,
  validateEveryNChunks: 1
});

// Each chunk validated separately
```

**Use when:**

- Each chunk is independent
- Faster detection required
- Memory constraints exist

### 3. Early Termination

Stop processing immediately when violations are detected.

```typescript
for await (const chunk of stream) {
  const { shouldTerminate, result } = await validator.processChunk(chunk);

  if (shouldTerminate) {
    console.log('Blocked:', result?.reason);
    return; // Stop processing
  }
}
```

## Use Cases

### LLM Response Validation

Validate LLM responses as they stream:

```typescript
const validator = new StreamingValidator([new JailbreakValidator(), new SecretGuard()], [], {
  validateEveryNChunks: 4
});

// Process LLM stream
for await (const chunk of llmStream) {
  const { shouldTerminate, result } = await validator.processChunk(chunk);

  if (shouldTerminate) {
    // Stop streaming and return error
    return { error: 'Content violated policy', reason: result?.reason };
  }

  // Forward chunk to user
  yield chunk;
}
```

### Real-time Chat Moderation

Moderate chat messages in real-time:

```typescript
const validator = new StreamingValidator([new PromptInjectionValidator()], [], {
  maxBufferSize: 1000
});

socket.on('message', async chunk => {
  const { shouldTerminate } = await validator.processEvent(chunk);

  if (shouldTerminate) {
    socket.emit('blocked', { reason: 'Content policy violation' });
  } else {
    socket.broadcast.emit('message', chunk);
  }
});
```

### Multi-turn Conversation Validation

Reset state between conversation turns:

```typescript
const validator = new StreamingValidator([new JailbreakValidator()]);

for (const turn of conversation) {
  for (const chunk of turn.chunks) {
    const { shouldTerminate } = await validator.processChunk(chunk);
    if (shouldTerminate) break;
  }

  // Reset for next turn
  validator.reset();
}
```

## Performance Considerations

### Validation Frequency

More frequent validation = more overhead but faster detection:

```typescript
// High frequency (slower, faster detection)
{
  validateEveryNChunks: 2;
}

// Low frequency (faster, slower detection)
{
  validateEveryNChunks: 10;
}
```

### Buffer Size

Larger buffers = more context but higher memory usage:

```typescript
// Small buffer (less memory, less context)
{
  maxBufferSize: 1000;
}

// Large buffer (more memory, more context)
{
  maxBufferSize: 10000;
}
```

### Chunk Size

Filter tiny chunks (tokens, partial words) to reduce overhead:

```typescript
// Skip chunks smaller than 10 characters
{
  minChunkSize: 10;
}
```

## Best Practices

1. **Set appropriate validation frequency** - Balance detection speed vs performance
2. **Use early termination** - Stop processing malicious content immediately
3. **Reset between conversations** - Clear state for new sessions
4. **Monitor buffer size** - Prevent memory issues with long streams
5. **Choose the right strategy** - Accumulate for context, chunk-by-chunk for speed
6. **Handle termination gracefully** - Inform users why content was blocked
7. **Log violations** - Track patterns for security monitoring

## Advanced: Custom StreamingValidator

Extend the base class for custom behavior:

```typescript
class CustomStreamingValidator extends StreamingValidator {
  async processChunk(chunk: string) {
    // Add pre-processing
    const sanitized = this.sanitize(chunk);

    // Call parent
    const result = await super.processChunk(sanitized);

    // Add post-processing
    if (result.result) {
      this.logMetrics(result.result);
    }

    return result;
  }

  private sanitize(chunk: string): string {
    // Custom sanitization logic
    return chunk;
  }

  private logMetrics(result: GuardrailResult) {
    // Custom metrics logging
  }
}
```

## See Also

- [Multi-Validator Example](../multi-validator/) - Using GuardrailEngine
- [Custom Validator Example](../custom-validator/) - Creating custom validators
- [API Reference](../../../docs/api-reference.md) - Complete API documentation
