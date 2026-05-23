# @blackunicorn/bonklm-server

Fastify-based HTTP server exposing BonkLM guardrails over
HMAC-authenticated endpoints. Designed for **LiteLLM custom-guardrail
plugins, Portkey webhook guardrails, and generic OpenAI-compatible
upstreams**. Drop into your LLM proxy stack; consumers send their
request payload + an HMAC-signed header pair; the server returns a
guardrail verdict.

**Effort**: L (1 week of dev). **Story 2.13** (Sprint 15).

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-server
```

Or run as a Docker image:

```bash
docker run -p 4123:4123 \
  -e BONKLM_HMAC_SECRET=$(openssl rand -base64 32) \
  blackunicorn/bonklm-server:0.4.0
```

## Quick start (programmatic)

```ts
import { createBonklmGuardrailServer } from '@blackunicorn/bonklm-server';
import {
  PromptInjectionValidator,
  SecretGuard,
} from '@blackunicorn/bonklm';

const server = await createBonklmGuardrailServer({
  validators: [new PromptInjectionValidator(), new SecretGuard()],
  port: 4123,
  hmacSecret: process.env.BONKLM_HMAC_SECRET!, // 32+ chars
  productionMode: true, // strip validator reasons from public responses
});

await server.listen();
```

## ⚠️ SECURITY: HMAC secret + production mode are MANDATORY

- `hmacSecret` MUST be at least 32 characters of entropy. The server
  refuses to start with a shorter value. Generate via
  `openssl rand -base64 32`.
- `productionMode: true` strips validator reasons + findings from
  HTTP responses (they still reach `engine.onIntercept(...)` for your
  audit telemetry). **Always set this true in production.**

## Routes

All three guardrail routes share:
- Method: `POST`
- HMAC auth via `X-Bonklm-Signature` (sha256=<hex>) + `X-Bonklm-Timestamp`
- 5-minute replay window (configurable via `replayWindowMs`)
- Response shape: `{ allowed, blocked, reason?, surface, findings?, requestId }`

### `POST /litellm`

Maps the LiteLLM custom-guardrail Python plugin payload to the
shared guard input. Inspects `data.messages` and
`request_data.messages` (the two common envelopes LiteLLM uses
across versions).

### `POST /portkey`

Maps the Portkey webhook guardrail payload. Inspects `request.json`
and the flat top-level envelope.

### `POST /openai-compatible`

Maps a standard OpenAI chat-completion request body. Handles both
`messages: [...]` (chat) and `prompt: string` (legacy completions).
Multimodal `{type: 'text', text}` + `{type: 'image_url'}` content
arrays are partially supported — text parts validated, image parts
skipped (see known-limitations §19).

### `GET /healthz`

No HMAC auth required. Returns `{status: 'ok'}` for k8s probes.

## HMAC signature format

```
X-Bonklm-Timestamp: 1714521600000
X-Bonklm-Signature: sha256=<64-hex-chars>
```

Where the signature is:
```
HMAC_SHA256(secret, `${timestamp}.${rawRequestBody}`)
```

Use the exported `signHmac(rawBody, timestamp, secret)` helper to
generate signatures from clients:

```ts
import { signHmac } from '@blackunicorn/bonklm-server';

const body = JSON.stringify({ data: { messages: [...] } });
const ts = String(Date.now());
const sig = signHmac(body, ts, hmacSecret);

await fetch('http://bonklm-server:4123/litellm', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-bonklm-timestamp': ts,
    'x-bonklm-signature': sig,
  },
  body,
});
```

## Integration recipes

### LiteLLM custom guardrail (YAML)

In your LiteLLM `proxy_config.yaml`:

```yaml
guardrails:
  - guardrail_name: "bonklm"
    litellm_params:
      guardrail: custom_guardrail.bonklmGuardrail
      mode: "pre_call"
      api_base: "http://bonklm-server:4123"
      api_key: "os.environ/BONKLM_HMAC_SECRET"
```

Your `custom_guardrail.py`:

```python
import hashlib
import hmac
import json
import time
import httpx

class bonklmGuardrail:
    def __init__(self, api_base, api_key):
        self.api_base = api_base
        self.secret = api_key.encode("utf-8") if isinstance(api_key, str) else api_key

    async def async_pre_call_hook(self, data, **kwargs):
        body = json.dumps({"data": data}).encode("utf-8")
        ts = str(int(time.time() * 1000))
        # HMAC-SHA256 over `${timestamp}.${rawBody}`. Note the f-string
        # builds the bytes carefully — Python's `hmac.new` takes
        # (key, msg, digestmod) where msg is bytes.
        mac = hmac.new(
            self.secret,
            f"{ts}.".encode("utf-8") + body,
            hashlib.sha256,
        )
        sig = "sha256=" + mac.hexdigest()
        async with httpx.AsyncClient() as c:
            r = await c.post(
                f"{self.api_base}/litellm",
                content=body,
                headers={
                    "content-type": "application/json",
                    "x-bonklm-timestamp": ts,
                    "x-bonklm-signature": sig,
                },
            )
        verdict = r.json()
        if verdict.get("blocked"):
            raise Exception(f"BonkLM guardrail blocked: {verdict.get('reason')}")
        return data
```

### Portkey webhook guardrail (UI)

In the Portkey UI, add a Guardrail:
- Type: **Custom Webhook**
- URL: `http://bonklm-server:4123/portkey`
- Method: `POST`
- Headers:
  - `Content-Type: application/json`
  - `X-Bonklm-Timestamp: {{TIMESTAMP_MS}}` (use Portkey's template var)
  - `X-Bonklm-Signature: sha256={{HMAC_HEX}}` (compute via Portkey's HMAC helper)

Map Portkey's "Verdict" to the response field `allowed === false` → FAIL.

### Curl test

```bash
SECRET="your-32-char-secret-here-please-replace"
BODY='{"data":{"messages":[{"role":"user","content":"hello"}]}}'
TS=$(date +%s%3N)
SIG="sha256=$(echo -n "${TS}.${BODY}" | openssl dgst -sha256 -hmac "${SECRET}" | awk '{print $2}')"

curl -X POST http://localhost:4123/litellm \
  -H "Content-Type: application/json" \
  -H "X-Bonklm-Timestamp: ${TS}" \
  -H "X-Bonklm-Signature: ${SIG}" \
  -d "${BODY}"
```

## Performance target

Story 2.13 AC: **P99 < 1.5s on the `packages/core/benchmarks/`
corpus on a 4-vCPU container.** Validate yourself by running:

```bash
cd packages/core
pnpm run benchmark
# then run the bonklm-server in a separate container + send the
# corpus through the /openai-compatible endpoint, tracking p99.
```

The default validator stack (PromptInjection + Multilingual) is
designed to fit this budget on commodity 4-vCPU containers; adding
heavy validators (e.g. external-API-backed) will push you past.

## Docker

```bash
docker build -t blackunicorn/bonklm-server:0.4.0 \
  -f packages/bonklm-server/Dockerfile .

docker run -p 4123:4123 \
  -e BONKLM_HMAC_SECRET=$(openssl rand -base64 32) \
  blackunicorn/bonklm-server:0.4.0
```

Image runs as a non-root `bonklm` user, exposes `4123/tcp`, and
includes a `/healthz` HEALTHCHECK.

## Configuration

| Env var | Default | Description |
|---|---|---|
| `BONKLM_PORT` | `4123` | Listen port |
| `BONKLM_HOST` | `0.0.0.0` | Bind host |
| `BONKLM_HMAC_SECRET` | (required) | 32+ char shared secret |
| `BONKLM_REPLAY_WINDOW_MS` | `300000` | Replay window (5 min) |
| `BONKLM_PRODUCTION_MODE` | `false` | Strip reasons from responses |

## License

MIT
