# @blackunicorn/bonklm-huggingface

HuggingFace Inference API connector for BonkLM - Provides security validation for model inputs and
outputs.

## Installation

```bash
npm install @blackunicorn/bonklm-huggingface
npm install @huggingface/inference
```

## Usage

### Guarded Inference Client

Wrap your HuggingFace client to validate all inference calls:

```typescript
import { HfInference } from '@huggingface/inference';
import { createGuardedInference } from '@blackunicorn/bonklm-huggingface';
import { PromptInjectionValidator, PIIGuard } from '@blackunicorn/bonklm';

// Initialize HuggingFace
const hf = new HfInference(process.env.HF_API_KEY);

// Wrap with guardrails
const guardedHF = createGuardedInference(hf, {
  validators: [new PromptInjectionValidator()],
  guards: [new PIIGuard()],
  allowedModels: ['meta-llama/*', 'mistralai/*'],
  maxInputLength: 10000
});

// Use protected methods
const result = await guardedHF.textGeneration({
  model: 'meta-llama/Llama-3-8b',
  inputs: 'What is the capital of France?'
});

if (result.filtered) {
  console.log('Content was filtered!');
} else {
  console.log(result.output);
}
```

### Supported Methods

The guarded client supports all HuggingFace inference methods:

- `textGeneration()` - Text generation with validation
- `chatCompletion()` - Chat completions with validation
- `questionAnswer()` - Question answering
- `summarization()` - Text summarization
- `translation()` - Translation tasks

### Chat Completion Example

```typescript
const result = await guardedHF.chatCompletion('meta-llama/Llama-3-8b', [
  { role: 'user', content: 'What is AI safety?' }
]);

console.log(result.output);
```

## Options

### GuardedHuggingFaceOptions

| Option              | Type               | Default                     | Description                        |
| ------------------- | ------------------ | --------------------------- | ---------------------------------- |
| `validators`        | `Validator[]`      | `[]`                        | Validators for inputs              |
| `guards`            | `Guard[]`          | `[]`                        | Guards for outputs                 |
| `logger`            | `Logger`           | `console`                   | Logger instance                    |
| `productionMode`    | `boolean`          | `NODE_ENV === 'production'` | Generic errors in production       |
| `validationTimeout` | `number`           | `30000`                     | Validation timeout in ms           |
| `maxInputLength`    | `number`           | `10000`                     | Maximum input length               |
| `allowedModels`     | `string[]`         | `[]`                        | Allowed model patterns             |
| `onInputBlocked`    | `(result) => void` | -                           | Callback when input is blocked     |
| `onOutputBlocked`   | `(result) => void` | -                           | Callback when output is blocked    |
| `onModelNotAllowed` | `(model) => void`  | -                           | Callback when model is not allowed |

## Security Features

1. **Input Validation** - Validates all prompts for injection attacks
2. **Output Validation** - Checks model outputs for policy violations
3. **Model Whitelisting** - Restricts which models can be used
4. **Input Length Limits** - Prevents excessive input attacks
5. **Timeout Protection** - Prevents hanging on malicious inputs

## Model Whitelisting

Control which models can be used with pattern matching:

```typescript
const guardedHF = createGuardedInference(hf, {
  allowedModels: [
    'meta-llama/Llama-*', // All Llama models
    'mistralai/Mistral-*', // All Mistral models
    'google/gemma-*' // All Gemma models
  ]
});

// This will work
await guardedHF.textGeneration({
  model: 'meta-llama/Llama-3-8b',
  inputs: 'Hello'
});

// This will fail
await guardedHF.textGeneration({
  model: 'unknown-model/X',
  inputs: 'Hello'
}); // Throws: Model not allowed
```

## Example Application

See `examples/` directory for a complete inference application with guardrails.

## License

MIT
