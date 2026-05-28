/**
 * Story 1.1 — Tool-Call Arguments Validator
 * =========================================
 * Composable validator that scans tool-call args (and the tool name
 * itself) through a configurable validator stack — typically
 * `PromptInjectionValidator`, `SecretGuard`, `BashSafetyGuard`,
 * `XSSGuard`. Returns an aggregated `GuardrailResult` with per-leaf
 * `subResults` for observability.
 *
 * Default serializer walks the args tree (depth-first), validating every
 * string leaf. WeakSet-based cycle protection prevents self-referential
 * args (`obj.self = obj`) from stack-overflowing. Default depth cap is 5
 * — anything deeper is recorded with an out-of-band `isTruncated` flag
 * and surfaces as a WARNING-severity finding so the truncation is
 * observable, not silent.
 *
 * Walker explicitly traverses `Map`, `Set`, `Buffer`, `Uint8Array`,
 * `URL`, and `Date` — `Object.entries` alone misses these (their data
 * lives on internal slots) and connectors deserialising JSON-RPC or
 * gRPC payloads commonly produce them.
 *
 * Tool name is scanned in raw and humanised form. Humanisation
 * normalises snake_case / camelCase / kebab-case / dot.separated /
 * Unicode-separator names by replacing every non-alphanumeric run with
 * a single ASCII space. ALL_CAPS acronym boundaries split on
 * `[A-Z]+[A-Z][a-z]` (e.g. `disableAPIKey` → `disable api key`).
 *
 * Round-2 amendment R2-2: connectors that support runtime tool
 * registration (`register_action(name, handler)`-style) MUST also wire
 * the tool name into prompt-injection at registration time, not only at
 * invocation. This factory ships the scanning capability; per-connector
 * registration enforcement lives in the Tier-1 connector stories. The
 * factory always scans the tool name regardless of whether a custom
 * serializer is supplied — custom serializers contribute additional
 * leaves but cannot suppress the name scan.
 */
import type { Validator, ValidatorInput } from '../engine/GuardrailEngine.types.js';
import { createResult, type Finding, type GuardrailResult, Severity } from '../base/GuardrailResult.js';
import { maxSeverity, riskFromScore, runValidatorChain, VALIDATOR_ERROR_CATEGORIES } from './validator-utils.js';

const DEFAULT_PER_FIELD_DEPTH = 5;
const MAX_PATH_PREVIEW = 80;

const TOOL_NAME_KEY = 'toolName';
const TOOL_NAME_HUMANIZED_KEY = 'toolName:humanized';

/**
 * Humanise a tool name into a space-separated lowercase form so the
 * natural-language injection patterns can match it.
 *
 * Replaces every non-letter / non-number run with a single space.
 * Subsumes underscore, dash, dot, whitespace, Cyrillic middle dot
 * U+00B7, fullwidth period U+FF0E, katakana middle dot U+30FB, etc.
 * Splits camelCase and ALL_CAPS acronym boundaries so `disableAPIKey`
 * and `disableAPI_KEY` both become `disable api key`.
 */
function humanizeToolName(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .toLowerCase()
    .trim();
}

export interface ToolCallArgsValidatorConfig {
  /**
   * Validator stack to run on every scanned string leaf and on the
   * tool name itself. Order matters: short-circuits on the first BLOCK.
   */
  validators: Validator[];
  /**
   * Custom serializer for tool-call args. If supplied, replaces the
   * default args tree walker but **never** suppresses the tool-name
   * scan — the factory always scans the raw + humanised tool name as
   * the first two leaves.
   *
   * Custom serializers receive the raw `toolName` for context but should
   * focus on serialising the `args` payload. Return one or more strings
   * to scan; the factory's default walker returns a list keyed by JSON
   * path (e.g. `'args.body'`, `'args.items[3]'`).
   */
  serializer?: ToolCallSerializer;
  /**
   * Maximum nested-object depth the default serializer will descend.
   * @default 5
   */
  perFieldDepth?: number;
}

export type ToolCallSerializer = (
  toolName: string,
  args: unknown,
  depth: number
) => string | string[] | Array<{ key: string; value: string }>;

interface CollectedLeaf {
  key: string;
  value: string;
  /**
   * True when this leaf is a depth-cap truncation marker rather than a
   * real scanned value. The validation loop checks this flag, not the
   * string value, so an attacker-supplied arg whose value happens to
   * equal a sentinel string cannot impersonate a truncation.
   */
  isTruncated?: boolean;
}

/**
 * Story 1.1 default serializer.
 *
 * Walks the args tree depth-first; records every string leaf with a JSON
 * path key so the caller can correlate findings to the specific arg
 * field. Uses a WeakSet to break cycles cheaply.
 */
function defaultWalker(args: unknown, maxDepth: number): CollectedLeaf[] {
  const out: CollectedLeaf[] = [];
  const seen = new WeakSet<object>();

  const decoder = new TextDecoder('utf-8', { fatal: false });

  const recurse = (node: unknown, path: string, depth: number): void => {
    if (depth > maxDepth) {
      out.push({ key: path, value: '', isTruncated: true });
      return;
    }
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      out.push({ key: path, value: node });
      return;
    }
    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, i) => recurse(item, `${path}[${i}]`, depth + 1));
      return;
    }
    if (node instanceof Map) {
      let i = 0;
      for (const [k, v] of node.entries()) {
        const keyStr = typeof k === 'string' ? k : `<${typeof k}>`;
        recurse(v, `${path}.map(${keyStr})`, depth + 1);
        i++;
        if (i > 1024) break;
      }
      return;
    }
    if (node instanceof Set) {
      let i = 0;
      for (const v of node.values()) {
        recurse(v, `${path}.set[${i}]`, depth + 1);
        i++;
        if (i > 1024) break;
      }
      return;
    }
    if (node instanceof URL) {
      out.push({ key: `${path}.url`, value: node.toString() });
      return;
    }
    if (node instanceof Date) {
      out.push({ key: `${path}.date`, value: node.toISOString() });
      return;
    }
    if (node instanceof Uint8Array || Buffer.isBuffer?.(node)) {
      try {
        const decoded = decoder.decode(node as Uint8Array);
        out.push({ key: `${path}.bytes`, value: decoded });
      } catch {
        // Non-UTF8 bytes — skip.
      }
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      recurse(v, path ? `${path}.${k}` : k, depth + 1);
    }
  };

  recurse(args, 'args', 0);
  return out;
}

function previewKey(key: string): string {
  return key.length > MAX_PATH_PREVIEW ? `${key.slice(0, MAX_PATH_PREVIEW)}…` : key;
}

// Story 1.3 (audit-loop BLOCK fix) — `maxSeverity`, `riskFromScore`,
// `runValidators` previously lived inline here and were duplicated
// across the three composite validators. They now live in
// `./validator-utils.ts`; `runValidators` is renamed `runValidatorChain`
// to match. We pass the error-category string explicitly so each
// composite preserves its own diagnostic taxonomy.

function normaliseSerializerOutput(raw: ReturnType<ToolCallSerializer>): CollectedLeaf[] {
  if (typeof raw === 'string') return [{ key: 'serialized', value: raw }];
  if (!Array.isArray(raw)) {
    throw new TypeError(
      `createToolCallArgsValidator: custom serializer must return a string, a string[], or an Array<{key, value}>. Received ${typeof raw}.`
    );
  }
  const out: CollectedLeaf[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (typeof entry === 'string') {
      out.push({ key: `serialized[${i}]`, value: entry });
    } else if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { key?: unknown }).key === 'string' &&
      typeof (entry as { value?: unknown }).value === 'string'
    ) {
      out.push({ key: (entry as { key: string }).key, value: (entry as { value: string }).value });
    } else {
      throw new TypeError(
        `createToolCallArgsValidator: custom serializer returned an unsupported entry at index ${i}.`
      );
    }
  }
  return out;
}

function buildToolNameLeaves(toolName: string): CollectedLeaf[] {
  const humanized = humanizeToolName(toolName);
  const leaves: CollectedLeaf[] = [{ key: TOOL_NAME_KEY, value: toolName }];
  if (humanized && humanized !== toolName.toLowerCase()) {
    leaves.push({ key: TOOL_NAME_HUMANIZED_KEY, value: humanized });
  }
  return leaves;
}

/**
 * Build a `Validator` that scans the tool name + args through the
 * supplied validator stack.
 */
export function createToolCallArgsValidator(config: ToolCallArgsValidatorConfig): Validator {
  const validators = config.validators;
  const maxDepth = config.perFieldDepth ?? DEFAULT_PER_FIELD_DEPTH;
  const serializer: ToolCallSerializer | undefined = config.serializer;

  if (validators.length === 0) {
    throw new Error('createToolCallArgsValidator requires at least one underlying validator.');
  }

  return {
    name: 'ToolCallArgsValidator',
    async validate(input: string | ValidatorInput): Promise<GuardrailResult> {
      if (typeof input === 'string') {
        // @deprecated string path — treat as a bare tool name (no args).
        // Will throw in 0.5; removed in 1.0. Mirrors the default-walker
        // behaviour: scan raw + humanised forms so snake_case names are
        // not silently exempt from the prompt-injection patterns.
        const humanized = humanizeToolName(input);
        const raw = await runValidatorChain(validators, input, VALIDATOR_ERROR_CATEGORIES.toolCallArgs);
        if (raw.blocked || !humanized || humanized === input.toLowerCase()) {
          return raw;
        }
        const humanizedResult = await runValidatorChain(validators, humanized, VALIDATOR_ERROR_CATEGORIES.toolCallArgs);
        return humanizedResult.blocked ? humanizedResult : raw;
      }

      if (input.kind !== 'tool_call') {
        return createResult(true, Severity.INFO, []);
      }

      const { toolName, args } = input;

      // Tool-name leaves are ALWAYS scanned, regardless of whether a
      // custom serializer is supplied — R2-2 requires the name to flow
      // through prompt-injection at every entry point, and a connector
      // that supplied a custom serializer would otherwise be able to
      // silently drop the toolName from the scan set.
      const leaves: CollectedLeaf[] = buildToolNameLeaves(toolName);

      if (serializer) {
        const raw = serializer(toolName, args, maxDepth);
        leaves.push(...normaliseSerializerOutput(raw));
      } else {
        leaves.push(...defaultWalker(args, maxDepth));
      }

      const subResults: Array<{ key: string; result: GuardrailResult }> = [];
      const allFindings: Finding[] = [];
      let aggregateBlocked = false;
      let aggregateSeverity: Severity = Severity.INFO;
      let aggregateScore = 0;
      let firstBlockedReason: string | undefined;

      for (const leaf of leaves) {
        if (leaf.isTruncated) {
          const truncationFinding: Finding = {
            category: 'tool_call_args_depth_capped',
            severity: Severity.WARNING,
            description: `Tool-call args walker hit perFieldDepth=${maxDepth} at ${previewKey(leaf.key)}; not all sub-fields were scanned.`,
            weight: 1
          };
          subResults.push({
            key: leaf.key,
            result: createResult(true, Severity.WARNING, [truncationFinding])
          });
          allFindings.push(truncationFinding);
          aggregateSeverity = maxSeverity(aggregateSeverity, Severity.WARNING);
          continue;
        }

        const leafResult = await runValidatorChain(validators, leaf.value, VALIDATOR_ERROR_CATEGORIES.toolCallArgs);
        subResults.push({ key: leaf.key, result: leafResult });
        // Aggregate findings up to the top-level for callers that
        // iterate `result.findings`. `subResults[i].result.findings`
        // also holds the per-leaf findings; consumers MUST NOT sum both
        // when aggregating (double-counting). See GuardrailResult.subResults JSDoc.
        allFindings.push(...leafResult.findings);
        aggregateSeverity = maxSeverity(aggregateSeverity, leafResult.severity);
        aggregateScore += leafResult.risk_score;

        if (leafResult.blocked && !aggregateBlocked) {
          aggregateBlocked = true;
          firstBlockedReason = leafResult.reason ?? `Blocked at ${previewKey(leaf.key)}`;
        }
      }

      return {
        allowed: !aggregateBlocked,
        blocked: aggregateBlocked,
        reason: firstBlockedReason,
        severity: aggregateSeverity,
        risk_level: riskFromScore(aggregateScore),
        risk_score: aggregateScore,
        findings: allFindings,
        subResults,
        timestamp: Date.now()
      };
    }
  };
}
