/**
 * MCP Tool-Result Extraction
 * ==========================
 *
 * Reduces an MCP tool result to the set of strings scanned by the guardrail
 * chain on the `tool_result` ingress path. Extracted from `guarded-mcp.ts` to
 * keep that file under the file-size cap and to let the scanning policy be tested
 * in isolation.
 *
 * Policy summary (see `docs/user/known-limitations.md` §30):
 * - Every scannable text leaf is collected — top-level `text` items,
 *   `resource.text` / `resource.uri`, and recursively-collected string leaves of
 *   embedded structured content.
 * - Base64 binary blobs (`image` / `audio` `data`, `resource.blob`) are decoded
 *   and scanned only when opted in; otherwise they are tallied as uninspectable.
 * - Extraction is bounded (leaf count, cumulative bytes, depth, traversal nodes);
 *   an oversized leaf is scanned as a bounded prefix rather than dropped; any
 *   bound hit sets {@link ExtractedResultContent.truncated} for telemetry.
 *
 * @package @blackunicorn/bonklm-mcp
 */

import { extractContentFromResponse } from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Options controlling how an MCP tool result is reduced to scannable content.
 *
 * @internal
 */
export interface ResultExtractOptions {
  /** Bounded-decode base64 binary blobs to UTF-8 and scan them. */
  decodeBinaryContent: boolean;
  /** Max decoded size, in bytes, for a single base64 blob. */
  maxDecodedBlobSize: number;
}

/**
 * Mutable accumulator threaded through the recursive extraction walk.
 *
 * @internal
 */
interface LeafAccumulator {
  /** Scannable text leaves collected so far. */
  segments: string[];
  /** Kind labels of binary/base64 blobs left uninspectable. */
  blobs: string[];
  /** Running total UTF-8 byte length of `segments` (cumulative DoS bound). */
  bytes: number;
  /** Count of graph nodes visited (traversal-work DoS bound). */
  nodes: number;
  /** Set once a bound is hit; further leaves are dropped + flagged. */
  truncated: boolean;
}

/**
 * Scannable content extracted from an MCP tool result.
 *
 * @internal
 */
export interface ExtractedResultContent {
  /**
   * Every independently-scannable text leaf: top-level `text` items,
   * `resource.text` / `resource.uri`, recursively-collected string leaves of
   * embedded structured content, and (when opted in) decoded base64 blobs.
   */
  segments: string[];
  /** Count of binary/base64 blobs that were NOT decoded + scanned. */
  uninspectableCount: number;
  /** Distinct kind labels of the uninspectable blobs (telemetry only). */
  uninspectableKinds: string[];
  /** True if a bound (count / bytes / depth / nodes) was hit and a tail dropped. */
  truncated: boolean;
}

/**
 * Maximum object-graph depth walked when collecting string leaves from embedded
 * structured content. Content nested deeper is a documented recall gap
 * (known-limitations §30), flagged via {@link ExtractedResultContent.truncated}.
 *
 * @internal
 */
export const MAX_EXTRACTION_DEPTH = 6;

/**
 * Object keys that are protocol structure, not attacker payload — skipped during
 * recursive leaf collection so discriminators / MIME types are not scanned as
 * content. Deliberately NARROW (`annotations` is NOT skipped — an adversarial
 * server is not bound by the MCP schema and could smuggle a directive under it).
 *
 * @internal
 */
const STRUCTURAL_KEYS = new Set(['type', 'mimeType']);

/**
 * Content-block `type` values whose `data` field is base64 binary per the MCP
 * spec. A `data` string is routed to blob handling ONLY when the enclosing block
 * is one of these — a `data` field on any other block (e.g. a forged `text`
 * block) is scanned as text, so an attacker cannot exclude a payload from the
 * scan by parking it in a field named `data`.
 *
 * @internal
 */
const BINARY_CONTENT_TYPES = new Set(['image', 'audio']);

/**
 * Upper bounds on extraction breadth + traversal work. A hostile result (many
 * tiny items, a huge field, a wide array of non-strings) cannot drive unbounded
 * memory or scan/traversal time; hitting any bound sets
 * {@link ExtractedResultContent.truncated}, surfaced as telemetry. Because the
 * leaf count is capped here, every collected leaf is also scanned independently
 * in {@link buildScanViews} — there is no separate per-item cap.
 *
 * @internal
 */
export const MAX_SEGMENTS = 64;
export const MAX_TOTAL_SCAN_BYTES = 256 * 1024;
export const MAX_TRAVERSAL_NODES = 5000;

/**
 * Appends a scannable leaf, enforcing the count + cumulative-byte bounds.
 *
 * @internal
 * @remarks
 * Bytes are measured with `Buffer.byteLength` (UTF-8), not `String.length`
 * (UTF-16 code units), so non-ASCII content is bounded accurately. An oversized
 * leaf is NOT dropped: a bounded PREFIX (up to the remaining budget) is scanned
 * so an injection at the start of a padded leaf is still caught.
 */
function pushSegment(acc: LeafAccumulator, value: string): void {
  if (acc.truncated || value.length === 0) {
    return;
  }
  if (acc.segments.length >= MAX_SEGMENTS) {
    acc.truncated = true;
    return;
  }
  const remainingBytes = MAX_TOTAL_SCAN_BYTES - acc.bytes;
  const valueBytes = Buffer.byteLength(value, 'utf8');
  if (valueBytes > remainingBytes) {
    if (remainingBytes > 0) {
      const clipped = Buffer.from(value, 'utf8').subarray(0, remainingBytes).toString('utf8');
      if (clipped.length > 0) {
        acc.segments.push(clipped);
        acc.bytes += Buffer.byteLength(clipped, 'utf8');
      }
    }
    acc.truncated = true;
    return;
  }
  acc.segments.push(value);
  acc.bytes += valueBytes;
}

/**
 * Bounded base64 → UTF-8 decode for an opt-in decode-and-scan of binary blobs.
 *
 * @internal
 * @remarks
 * Rejects (returns `null`) any blob whose encoded length could exceed the byte
 * bound before allocating, and any decoded buffer over the bound or empty. This
 * caps the amplification / DoS surface of decoding attacker-controlled base64.
 */
function tryDecodeBase64(b64: string, maxBytes: number): string | null {
  if (b64.length === 0) {
    return null;
  }
  // base64 encodes ~3 bytes per 4 chars; reject oversized input pre-allocation.
  if (b64.length > Math.ceil((maxBytes * 4) / 3) + 4) {
    return null;
  }
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0 || buf.length > maxBytes) {
      return null;
    }
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Routes a base64 binary blob to either a decoded scannable segment (opt-in) or
 * the uninspectable bucket.
 *
 * @internal
 */
function handleBlob(b64: string, kind: string, acc: LeafAccumulator, opts: ResultExtractOptions): void {
  if (opts.decodeBinaryContent) {
    // `tryDecodeBase64` returns null for an empty/over-bound decode, so a
    // non-null result is always a non-empty string.
    const decoded = tryDecodeBase64(b64, opts.maxDecodedBlobSize);
    if (decoded !== null) {
      pushSegment(acc, decoded);
      return;
    }
    // Decode failed or exceeded the bound — fall through to uninspectable.
  }
  acc.blobs.push(kind);
}

/**
 * Recursively collects string leaves from an MCP content item (or nested
 * structured value), routing base64 `data` / `blob` fields to {@link handleBlob}.
 *
 * @internal
 * @remarks
 * Traversal is bounded by depth AND a per-result node budget, and uses `for…in`
 * + `hasOwnProperty` (not `Object.entries`, which allocates every key up front)
 * so a wide hostile object/array of non-string nodes cannot drive unbounded
 * work. Any bound hit sets `acc.truncated`.
 */
function collectStringLeaves(
  value: unknown,
  acc: LeafAccumulator,
  opts: ResultExtractOptions,
  depth: number,
  kindHint: string
): void {
  if (acc.truncated) {
    return;
  }
  if (depth > MAX_EXTRACTION_DEPTH) {
    // Depth-cut is a form of "tail left unscanned"; flag it like the size caps
    // so a deep-nesting evasion produces an operator signal, not silence.
    acc.truncated = true;
    return;
  }
  if (++acc.nodes > MAX_TRAVERSAL_NODES) {
    acc.truncated = true;
    return;
  }
  if (typeof value === 'string') {
    pushSegment(acc, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (acc.truncated) {
        return;
      }
      collectStringLeaves(entry, acc, opts, depth + 1, kindHint);
    }
    return;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const hint = typeof obj.type === 'string' ? obj.type : kindHint;
    for (const key in obj) {
      if (acc.truncated) {
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(obj, key) || STRUCTURAL_KEYS.has(key)) {
        continue;
      }
      const child = obj[key];
      // Route base64 binary to blob handling ONLY for genuinely-binary fields:
      // a `resource.blob`, or a `data` field on an image/audio block. A `data`
      // field anywhere else is scanned as text (see BINARY_CONTENT_TYPES) so a
      // payload cannot be hidden from the scan by naming its field `data`.
      if (typeof child === 'string') {
        if (key === 'blob') {
          handleBlob(child, 'resource.blob', acc, opts);
          continue;
        }
        if (key === 'data' && BINARY_CONTENT_TYPES.has(hint)) {
          handleBlob(child, hint, acc, opts);
          continue;
        }
      }
      collectStringLeaves(child, acc, opts, depth + 1, hint);
    }
  }
}

/**
 * Reduces an MCP tool result to every scannable text leaf plus a tally of the
 * binary blobs that could not be inspected.
 *
 * @internal
 * @remarks
 * For an MCP `content[]` result this walks each item, collecting string leaves
 * (text items, `resource.text` / `resource.uri`, embedded structured-content
 * strings) and routing base64 `data` / `blob` fields per the decode policy. For
 * a non-MCP-shaped result it falls back to the generic multi-format extractor.
 */
export function extractResultContent(result: unknown, opts: ResultExtractOptions): ExtractedResultContent {
  const acc: LeafAccumulator = { segments: [], blobs: [], bytes: 0, nodes: 0, truncated: false };

  if (result && typeof result === 'object' && Array.isArray((result as { content?: unknown[] }).content)) {
    for (const item of (result as { content: unknown[] }).content) {
      collectStringLeaves(item, acc, opts, 0, 'binary');
    }
  } else {
    // Fallback to connector-utils for generic (non-MCP) response formats.
    pushSegment(acc, extractContentFromResponse(result, { defaultValue: '' }));
  }

  return {
    segments: acc.segments,
    uninspectableCount: acc.blobs.length,
    uninspectableKinds: [...new Set(acc.blobs)],
    truncated: acc.truncated
  };
}

/**
 * Builds the deduplicated set of strings to scan from the extracted leaves.
 *
 * @internal
 * @remarks
 * - The newline-joined view preserves the historical single-scan behaviour.
 * - The separator-free concatenation reconstructs a contiguous attack token an
 *   attacker split across two content items to slip past arms with no
 *   inter-token whitespace allowance (e.g. `AGENT_` + `FOOTER` → `AGENT_FOOTER`).
 * - Each leaf is also scanned independently to defeat benign-padding /
 *   truncation-window evasion. The leaf count is already capped upstream
 *   (MAX_SEGMENTS), so every collected leaf is scanned; the joined and
 *   concatenated views still carry the full collected content.
 */
export function buildScanViews(segments: string[]): string[] {
  const views: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string): void => {
    if (candidate.length > 0 && !seen.has(candidate)) {
      seen.add(candidate);
      views.push(candidate);
    }
  };

  add(segments.join('\n'));

  if (segments.length > 1) {
    add(segments.join(''));
    for (const segment of segments) {
      add(segment);
    }
  }

  return views;
}
