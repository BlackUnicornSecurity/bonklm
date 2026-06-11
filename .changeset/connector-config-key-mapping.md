---
'@blackunicorn/bonklm': patch
---

cli: `bonklm connector test openai|anthropic`, `connector add`, and the `wizard` connection test now
succeed with a valid API key instead of reporting "API key is required".

The CLI credential loaders build connector config keyed by the detected env-var name
(`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) because that is the shape persisted to `.env`, but the
openai/anthropic connectors' `test()` reads `config.apiKey` — so the connection test always saw an
undefined key. Connectors may now declare an optional `configKeyByEnvVar` map on their definition
(e.g. `{ OPENAI_API_KEY: 'apiKey' }`), and the shared test seam re-keys the credential bag
accordingly before invoking `test()`. `ollama` and the framework connectors have no env-var →
config-key indirection and are unaffected; `.env` persistence is unchanged.
