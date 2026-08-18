# ADR-0002: Temporal `guardrailGate` fails workflows with `ApplicationFailure`

> Status: Accepted (2026-05-28). Scope: `@blackunicorn/bonklm-temporal` connector. Authority:
> internal engineering review. Applies to `packages/temporal-middleware/src/workflow.ts`.

## Problem

The Temporal connector's workflow-side helper `guardrailGate(result)` must abort a workflow when a
validator returns a BLOCK decision. The intended contract is that a BLOCK fails the workflow
**deterministically** — the client awaiting the workflow should observe a terminal failure.

Temporal's TypeScript SDK does not fail a workflow for every thrown error. The workflow runtime
(`@temporalio/workflow`, `Activator.handleWorkflowFailure`) routes a thrown error one of two ways:

- `error instanceof TemporalFailure` → it emits a `failWorkflowExecution` command. The workflow
  **fails terminally**; the client rejects with `WorkflowFailedError`.
- any other error (a plain `Error` / subclass) → it is recorded as a **Workflow Task failure**,
  which Temporal **retries** (by default, indefinitely). The workflow never reaches a terminal
  state, so a client awaiting it never settles.

Throwing a plain `Error` subclass from workflow code therefore does **not** fail the workflow — it
wedges it in a perpetual workflow-task retry loop. That silently breaks the "fails
deterministically" contract for real consumers (and any `TestWorkflowEnvironment`-backed test hangs
until its timeout).

## Decision

`guardrailGate` throws a terminal, non-retryable `ApplicationFailure` (which extends
`TemporalFailure`) on BLOCK:

```ts
throw ApplicationFailure.create({
  message,
  type: 'TemporalGuardrailBlockedError',
  nonRetryable: true,
  details: [{ validatorName, category, severity, reason }],
  cause: new TemporalGuardrailBlockedError(message, validatorName, { category, severity })
});
```

- `ApplicationFailure` is imported from `@temporalio/workflow` — the workflow sandbox's own
  deterministic API, so `workflow.ts` stays sandbox-safe (see its `@workflow-safe` banner).
- `nonRetryable: true` pins a BLOCK as final even under a workflow-level retry policy; a BLOCK is a
  semantic verdict, never a transient fault.
- The public `TemporalGuardrailBlockedError` class is preserved as both the failure `cause` (typed
  fields for in-process callers) and the failure `type` string. Diagnostics are duplicated into
  `details[0]` because the `details` payload survives the client RPC boundary while the JS class
  identity does not.

## Consequences

- A BLOCK now surfaces to a client as `WorkflowFailedError` whose `.cause` is an
  `ApplicationFailure` with `type === 'TemporalGuardrailBlockedError'` and `nonRetryable === true`.
- `@temporalio/workflow` becomes a runtime import of the package barrel (the barrel eagerly loads
  `workflow.js`), so it is declared as a **required** peer dependency. A peer — rather than a
  regular `dependency` — keeps it on the consumer's single `@temporalio/*` install: Temporal
  requires the whole SDK family to share one version, and a peer avoids a second copy.
  (`@temporalio/worker` stays an _optional_ peer — the barrel never imports it.)
- Cross-realm `instanceof` is not relied upon for the fix to work: the terminal-failure decision
  (`handleWorkflowFailure`) runs inside the workflow sandbox against the bundled
  `ApplicationFailure`, and the client reconstructs the failure by its `type` string. (Temporal's
  failure classes also key `instanceof` off a `Symbol.for(...)` registry, so the test assertions
  hold even when the class is imported from `@temporalio/client` vs `@temporalio/workflow`.)
- **Do not** revert `guardrailGate` to throwing a plain `Error` subclass — it reintroduces the
  workflow-task retry hang. The behaviour is locked by the BLOCK-path assertion in
  `tests/test-workflow-environment.test.ts` (real cluster) and the mock-level assertions in
  `tests/middleware.test.ts` / `tests/worker-integration.test.ts`.
