/**
 * Mastra Message Content Extractor
 * ================================
 *
 * Extracts text content from Mastra messages for validation.
 *
 * Security Features:
 * - SEC-006: Complex message content handling (arrays, images, structured data)
 * - SEC-005: Tool call content extraction
 *
 * @package @blackunicorn/bonklm-mastra
 */

import type { MastraContentPart, MastraMessage, MastraToolCall } from './types.js';

/**
 * Extracts text content from Mastra messages.
 *
 * @remarks
 * Handles complex message content types per SEC-006:
 * - String content: "Hello"
 * - Array content: [{type: 'text', text: 'Hello'}, {type: 'image_url', ...}]
 * - Tool call content: Extracts tool name and input
 *
 * This is a critical security function as it prevents validation bypass
 * when messages contain structured data or images.
 *
 * @param messages - Array of MastraMessage objects
 * @returns Concatenated text content from all messages
 *
 * @example
 * ```ts
 * const messages: MastraMessage[] = [
 *   { role: 'user', content: 'Hello' },
 *   { role: 'user', content: [{ type: 'text', text: 'Hi there' }] }
 * ];
 * const text = messagesToText(messages); // "Hello\nHi there"
 * ```
 */
export function messagesToText(messages: MastraMessage[]): string {
  return messages
    .map((m) => {
      const content = m.content;

      // Handle messages without content
      if (content === undefined || content === null) {
        return '';
      }

      // Handle string content (most common case)
      if (typeof content === 'string') {
        return content;
      }

      // Handle array content (SEC-006: structured data, images, tool calls, etc.)
      if (Array.isArray(content)) {
        return content
          .map((part) => contentPartToText(part))
          .filter((c) => c.length > 0)
          .join('\n');
      }

      // Handle other types (convert to string)
      return String(content);
    })
    .filter((c) => c.length > 0)
    .join('\n');
}

/**
 * Extracts text from a single content part.
 *
 * @internal
 * @param part - The content part to extract text from
 * @returns Extracted text content
 */
function contentPartToText(part: MastraContentPart): string {
  switch (part.type) {
    case 'text':
      return part.text || '';

    case 'tool_use': {
      // SEC-005: Extract tool call info for validation
      // Format: "Tool: toolName\nInput: {...}"
      const toolParts: string[] = [];
      if (part.toolUse?.name) {
        toolParts.push(`Tool: ${part.toolUse.name}`);
      }
      if (part.toolUse?.input) {
        try {
          toolParts.push(`Input: ${JSON.stringify(part.toolUse.input)}`);
        } catch {
          toolParts.push('Input: [unparseable]');
        }
      }
      return toolParts.join('\n');
    }

    case 'tool_result':
      // Extract tool result content
      if (typeof part.toolResult?.content === 'string') {
        return `Tool Result: ${part.toolResult.content}`;
      }
      if (Array.isArray(part.toolResult?.content)) {
        return (
          `Tool Result: ${ 
          part.toolResult.content
            .map((p) => contentPartToText(p))
            .filter((c) => c.length > 0)
            .join('\n')}`
        );
      }
      return part.toolResult?.isError ? 'Tool Error' : '';

    case 'image_url':
      // Don't validate image URLs directly - they're checked elsewhere
      return '[Image]';

    default:
      return '';
  }
}

/**
 * Extracts text from tool calls for validation.
 *
 * @remarks
 * Addresses SEC-005: Tool call injection protection.
 * Extracts tool name and serialized input for validation.
 *
 * @param toolCalls - Array of MastraToolCall objects
 * @returns Concatenated text representation of tool calls
 *
 * @example
 * ```ts
 * const toolCalls: MastraToolCall[] = [
 *   { id: '1', name: 'search', input: { query: 'test' } }
 * ];
 * const text = toolCallsToText(toolCalls); // "Tool: search\nInput: {\"query\":\"test\"}"
 * ```
 */
export function toolCallsToText(toolCalls: MastraToolCall[]): string {
  return toolCalls
    .map((tool) => {
      const parts: string[] = [];
      if (tool.name) {
        parts.push(`Tool: ${tool.name}`);
      }
      if (tool.input) {
        try {
          // SEC-005: Serialize input for validation
          // This prevents injection via malformed objects
          parts.push(`Input: ${JSON.stringify(tool.input)}`);
        } catch {
          parts.push('Input: [unparseable]');
        }
      }
      return parts.join('\n');
    })
    .filter((c) => c.length > 0)
    .join('\n\n');
}

/**
 * Normalizes content to string for validation.
 *
 * @remarks
 * Ensures any input is converted to a string for validation.
 * Handles arrays, objects, and primitive types safely.
 *
 * @param content - Content to normalize
 * @returns String representation of content
 */
export function normalizeToString(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (content === null || content === undefined) {
    return '';
  }
  if (typeof content === 'object') {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  return String(content);
}
