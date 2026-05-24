/**
 * Guardrails Interceptor
 * ======================
 * NestJS interceptor for automatic request/response validation.
 *
 * @package @blackunicorn/bonklm-nestjs
 *
 * Security Fixes Applied:
 * - S013-001: Use WeakMap for metadata storage to prevent prototype pollution
 * - S013-001: Implement cleanup on response end to prevent memory leaks
 * - S013-006: Add robust error handling for JSON operations
 */

import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Logger as NestLogger,
} from '@nestjs/common';
import { forkJoin, Observable, of, throwError } from 'rxjs';
import { catchError, finalize, map, switchMap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import type { GuardrailResult } from '@blackunicorn/bonklm';
import { RiskLevel, sanitizeMeta, serializeError, Severity } from '@blackunicorn/bonklm';
import type { UseGuardrailsDecoratorOptions } from './types.js';
import { GuardrailsService } from './guardrails.service.js';
import { USE_GUARDRAILS_KEY } from './constants.js';
import { isUseGuardrailsOptions } from './use-guardrails.decorator.js';

/**
 * S013-001: WeakMap for storing guardrails metadata on request objects.
 * Prevents prototype pollution attacks by avoiding direct property assignment.
 * Automatically cleaned up when request objects are garbage collected.
 */
const requestMetadataMap = new WeakMap<any, {
  validated: boolean;
  results?: GuardrailResult[];
  response?: {
    originalSend?: any;
    chunks?: Buffer[];
  };
}>();

/**
 * S013-001: Mark request as validated in WeakMap.
 */
function markRequestValidated(request: any, results?: GuardrailResult[]) {
  requestMetadataMap.set(request, { validated: true, results });
}

/**
 * S013-001: Cleanup metadata for request (called on response end).
 */
function cleanupRequestMetadata(request: any) {
  requestMetadataMap.delete(request);
}

/**
 * Interceptor that validates requests and responses using the GuardrailsService.
 *
 * This interceptor checks for the @UseGuardrails() decorator on handlers
 * and performs validation before the handler executes (input validation)
 * and/or after the handler returns (output validation).
 *
 * @example
 * The interceptor is automatically applied when you use the @UseGuardrails() decorator:
 * ```typescript
 * @Controller('chat')
 * export class ChatController {
 *   @Post()
 *   @UseGuardrails({ validateInput: true, validateOutput: true })
 *   async chat(@Body() body: { message: string }) {
 *     return { response: 'Hello!' };
 *   }
 * }
 * ```
 */
@Injectable()
export class GuardrailsInterceptor implements NestInterceptor {
  private readonly logger = new NestLogger('GuardrailsInterceptor');

  constructor(
    private readonly reflector: Reflector,
    private readonly guardrailsService: GuardrailsService,
  ) {
    this.logger.debug('GuardrailsInterceptor initialized');
  }

  /**
   * Intercept method called by NestJS for each request.
   *
   * S013-001: Uses WeakMap for metadata storage to prevent prototype pollution.
   * S013-001: Cleans up metadata on response completion.
   *
   * @param context - Execution context containing request/response
   * @param next - CallHandler to proceed to the next interceptor or handler
   * @returns Observable with the response or error
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Get decorator options from handler and class metadata
    const handlerOptions = this.reflector.getAllAndOverride<UseGuardrailsDecoratorOptions>(
      USE_GUARDRAILS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no decorator options, skip validation
    if (!handlerOptions && !this.hasDecoratorOnClass(context)) {
      return next.handle();
    }

    const options: UseGuardrailsDecoratorOptions = handlerOptions || {};

    // Default to validateInput: true if not specified
    const validateInput = options.validateInput !== false;
    const validateOutput = options.validateOutput === true;

    // Extract request content
    const request = this.getRequest(context);
    const content = this.extractContent(request, options.bodyField);

    // Skip if no content to validate
    if (!content || content.length === 0) {
      return next.handle();
    }

    // Input validation
    if (validateInput) {
      // Create an observable for input validation
      return of(null).pipe(
        switchMap(() => this.validateInput(content, context, options)),
        switchMap((inputResult) => {
          if (!inputResult.allowed) {
            return throwError(
              () => new BadRequestException({
                error: this.guardrailsService.getErrorMessage(inputResult),
                risk_level: inputResult.risk_level,
              }),
            );
          }

          // S013-001: Store validation results in WeakMap instead of direct request mutation
          markRequestValidated(request, [inputResult]);

          // Proceed to handler and optionally validate output
          // S013-001: Add cleanup on response completion
          return this.handleWithOutputValidation(
            context,
            next,
            validateOutput,
            options,
          ).pipe(
            // S013-001: Cleanup metadata on response completion (success or error)
            finalize(() => {
              cleanupRequestMetadata(request);
            })
          );
        }),
        // S013-001: Also cleanup on error
        catchError((error) => {
          cleanupRequestMetadata(request);
          return throwError(() => error);
        })
      );
    }

    // Skip input validation, only validate output if requested
    // S013-001: Add cleanup on response completion
    return this.handleWithOutputValidation(
      context,
      next,
      validateOutput,
      options,
    ).pipe(
      finalize(() => {
        cleanupRequestMetadata(request);
      }),
      catchError((error) => {
        cleanupRequestMetadata(request);
        return throwError(() => error);
      })
    );
  }

  /**
   * Validate input content.
   *
   * S013-008: Request size validation using UTF-8 byte size.
   */
  private async validateInput(
    content: string,
    context: ExecutionContext,
    options: UseGuardrailsDecoratorOptions,
  ): Promise<GuardrailResult> {
    // S013-008: Check content size using UTF-8 byte count, not character count
    const contentByteLength = Buffer.byteLength(content, 'utf8');
    const maxLength = options.maxContentLength || 1048576; // Default 1MB

    if (contentByteLength > maxLength) {
      this.logger.warn(`Content exceeds max length: ${contentByteLength} bytes > ${maxLength} bytes`);
      return {
        allowed: false,
        blocked: true,
        severity: Severity.WARNING,
        risk_level: RiskLevel.MEDIUM,
        risk_score: 50,
        reason: 'Content too large',
        findings: [],
        timestamp: Date.now(),
      };
    }

    const results = await this.guardrailsService.validateInput(content);
    const blocked = this.guardrailsService.getBlockedResult(results);

    if (blocked) {
      // Sprint 40 connector CWE-117 sweep: `blocked.reason` is built
      // from validator output and may carry attacker-influenced text
      // (matched-pattern content). Wrap the template interpolation.
      this.logger.warn(`Request blocked: ${sanitizeMeta(blocked.reason)}`);
      // Call custom error handler if provided and is a function
      if (options.onError && typeof options.onError === 'function') {
        try {
          options.onError(blocked, context);
        } catch (error) {
          // Sprint 40 connector CWE-117 sweep: use canonical serializeError
          // (Sprint 33 primitive) for the `error` meta field. Bare
          // `{ error }` renders as `error={}` post-JSON.stringify because
          // Error properties are non-enumerable.
          this.logger.error('Error in custom error handler', { error: serializeError(error) });
        }
      }
      return blocked;
    }

    return results[0] || {
      allowed: true,
      blocked: false,
      severity: Severity.INFO,
      risk_level: RiskLevel.LOW,
      risk_score: 0,
      findings: [],
      timestamp: Date.now()
    };
  }

  /**
   * Handle output validation if enabled.
   *
   * S013-008: Request size validation using UTF-8 byte size.
   */
  private handleWithOutputValidation(
    context: ExecutionContext,
    next: CallHandler,
    validateOutput: boolean,
    options: UseGuardrailsDecoratorOptions,
  ): Observable<any> {
    if (!validateOutput) {
      return next.handle();
    }

    return next.handle().pipe(
      switchMap((data) => {
        // Extract response content
        const content = this.extractContentFromResponse(data, options.responseField);

        if (!content || content.length === 0) {
          return of(data);
        }

        // S013-008: Check response size using UTF-8 byte count
        const contentByteLength = Buffer.byteLength(content, 'utf8');
        const maxLength = options.maxContentLength || 1048576; // Default 1MB

        if (contentByteLength > maxLength) {
          this.logger.warn(`Response content exceeds max length: ${contentByteLength} bytes > ${maxLength} bytes`);
          return of({
            error: 'Response filtered by guardrails',
            ...(this.guardrailsService.getConfig().productionMode
              ? {}
              : { reason: 'Response too large' }),
          });
        }

        // Validate output asynchronously
        return forkJoin({
          original: of(data),
          validation: this.guardrailsService.validateOutput(content),
        }).pipe(
          map(({ original, validation }) => {
            const blocked = this.guardrailsService.getBlockedResult(validation);

            if (blocked) {
              // Sprint 40 connector CWE-117 sweep — see line 218 rationale.
              this.logger.warn(`Response blocked: ${sanitizeMeta(blocked.reason)}`);
              // Call custom error handler if provided and is a function
              if (options.onError && typeof options.onError === 'function') {
                try {
                  options.onError(blocked, context);
                } catch (error) {
                  // Sprint 40 connector CWE-117 sweep: use canonical serializeError
          // (Sprint 33 primitive) for the `error` meta field. Bare
          // `{ error }` renders as `error={}` post-JSON.stringify because
          // Error properties are non-enumerable.
          this.logger.error('Error in custom error handler', { error: serializeError(error) });
                }
              }

              // Return filtered response
              return {
                error: 'Response filtered by guardrails',
                ...(this.guardrailsService.getConfig().productionMode
                  ? {}
                  : { reason: blocked.reason }),
              };
            }

            return original;
          }),
        );
      }),
      catchError((error) => {
        // Sprint 40 audit closure (architect HIGH-1 + security S40-3):
        // sister site to the interceptor's existing serializeError
        // call sites (lines 231 + 306). The Sprint 40 first pass
        // missed this `catchError` block 90 lines down.
        this.logger.error('Error in output validation', { error: serializeError(error) });
        return throwError(() => error);
      }),
    );
  }

  /**
   * Get the request object from the execution context.
   */
  private getRequest(context: ExecutionContext): any {
    switch (context.getType()) {
      case 'http': {
        const http = context.switchToHttp();
        return http.getRequest();
      }
      case 'rpc':
        // RPC context (e.g., microservices)
        return context.getArgByIndex(0);
      default:
        return context.getArgByIndex(0);
    }
  }

  /**
   * Extract content from request body.
   *
   * S013-002: Adds prototype pollution protection to JSON.stringify.
   */
  private extractContent(request: any, field?: string): string {
    if (!request || !request.body) {
      return '';
    }

    // Use module-level custom extractor if available
    const bodyExtractor = this.guardrailsService.getBodyExtractor();
    if (bodyExtractor) {
      try {
        const result = bodyExtractor(request);
        return String(result ?? '');
      } catch (error) {
        this.logger.warn('Custom bodyExtractor failed, using default', { error });
        // Fall through to default extraction
      }
    }

    if (field) {
      return String(request.body[field] || '');
    }

    // Try common fields
    const commonFields = ['message', 'prompt', 'content', 'text', 'query', 'input'];
    for (const f of commonFields) {
      if (request.body[f]) {
        return String(request.body[f]);
      }
    }

    // S013-002 & S013-006: Fallback to stringified body with prototype pollution protection
    // Use a replacer function to prevent prototype pollution and handle circular references
    try {
      return JSON.stringify(request.body, (key, value) => {
        // S013-002: Prevent prototype pollution by ignoring prototype chain properties
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          return undefined;
        }
        // Handle circular references
        if (typeof value === 'object' && value !== null) {
          if (value === request.body) {
            return '[Circular]';
          }
        }
        return value;
      });
    } catch (error) {
      // S013-006: Fallback to String if JSON.stringify fails
      this.logger.warn('Failed to stringify body, using String conversion', { error });
      return String(request.body);
    }
  }

  /**
   * Extract content from response data.
   *
   * S013-002: Adds prototype pollution protection to JSON.stringify.
   * S013-006: Adds robust error handling for JSON operations.
   */
  private extractContentFromResponse(data: any, field?: string): string {
    if (!data) {
      return '';
    }

    // Use module-level custom extractor if available
    const responseExtractor = this.guardrailsService.getResponseExtractor();
    if (responseExtractor) {
      try {
        const result = responseExtractor(data);
        return String(result ?? '');
      } catch (error) {
        this.logger.warn('Custom responseExtractor failed, using default', { error });
        // Fall through to default extraction
      }
    }

    if (field) {
      return String(data[field] || '');
    }

    // Try common response fields
    const commonFields = ['text', 'content', 'message', 'response', 'output', 'result', 'data'];
    for (const f of commonFields) {
      if (data[f] && typeof data[f] === 'string') {
        return data[f];
      }
    }

    // Fallback to stringified data
    if (typeof data === 'string') {
      return data;
    }

    // S013-002 & S013-006: Protected JSON stringify with error handling
    try {
      return JSON.stringify(data, (key, value) => {
        // S013-002: Prevent prototype pollution
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          return undefined;
        }
        // Handle circular references
        if (typeof value === 'object' && value !== null) {
          if (value === data) {
            return '[Circular]';
          }
        }
        return value;
      });
    } catch (error) {
      // S013-006: Fallback to String if JSON.stringify fails
      this.logger.warn('Failed to stringify response data, using String conversion', { error });
      return String(data);
    }
  }

  /**
   * Check if the class has the decorator.
   */
  private hasDecoratorOnClass(context: ExecutionContext): boolean {
    const classMetadata = this.reflector.get<UseGuardrailsDecoratorOptions>(
      USE_GUARDRAILS_KEY,
      context.getClass(),
    );
    return isUseGuardrailsOptions(classMetadata);
  }
}
