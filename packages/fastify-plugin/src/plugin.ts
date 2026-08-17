/**
 * Fastify Guardrails Plugin
 * ============================
 * Fastify plugin for LLM security guardrails.
 *
 * Security controls:
 * - Path traversal protection via path.normalize()
 * - Production-safe error responses by default
 * - Validation timeout via `validateWithTimeoutSecure`
 * - UTF-8 request size limits
 * - Runtime configuration validation
 * - Optional attack logging and session tracking
 *
 * @package @blackunicorn/bonklm-fastify
 */

import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { normalize } from 'node:path';
import {
  createLogger,
  GuardrailEngine,
  type GuardrailResult,
  isSessionEscalated,
  type Logger,
  LogLevel,
  RiskLevel,
  sanitizeMeta,
  Schema,
  serializeError,
  type SessionPatternFinding,
  Severity,
  updateSessionState,
  validateWithTimeoutSecure,
  Validators
} from '@blackunicorn/bonklm';
import type {
  ErrorHandler,
  GuardrailsPluginOptions,
  GuardrailsRequest,
  PathMatcher,
  ResponseExtractor
} from './types.js';
import { defaultResponseExtractor, extractRequestContent } from './content.js';

const DEFAULT_LOGGER = createLogger('console', LogLevel.INFO);

// Production mode error handler (generic, no info leakage)
const PRODUCTION_ERROR_HANDLER: ErrorHandler = async (
  _result: GuardrailResult,
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {
  await reply.status(400).send({
    error: 'Request blocked',
    request_id: req.id
  });
};

// Development mode error handler (verbose)
const DEVELOPMENT_ERROR_HANDLER: ErrorHandler = async (
  result: GuardrailResult,
  _req: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {
  // Validator output is attacker-influenced, so sanitize it at the
  // response boundary. Severity and risk level are library enums.
  await reply.status(400).send({
    error: 'Request blocked by guardrails',
    reason: sanitizeMeta(result.reason),
    severity: result.severity,
    risk_level: result.risk_level
  });
};

/**
 * Configuration schema evaluated when the plugin initializes.
 */
// ALL fields wrapped in `Validators.optional(...)` — the
// plugin destructures with defaults for every field, so the schema must
// validate SHAPES when supplied without rejecting sparse configs. The
// validators/guards arrays use `validatorInstance` (accepts BOTH object-
// shape Validator instances AND bare callables).
const FASTIFY_CONFIG_SCHEMA = new Schema({
  validators: Validators.optional(Validators.array(Validators.validatorInstance, 0, 100)),
  guards: Validators.optional(Validators.array(Validators.validatorInstance, 0, 100)),
  validateRequest: Validators.optional(Validators.boolean),
  validateResponse: Validators.optional(Validators.boolean),
  paths: Validators.optional(Validators.array(Validators.string, 0, 100)),
  excludePaths: Validators.optional(Validators.array(Validators.string, 0, 100)),
  logger: Validators.optional(Validators.loggerInstance),
  productionMode: Validators.optional(Validators.boolean),
  validationTimeout: Validators.optional(Validators.timeout),
  maxContentLength: Validators.optional(Validators.positiveNumber(0)),
  onError: Validators.optional(Validators.function),
  responseExtractor: Validators.optional(Validators.function),
  // AttackLogger is a class instance, not a bare callable.
  attackLogger: Validators.optional(Validators.attackLoggerInstance),
  enableSessionTracking: Validators.optional(Validators.boolean),
  sessionIdExtractor: Validators.optional(Validators.function)
});

/**
 * Validate plugin configuration at initialization.
 */
function validateFastifyConfig(options: GuardrailsPluginOptions): void {
  FASTIFY_CONFIG_SCHEMA.validateOrThrow(options as Record<string, unknown>);
  if (options.enableSessionTracking === true && typeof options.sessionIdExtractor !== 'function') {
    throw new Error('sessionIdExtractor is required when enableSessionTracking is true');
  }
}

const SESSION_ID = /^[A-Za-z0-9._~-]{1,128}$/;

function extractSessionId(
  extractor: NonNullable<GuardrailsPluginOptions['sessionIdExtractor']>,
  request: FastifyRequest
) {
  const value = extractor(request);
  if (typeof value !== 'string' || !SESSION_ID.test(value)) {
    throw new Error('sessionIdExtractor must return a 1-128 character opaque session ID');
  }
  return value;
}

type CrossVersionRouteRequest = FastifyRequest & {
  readonly routeOptions?: { readonly url?: string };
  readonly routerPath?: string;
};

function getConcretePath(request: FastifyRequest): string {
  const queryStart = request.url.indexOf('?');
  return queryStart === -1 ? request.url : request.url.slice(0, queryStart);
}

function getRoutePath(request: FastifyRequest): string {
  const compatibleRequest = request as CrossVersionRouteRequest;
  return compatibleRequest.routeOptions?.url ?? compatibleRequest.routerPath ?? '<route-unavailable>';
}

// Path normalization for security
// Prevents path traversal attacks like /api/ai/../chat
/**
 * Compiles a path pattern into a matcher function.
 * @param pattern - The path pattern to match (e.g., "/api/chat")
 * @returns A function that tests if a given path matches the pattern
 */
export function compilePathMatcher(pattern: string): PathMatcher {
  // Validate pattern is a non-empty string
  if (!pattern || typeof pattern !== 'string') {
    throw new Error(`Invalid path pattern: expected string, got ${typeof pattern}`);
  }

  // Normalize the pattern and convert backslashes to forward slashes
  const normalized = normalize(pattern).replace(/\\/g, '/');
  const pathPrefix = normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;

  return (path: string): boolean => {
    // Validate path parameter
    if (!path || typeof path !== 'string') {
      return false;
    }

    // Normalize the request path
    const normalizedPath = normalize(path).replace(/\\/g, '/');
    return pathPrefix === '/' || normalizedPath === pathPrefix || normalizedPath.startsWith(`${pathPrefix}/`);
  };
}

type ValidateContent = (content: string, context?: string) => Promise<GuardrailResult>;

interface PluginContext {
  readonly enableSessionTracking: boolean;
  readonly errorHandler: ErrorHandler;
  readonly logger: Logger;
  readonly maxContentLength: number;
  readonly productionMode: boolean;
  readonly responseExtractor: ResponseExtractor;
  readonly usesDefaultResponseExtractor: boolean;
  readonly sessionIdExtractor: GuardrailsPluginOptions['sessionIdExtractor'];
  readonly shouldProcessPaths: (paths: readonly string[]) => boolean;
  readonly validateRequest: boolean;
  readonly validateResponse: boolean;
  readonly validateWithTimeout: ValidateContent;
}

function createEngine(options: GuardrailsPluginOptions, logger: Logger): GuardrailEngine {
  const engine = new GuardrailEngine({ validators: options.validators ?? [], guards: options.guards ?? [], logger });
  if (options.attackLogger) engine.onIntercept(options.attackLogger.getInterceptCallback());
  return engine;
}

function createPathSelector(options: GuardrailsPluginOptions): PluginContext['shouldProcessPaths'] {
  const include = (options.paths ?? []).map(compilePathMatcher);
  const exclude = (options.excludePaths ?? []).map(compilePathMatcher);
  return pathsToCheck => {
    const paths = pathsToCheck.filter(Boolean).map(path => normalize(path).replace(/\\/g, '/'));
    if (paths.length === 0 || exclude.some(matcher => paths.some(path => matcher(path)))) return false;
    return include.length === 0 || include.some(matcher => paths.some(path => matcher(path)));
  };
}

function createValidator(engine: GuardrailEngine, timeoutMs: number, logger: Logger): ValidateContent {
  return async (content, context) =>
    validateWithTimeoutSecure<GuardrailResult>({
      operation: async () => await engine.validate(content, context),
      timeoutMs,
      timeoutSentinel: () => ({
        allowed: false,
        blocked: true,
        severity: Severity.CRITICAL,
        risk_level: RiskLevel.HIGH,
        risk_score: 100,
        findings: [],
        timestamp: Date.now(),
        reason: 'Validation timeout'
      }),
      logger
    });
}

function createPluginContext(options: GuardrailsPluginOptions): PluginContext {
  const logger = options.logger ?? DEFAULT_LOGGER;
  const productionMode = options.productionMode ?? true;
  const engine = createEngine(options, logger);
  return {
    enableSessionTracking: options.enableSessionTracking ?? false,
    errorHandler: options.onError ?? (productionMode ? PRODUCTION_ERROR_HANDLER : DEVELOPMENT_ERROR_HANDLER),
    logger,
    maxContentLength: options.maxContentLength ?? 1024 * 1024,
    productionMode,
    responseExtractor: options.responseExtractor ?? defaultResponseExtractor,
    sessionIdExtractor: options.sessionIdExtractor,
    shouldProcessPaths: createPathSelector(options),
    validateRequest: options.validateRequest ?? true,
    validateResponse: options.validateResponse ?? false,
    validateWithTimeout: createValidator(engine, options.validationTimeout ?? 5000, logger),
    usesDefaultResponseExtractor: options.responseExtractor === undefined
  };
}

function blockedResult(
  reason: string,
  severity: Severity,
  riskLevel: RiskLevel,
  riskScore: number,
  findings: GuardrailResult['findings'] = []
): GuardrailResult {
  return {
    allowed: false,
    blocked: true,
    severity,
    risk_level: riskLevel,
    risk_score: riskScore,
    findings,
    timestamp: Date.now(),
    reason
  };
}

async function sendBlockedReply(
  result: GuardrailResult,
  request: FastifyRequest,
  reply: FastifyReply,
  context: PluginContext
): Promise<void> {
  try {
    await context.errorHandler(result, request, reply);
  } catch (error) {
    context.logger.error('[Guardrails] Custom error handler failed', { error: serializeError(error) });
  }
  if (!reply.sent) await PRODUCTION_ERROR_HANDLER(result, request, reply);
}

async function handleOversizedRequest(
  content: string,
  request: FastifyRequest,
  reply: FastifyReply,
  context: PluginContext
): Promise<boolean> {
  const byteLength = Buffer.byteLength(content, 'utf8');
  if (byteLength <= context.maxContentLength) return false;
  context.logger.warn('[Guardrails] Content too large', { byteLength, max: context.maxContentLength });
  await sendBlockedReply(
    blockedResult('Content too large', Severity.WARNING, RiskLevel.MEDIUM, 50),
    request,
    reply,
    context
  );
  return true;
}

async function handleExistingEscalation(
  sessionId: string | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
  context: PluginContext
): Promise<boolean> {
  if (sessionId === undefined) return false;
  const result = isSessionEscalated(sessionId);
  if (!result.escalated) return false;
  const reason = sanitizeMeta(result.reason);
  context.logger.warn('[Guardrails] Session escalated, blocking request', { reason });
  await sendBlockedReply(
    blockedResult(`Session escalated: ${reason}`, Severity.CRITICAL, RiskLevel.HIGH, result.riskScore),
    request,
    reply,
    context
  );
  return true;
}

export function sessionFindings(result: GuardrailResult): SessionPatternFinding[] {
  return (result.findings ?? []).map(finding => ({
    category: finding.category,
    weight:
      finding.weight ?? (finding.severity === Severity.CRITICAL ? 5 : finding.severity === Severity.BLOCKED ? 3 : 1),
    pattern_name: finding.pattern_name,
    timestamp: result.timestamp
  }));
}

async function handleSessionUpdate(
  sessionId: string | undefined,
  result: GuardrailResult,
  request: FastifyRequest,
  reply: FastifyReply,
  context: PluginContext
): Promise<boolean> {
  if (sessionId === undefined) return false;
  const findings = sessionFindings(result);
  if (findings.length === 0) return false;
  const sessionResult = updateSessionState(sessionId, findings);
  if (!sessionResult.shouldEscalate) return false;
  const reason = sanitizeMeta(sessionResult.reason);
  context.logger.warn('[Guardrails] Session escalated after validation', { reason });
  await sendBlockedReply(
    blockedResult(
      `Session escalation: ${reason}`,
      Severity.CRITICAL,
      RiskLevel.HIGH,
      sessionResult.riskScore,
      result.findings
    ),
    request,
    reply,
    context
  );
  return true;
}

async function handleBlockedRequest(
  result: GuardrailResult,
  routePath: string,
  request: FastifyRequest,
  reply: FastifyReply,
  context: PluginContext
): Promise<void> {
  const reason = result.reason || 'Content blocked by security guardrails';
  context.logger.warn('[Guardrails] Request blocked', { reason: sanitizeMeta(reason), path: sanitizeMeta(routePath) });
  await sendBlockedReply({ ...result, reason }, request, reply, context);
}

async function validateRequestContent(
  request: FastifyRequest,
  reply: FastifyReply,
  routePath: string,
  context: PluginContext
): Promise<void> {
  const content = extractRequestContent(request.body);
  if (await handleOversizedRequest(content, request, reply, context)) return;
  const sessionId = context.enableSessionTracking ? extractSessionId(context.sessionIdExtractor!, request) : undefined;
  if (await handleExistingEscalation(sessionId, request, reply, context)) return;
  const result = await context.validateWithTimeout(content, 'input');
  const guardedRequest = request as GuardrailsRequest;
  guardedRequest._guardrailsResults = [result];
  guardedRequest._guardrailsValidated = true;
  if (await handleSessionUpdate(sessionId, result, request, reply, context)) return;
  if (!result.allowed) await handleBlockedRequest(result, routePath, request, reply, context);
}

export async function handleRequestError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
  context: PluginContext
): Promise<void> {
  if (reply.sent) return;
  context.logger.error('[Guardrails] Validation error', { error: serializeError(error) });
  await sendBlockedReply(
    blockedResult('Validation error', Severity.CRITICAL, RiskLevel.HIGH, 100),
    request,
    reply,
    context
  );
}

export async function runRequestValidation(
  request: FastifyRequest,
  reply: FastifyReply,
  context: PluginContext
): Promise<void> {
  const routePath = getRoutePath(request);
  if (!context.shouldProcessPaths([getConcretePath(request), routePath])) return;
  if ((request as GuardrailsRequest)._guardrailsValidated) return;
  try {
    await validateRequestContent(request, reply, routePath, context);
  } catch (error) {
    await handleRequestError(error, request, reply, context);
  }
}

const STALE_REPRESENTATION_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-encoding',
  'content-length',
  'content-range',
  'etag',
  'last-modified'
] as const;

function replaceResponse(reply: FastifyReply, body: Record<string, string>): string {
  for (const header of STALE_REPRESENTATION_HEADERS) reply.removeHeader(header);
  reply.status(502).type('application/json; charset=utf-8');
  return JSON.stringify(body);
}

function assertInspectableEncoding(reply: FastifyReply, context: PluginContext): void {
  const encoding = reply.getHeader('content-encoding');
  if (
    context.usesDefaultResponseExtractor &&
    encoding !== undefined &&
    String(encoding).trim().toLowerCase() !== 'identity'
  ) {
    throw new TypeError('Encoded responses require a custom responseExtractor');
  }
}

export async function runResponseValidation(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
  context: PluginContext
): Promise<unknown> {
  const routePath = getRoutePath(request);
  if (!context.shouldProcessPaths([getConcretePath(request), routePath]) || reply.sent) return payload;
  try {
    assertInspectableEncoding(reply, context);
    const result = await context.validateWithTimeout(context.responseExtractor(payload), 'output');
    if (result.allowed) return payload;
    const reason = sanitizeMeta(result.reason || 'Response blocked by security guardrails');
    context.logger.warn('[Guardrails] Response blocked', { reason, path: sanitizeMeta(routePath) });
    const guardedRequest = request as GuardrailsRequest;
    guardedRequest._guardrailsResults = [...(guardedRequest._guardrailsResults ?? []), result];
    return context.productionMode
      ? replaceResponse(reply, { error: 'Response filtered' })
      : replaceResponse(reply, { error: 'Response filtered by guardrails', reason });
  } catch (error) {
    context.logger.error('[Guardrails] Response validation error', { error: serializeError(error) });
    return replaceResponse(reply, { error: 'Validation error' });
  }
}

function registerHooks(fastify: FastifyInstance, context: PluginContext): void {
  if (context.validateRequest) {
    fastify.addHook('preHandler', async (request, reply) => runRequestValidation(request, reply, context));
  }
  fastify.addHook('onError', async (_request, reply, error) => {
    rethrowUnsentRouteError(reply, error);
  });
  if (context.validateResponse) {
    fastify.addHook('onSend', async (request, reply, payload) =>
      runResponseValidation(request, reply, payload, context)
    );
  }
}

export function rethrowUnsentRouteError(reply: FastifyReply, error: Error): void {
  if (!reply.sent) throw error;
}

/**
 * Fastify plugin for LLM guardrails.
 *
 * Validates incoming requests and outgoing responses using the core guardrails engine.
 *
 * @param fastify - Fastify instance
 * @param options - Plugin configuration options
 *
 * @example
 * ```typescript
 * import Fastify from 'fastify';
 * import guardrailsPlugin from '@blackunicorn/bonklm-fastify';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const fastify = Fastify();
 *
 * await fastify.register(guardrailsPlugin, {
 *   validators: [new PromptInjectionValidator()],
 *   validateRequest: true,
 *   validateResponse: false,
 * });
 * ```
 */
const guardrailsPlugin: FastifyPluginAsync<GuardrailsPluginOptions> = async (fastify, options) => {
  validateFastifyConfig(options);
  registerHooks(fastify, createPluginContext(options));
  fastify.decorateRequest('_guardrailsValidated', false);
  fastify.decorateRequest('_guardrailsResults', undefined);
};

export default fp(guardrailsPlugin, {
  fastify: '>=5.8.5 <6',
  name: '@blackunicorn/bonklm-fastify'
});

// Export the unwrapped plugin and types for testing
export { guardrailsPlugin };
export type { GuardrailsPluginOptions, GuardrailsRequest, ErrorHandler, ResponseExtractor };
