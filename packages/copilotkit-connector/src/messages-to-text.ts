/**
 * CopilotKit Message Content Extractor
 * =====================================
 *
 * Extracts text content from CopilotKit messages for validation.
 *
 * Security Features:
 * - SEC-006: Complex message content handling (arrays, images, structured data)
 * - SEC-005: Action call content extraction
 *
 * @package @blackunicorn/bonklm-copilotkit
 */

import type { CopilotKitAction, CopilotKitContentPart, CopilotKitMessage } from './types.js';

/**
 * Extracts text content from CopilotKit messages.
 *
 * @remarks
 * Handles complex message content types per SEC-006.
 *
 * @param messages - Array of CopilotKitMessage objects
 * @returns Concatenated text content from all messages
 */
export function messagesToText(messages: CopilotKitMessage[]): string {
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

      // Handle array content (SEC-006: structured data, images, etc.)
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
function contentPartToText(part: CopilotKitContentPart): string {
  switch (part.type) {
    case 'text':
      return part.text || '';

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
 * Extracts text from action calls for validation.
 *
 * @remarks
 * Addresses SEC-005: Action call injection protection.
 * Extracts action name and serialized arguments for validation.
 *
 * @param actions - Array of CopilotKitAction objects
 * @returns Concatenated text representation of action calls
 */
export function actionsToText(actions: CopilotKitAction[]): string {
  return actions
    .map((action) => {
      const parts: string[] = [];
      if (action.name) {
        parts.push(`Action: ${action.name}`);
      }
      if (action.description) {
        parts.push(`Description: ${action.description}`);
      }
      if (action.args) {
        try {
          // SEC-005: Serialize arguments for validation
          // This prevents injection via malformed objects
          parts.push(`Arguments: ${JSON.stringify(action.args)}`);
        } catch {
          parts.push('Arguments: [unparseable]');
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
