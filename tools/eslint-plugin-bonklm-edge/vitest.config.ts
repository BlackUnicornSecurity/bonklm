import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,js}', 'src/**/*.test.{ts,js}'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 30000,
  },
});
