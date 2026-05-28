import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,js}', 'src/**/*.test.{ts,js}'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 30000
  },
  coverage: {
    provider: 'istanbul', // Better TypeScript source map support
    reporter: ['text', 'json', 'html', 'json-summary'],
    include: ['src/**/*.ts'],
    exclude: ['**/*.d.ts', 'node_modules/**', 'dist/**', '**/*.test.ts', '**/*.spec.ts'],
    all: true
  }
});
