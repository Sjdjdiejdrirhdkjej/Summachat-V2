## 2026-03-26

- Added shared stream lifecycle guard in `artifacts/api-server/src/lib/provider-stream-guard.ts` and removed route-level duplication for provider streaming timeout/abort handling.
- Guard wrapper now logs provider start, first chunk timing, completion, timeout/abort, empty output, and provider errors through request-scoped logger passed from each route.
- `/chat` and `/multi-chat` now treat empty provider output as terminal non-success (`empty`) instead of silent success.
- Gemini runtime handling now wraps the SDK result object and drains `result.stream` before awaiting `result.response`, which preserves streamed chunks while still surfacing late completion errors.
- `/api/chat` now logs request-scoped provider invocation start/end (`chat_provider_invoke_start`/`chat_provider_invoke_done`) and forces a visible terminal provider event: if no `chunk` was sent, it emits `error` before `done`.

## 2026-03-27

- `/api/multi-chat` now enforces deterministic terminal semantics per requested model: each model emits exactly one terminal event (`model_done` or `model_error`) even if a provider call stalls past a hard timeout fallback.
- Summary policy is now explicit and stable for UI/diagnostics consumers: 2+ model successes use summarizer streaming, exactly 1 success mirrors that single provider output through `summary_start`/`summary_chunk`/`summary_done`, and 0 successes emits `summary_error` before `done`.
