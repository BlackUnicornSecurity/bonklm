/**
 * `getRequestBody(req, framework)` — framework-shape-aware raw-body
 * extractor. Returns the body as a string.
 *
 * Supported frameworks:
 *   - `'web'`         — Web standard `Request` (Fetch API; used by
 *                       Next.js Route Handlers, Hono, Vercel Edge,
 *                       Cloudflare Workers). `await req.text()`.
 *   - `'elysia'`      — Elysia `Context` with `.body` (already-parsed
 *                       or string-typed). We JSON-stringify objects;
 *                       circular-ref-safe via try/catch.
 *   - `'next-action'` — Next.js Server Action `formData` style: pass
 *                       `req` as a plain object; we serialise its
 *                       entries.
 *   - `'node'`        — Legacy Node `IncomingMessage`. The caller MUST
 *                       have pre-buffered the body (Express bodyParser
 *                       or similar); we read `req.body` after coercing
 *                       to string.
 *
 * Note: framework-shape detection is intentionally narrow — operators
 * pass the right `framework` tag rather than us sniffing duck-typed
 * shape (which produces false positives for proxies/mocks).
 */

export type SupportedFramework = 'web' | 'elysia' | 'next-action' | 'node';

export interface RequestLike {
  text?: () => Promise<string>;
  body?: unknown;
}

export async function getRequestBody(req: RequestLike, framework: SupportedFramework): Promise<string> {
  if (!req) {
    throw new TypeError('getRequestBody: req is required.');
  }
  switch (framework) {
    case 'web': {
      if (typeof req.text !== 'function') {
        throw new TypeError('getRequestBody: framework="web" requires req.text() (Web Request).');
      }
      return req.text();
    }
    case 'elysia':
    case 'next-action':
    case 'node': {
      const raw = req.body;
      if (raw === undefined || raw === null) return '';
      if (typeof raw === 'string') return raw;
      if (raw instanceof URLSearchParams) return raw.toString();
      if (typeof FormData !== 'undefined' && raw instanceof FormData) {
        // use `.forEach` instead of `.entries()` iterator
        // — the latter requires `lib: ["DOM.Iterable"]` which the root
        // tsconfig does not bundle (kept Node-only). `.forEach` is
        // available with just `lib: ["DOM"]` via @types/node's FormData
        // global, so this stays portable across Node + edge runtimes.
        const entries: Array<[string, unknown]> = [];
        raw.forEach((value, key) => entries.push([key, value]));
        return safeStringify(Object.fromEntries(entries));
      }
      return safeStringify(raw);
    }
    default:
      throw new TypeError(`getRequestBody: unsupported framework '${framework}'.`);
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return `[unstringifiable:${typeof value}]`;
  }
}
