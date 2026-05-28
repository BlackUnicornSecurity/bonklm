/**
 * HuggingFace Connector Types
 *
 * This file contains all TypeScript type definitions for the HuggingFace connector.
 * Includes security-related options for inference API validation.
 */

// D-011 (Sprint 52 Gate 2): explicit resolution-mode attribute required so
// consumers with `moduleResolution: "node16"`/`"nodenext"` can type-resolve
// this import across the CJS connector → ESM core boundary. Without the
// attribute, tsc emits TS1541 in the consumer build.
import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm' with {
  'resolution-mode': 'import'
};

/**
 * Configuration options for the guarded HuggingFace wrapper.
 *
 * @remarks
 * All security options are included to address inference API vulnerabilities:
 * - Input prompt validation
 * - Output response validation
 * - Production mode error messages
 * - Validation timeout
 * - Model reference validation
 */
export interface GuardedHuggingFaceOptions {
  /**
   * Validators to apply to inputs and outputs.
   */
  validators?: Validator[];

  /**
   * Guards to apply to outputs.
   */
  guards?: Guard[];

  /**
   * Logger instance for validation events.
   *
   * @defaultValue createLogger('console')
   */
  logger?: Logger;

  /**
   * Production mode flag.
   *
   * @defaultValue process.env.NODE_ENV === 'production'
   */
  productionMode?: boolean;

  /**
   * Validation timeout in milliseconds.
   *
   * @defaultValue 30000 (30 seconds)
   */
  validationTimeout?: number;

  /**
   * Maximum input length in characters.
   *
   * @remarks
   * Prevents excessive input attacks.
   *
   * @defaultValue 10000
   */
  maxInputLength?: number;

  /**
   * Allowed model patterns.
   *
   * @remarks
   * If provided, only models matching these patterns are allowed.
   * Uses simple string matching (supports wildcards with *).
   */
  allowedModels?: string[];

  /**
   * Callback invoked when input is blocked.
   */
  onInputBlocked?: (result: GuardrailResult) => void;

  /**
   * Callback invoked when output is blocked.
   */
  onOutputBlocked?: (result: GuardrailResult) => void;

  /**
   * Callback invoked when model is not allowed.
   */
  onModelNotAllowed?: (model: string) => void;
}

/**
 * Text generation options.
 */
export interface TextGenerationOptions {
  /**
   * Model identifier or reference.
   */
  model: string;

  /**
   * Input prompt/text.
   */
  inputs: string;

  /**
   * Generation parameters.
   */
  parameters?: {
    max_new_tokens?: number;
    temperature?: number;
    top_k?: number;
    top_p?: number;
    repetition_penalty?: number;
    stop?: string[];
    [key: string]: any;
  };

  /**
   * Optional task specification.
   */
  task?: string;
}

/**
 * Result type for guarded inference operations.
 */
export interface GuardedInferenceResult {
  /**
   * The generated output text.
   */
  output?: string | string[];

  /**
   * Whether the result was filtered by guardrails.
   */
  filtered?: boolean;

  /**
   * Number of tokens generated (if available).
   */
  tokensGenerated?: number;

  /**
   * The original result from HuggingFace.
   */
  raw?: any;
}

/**
 * Default validation timeout (30 seconds).
 *
 * @internal
 */
export const DEFAULT_VALIDATION_TIMEOUT = 30000;

/**
 * Default max input length.
 *
 * @internal
 */
export const DEFAULT_MAX_INPUT_LENGTH = 10000;
