/**
 * Cumulative-audit extraction — `applyRetrievedDocValidatorToMatches`
 * =====================================================================
 *
 * Three vector-DB connectors (pinecone, qdrant, weaviate) implemented
 * an identical 6-line pattern around `retrievedDocValidator.validateBatch`:
 *
 *   1. Build `docs[]` from `matches[]` with position-stable synthetic
 *      ids (`__pos_${i}`) so attacker-influenced metadata cannot spoof
 *      sibling ids.
 *   2. Call `validateBatch(docs)`.
 *   3. On `batch.result.blocked`: throw `ConnectorValidationError`.
 *   4. Build `survivorPositions = Set(batch.docs.map(d => d.id))`.
 *   5. Filter `matches.filter((_m, i) => survivorPositions.has(__pos_${i}))`.
 *
 * Repeated identically across the three connectors, a single bug fix
 * required four coordinated edits. This helper consolidates the pattern.
 * Chroma's 2D-batch shape stays inline because it iterates per-query
 * with reset position keys.
 *
 * @package @blackunicorn/bonklm/core/connector-utils
 */
import { ConnectorValidationError } from './errors.js';
import type { RetrievedDoc, RetrievedDocValidator } from '../validators/retrieved-doc.js';

/** Position-stable synthetic-id prefix. Audit-fix from Story 1.2. */
export const BATCH_POS_PREFIX = '__pos_';

export interface ApplyRetrievedDocValidatorOptions {
  /**
   * Production-mode flag controls error verbosity. When true, the
   * thrown `ConnectorValidationError` carries a generic message; when
   * false, the validator's `reason` string is included for debugging.
   * @default false
   */
  productionMode?: boolean;
  /**
   * Generic-noun used in error messages (e.g. "vector", "point",
   * "object", "document"). Surfaces as `'<noun> batch blocked'`.
   * @default 'item'
   */
  itemNoun?: string;
}

/**
 * Apply a {@link RetrievedDocValidator} to a flat (1D) batch of
 * connector-shaped matches. Returns the surviving subset plus the
 * filtered count.
 *
 * @param matches      Original match array (connector-specific shape).
 * @param validator    Opt-in `RetrievedDocValidator` the connector caller
 *                     supplied.
 * @param toDoc        Per-match adapter mapping a match into the
 *                     `{ content, metadata }` shape the validator
 *                     consumes. The function MUST NOT set `id` — this
 *                     helper assigns `__pos_${i}` so attacker-supplied
 *                     metadata cannot spoof another match's identity.
 * @param options      Production-mode + error-message verbosity.
 *
 * @example
 * ```ts
 * const { valid, blocked } = await applyRetrievedDocValidatorToMatches(
 *   matches,
 *   retrievedDocValidator,
 *   (m) => ({
 *     content: [m.metadata ? JSON.stringify(m.metadata) : '', m.id ?? '']
 *       .filter(Boolean).join(' '),
 *     metadata: m.metadata,
 *   }),
 *   { productionMode, itemNoun: 'vector' }
 * );
 * return { valid, blocked };
 * ```
 */
export async function applyRetrievedDocValidatorToMatches<TMatch>(
  matches: TMatch[],
  validator: RetrievedDocValidator,
  toDoc: (match: TMatch, index: number) => Omit<RetrievedDoc, 'id'>,
  options: ApplyRetrievedDocValidatorOptions = {}
): Promise<{ valid: TMatch[]; blocked: number }> {
  const productionMode = options.productionMode ?? false;
  const itemNoun = options.itemNoun ?? 'item';

  const docs: RetrievedDoc[] = matches.map((m, i) => {
    const base = toDoc(m, i);
    return { ...base, id: `${BATCH_POS_PREFIX}${i}` };
  });

  const batch = await validator.validateBatch(docs);
  if (batch.result.blocked) {
    throw new ConnectorValidationError(
      productionMode ? `${itemNoun} batch blocked` : `${itemNoun} batch blocked: ${batch.result.reason}`,
      'validation_failed'
    );
  }

  const survivorPositions = new Set(batch.docs.map(d => d.id));
  const valid = matches.filter((_m, i) => survivorPositions.has(`${BATCH_POS_PREFIX}${i}`));
  return { valid, blocked: batch.filteredCount };
}
