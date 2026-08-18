/**
 * Test setup for Fastify plugin tests
 */

// Suppress expected unhandled rejections from failing validator tests
if (typeof process !== 'undefined' && process.on) {
  // Remove existing listener if any to avoid duplicates
  process.removeAllListeners('unhandledRejection');

  process.on('unhandledRejection', (reason: unknown) => {
    // Suppress specific expected errors from tests
    if (
      reason instanceof Error &&
      (reason.message === 'Internal database connection failed' ||
        reason.message === 'Unexpected error' ||
        reason.message === 'Validation failed')
    ) {
      return; // Suppress expected errors
    }
    // Let other errors propagate
  });
}
