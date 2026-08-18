# @blackunicorn/eslint-plugin-edge

ESLint rules for keeping BonkLM connector code compatible with edge runtimes.

## Usage

```js
import bonklmEdge from '@blackunicorn/eslint-plugin-edge';

export default [
  {
    files: ['src/**/*.ts'],
    plugins: { 'bonklm-edge': bonklmEdge },
    rules: { 'bonklm-edge/no-bare-process-env': 'error' }
  }
];
```

The `no-bare-process-env` rule rejects direct `process.env` reads in files where the rule is
enabled. Pass environment bindings through application configuration instead.
