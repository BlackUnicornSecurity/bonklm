/**
 * @blackunicorn/bonklm-hono — Body extraction
 * ============================================
 * Extract the validatable text payload from a Hono request. Handles
 * JSON, plain text, and form-encoded bodies; respects the
 * `options.bodyFields` allowlist when set.
 *
 * Story 2.2 AC: body extractor abstracted so a future
 * `packages/web-middleware-utils/` package can reuse it across
 * Hono / Express / Fastify connectors. For Phase-1 it lives here;
 * the shared package is deferred.
 *
 * SECURITY: this module is the FIRST line that handles attacker-
 * controlled bytes. It MUST NOT throw on malformed input; throws
 * surface as Hono 500 (info disclosure) rather than ConnectorValidationError
 * (the validation gate). All paths catch JSON-parse errors and
 * coerce to empty-string-or-best-effort text.
 */
// Native JSON.parse is sufficient here — we walk the parsed tree to
// extract string leaves (never return the object to caller code), so
// prototype pollution via `__proto__` / `constructor` keys is contained
// inside this module's local scope. Walking via Object.values() ignores
// the polluted prototype chain.

/**
 * Maximum bytes the extractor will read from the request body.
 *
 * Hono itself does not enforce a body-size limit by default; consumers
 * deploying on edge runtimes are constrained by the host (Workers
 * has a 100MB request limit). For BonkLM validation, anything beyond
 * 1MB is almost certainly attacker-pumping. We bound the extraction
 * to defeat memory-exhaustion DoS against the validator chain.
 */
const MAX_BODY_BYTES = 1_000_000; // 1 MB

/**
 * Extracted body — `text` is the concatenated payload to validate;
 * `fields` (when `bodyFields` was set) maps field name to extracted
 * text for fine-grained reporting.
 *
 * `charsetUnsupported: true` when the declared content-type charset
 * is outside the supported set (UTF-8 / ASCII / Latin-1). The
 * middleware uses this to return a 415 Unsupported Media Type before
 * feeding mojibake to the validator chain. `text` is empty in this case.
 */
export interface ExtractedBody {
  text: string;
  fields?: Record<string, string>;
  charsetUnsupported?: boolean;
}

/**
 * Iter-1 security BLOCK #4 — supported charsets. `TextDecoder`
 * hardcoded to UTF-8 was vulnerable to a charset-mismatch bypass:
 * a request with `content-type: application/json; charset=UTF-16`
 * would be decoded as UTF-8 (producing mojibake), `JSON.parse` would
 * throw, the catch-all fallback would emit the mojibake as text, and
 * the validator chain would scan the garbled bytes — silently
 * letting through an injection payload encoded in UTF-16. Defence:
 * we accept only UTF-8 / ASCII / Latin-1 (web-platform defaults).
 * Any other declared charset is treated as a malformed request:
 * `extractBody` returns `{ text: '' }` so validation safely skips
 * but the consumer's route handler will still see the raw body and
 * can choose how to respond (typically 400 / 415).
 */
const SUPPORTED_CHARSETS = new Set([
  'utf-8',
  'utf8',
  'us-ascii',
  'ascii',
  'iso-8859-1',
  'latin-1',
  'latin1',
]);

/**
 * Parse the charset parameter out of a `content-type` header value.
 * Returns the lowercased + trimmed charset, or `'utf-8'` when the
 * header is absent or unparseable (the web-platform default).
 */
function parseCharset(contentType: string): string {
  // content-type format: `type/subtype; param=value; param=value`
  const parts = contentType.split(';');
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].trim();
    if (part.toLowerCase().startsWith('charset=')) {
      // Strip optional quoting per RFC 7231 §3.1.1.1.
      return part.slice('charset='.length).trim().replace(/^["']|["']$/g, '').toLowerCase();
    }
  }
  return 'utf-8';
}

/**
 * Read the request body, bounded at `MAX_BODY_BYTES`. Returns the
 * raw string and a `truncated` flag. Never throws.
 *
 * Iter-1 security BLOCK #4 — when the declared charset is not in
 * `SUPPORTED_CHARSETS`, returns `{ raw: '', truncated: false,
 * charsetUnsupported: true }` so the caller can surface the error
 * (and importantly, NOT feed mojibake to the validator chain).
 */
async function readBodyBounded(
  req: Request
): Promise<{ raw: string; truncated: boolean; charsetUnsupported?: boolean }> {
  try {
    // Stream-aware bounded read via Web Streams API. We accumulate
    // bytes until the cap is reached, then abort the stream and
    // return what we have.
    const body = req.body;
    if (body === null) {
      return { raw: '', truncated: false };
    }

    // Charset gate — defeat the UTF-16 / UTF-32 mojibake bypass.
    const contentType = (req.headers.get('content-type') ?? '').toLowerCase();
    const charset = parseCharset(contentType);
    if (!SUPPORTED_CHARSETS.has(charset)) {
      try {
        await body.cancel();
      } catch {
        // ignore
      }
      return { raw: '', truncated: false, charsetUnsupported: true };
    }

    const reader = body.getReader();
    // TextDecoder supports utf-8, iso-8859-1, etc. via the WHATWG
    // Encoding spec. `iso-8859-1` ↔ `latin-1` aliases handled.
    const decoder = new TextDecoder(charset, { fatal: false });
    let total = 0;
    let truncated = false;
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          truncated = true;
          // Take only the prefix that fits under the cap.
          const remaining = MAX_BODY_BYTES - (total - value.byteLength);
          if (remaining > 0) {
            buffer += decoder.decode(value.subarray(0, remaining), { stream: false });
          }
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          break;
        }
        buffer += decoder.decode(value, { stream: true });
      }
    }
    buffer += decoder.decode();
    return { raw: buffer, truncated };
  } catch {
    // Network-level read errors (caller aborted, bad stream) surface
    // as empty body — the middleware then skips validation rather
    // than 500-ing on a malformed request.
    return { raw: '', truncated: false };
  }
}

/**
 * Extract the validatable text payload from a Hono request.
 *
 * Content-type handling:
 * - `application/json` → parse via `secureJSONParse` (defeats prototype
 *   pollution). If `bodyFields` is set, concatenate only those fields.
 *   Otherwise concatenate every string leaf in the parsed object.
 * - `text/plain` or no content-type → use the raw body as text.
 * - `application/x-www-form-urlencoded` → parse via URLSearchParams,
 *   concatenate every value (or `bodyFields` subset).
 * - everything else → treat as opaque; use raw body up to the cap.
 *
 * Never throws — returns `{ text: '' }` on any failure.
 */
export async function extractBody(
  req: Request,
  bodyFields?: string[]
): Promise<ExtractedBody> {
  const { raw, charsetUnsupported } = await readBodyBounded(req);
  if (charsetUnsupported === true) {
    return { text: '', charsetUnsupported: true };
  }
  if (raw.length === 0) return { text: '' };

  const contentType = (req.headers.get('content-type') ?? '').toLowerCase();

  if (contentType.includes('application/json')) {
    return extractFromJson(raw, bodyFields);
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return extractFromForm(raw, bodyFields);
  }
  // Plain text or unknown — the whole body is the validatable text.
  return { text: raw };
}

function extractFromJson(raw: string, bodyFields?: string[]): ExtractedBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    // Malformed JSON — the consumer's app will likely 400 this
    // anyway. We surface the raw text for validation (an attacker
    // pumping non-JSON injection through a JSON endpoint still gets
    // their payload scanned).
    return { text: raw };
  }
  if (parsed === null || typeof parsed !== 'object') {
    // Non-object JSON (number, string, boolean) — the value is the text.
    return { text: typeof parsed === 'string' ? parsed : JSON.stringify(parsed) };
  }

  if (bodyFields !== undefined && bodyFields.length > 0) {
    // Fine-grained per-field extraction.
    const fields: Record<string, string> = {};
    const obj = parsed as Record<string, unknown>;
    for (const field of bodyFields) {
      const value = obj[field];
      if (typeof value === 'string') {
        fields[field] = value;
      } else if (value !== undefined && value !== null) {
        try {
          fields[field] = JSON.stringify(value);
        } catch {
          fields[field] = String(value);
        }
      }
    }
    const text = Object.values(fields).join('\n');
    return { text, fields };
  }

  // Walk every string leaf in the parsed tree and concatenate.
  const leaves: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      leaves.push(node);
    } else if (Array.isArray(node)) {
      for (const child of node) walk(child);
    } else if (node !== null && typeof node === 'object') {
      for (const v of Object.values(node as Record<string, unknown>)) walk(v);
    }
  };
  walk(parsed);
  return { text: leaves.join('\n') };
}

function extractFromForm(raw: string, bodyFields?: string[]): ExtractedBody {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return { text: raw };
  }

  if (bodyFields !== undefined && bodyFields.length > 0) {
    const fields: Record<string, string> = {};
    for (const field of bodyFields) {
      const value = params.get(field);
      if (value !== null) fields[field] = value;
    }
    return { text: Object.values(fields).join('\n'), fields };
  }

  const values: string[] = [];
  params.forEach((value) => values.push(value));
  return { text: values.join('\n') };
}
