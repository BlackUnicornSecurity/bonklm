import { defineConfig } from 'vitest/config';
import path from 'path';
import fs from 'fs';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,js}', 'src/**/*.test.{ts,js}'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Ratchet floor (project DoD): this package is at 100% — keep it there.
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100
      }
    }
  },
  plugins: [
    {
      name: 'resolve-bonklm',
      resolveId(id) {
        if (id === '@blackunicorn/bonklm') {
          // Return the actual index.js file path directly
          const indexPath = path.resolve(__dirname, '../../core/dist/index.js');
          return indexPath;
        }
        // Also handle sub-exports like @blackunicorn/bonklm/validators
        if (id.startsWith('@blackunicorn/bonklm/')) {
          const subpath = id.replace('@blackunicorn/bonklm/', '');
          const resolvedPath = path.resolve(__dirname, '../../core/dist', subpath + '.js');
          if (fs.existsSync(resolvedPath)) {
            return resolvedPath;
          }
          // Try as a directory with index.js
          const dirIndexPath = path.resolve(__dirname, '../../core/dist', subpath, 'index.js');
          if (fs.existsSync(dirIndexPath)) {
            return dirIndexPath;
          }
        }
        return null;
      }
    }
  ]
});
