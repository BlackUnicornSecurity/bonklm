/**
 * CopilotKit Message Content Extractor
 * =====================================
 *
 * Extracts text content from CopilotKit messages for validation.
 *
 * Security Features:
 * - Complex message content handling (arrays, images, structured data)
 * - Action call content extraction
 *
 * @package @blackunicorn/bonklm-copilotkit
 */

import type { CopilotKitAction, CopilotKitContentPart, CopilotKitMessage } from './types.js';

/**
 * Extracts text content from CopilotKit messages.
 *
 * @remarks
 * Handles complex message content types.
 *
 * @param messages - Array of CopilotKitMessage objects
 * @returns Concatenated text content from all messages
 */
export function messagesToText(messages: CopilotKitMessage[]): string {
  return messagesToTextWithTelemetry(messages).text;
}

/**
 * A tally of content parts whose real payload was NOT surfaced as scannable
 * text — either reduced to a fixed placeholder (e.g. `data` → '[Data]') or
 * dropped to '' (an unrecognized part `type`). The indirect-injection arm
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
 * @param messages - Array of CopilotKitMessage objects
 * @returns Concatenated scannable text plus the reduced-channel tally
 */
export function messagesToTextWithTelemetry(messages: CopilotKitMessage[]): ReducedMessages {
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
function reduceMessage(m: CopilotKitMessage): PartReduction {
  const content = m.content;

  // Handle messages without content
  if (content === undefined || content === null) {
    return { text: '', reducedKinds: [] };
  }

  // Handle string content (most common case)
  if (typeof content === 'string') {
    return { text: content, reducedKinds: [] };
  }

  // Handle array content (structured data, images, etc.)
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
function reduceContentPart(part: CopilotKitContentPart): PartReduction {
  switch (part.type) {
    case 'text':
      return { text: part.text || '', reducedKinds: [] };

    case 'image':
      // Don't validate image URLs directly. The '[Image]' placeholder carries
      // none of the channel's payload, so flag it as a reduced channel.
      return { text: '[Image]', reducedKinds: ['image'] };

    case 'data':
      // A `data` part is a string-typed channel reduced to '[Data]', discarding
      // `part.data`. Always tallied as a reduced channel — even an empty `data`
      // field is a non-text part the scan never inspected — matching the `image`
      // and unknown-type branches and the MCP connector's "always count the
      // uninspectable channel" rule. Text stays byte-identical ('' when empty,
      // '[Data]' otherwise), so only the tally (not the scanned text) changes.
      return { text: part.data ? '[Data]' : '', reducedKinds: ['data'] };

    default:
      // An unrecognized content-part `type` is dropped to '' — the declared
      // union is not enforced on attacker-supplied JSON, so a payload can be
      // parked under a novel type. Flag the (attacker-controlled) type so the
      // drop is not silent; it is CWE-117-sanitized at the log site, never raw.
      return { text: '', reducedKinds: [reducedKindLabel(part)] };
  }
}

/**
 * Best-effort kind label for an unrecognized content part. CopilotKit hands us
 * untyped JSON, so `part.type` may be any value despite the declared union;
 * coerce to a non-empty string for telemetry (sanitized at the log site).
 *
 * @internal
 */
function reducedKindLabel(part: CopilotKitContentPart): string {
  const raw = (part as { type?: unknown }).type;
  return typeof raw === 'string' && raw.length > 0 ? raw : 'unknown';
}

/**
 * Extracts text from action calls for validation.
 *
 * @remarks
 * Addresses action call injection protection.
 * Extracts action name and serialized arguments for validation.
 *
 * @param actions - Array of CopilotKitAction objects
 * @returns Concatenated text representation of action calls
 */
export function actionsToText(actions: CopilotKitAction[]): string {
  return actions
    .map(action => {
      const parts: string[] = [];
      if (action.name) {
        parts.push(`Action: ${action.name}`);
      }
      if (action.description) {
        parts.push(`Description: ${action.description}`);
      }
      if (action.args) {
        try {
          // Serialize arguments for validation
          // This prevents injection via malformed objects
          parts.push(`Arguments: ${JSON.stringify(action.args)}`);
        } catch {
          parts.push('Arguments: [unparseable]');
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
