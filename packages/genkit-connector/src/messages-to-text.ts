/**
 * Genkit Message Content Extractor
 * =================================
 *
 * Extracts text content from Genkit messages for validation.
 *
 * Security Features:
 * - SEC-006: Complex message content handling (arrays, images, structured data)
 * - SEC-005: Tool call content extraction
 *
 * @package @blackunicorn/bonklm-genkit
 */

import type { GenkitContentPart, GenkitMessage, GenkitToolCall } from './types.js';

/**
 * Extracts text content from Genkit messages.
 *
 * @remarks
 * Handles complex message content types per SEC-006.
 *
 * @param messages - Array of GenkitMessage objects
 * @returns Concatenated text content from all messages
 */
export function messagesToText(messages: GenkitMessage[]): string {
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
function contentPartToText(part: GenkitContentPart): string {
  switch (part.type) {
    case 'text':
      return part.text || '';

    case 'toolRequest': {
      // SEC-005: Extract tool call info for validation
      const toolReqParts: string[] = [];
      if (part.toolRequest?.name) {
        toolReqParts.push(`Tool: ${part.toolRequest.name}`);
      }
      if (part.toolRequest?.input) {
        try {
          toolReqParts.push(`Input: ${JSON.stringify(part.toolRequest.input)}`);
        } catch {
          toolReqParts.push('Input: [unparseable]');
        }
      }
      return toolReqParts.join('\n');
    }

    case 'toolResponse': {
      // Extract tool response content
      const toolRespParts: string[] = [];
      if (part.toolResponse?.name) {
        toolRespParts.push(`Tool: ${part.toolResponse.name}`);
      }
      if (part.toolResponse?.output) {
        try {
          toolRespParts.push(`Output: ${JSON.stringify(part.toolResponse.output)}`);
        } catch {
          toolRespParts.push('Output: [unparseable]');
        }
      }
      return toolRespParts.join('\n');
    }

    case 'image':
      // Don't validate image URLs directly
      return '[Image]';

    case 'data':
      return part.data ? '[Data]' : '';

    default:
      return '';
  }
}

/**
 * Extracts text from tool calls for validation.
 *
 * @remarks
 * Addresses SEC-005: Tool call injection protection.
 *
 * @param toolCalls - Array of GenkitToolCall objects
 * @returns Concatenated text representation of tool calls
 */
export function toolCallsToText(toolCalls: GenkitToolCall[]): string {
  return toolCalls
    .map((tool) => {
      const parts: string[] = [];
      if (tool.name) {
        parts.push(`Tool: ${tool.name}`);
      }
      if (tool.input) {
        try {
          // SEC-005: Serialize input for validation
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
