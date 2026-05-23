/**
 * Story 3.7 — wrapReducto (Reducto wrapper, BONUS per AC)
 * =========================================================
 *
 * Wraps `reductoai ^0.15.0`. Proxies the `parse(request)` surface;
 * Reducto returns a parsed document with `result.chunks[]` (text +
 * embeddings + bbox metadata). We validate the concatenated chunk
 * text.
 */
import {
  assertNotWrapped,
  markWrapped,
} from '@blackunicorn/bonklm/core/connector-utils';
import { validateExtractedText } from './validate-extracted-text.js';
import type { DocumentIngestWrapOptions } from './types.js';

/**
 * Subset of Reducto SDK surface we proxy. Real type:
 * `reductoai` `Reducto.parse`.
 */
export interface ReductoClientLike {
  parse(request: unknown): Promise<ReductoParseResponse>;
}

export interface ReductoParseResponse {
  result?: {
    chunks?: Array<{
      content?: string;
      embed?: string;
      enriched?: string;
      bbox?: unknown;
    }>;
  };
  job_id?: string;
  duration?: number;
}

const BONKLM_WIRED = Symbol.for('bonklm.reducto.wired');

export function wrapReducto<C extends ReductoClientLike>(
  client: C,
  options: DocumentIngestWrapOptions
): C {
  if (!client || typeof client !== 'object') {
    throw new TypeError('wrapReducto: client is required.');
  }
  // Sprint 21 audit closure (code-reviewer N-3): explicit guard so a
  // missing `.parse` produces a clear error rather than a confusing
  // "Cannot read properties of undefined" at `.bind` time.
  if (typeof client.parse !== 'function') {
    throw new TypeError('wrapReducto: client.parse must be a function.');
  }
  if (!options?.engine) {
    throw new TypeError('wrapReducto: options.engine is required.');
  }
  assertNotWrapped(client, BONKLM_WIRED, 'wrapReducto');

  const originalParse = client.parse.bind(client);

  const wrapped = {
    ...client,
    async parse(request: unknown): Promise<ReductoParseResponse> {
      const response = await originalParse(request);
      const chunks = response?.result?.chunks;
      if (!Array.isArray(chunks) || chunks.length === 0) return response;
      const joined = chunks
        .map((c) => (typeof c?.content === 'string' ? c.content : ''))
        .filter((t) => t.length > 0)
        .join('\n\n');
      if (joined.length === 0) return response;
      await validateExtractedText(joined, {
        ...options,
        phase: 'reducto',
        documentId: response.job_id,
      });
      return response;
    },
  } as unknown as C;

  markWrapped(wrapped, BONKLM_WIRED);
  return wrapped;
}
