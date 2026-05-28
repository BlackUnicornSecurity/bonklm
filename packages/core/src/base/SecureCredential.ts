/**
 * Secure Credential Handling
 *
 * This module provides secure credential handling for the BonkLM core package.
 * The implementation is re-exported from the CLI utilities for consistency.
 *
 * @package @blackunicorn/bonklm/core
 */

// Re-export the SecureCredential class from CLI utils
// This maintains a single source of truth while making it available to core consumers
export {
  SecureCredential,
  type CredentialCallback,
  type CredentialCallbackSync,
  SecureCredentialError
} from '../cli/utils/secure-credential.js';
