/**
 * Mastra Message Content Extractor
 * ================================
 *
 * Extracts text content from Mastra messages for validation.
 *
 * Security Features:
 * - Complex message content handling (arrays, images, structured data)
 * - Tool call content extraction
 *
 * @package @blackunicorn/bonklm-mastra
 */

import type { MastraContentPart, MastraMessage, MastraToolCall } from './types.js';

/**
 * Extracts text content from Mastra messages.
 *
 * @remarks
 * Handles complex message content types:
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
  return messagesToTextWithTelemetry(messages).text;
}

/**
 * A tally of content parts whose real payload was NOT surfaced as scannable
 * text — either reduced to a fixed placeholder (e.g. `image_url` → '[Image]')
 * or dropped to '' (an unrecognized part `type`). The indirect-injection arm
 * therefore never inspects that channel; surfacing the tally turns the silent
 * pass into an operator signal (mirrors the MCP connector's uninspectable-blob
 * telemetry, PR #146).
 *
 * @internal
 */
export interface ReducedContentTally {
  /** Total number of content parts reduced to a placeholder or dropped. */
  reducedCount: number;
  /**
   * Distinct kind labels of the reduced/dropped parts. For an unrecognized
   * `type` the label is the attacker-controlled `type` string itself, so it
   * MUST be CWE-117-sanitized at the log site — it is never emitted raw.
   */
  reducedKinds: string[];
}

/**
 * Text reduced from messages plus the tally of channels left unscanned.
 *
 * @internal
 */
export interface ReducedMessages {
  text: string;
  tally: ReducedContentTally;
}

/**
 * Text surfaced for scanning from a content part, plus the kind labels of any
 * sub-part whose payload was reduced to a placeholder or dropped.
 *
 * @internal
 */
interface PartReduction {
  text: string;
  reducedKinds: string[];
}

/**
 * {@link messagesToText} plus a tally of the non-text channels it could not
 * surface for scanning. Text output is byte-identical to {@link messagesToText}.
 *
 * @internal
 * @param messages - Array of MastraMessage objects
 * @returns Concatenated scannable text plus the reduced-channel tally
 */
export function messagesToTextWithTelemetry(messages: MastraMessage[]): ReducedMessages {
  const reductions = messages.map(reduceMessage);
  const text = reductions
    .map(r => r.text)
    .filter(c => c.length > 0)
    .join('\n');
  const reducedKinds = reductions.flatMap(r => r.reducedKinds);
  return {
    text,
    tally: { reducedCount: reducedKinds.length, reducedKinds: [...new Set(reducedKinds)] }
  };
}

/**
 * Reduces a single message to its scannable text + reduced-channel kinds.
 *
 * @internal
 */
function reduceMessage(m: MastraMessage): PartReduction {
  const content = m.content;

  // Handle messages without content
  if (content === undefined || content === null) {
    return { text: '', reducedKinds: [] };
  }

  // Handle string content (most common case)
  if (typeof content === 'string') {
    return { text: content, reducedKinds: [] };
  }

  // Handle array content (structured data, images, tool calls, etc.)
  if (Array.isArray(content)) {
    const parts = content.map(reduceContentPart);
    return {
      text: parts
        .map(p => p.text)
        .filter(c => c.length > 0)
        .join('\n'),
      reducedKinds: parts.flatMap(p => p.reducedKinds)
    };
  }

  // Handle other types (convert to string)
  return { text: String(content), reducedKinds: [] };
}

/**
 * Reduces a single content part to its scannable text plus the kind labels of
 * any channel whose payload was reduced to a placeholder or dropped.
 *
 * @internal
 * @param part - The content part to reduce
 * @returns Scannable text plus reduced-channel kind labels
 */
function reduceContentPart(part: MastraContentPart): PartReduction {
  switch (part.type) {
    case 'text':
      return { text: part.text || '', reducedKinds: [] };

    case 'tool_use': {
      // regression: Extract tool call info for validation
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
      return { text: toolParts.join('\n'), reducedKinds: [] };
    }

    case 'tool_result': {
      // Extract tool result content
      if (typeof part.toolResult?.content === 'string') {
        return { text: `Tool Result: ${part.toolResult.content}`, reducedKinds: [] };
      }
      if (Array.isArray(part.toolResult?.content)) {
        const nested = part.toolResult.content.map(reduceContentPart);
        const inner = nested
          .map(n => n.text)
          .filter(c => c.length > 0)
          .join('\n');
        // Keep the historical `Tool Result: ` prefix (even when inner is empty)
        // so text output stays byte-identical to the pre-telemetry reducer;
        // nested image/unknown parts still propagate their reduced-kind labels.
        return { text: `Tool Result: ${inner}`, reducedKinds: nested.flatMap(n => n.reducedKinds) };
      }
      return part.toolResult?.isError ? { text: 'Tool Error', reducedKinds: [] } : { text: '', reducedKinds: [] };
    }

    case 'image_url':
      // Image URLs are not validated as text (checked elsewhere). The '[Image]'
      // placeholder carries none of the channel's payload, so flag it as a
      // reduced channel for telemetry.
      return { text: '[Image]', reducedKinds: ['image_url'] };

    default:
      // An unrecognized content-part `type` is dropped to '' — the declared
      // union is not enforced on attacker-supplied JSON, so a payload can be
      // parked under a novel type. Flag the (attacker-controlled) type so the
      // drop is not silent; it is CWE-117-sanitized at the log site, never raw.
      return { text: '', reducedKinds: [reducedKindLabel(part)] };
  }
}

/**
 * Best-effort kind label for an unrecognized content part. The agent SDKs hand
 * us untyped JSON, so `part.type` may be any value despite the declared union;
 * coerce to a non-empty string for telemetry (sanitized at the log site).
 *
 * @internal
 */
function reducedKindLabel(part: MastraContentPart): string {
  const raw = (part as { type?: unknown }).type;
  return typeof raw === 'string' && raw.length > 0 ? raw : 'unknown';
}

/**
 * Extracts text from tool calls for validation.
 *
 * @remarks
 * Addresses tool call injection protection.
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
    .map(tool => {
      const parts: string[] = [];
      if (tool.name) {
        parts.push(`Tool: ${tool.name}`);
      }
      if (tool.input) {
        try {
          // Serialize input for validation
          // This prevents injection via malformed objects
          parts.push(`Input: ${JSON.stringify(tool.input)}`);
        } catch {
          parts.push('Input: [unparseable]');
        }
      }
      return parts.join('\n');
    })
    .filter(c => c.length > 0)
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
