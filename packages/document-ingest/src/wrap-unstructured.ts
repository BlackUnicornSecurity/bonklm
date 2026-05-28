/**
 * Story 3.7 — wrapUnstructured (Unstructured wrapper)
 * =====================================================
 *
 * Wraps `unstructured-client ^0.31.0`. Proxies the
 * `general.partition(request)` surface; validates the concatenated
 * text from each returned element before passing the result back to
 * the caller.
 *
 * Unstructured returns an array of "elements" — each has a
 * `category` (Title / NarrativeText / ListItem / Table / etc.) and a
 * `text` field. We validate the joined text across ALL elements
 * (the LLM consumer typically concatenates them anyway).
 */
import { assertNotWrapped, markWrapped } from '@blackunicorn/bonklm/core/connector-utils';
import { validateExtractedText } from './validate-extracted-text.js';
import type { DocumentIngestWrapOptions } from './types.js';

/**
 * Subset of unstructured-client surface we proxy. Real type:
 * `unstructured-client.SDK.general.partition`.
 */
export interface UnstructuredClientLike {
  general: {
    partition(request: unknown, requestOptions?: unknown): Promise<UnstructuredPartitionResponse>;
  };
}

export interface UnstructuredPartitionResponse {
  /** Per-element extracted text. */
  elements?: Array<{
    text?: string;
    type?: string;
    metadata?: Record<string, unknown>;
  }>;
  /** HTTP status / raw envelope — pass through. */
  statusCode?: number;
  contentType?: string;
}

const BONKLM_WIRED = Symbol.for('bonklm.unstructured.wired');

/**
 * Wrap an unstructured-client SDK instance. Returns a NEW object;
 * underlying SDK is not mutated. Reject re-wrap.
 */
export function wrapUnstructured<C extends UnstructuredClientLike>(client: C, options: DocumentIngestWrapOptions): C {
  if (!client || typeof client !== 'object' || !client.general) {
    throw new TypeError('wrapUnstructured: client with `.general.partition` is required.');
  }
  if (!options?.engine) {
    throw new TypeError('wrapUnstructured: options.engine is required.');
  }
  assertNotWrapped(client, BONKLM_WIRED, 'wrapUnstructured');

  const originalPartition = client.general.partition.bind(client.general);

  const wrapped = {
    ...client,
    general: {
      ...client.general,
      async partition(request: unknown, requestOptions?: unknown): Promise<UnstructuredPartitionResponse> {
        const response = await originalPartition(request, requestOptions);
        const elements = response?.elements;
        if (!Array.isArray(elements) || elements.length === 0) return response;
        const joined = elements
          .map(el => (typeof el?.text === 'string' ? el.text : ''))
          .filter(t => t.length > 0)
          .join('\n\n');
        if (joined.length === 0) return response;
        await validateExtractedText(joined, {
          ...options,
          phase: 'unstructured'
        });
        return response;
      }
    }
  } as unknown as C;

  markWrapped(wrapped, BONKLM_WIRED);
  return wrapped;
}
