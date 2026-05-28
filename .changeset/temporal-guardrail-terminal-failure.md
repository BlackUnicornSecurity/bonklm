---
'@blackunicorn/bonklm-temporal': patch
---

Fix: `guardrailGate` now fails the workflow terminally on BLOCK.

Previously `guardrailGate` threw a plain `TemporalGuardrailBlockedError` (a subclass of `Error`)
from inside workflow code. Because that is not a Temporal `TemporalFailure`, the Temporal workflow
runtime treated it as a retryable _Workflow Task_ failure and retried the task indefinitely — the
workflow never reached a terminal FAILED state, so a client awaiting it never settled.

`guardrailGate` now throws a terminal, non-retryable `ApplicationFailure`
(`type: 'TemporalGuardrailBlockedError'`) so a BLOCK decision deterministically fails the workflow.
A client awaiting the workflow receives a `WorkflowFailedError` whose `.cause` is that
`ApplicationFailure`; the guardrail diagnostics (`validatorName`, `category`, `severity`, `reason`)
are carried in `details[0]`, and the `TemporalGuardrailBlockedError` instance is attached as the
failure `cause` for direct in-process callers. The `TemporalGuardrailBlockedError` class remains a
public export.

`@temporalio/workflow` is now declared as a (required) peer dependency, since the package barrel
imports `ApplicationFailure` from it at module load.
