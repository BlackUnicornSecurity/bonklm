/**
 * HuggingFace Guarded Wrapper
 * ===========================
 *
 * Provides security guardrails for HuggingFace Inference API operations.
 *
 * Security Features:
 * - Input prompt validation
 * - Output response validation
 * - Model reference validation
 * - Production mode error messages
 * - Validation timeout via validateWithTimeoutSecure (Sprint 30)
 *
 * @package @blackunicorn/bonklm-huggingface
 */

import {
  createLogger,
  type EngineResult,
  GuardrailEngine,
  type Logger,
  RiskLevel,
  Severity,
  validateWithTimeoutSecure
} from '@blackunicorn/bonklm';
import {
  ConnectorValidationError,
  extractContentFromResponse,
  logValidationFailure
} from '@blackunicorn/bonklm/core/connector-utils';
import type { GuardedHuggingFaceOptions, TextGenerationOptions } from './types.js';
import { DEFAULT_MAX_INPUT_LENGTH, DEFAULT_VALIDATION_TIMEOUT } from './types.js';

/**
 * Default logger instance.
 *
 * @internal
 */
const DEFAULT_LOGGER: Logger = createLogger('console');

/**
 * All HuggingFace inference methods that should be intercepted for validation.
 * Methods not in this list will pass through without validation.
 *
 * @internal
 */
const GUARDED_METHODS = [
  'textGeneration',
  'questionAnswer',
  'summarization',
  'translation',
  'chatCompletion',
  'imageClassification',
  'objectDetection',
  'zeroShotClassification',
  'featureExtraction',
  'textToImage',
  'textToSpeech',
  'automaticSpeechRecognition',
  'text2TextGeneration',
  'fillMask',
  'tokenClassification',
  'sentenceSimilarity',
  'documentQuestionAnswering',
  'tableQuestionAnswering'
] as const;

/**
 * Output field mappings for different HuggingFace task types.
 * Maps each method to the field(s) where the output text is located.
 *
 * @internal
 */
const OUTPUT_FIELD_MAP: Record<string, string[]> = {
  textGeneration: ['generated_text', 'output_text', 'text'],
  questionAnswer: ['answer', 'output_text', 'text'],
  summarization: ['summary_text', 'output_text', 'text'],
  translation: ['translation_text', 'output_text', 'text'],
  chatCompletion: ['choices[0].message.content', 'choices[0].text', 'text'],
  zeroShotClassification: ['labels', 'text'],
  tokenClassification: ['text'],
  sentenceSimilarity: ['text'],
  text2TextGeneration: ['generated_text', 'output_text', 'text'],
  fillMask: ['text'],
  documentQuestionAnswering: ['answer', 'text'],
  tableQuestionAnswering: ['answer', 'text'],
  automaticSpeechRecognition: ['text'],
  // Image and audio methods typically return base64 or URLs
  imageClassification: ['label'],
  objectDetection: ['label'],
  featureExtraction: [],
  textToImage: [],
  textToSpeech: []
};

/**
 * Creates a guarded HuggingFace inference client wrapper.
 *
 * @param hfClient - The HuggingFace inference client to wrap
 * @param options - Configuration options for the guarded wrapper
 * @returns A guarded inference client with validation
 *
 * @example
 * ```ts
 * import { HfInference } from '@huggingface/inference';
 * import { createGuardedInference } from '@blackunicorn/bonklm-huggingface';
 * import { PromptInjectionValidator, PIIGuard } from '@blackunicorn/bonklm';
 *
 * const hf = new HfInference(process.env.HF_API_KEY);
 *
 * const guardedHF = createGuardedInference(hf, {
 *   validators: [new PromptInjectionValidator()],
 *   guards: [new PIIGuard()],
 *   allowedModels: ['meta-llama/Llama-3*', 'mistralai/Mistral*']
 * });
 *
 * const result = await guardedHF.textGeneration({
 *   model: 'meta-llama/Llama-3-8b',
 *   inputs: 'What is the capital of France?'
 * });
 * ```
 */
export function createGuardedInference(hfClient: any, options: GuardedHuggingFaceOptions = {}): any {
  const {
    validators = [],
    guards = [],
    logger = DEFAULT_LOGGER,
    productionMode = process.env.NODE_ENV === 'production',
    validationTimeout = DEFAULT_VALIDATION_TIMEOUT,
    maxInputLength = DEFAULT_MAX_INPUT_LENGTH,
    allowedModels,
    onInputBlocked,
    onOutputBlocked,
    onModelNotAllowed
  } = options;

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger
  });

  /**
   * S012-003: Validation timeout wrapper (Sprint 30: routes through canonical validateWithTimeoutSecure primitive).
   * Returns EngineResult and properly handles allowed property.
   *
   * @internal
   */
  const validateWithTimeout = async (content: string, context?: string): Promise<EngineResult> => {
    const result = await validateWithTimeoutSecure<EngineResult>({
      operation: () => engine.validate(content, context),
      timeoutMs: validationTimeout,
      timeoutSentinel: () => ({
        allowed: false,
        blocked: true,
        severity: Severity.CRITICAL,
        risk_level: RiskLevel.HIGH,
        risk_score: 30,
        reason: 'Validation timeout',
        findings: [
          {
            category: 'timeout',
            severity: Severity.CRITICAL,
            description: 'Validation timeout',
            weight: 30
          }
        ],
        results: [],
        validatorCount: validators.length,
        guardCount: guards.length,
        executionTime: validationTimeout,
        timestamp: Date.now()
      }),
      logger
    });
    return result;
  };

  /**
   * Checks if a model is allowed based on allowedModels patterns.
   *
   * @internal
   */
  const isModelAllowed = (model: string): boolean => {
    if (!allowedModels || allowedModels.length === 0) {
      return true;
    }

    return allowedModels.some(pattern => {
      // Convert wildcard pattern to regex, escaping special regex characters first
      const escapedPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      const regexPattern = escapedPattern.replace(/\*/g, '.*').replace(/\?/g, '.');
      const regex = new RegExp(`^${regexPattern}$`, 'i');
      return regex.test(model);
    });
  };

  /**
   * Validates model reference.
   *
   * @internal
   */
  const validateModel = (model: string): void => {
    if (!model || typeof model !== 'string') {
      throw new ConnectorValidationError('Model must be a non-empty string', 'invalid_model');
    }

    if (!isModelAllowed(model)) {
      logger.warn('[Guardrails] Model not allowed', { model });
      if (onModelNotAllowed) onModelNotAllowed(model);
      throw new ConnectorValidationError(
        productionMode ? 'Model not allowed' : `Model '${model}' is not in the allowed list`,
        'model_not_allowed'
      );
    }
  };

  /**
   * Validates input text.
   *
   * @internal
   */
  const validateInput = async (inputs: string): Promise<void> => {
    // Check input length
    if (inputs.length > maxInputLength) {
      logger.warn('[Guardrails] Input too long', {
        length: inputs.length,
        max: maxInputLength
      });
      throw new ConnectorValidationError(
        productionMode ? 'Input too long' : `Input exceeds maximum length of ${maxInputLength} characters`,
        'input_too_long'
      );
    }

    // Validate content
    const result = await validateWithTimeout(inputs, 'hf_input');

    if (!result.allowed) {
      // S012-003: Use connector-utils validation failure logging
      logValidationFailure(logger, result.reason || 'Input blocked', { context: 'hf_input' });
      if (onInputBlocked) onInputBlocked(result);

      throw new ConnectorValidationError(
        productionMode ? 'Input blocked' : `Input blocked: ${result.reason}`,
        'validation_failed'
      );
    }
  };

  /**
   * Validates output text.
   *
   * @internal
   */
  const validateOutput = async (output: string): Promise<{ output?: string; filtered: boolean }> => {
    const result = await validateWithTimeout(output, 'hf_output');

    if (!result.allowed) {
      // S012-003: Use connector-utils validation failure logging
      logValidationFailure(logger, result.reason || 'Output blocked', { context: 'hf_output' });
      if (onOutputBlocked) onOutputBlocked(result);

      return {
        output: '[Content filtered by guardrails]',
        filtered: true
      };
    }

    return {
      output,
      filtered: false
    };
  };

  // Return a proxy object that wraps HuggingFace client methods
  return new Proxy(hfClient, {
    get(target, prop) {
      const propStr = String(prop);

      // Check if this is a guarded method
      if (GUARDED_METHODS.includes(propStr as any)) {
        // Handle chatCompletion specially (different signature)
        if (propStr === 'chatCompletion') {
          return async (model: string, messages: any[], options?: any) => {
            // Validate model
            validateModel(model);

            // Extract and validate input from messages
            const inputText = messages.map((m: any) => `${m.role}: ${m.content || ''}`).join('\n');
            await validateInput(inputText);

            // Call the original method
            const rawResult = await target[prop](model, messages, options);

            // Extract output using content extractor
            const outputText = extractContentFromResponse(rawResult, {
              fields: ['choices[0].message.content', 'choices[0].text', 'text'],
              defaultValue: ''
            });

            if (outputText) {
              const validationResult = await validateOutput(outputText);
              return {
                ...validationResult,
                raw: rawResult
              };
            }

            return rawResult;
          };
        }

        // Handle standard options-based methods (textGeneration, questionAnswer, etc.)
        return async (options: TextGenerationOptions) => {
          const { model, inputs } = options;

          // Validate model
          validateModel(model);

          // Validate input
          await validateInput(inputs);

          // Call the original method
          const rawResult = await target[prop](options);

          // Extract output using content extractor with method-specific fields
          const fields = OUTPUT_FIELD_MAP[propStr] || ['generated_text', 'text', 'output'];
          const outputText = extractContentFromResponse(rawResult, {
            fields,
            defaultValue: ''
          });

          if (outputText) {
            const validationResult = await validateOutput(outputText);
            return {
              ...validationResult,
              raw: rawResult
            };
          }

          // No text output (e.g., image generation)
          return rawResult;
        };
      }

      // For all other methods, pass through without validation
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

/**
 * Re-exports types for convenience.
 */
export type { GuardedHuggingFaceOptions, TextGenerationOptions, GuardedInferenceResult } from './types.js';
