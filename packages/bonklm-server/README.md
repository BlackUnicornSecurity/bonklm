# @blackunicorn/bonklm-server

Fastify-based HTTP server exposing BonkLM guardrails over authenticated endpoints. Designed for
**LiteLLM custom-guardrail plugins, Portkey webhook guardrails, and generic OpenAI-compatible
upstreams**. LiteLLM and OpenAI-compatible callers use HMAC authentication. Portkey can use a static
bearer credential configured in its webhook UI.

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-server
```

After the first registry release, run the Docker image:

```bash
VERSION=1.0.1
docker run -p 127.0.0.1:4123:4123 \
  -e BONKLM_HMAC_SECRET=$(openssl rand -base64 32) \
  -e BONKLM_PRODUCTION_MODE=false \
  "ghcr.io/blackunicornsecurity/bonklm-server:${VERSION}"
```

That command is for local evaluation only. Production non-loopback binding requires an HTTPS reverse
proxy or load balancer and the explicit `BONKLM_TRUSTED_TLS_TERMINATION=true` assertion.

## Quick start (programmatic)

```ts
import { createBonklmGuardrailServer } from '@blackunicorn/bonklm-server';
import { PromptInjectionValidator, JailbreakValidator, SecretGuard } from '@blackunicorn/bonklm';

const server = await createBonklmGuardrailServer({
  validators: [new PromptInjectionValidator(), new JailbreakValidator()],
  guards: [new SecretGuard()],
  hmacSecret: process.env.BONKLM_HMAC_SECRET!, // 32+ UTF-8 bytes
  productionMode: true // strip validator reasons from public responses
});

await server.listen({ port: 4123, host: '0.0.0.0' });
```

Programmatic callers own the listener transport. Put this non-loopback listener behind HTTPS; HMAC
authenticates the body but does not encrypt prompts or credentials.

## ⚠️ SECURITY: HMAC secret + production mode are MANDATORY

- `hmacSecret` MUST contain at least 32 UTF-8 bytes of entropy. The server refuses to start with a
  shorter value. Generate via `openssl rand -base64 32`.
- `productionMode: true` strips validator reasons + findings from HTTP responses (they still reach
  `engine.onIntercept(...)` for your audit telemetry). **Always set this true in production.**
- HMAC and the Portkey bearer do not provide transport confidentiality. Use HTTPS for every
  non-loopback request. The CLI fails production startup on a non-loopback host unless
  `BONKLM_TRUSTED_TLS_TERMINATION=true` confirms that a trusted TLS boundary is present.

## Routes

The `/litellm` and `/openai-compatible` routes use:

- Method: `POST`
- HMAC auth via `X-Bonklm-Signature` (sha256=<hex>) + `X-Bonklm-Timestamp`
- 5-minute replay window (configurable via `replayWindowMs`)
- Response shape: `{ allowed, blocked, reason?, surface, findings?, requestId }`

### Replay protection

An accepted signature is rejected when resubmitted inside the window (seen-signature cache, default
100,000 entries ≈ 12 MB). Guarantees are per-instance and capacity-bounded:

- **Sizing:** size the cache to `window × peak accepted requests/second` (CLI:
  `BONKLM_REPLAY_CACHE_SIZE`, programmatic: `replayCacheSize`). At capacity the server fails closed
  with `replay_cache_exhausted` (HTTP 503) rather than silently forgetting live signatures.
- **Multi-replica:** each replica keeps its own cache; a replay routed to a different replica within
  the window still succeeds. Inject a shared implementation (e.g. Redis-backed) via the
  `replayCache` option (structural `{ claim(signature): 'first' | 'replay' | 'full' }`).
- **Retry semantics:** a signature is claimed at verification time, before the request outcome is
  known — a request that subsequently fails (415, malformed JSON) still consumes it. Mint a fresh
  timestamp per attempt (conformant SDKs already do).

### `POST /litellm`

Maps the LiteLLM custom-guardrail Python plugin payload to the shared guard input. Inspects
`data.messages` and `request_data.messages` (the two common envelopes LiteLLM uses across versions).

### `POST /portkey`

Maps Portkey's documented webhook payload. `beforeRequestHook` validates `request`;
`afterRequestHook` validates `response`. It returns Portkey's required `{ verdict: boolean }` shape.
Configure `portkeyWebhookSecret` (or `BONKLM_PORTKEY_WEBHOOK_SECRET` in the container) to
authenticate Portkey's static `Authorization: Bearer ...` header. When that option is omitted, the
route retains HMAC auth.

### `POST /openai-compatible`

Maps a standard OpenAI chat-completion request body. Handles both `messages: [...]` (chat) and
`prompt: string` (legacy completions). Multimodal `{type: 'text', text}` + `{type: 'image_url'}`
content arrays are partially supported — text parts validated, image parts skipped (see
known-limitations §19).

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

Use the exported `signHmac(rawBody, timestamp, secret)` helper to generate signatures from clients:

```ts
import { signHmac } from '@blackunicorn/bonklm-server';

const body = JSON.stringify({ data: { messages: [...] } });
const ts = String(Date.now());
const sig = signHmac(body, ts, hmacSecret);

await fetch('https://bonklm-server.example/litellm', {
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
  - guardrail_name: 'bonklm'
    litellm_params:
      guardrail: custom_guardrail.bonklmGuardrail
      mode: 'pre_call'
      api_base: 'https://bonklm-server.example'
      api_key: 'os.environ/BONKLM_HMAC_SECRET'
```

Your `custom_guardrail.py` uses LiteLLM's current provider-agnostic `apply_guardrail` interface:

```python
import hashlib
import hmac
import json
import time
from typing import TYPE_CHECKING, Literal, Optional

import httpx
from litellm.integrations.custom_guardrail import CustomGuardrail
from litellm.types.utils import GenericGuardrailAPIInputs

if TYPE_CHECKING:
    from litellm.litellm_core_utils.litellm_logging import Logging as LiteLLMLoggingObj

class bonklmGuardrail(CustomGuardrail):
    def __init__(self, api_base: str, api_key: str, **kwargs):
        self.api_base = api_base
        self.secret = api_key.encode("utf-8")
        super().__init__(**kwargs)

    async def apply_guardrail(
        self,
        inputs: GenericGuardrailAPIInputs,
        request_data: dict,
        input_type: Literal["request", "response"],
        logging_obj: Optional["LiteLLMLoggingObj"] = None,
    ) -> GenericGuardrailAPIInputs:
        messages = [
            {"role": input_type, "content": text}
            for text in inputs.get("texts") or []
        ]
        body = json.dumps(
            {"request_data": {"messages": messages}},
            separators=(",", ":"),
        ).encode("utf-8")
        ts = str(int(time.time() * 1000))
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
        r.raise_for_status()
        verdict = r.json()
        if verdict.get("blocked"):
            raise RuntimeError("BonkLM guardrail blocked the content")
        return inputs
```

### Portkey webhook guardrail (UI)

In the Portkey UI, add a Guardrail:

- Type: **Custom Webhook**
- URL: `https://your-bonklm-server.example/portkey`
- Method: `POST`
- Headers:
  - `Content-Type: application/json`
  - `Authorization: Bearer <the BONKLM_PORTKEY_WEBHOOK_SECRET value>`

Set `BONKLM_PORTKEY_WEBHOOK_SECRET` to the same independently generated 32+ character secret in the
server container. Portkey sends `eventType`; BonkLM validates the request for `beforeRequestHook`
and the model response for `afterRequestHook`, then returns `{ "verdict": true | false }` directly.

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

Performance target: **P99 < 1.5s on the `packages/core/benchmarks/` corpus on a 4-vCPU container.**
Validate yourself by running:

```bash
cd packages/core
pnpm run benchmark
# then run the bonklm-server in a separate container + send the
# corpus through the /openai-compatible endpoint, tracking p99.
```

The default validator stack (PromptInjection, Jailbreak, CodeInjection, Multilingual, EncodedRescan,
IndirectInjection, plus the SecretGuard guard) is designed to fit this budget on commodity 4-vCPU
containers; adding heavy validators (e.g. external-API-backed) will push you past.

## Docker

```bash
VERSION=1.0.1
pnpm run docker:build

docker run -p 127.0.0.1:4123:4123 \
  -e BONKLM_HMAC_SECRET=$(openssl rand -base64 32) \
  -e BONKLM_TRUSTED_TLS_TERMINATION=true \
  "ghcr.io/blackunicornsecurity/bonklm-server:${VERSION}"
```

The loopback-published port above is intended for a same-host HTTPS reverse proxy. Do not expose the
container port directly. The TLS assertion is fail-closed configuration, not a TLS implementation
inside the image.

The release workflow publishes images for `linux/amd64` and `linux/arm64` from a published GitHub
Release. Each image uses only the exact SemVer tag; GHCR has no mutable `latest` or `next` channel.
The workflow retains platform SBOM artifacts and signs the exact image digest with the release
workflow identity.

The image runs as a non-root `bonklm` user, exposes `4123/tcp`, and includes a `/healthz`
HEALTHCHECK. Local builds must run from the repository root through `pnpm run docker:build`; the
workspace root is required as the Docker build context.

## Configuration

| Env var                          | Default    | Description                                           |
| -------------------------------- | ---------- | ----------------------------------------------------- |
| `BONKLM_PORT`                    | `4123`     | Listen port                                           |
| `BONKLM_HOST`                    | `0.0.0.0`  | Bind host                                             |
| `BONKLM_HMAC_SECRET`             | (required) | 32+ char HMAC secret                                  |
| `BONKLM_PORTKEY_WEBHOOK_SECRET`  | (unset)    | 32+ char static bearer secret for `/portkey`          |
| `BONKLM_REPLAY_WINDOW_MS`        | `300000`   | Replay window (5 min)                                 |
| `BONKLM_PRODUCTION_MODE`         | `true`     | Strip reasons; set `false` only for local development |
| `BONKLM_TRUSTED_TLS_TERMINATION` | `false`    | Required for production non-loopback CLI binding      |

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn
