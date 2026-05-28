/**
 * Connector Utilities - Content Extractor
 * ======================================
 *
 * Standard utilities for extracting content from various response formats.
 * Handles 10+ response formats across different LLM and vector DB providers.
 *
 * @package @blackunicorn/bonklm/core
 */

/**
 * Content extraction options.
 */
export interface ContentExtractorOptions {
  /** Fields to check for content (in priority order) */
  fields?: string[];
  /** Default value if no content found */
  defaultValue?: string;
  /** Whether to throw error if no content found */
  throwOnMissing?: boolean;
}

/**
 * Extracts text content from a variety of response formats.
 * Handles different response structures from various providers.
 *
 * Supported formats:
 * - String responses
 * - Object responses with named fields (text, content, output, message, etc.)
 * - Nested structures (choices[0].message.content, data[0].text, etc.)
 * - Array responses
 *
 * @param response - The response object from a provider
 * @param options - Extraction options
 * @returns Extracted text content
 *
 * @example
 * ```ts
 * // OpenAI format
 * const text = extractContentFromResponse({
 *   choices: [{ message: { content: 'Hello' } }]
 * });
 *
 * // HuggingFace format
 * const text = extractContentFromResponse({
 *   generated_text: 'Hello world'
 * });
 *
 * // Anthropic format
 * const text = extractContentFromResponse({
 *   content: [{ text: 'Hello' }]
 * });
 * ```
 */
export function extractContentFromResponse(response: unknown, options: ContentExtractorOptions = {}): string {
  const { fields, defaultValue = '', throwOnMissing = false } = options;

  // If already a string, return it
  if (typeof response === 'string') {
    return response;
  }

  // If not an object, can't extract
  if (typeof response !== 'object' || response === null) {
    if (throwOnMissing) {
      throw new Error('Cannot extract content from non-object response');
    }
    return defaultValue;
  }

  const obj = response as Record<string, unknown>;

  // Custom fields take priority
  if (fields) {
    for (const field of fields) {
      const value = getNestedValue(obj, field);
      if (typeof value === 'string') {
        return value;
      }
    }
  }

  // Standard field checks in priority order
  const standardFields = [
    // OpenAI/Chat format
    'choices[0].message.content',
    'choices[0].text',
    // Anthropic format
    'content[0].text',
    // Generic message content
    'message.content',
    'messages[0].content',
    // HuggingFace inference formats
    'generated_text',
    'answer',
    'summary_text',
    'translation_text',
    'output_text',
    // Generic text fields
    'text',
    'content',
    'output',
    'result',
    'response',
    'data[0].text',
    'data[0].content',
    // Completion formats
    'completion'
  ];

  for (const field of standardFields) {
    const value = getNestedValue(obj, field);
    if (typeof value === 'string') {
      return value;
    }
  }

  // Check for array of text items
  if (Array.isArray(obj.content)) {
    const textItems = obj.content
      .filter((item: unknown) => item && typeof item === 'object')
      .map((item: { text?: string }) => item.text)
      .filter((text: unknown) => typeof text === 'string');
    if (textItems.length > 0) {
      return textItems.join('\n');
    }
  }

  // Check for array response
  if (Array.isArray(response) && response.length > 0) {
    const first = response[0];
    if (typeof first === 'string') {
      return first;
    }
    if (typeof first === 'object') {
      return extractContentFromResponse(first, options);
    }
  }

  // No content found
  if (throwOnMissing) {
    throw new Error('No content found in response');
  }
  return defaultValue;
}

/**
 * Gets a nested value from an object using bracket notation.
 * Supports paths like 'choices[0].message.content'.
 *
 * @param obj - The object to traverse
 * @param path - The path to traverse (e.g., 'a.b.c' or 'a[0].b')
 * @returns The value at the path, or undefined if not found
 *
 * @internal
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(/[\.\[]/);
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    // Clean up array index notation
    const key = part.replace(/\]$/, '');
    const index = parseInt(key, 10);

    if (typeof current === 'object' && current !== null) {
      if (!isNaN(index) && Array.isArray(current)) {
        current = current[index];
      } else {
        current = (current as Record<string, unknown>)[key];
      }
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Extracts content from an array of potential response formats.
 * Useful when a provider might return different formats.
 *
 * @param responses - Array of possible response objects
 * @param options - Extraction options
 * @returns First successfully extracted content
 *
 * @example
 * ```ts
 * const text = extractContentFirstSuccess([
 *   response.data,
 *   response,
 *   response.output
 * ]);
 * ```
 */
export function extractContentFirstSuccess(responses: unknown[], options: ContentExtractorOptions = {}): string {
  for (const response of responses) {
    try {
      const content = extractContentFromResponse(response, {
        ...options,
        throwOnMissing: true
      });
      return content;
    } catch {
      // Continue to next response
    }
  }
  return options.defaultValue ?? '';
}

/**
 * Joins multiple content extracts into a single string.
 * Useful for handling multi-part responses.
 *
 * @param responses - Array of response objects or strings
 * @param separator - Separator between content items
 * @param options - Extraction options
 * @returns Joined content string
 *
 * @example
 * ```ts
 * const combined = extractContentJoined([
 *   response1,
 *   response2.data,
 *   response3
 * ], '\n\n');
 * ```
 */
export function extractContentJoined(
  responses: unknown[],
  separator: string = '\n',
  options: ContentExtractorOptions = {}
): string {
  const parts: string[] = [];

  for (const response of responses) {
    if (typeof response === 'string') {
      parts.push(response);
    } else {
      const content = extractContentFromResponse(response, options);
      if (content) {
        parts.push(content);
      }
    }
  }

  return parts.join(separator);
}
