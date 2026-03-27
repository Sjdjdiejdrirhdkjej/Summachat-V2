## 2026-03-26

- Centralized provider stream guardrails in one helper (`runGuardedProviderStream`) to keep timeout/abort/empty-output logic out of route handlers.
- Normalized terminal contract chosen as `{ status, output, firstChunkMs, totalMs, error? }` where `status` is one of `success | timed_out | aborted | errored | empty`.
- Preserved existing SSE event names/contracts in both routes; non-success guard statuses are surfaced through existing `error`/`model_error`/`summary_error` events rather than introducing new SSE event types.
