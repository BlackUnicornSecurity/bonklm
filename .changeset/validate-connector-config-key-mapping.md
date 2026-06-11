---
'@blackunicorn/bonklm': patch
---

`validateConnectorConfig` (from `@blackunicorn/bonklm/testing`) now accepts a credential bag keyed
either by the connector's config keys (e.g. `apiKey`) or by env-var name (e.g. `OPENAI_API_KEY`, the
shape the CLI loaders build for `.env` persistence). It re-keys the bag through the connector's
optional `configKeyByEnvVar` map before schema validation — the same seam `testConnector` already
uses — so a connector declaring `{ OPENAI_API_KEY: 'apiKey' }` no longer reports `apiKey` missing
for an env-var-keyed bag. Connectors without that mapping are unaffected (the bag passes through
unchanged), a config-keyed bag continues to validate exactly as before, and the caller's object is
never mutated.

The shared re-keying helper (`applyConnectorConfigKeys`) now reads only a connector's own declared
mappings, so a credential key that happens to share a name with a built-in object member can no
longer be misrouted.
