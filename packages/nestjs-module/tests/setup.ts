/**
 * Test setup for NestJS tests
 * Import reflect-metadata for decorator support
 */

import 'reflect-metadata';

// Verify reflect-metadata is loaded
console.log(
  '[test setup] reflect-metadata loaded:',
  typeof Reflect !== 'undefined' && typeof Reflect.getMetadata === 'function'
);
