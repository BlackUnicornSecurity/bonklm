/**
 * Weaviate Filter Validation
 * ==========================
 *
 * Structural validation for `weaviate-client ^3` `FilterValue` trees.
 *
 * In the v3 client, `where` filters are not free-form object literals: they
 * are builder-produced trees of `{ filters?, operator, target?, value }`
 * nodes (see `collection.filter.byProperty(...)` / `Filters.and(...)`).
 * Validation therefore walks that exact structure instead of
 * JSON-stringifying and pattern-scanning the input:
 *
 * - node keys restricted to the `FilterValue` shape (own-property reads only,
 *   so prototype-chain tricks and polluted keys like `constructor` are
 *   rejected structurally),
 * - operators checked against the v3 operator allowlist,
 * - leaf targets restricted to the proto `FilterTarget` shape, with property
 *   names length- and character-checked (including the builder's
 *   `len(<property>)` wrapper) and optionally matched against the caller's
 *   `allowedFields` policy,
 * - values typed per operator (e.g. `Like` requires a string,
 *   `WithinGeoRange` requires `{ latitude, longitude, distance }` numbers),
 * - depth and total-node caps to bound traversal cost.
 *
 * Throws a plain `Error` with a specific message; the caller decides how to
 * log it and whether to swap in a production-mode generic message.
 *
 * @package @blackunicorn/bonklm-weaviate
 */

/**
 * The full `weaviate-client ^3` filter operator set (verified against
 * weaviate-client@3.11.0 `Operator`).
 *
 * @internal
 */
const ALLOWED_OPERATORS = new Set([
  'Equal',
  'NotEqual',
  'GreaterThan',
  'GreaterThanEqual',
  'LessThan',
  'LessThanEqual',
  'Like',
  'IsNull',
  'WithinGeoRange',
  'ContainsAny',
  'ContainsAll',
  'ContainsNone',
  'And',
  'Or',
  'Not'
]);

/** Logical operators carrying child filters instead of a target/value. @internal */
const LOGICAL_OPERATORS = new Set(['And', 'Or', 'Not']);

/** Keys a `FilterValue` node may carry. @internal */
const NODE_KEYS = new Set(['filters', 'operator', 'target', 'value']);

/** Keys a proto `FilterTarget` may carry. @internal */
const TARGET_KEYS = new Set(['property', 'singleTarget', 'multiTarget', 'count']);

/** Keys a `WithinGeoRange` value must carry. @internal */
const GEO_RANGE_KEYS = ['latitude', 'longitude', 'distance'] as const;

/** Maximum filter-tree depth. @internal */
const MAX_FILTER_DEPTH = 10;

/** Maximum total nodes in a filter tree. @internal */
const MAX_FILTER_NODES = 256;

/** Maximum length of a filter target property name. @internal */
const MAX_PROPERTY_LENGTH = 100;

/** Safe property-name pattern (GraphQL-safe identifier). @internal */
const SAFE_PROPERTY_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Builder length-filter wrapper: `len(<property>)`. @internal */
const LENGTH_WRAPPER_REGEX = /^len\(([a-zA-Z_][a-zA-Z0-9_]*)\)$/;

/**
 * Options for {@link validateWeaviateFilter}.
 */
export interface ValidateWeaviateFilterOptions {
  /**
   * Optional predicate applied to every leaf target property name (after
   * structural checks). When provided, a property that does not pass is
   * rejected, and cross-reference targets are rejected outright (their
   * referenced properties cannot be checked against the policy).
   */
  isPropertyAllowed?: (property: string) => boolean;
}

/**
 * Reads an own enumerable property only — never the prototype chain — so a
 * key like `constructor` present only on `Object.prototype` reads as
 * `undefined` instead of leaking a prototype member into validation.
 *
 * @internal
 */
const readOwn = (obj: Record<string, unknown>, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;

/**
 * Non-array, non-null object check.
 *
 * @internal
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Primitive filter-operand check (string / finite number / boolean / Date).
 *
 * @internal
 */
const isPrimitiveOperand = (value: unknown): boolean =>
  typeof value === 'string' ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  typeof value === 'boolean' ||
  value instanceof Date;

/**
 * Extracts the validation-failure detail from a thrown value.
 * {@link validateWeaviateFilter} throws `Error`s; the fallback arm keeps the
 * narrow-unknown contract should a future change throw something else.
 */
export const filterValidationDetail = (thrown: unknown): string =>
  thrown instanceof Error ? thrown.message : 'Filter validation failed';

/**
 * Validates a `weaviate-client ^3` `FilterValue` tree structurally.
 *
 * @param filter - The `where` value supplied by the caller.
 * @param options - Optional property-allowlist hook.
 *
 * @throws Error with a specific (non-production) message on the first
 * violation found.
 */
export function validateWeaviateFilter(filter: unknown, options: ValidateWeaviateFilterOptions = {}): void {
  const state = { nodes: 0 };
  visitNode(filter, 0, state, options);
}

/**
 * Validates one `FilterValue` node and recurses into logical children.
 *
 * @internal
 */
function visitNode(
  node: unknown,
  depth: number,
  state: { nodes: number },
  options: ValidateWeaviateFilterOptions
): void {
  if (depth > MAX_FILTER_DEPTH) {
    throw new Error('Filter depth exceeded maximum');
  }

  state.nodes += 1;
  if (state.nodes > MAX_FILTER_NODES) {
    throw new Error('Filter exceeds maximum node count');
  }

  if (!isPlainObject(node)) {
    throw new Error('Filter node must be an object');
  }

  for (const key of Object.keys(node)) {
    if (!NODE_KEYS.has(key)) {
      throw new Error('Filter contains unsupported keys');
    }
  }

  const operator = readOwn(node, 'operator');
  if (typeof operator !== 'string' || !ALLOWED_OPERATORS.has(operator)) {
    throw new Error('Filter operator is not allowed');
  }

  const filters = readOwn(node, 'filters');
  const target = readOwn(node, 'target');
  const value = readOwn(node, 'value');

  if (LOGICAL_OPERATORS.has(operator)) {
    if (!Array.isArray(filters) || filters.length === 0) {
      throw new Error('Logical filter requires child filters');
    }
    if (value !== null && value !== undefined) {
      throw new Error('Logical filter must not carry a value');
    }
    if (target !== undefined) {
      throw new Error('Logical filter must not carry a target');
    }
    for (const child of filters) {
      visitNode(child, depth + 1, state, options);
    }
    return;
  }

  if (filters !== undefined) {
    throw new Error('Leaf filter must not carry child filters');
  }

  validateTarget(target, options);
  validateValue(operator, value);
}

/**
 * Validates a leaf node's proto `FilterTarget`.
 *
 * @internal
 */
function validateTarget(target: unknown, options: ValidateWeaviateFilterOptions): void {
  if (!isPlainObject(target)) {
    throw new Error('Leaf filter requires a target object');
  }

  for (const key of Object.keys(target)) {
    if (!TARGET_KEYS.has(key)) {
      throw new Error('Filter target contains unsupported keys');
    }
  }

  const property = readOwn(target, 'property');
  const hasReferenceTarget =
    readOwn(target, 'singleTarget') !== undefined ||
    readOwn(target, 'multiTarget') !== undefined ||
    readOwn(target, 'count') !== undefined;

  if (property === undefined && !hasReferenceTarget) {
    throw new Error('Filter target requires a property or reference');
  }

  if (property !== undefined) {
    validateTargetProperty(property, options);
  }

  if (hasReferenceTarget && options.isPropertyAllowed) {
    throw new Error('Reference filter targets are not allowed while a field allowlist is configured');
  }
}

/**
 * Validates a target property name (including the builder's
 * `len(<property>)` wrapper) and applies the caller's allowlist policy.
 *
 * @internal
 */
function validateTargetProperty(property: unknown, options: ValidateWeaviateFilterOptions): void {
  if (typeof property !== 'string' || property.length === 0) {
    throw new Error('Filter target property must be a non-empty string');
  }

  if (property.length > MAX_PROPERTY_LENGTH) {
    throw new Error('Filter target property exceeds maximum length');
  }

  const lengthMatch = property.match(LENGTH_WRAPPER_REGEX);
  const propertyName = lengthMatch ? lengthMatch[1] : property;

  if (!SAFE_PROPERTY_REGEX.test(propertyName)) {
    throw new Error('Filter target property contains invalid characters');
  }

  if (options.isPropertyAllowed && !options.isPropertyAllowed(propertyName)) {
    throw new Error('Filter references a property that is not allowed');
  }
}

/**
 * Validates a leaf node's operand value against its operator.
 *
 * @internal
 */
function validateValue(operator: string, value: unknown): void {
  switch (operator) {
    case 'IsNull':
      if (typeof value !== 'boolean') {
        throw new Error('IsNull filter requires a boolean value');
      }
      return;
    case 'ContainsAny':
    case 'ContainsAll':
    case 'ContainsNone':
      if (!Array.isArray(value) || !value.every(isPrimitiveOperand)) {
        throw new Error('Contains filter requires an array of primitive values');
      }
      return;
    case 'WithinGeoRange':
      validateGeoRangeValue(value);
      return;
    case 'Like':
      if (typeof value !== 'string') {
        throw new Error('Like filter requires a string value');
      }
      return;
    case 'GreaterThan':
    case 'GreaterThanEqual':
    case 'LessThan':
    case 'LessThanEqual':
      if (
        typeof value !== 'string' &&
        !(typeof value === 'number' && Number.isFinite(value)) &&
        !(value instanceof Date)
      ) {
        throw new Error('Comparison filter requires a string, finite number, or Date value');
      }
      return;
    case 'Equal':
    case 'NotEqual':
      if (!isPrimitiveOperand(value)) {
        throw new Error('Equality filter requires a primitive value');
      }
      return;
    /* v8 ignore next 3 -- unreachable: operator allowlist precedes the switch */
    default:
      throw new Error('Filter operator is not allowed');
  }
}

/**
 * Validates a `WithinGeoRange` operand (`{ latitude, longitude, distance }`).
 *
 * @internal
 */
function validateGeoRangeValue(value: unknown): void {
  if (!isPlainObject(value)) {
    throw new Error('WithinGeoRange filter requires a geo-range object value');
  }

  for (const key of Object.keys(value)) {
    if (!GEO_RANGE_KEYS.includes(key as (typeof GEO_RANGE_KEYS)[number])) {
      throw new Error('WithinGeoRange value contains unsupported keys');
    }
  }

  for (const key of GEO_RANGE_KEYS) {
    const member = readOwn(value, key);
    if (typeof member !== 'number' || !Number.isFinite(member)) {
      throw new Error('WithinGeoRange value requires finite latitude, longitude, and distance numbers');
    }
  }
}
