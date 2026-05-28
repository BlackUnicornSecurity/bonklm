/**
 * HuggingFace Guardrail Connector
 * ==============================
 *
 * Main entry point for @blackunicorn/bonklm-huggingface.
 *
 * @package @blackunicorn/bonklm-huggingface
 */

export { createGuardedInference } from './guarded-inference.js';

export type { GuardedHuggingFaceOptions, TextGenerationOptions, GuardedInferenceResult } from './types.js';
