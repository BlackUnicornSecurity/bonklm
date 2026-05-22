# @blackunicorn/bonklm-openclaw

> **⚠️ DEPRECATION NOTICE (v0.4.0-rc1)**
>
> This package is **deprecated** and scheduled for **removal at v0.6.0
> (Sprint 16)**. The deprecation is tracked as Story 2.14a in the
> BonkLM v0.4–v0.7 roadmap.
>
> **If you depend on `@blackunicorn/bonklm-openclaw`, please surface
> yourself before 2026-07-01.** Open an issue at
> https://github.com/BlackUnicornSecurity/bonklm/issues with the
> label `dep:openclaw` describing your use case so we can plan a
> migration path or extend the deprecation window.
>
> If no consumers surface by 2026-07-01, the package will be removed
> in v0.6.0 with no further deprecation cycle. Pin to
> `@blackunicorn/bonklm-openclaw@^0.5.0` in your `package.json` if you
> need the legacy shape and cannot migrate by then; we will retain
> the 0.5.x line as a security-fix-only branch through 2027-01-01.

## Why this package is deprecated

`openclaw` itself is not a generally-adopted ecosystem dependency
and the integration patterns BonkLM expresses through the rest of the
connector family (vercel-connector, langchain-connector,
google-genai-connector, anthropic-connector, etc.) cover the same
"wrap an LLM call with input/output validation" surface with broader
ecosystem reach.

The maintenance cost of keeping `openclaw-adapter` in lockstep with
the BonkLM core API exceeds the demonstrable user benefit. The path
forward is to use the LLM-provider-specific connector that matches
your actual deployment (`@blackunicorn/bonklm-anthropic` if you're on
Claude, `@blackunicorn/bonklm-vercel` if you're on the Vercel AI SDK,
etc.) and wire validators through that.

## Migration recipe

If you currently wire BonkLM through OpenClaw, switch to the
`GuardrailEngine` directly or to a provider-specific connector:

```ts
// BEFORE (deprecated)
import { OpenClawGuardrailsMiddleware } from '@blackunicorn/bonklm-openclaw';

// AFTER — direct engine usage
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator()],
});
const result = await engine.validate(userInput);
if (!result.allowed) throw new Error(result.reason);
```

For provider-specific wraps see the connector READMEs in
`packages/{anthropic,vercel,langchain,openai,google-genai}-connector/`.

## License

MIT
