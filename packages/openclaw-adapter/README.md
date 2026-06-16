# @blackunicorn/bonklm-openclaw

> **⚠️ LEGACY / PRIVATE PACKAGE**
>
> This package is **deprecated** and marked `private:true` in the v1.0 release surface. It is
> retained in the repository for migration reference only and is not part of the current publish
> set.
>
> If you still depend on a pre-v1 OpenClaw adapter release, migrate to a provider-specific connector
> or framework-native middleware before adopting the v1 package set.

## Why this package is deprecated

`openclaw` itself is not a generally-adopted ecosystem dependency and the integration patterns
BonkLM expresses through the rest of the connector family (vercel-connector, langchain-connector,
google-genai-connector, anthropic-connector, etc.) cover the same "wrap an LLM call with
input/output validation" surface with broader ecosystem reach.

The maintenance cost of keeping `openclaw-adapter` in lockstep with the BonkLM core API exceeds the
demonstrable user benefit. The path forward is to use the LLM-provider-specific connector that
matches your actual deployment (`@blackunicorn/bonklm-anthropic` if you're on Claude,
`@blackunicorn/bonklm-vercel` if you're on the Vercel AI SDK, etc.) and wire validators through
that.

## Migration recipe

If you currently wire BonkLM through OpenClaw, switch to the `GuardrailEngine` directly or to a
provider-specific connector:

```ts
// BEFORE (deprecated)
import { OpenClawGuardrailsMiddleware } from '@blackunicorn/bonklm-openclaw';

// AFTER — direct engine usage
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator()]
});
const result = await engine.validate(userInput);
if (!result.allowed) throw new Error(result.reason);
```

For provider-specific wraps see the connector READMEs in
`packages/{anthropic,vercel,langchain,openai,google-genai}-connector/`.

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn
