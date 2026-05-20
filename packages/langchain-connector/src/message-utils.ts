/**
 * LangChain message extraction helpers.
 *
 * Extracted from `guardrails-handler.ts` to keep that file under the
 * project's 800-line size cap. These utilities convert LangChain message
 * and LLMResult objects into the plain-text form that the BonkLM engine
 * validates against.
 */

/**
 * Minimal shape we expect from a LangChain BaseMessage. Avoids a direct
 * dependency on `@langchain/core` types here so the connector stays
 * lightweight at the type-import layer.
 */
export interface BaseMessageLike {
  content: string | unknown[];
  _getType(): string;
}

/**
 * Minimal shape we expect from a LangChain LLMResult.
 */
export interface LLMResultLike {
  generations: Array<{ text?: string }[]>;
  llmOutput?: unknown;
}

/**
 * Validates that a numeric option is a positive, finite number.
 *
 * @throws {TypeError} If value is not a positive finite number.
 */
export function validatePositiveNumber(value: number, optionName: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(
      `${optionName} must be a positive number. Received: ${value}`,
    );
  }
}

/**
 * Extracts text content from message-like objects.
 *
 * Handles complex message content types per SEC-006:
 * - String content: "Hello"
 * - Array content with structured blocks (`{ type: 'text', text: '...' }`)
 * - Other types (coerced to string)
 *
 * This is security-critical: structured-data messages must be flattened
 * to plain text so the validation pipeline sees the actual payload, not
 * the wrapper objects.
 */
export function messagesToText(messages: BaseMessageLike[]): string {
  return messages
    .map((m) => {
      const content = m.content;

      // Handle string content (most common case)
      if (typeof content === 'string') {
        return content;
      }

      // Handle array content (SEC-006: structured data)
      if (Array.isArray(content)) {
        return content
          .filter((c) => {
            return typeof c === 'object' && c !== null && 'type' in c && c.type === 'text';
          })
          .map((c) => {
            if (typeof c === 'object' && c !== null && 'type' in c && c.type === 'text' && 'text' in c) {
              return String((c as { text: string }).text || '');
            }
            return '';
          })
          .join('\n');
      }

      // Handle other types (convert to string)
      return String(content ?? '');
    })
    .filter((c) => c.length > 0)
    .join('\n');
}

/**
 * Extracts text content from an LLMResult-like object.
 */
export function extractLLMResultText(llmResult: LLMResultLike): string[] {
  const texts: string[] = [];

  for (const generations of llmResult.generations) {
    for (const gen of generations) {
      if (gen.text) {
        texts.push(gen.text);
      }
    }
  }

  return texts;
}
