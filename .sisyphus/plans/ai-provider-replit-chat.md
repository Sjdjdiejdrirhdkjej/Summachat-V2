# Replit AI Provider Response Recovery for `/chat/:id`

## TL;DR

> **Summary**: Restore reliable AI responses for the deployed Replit chat flow by hardening server-side provider streaming, adding provider-isolation diagnostics, and guaranteeing terminal SSE events for both `/api/chat` and `/api/multi-chat`.
> **Deliverables**:
>
> - provider-by-provider runtime diagnostics and logging
> - timeout/abort-safe streaming for OpenAI, Anthropic, and Gemini
> - non-blocking multi-chat completion semantics with partial-success handling
> - frontend handling for terminal SSE states and degraded responses
> - doc-backed verification commands for Replit deployment
>   **Effort**: Medium
>   **Parallel**: YES - 2 waves
>   **Critical Path**: 1 → 2/3 → 4/5 → 6 → 7

## Context

### Original Request

- Find why sending a message to the AIs gets no response.
- Verify which AI provider the deployed Replit app uses and make sure it works.
- Check provider docs for reference.

### Interview Summary

- Failing surface is the deployed Replit `chat-ui` route `/chat/:id`.
- Repo exploration traced that page to `artifacts/chat-ui/src/pages/multi-chat.tsx`, which posts to `POST /api/multi-chat` and consumes SSE `data:` lines.
- Direct `curl` against the deployed Replit server confirmed `GET /api/healthz` returns `200 {"status":"ok"}` and both `POST /api/chat` and `POST /api/multi-chat` emit initial `start`/`model_start` events, but no `chunk`, `done`, or `error` events before the connection closes.
- Backend provider flow lives in `artifacts/api-server/src/routes/chat.ts` and `artifacts/api-server/src/routes/multi-chat.ts`, using OpenAI, Anthropic, and Gemini clients from `lib/integrations-*`.

### Metis Review (gaps addressed)

- Treat `/api/chat` and `/api/multi-chat` as both in scope because deployed probes show the same stall pattern on each route.
- Default degraded behavior is **partial success, never indefinite wait**: a stalled provider must resolve to `model_error`, other providers continue, and the overall SSE stream must always terminate with `done`.
- Replit infrastructure diagnostics are in scope only where they affect SSE delivery or provider egress; no unrelated platform work.
- No new test framework setup is in scope; verification remains agent-executed via `curl`, targeted typecheck/build, and browser automation only if needed.

## Work Objectives

### Core Objective

Make the deployed Replit chat experience produce reliable assistant output by ensuring every provider call either streams chunks or emits a bounded error, and by ensuring every SSE request ends with an explicit terminal event.

### Deliverables

- Shared provider-stream guardrails for timeout, abort, first-byte logging, and terminal logging
- Correct Gemini stream consumption per SDK contract
- Hardened `/api/chat` route with guaranteed `chunk|error|done` semantics
- Hardened `/api/multi-chat` route with provider isolation, timeout handling, and partial-success completion
- Frontend handling for terminal SSE states and degraded summary behavior
- Replit runbook steps and evidence commands using deployed endpoints

### Definition of Done (verifiable conditions with commands)

- `curl -sS -N -H "Content-Type: application/json" -X POST --data '{"model":"gpt-5.2","messages":[{"role":"user","content":"Reply with OK"}],"webSearch":false}' "$DEPLOYED_URL/api/chat"` emits `start`, at least one terminal event (`chunk` or `error`), and `done`.
- `curl -sS -N -H "Content-Type: application/json" -X POST --data '{"prompt":"Reply with OK","models":["gpt-5.2","claude-opus-4-6"],"webSearch":false}' "$DEPLOYED_URL/api/multi-chat"` emits per-model terminal events and overall `done` without hanging.
- `pnpm --filter @workspace/api-server run typecheck`
- `pnpm --filter @workspace/chat-ui run typecheck`
- `pnpm run typecheck`

### Must Have

- Explicit per-provider logging around request start, first chunk, timeout, completion, and error
- Abort/timeout handling that prevents infinite waits on provider streams
- No route may exit after `start`/`model_start` without a terminal SSE event
- Gemini implementation must follow the actual SDK streaming contract
- Multi-chat must complete even if one provider fails or stalls

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)

- No provider-specific logic hidden only in logs; client-visible terminal states are mandatory
- No indefinite `Promise.all` wait on provider streams without timeout wrapping
- No fake “success” where the stream ends silently without `done`
- No new test framework, package manager, or unrelated UI redesign
- No regression to current model IDs or Replit deployment assumptions without evidence

## Verification Strategy

> ZERO HUMAN INTERVENTION — all verification is agent-executed.

- Test decision: none existing; use tests-after verification with `curl`, app typecheck, and targeted deployed-endpoint probes
- QA policy: Every task includes agent-executed scenarios
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy

### Parallel Execution Waves

> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: shared diagnostics + provider wrappers + route hardening foundations
Wave 2: multi-chat completion semantics + frontend terminal handling + Replit verification runbook

### Dependency Matrix (full, all tasks)

- 1 blocks 2, 3, 4, 5
- 2 informs 3 and 4
- 3 and 4 block 5 and 6
- 5 blocks 6
- 6 blocks 7

### Agent Dispatch Summary (wave → task count → categories)

- Wave 1 → 4 tasks → deep, unspecified-high, quick
- Wave 2 → 3 tasks → unspecified-high, visual-engineering, writing
- Final Verification Wave → 4 tasks → oracle, unspecified-high, deep

## TODOs

> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Add shared provider stream guardrails for Replit SSE reliability

  **What to do**: Create a shared server helper in `artifacts/api-server/src/lib/` that wraps provider streaming with request-scoped logging, first-byte timing, overall timeout, first-chunk timeout, abort propagation, empty-output detection, and a normalized result contract (`success`, `timed_out`, `aborted`, `errored`, `empty`). Make the helper accept provider label, request logger, timeout budgets, and callbacks for chunk emission and terminal-state reporting so both chat routes use identical behavior.
  **Must NOT do**: Do not leave timeout logic duplicated inside each route. Do not swallow provider exceptions. Do not log raw prompts, secrets, auth headers, or full model responses.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: shared backend reliability layer with multiple consumers and edge cases
  - Skills: `[]` — no special skill required beyond careful TypeScript server work
  - Omitted: [`playwright`] — not needed for server-side helper implementation

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 4 | Blocked By: none

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `artifacts/api-server/src/routes/chat.ts:176-227` — current SSE send/try/finally pattern that must be preserved while gaining bounded terminal behavior
  - Pattern: `artifacts/api-server/src/routes/multi-chat.ts:173-252` — current multi-chat send flow and terminal event shape
  - API/Type: `artifacts/api-server/src/app.ts:12-35` — `pino-http` is already installed, so route handlers can use request-scoped logging instead of ad hoc console output
  - External: `https://github.com/openai/openai-node/blob/master/helpers.md` — OpenAI streams support async iteration and abort; wrapper should expose cancellation cleanly
  - External: `https://github.com/anthropics/anthropic-sdk-typescript/blob/main/helpers.md` — Anthropic streams expose `error`, `abort`, `end`, `done`, and `final*` helpers

  **Acceptance Criteria** (agent-executable only):
  - [ ] Shared helper is imported by both `artifacts/api-server/src/routes/chat.ts` and `artifacts/api-server/src/routes/multi-chat.ts`
  - [ ] Helper logs provider start, first chunk, completion, timeout, and error using request-scoped logger
  - [ ] Helper distinguishes empty-output from normal completion and returns a terminal status instead of silent success
  - [ ] `pnpm --filter @workspace/api-server run typecheck`

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Shared helper compiles in server graph
    Tool: Bash
    Steps: Run `pnpm --filter @workspace/api-server run typecheck`
    Expected: TypeScript passes with the new helper imported by both routes
    Evidence: .sisyphus/evidence/task-1-provider-stream-helper.txt

  Scenario: Timeout path is reachable from route integration
    Tool: Bash
    Steps: After tasks 2-4 are merged, hit `curl -sS -N -H "Content-Type: application/json" -X POST --data '{"model":"gpt-5.2","messages":[{"role":"user","content":"Reply with OK"}],"webSearch":false}' "$DEPLOYED_URL/api/chat"`
    Expected: Request ends with `done` plus either streamed content or explicit `error`; no silent close after `start`
    Evidence: .sisyphus/evidence/task-1-provider-stream-helper-runtime.txt
  ```

  **Commit**: NO | Message: `refactor(api-server): centralize provider stream guardrails` | Files: `artifacts/api-server/src/lib/*`, `artifacts/api-server/src/routes/chat.ts`, `artifacts/api-server/src/routes/multi-chat.ts`

- [x] 2. Correct Gemini streaming to match the actual SDK contract

  **What to do**: Update Gemini handling in both `artifacts/api-server/src/routes/chat.ts` and `artifacts/api-server/src/routes/multi-chat.ts` to consume the object returned by `ai.models.generateContentStream(...)` exactly as documented: iterate `result.stream`, collect text deltas from streamed chunks, and await `result.response` (or equivalent terminal promise) so completion and late errors are observed. Route any SDK exceptions through the shared stream guard from Task 1 and treat zero emitted text as a failure state rather than a silent success.
  **Must NOT do**: Do not continue iterating the outer result object directly. Do not assume Gemini parity with OpenAI/Anthropic stream shapes. Do not emit `model_done`/`done` before the terminal Gemini promise has settled.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: narrow, high-confidence doc-backed fix across two files
  - Skills: `[]` — no extra skill required
  - Omitted: [`playwright`] — not needed for backend SDK contract correction

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4 | Blocked By: 1

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `artifacts/api-server/src/routes/chat.ts:118-149` — current Gemini single-chat implementation is iterating the wrong return shape
  - Pattern: `artifacts/api-server/src/routes/multi-chat.ts:83-114` — current multi-chat Gemini implementation has the same issue
  - API/Type: `lib/integrations-gemini-ai/src/client.ts:15-20` — existing Gemini client configuration and base URL wiring
  - External: `https://github.com/google-gemini/deprecated-generative-ai-js/blob/main/docs/reference/main/generative-ai.generativemodel.generatecontentstream.md` — `generateContentStream()` returns a `GenerateContentStreamResult`
  - External: `https://github.com/google-gemini/deprecated-generative-ai-js/blob/main/docs/reference/main/generative-ai.generatecontentstreamresult.stream.md` — streamed chunks come from the `.stream` async generator

  **Acceptance Criteria** (agent-executable only):
  - [ ] Both Gemini code paths iterate `result.stream` instead of the outer result object
  - [ ] Gemini completion awaits the final aggregated response (or equivalent documented terminal promise)
  - [ ] Empty Gemini output yields a logged error path and client-visible SSE error, not silent `done`
  - [ ] `pnpm --filter @workspace/api-server run typecheck`

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Gemini single-chat emits terminal SSE state
    Tool: Bash
    Steps: Run `curl -sS -N -H "Content-Type: application/json" -X POST --data '{"model":"gemini-3.1-pro-preview","messages":[{"role":"user","content":"Reply with the single word OK."}],"webSearch":false}' "$DEPLOYED_URL/api/chat"`
    Expected: Response contains `start`, then either at least one `chunk` followed by `done`, or an explicit `error` followed by `done`
    Evidence: .sisyphus/evidence/task-2-gemini-chat.txt

  Scenario: Gemini multi-chat cannot silently disappear
    Tool: Bash
    Steps: Run `curl -sS -N -H "Content-Type: application/json" -X POST --data '{"prompt":"Reply with the single word OK.","models":["gemini-3.1-pro-preview","gpt-5.2"],"webSearch":false}' "$DEPLOYED_URL/api/multi-chat"`
    Expected: Gemini path emits either `model_chunk`/`model_done` or `model_error`; overall stream ends with `done`
    Evidence: .sisyphus/evidence/task-2-gemini-multi-chat.txt
  ```

  **Commit**: NO | Message: `fix(api-server): consume gemini stream correctly` | Files: `artifacts/api-server/src/routes/chat.ts`, `artifacts/api-server/src/routes/multi-chat.ts`

- [x] 3. Harden `/api/chat` so single-provider requests always end visibly

  **What to do**: Refactor `artifacts/api-server/src/routes/chat.ts` to run each provider call through the shared guard, attach request-scoped logs before and after provider invocation, pass abort signals where the SDK supports them, and guarantee the route emits exactly one terminal provider outcome (`chunk` stream or `error`) followed by `done` in all cases. Add explicit handling for “stream opened but no chunks arrived” so the client gets an error instead of a silent close.
  **Must NOT do**: Do not leave `send({ type: "done" })` in a path that can happen before provider terminal state is known. Do not special-case only one provider; OpenAI, Anthropic, and Gemini must all use the same terminal guarantees.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: route-level resilience and terminal-state correctness across three providers
  - Skills: `[]` — no extra skill required
  - Omitted: [`playwright`] — curl-based SSE validation is sufficient

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5, 6 | Blocked By: 1

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `artifacts/api-server/src/routes/chat.ts:63-149` — existing provider dispatch functions that need wrapper integration
  - Pattern: `artifacts/api-server/src/routes/chat.ts:151-227` — current route emits `start` and `done`, but the deployed server showed no `chunk`/`error` before close
  - API/Type: `lib/integrations-openai-ai-server/src/client.ts:3-18` — OpenAI env requirements must remain intact
  - API/Type: `lib/integrations-anthropic-ai/src/client.ts:3-18` — Anthropic env requirements must remain intact
  - API/Type: `lib/integrations-gemini-ai/src/client.ts:3-20` — Gemini env requirements must remain intact
  - External: `https://github.com/openai/openai-node/blob/master/helpers.md` — OpenAI streaming iteration and abort support
  - External: `https://github.com/anthropics/anthropic-sdk-typescript/blob/main/README.md` — Anthropic text streaming and finalization helpers

  **Acceptance Criteria** (agent-executable only):
  - [ ] `POST /api/chat` emits `start` then either streamed `chunk` events or an explicit `error`, and always ends with `done`
  - [ ] Provider timeout, abort, and empty-output conditions are logged with provider label and request id
  - [ ] Client disconnect triggers upstream abort where supported and avoids orphaned provider streams
  - [ ] `pnpm --filter @workspace/api-server run typecheck`

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: OpenAI single chat completes visibly
    Tool: Bash
    Steps: Run `curl -sS -N -H "Content-Type: application/json" -X POST --data '{"model":"gpt-5.2","messages":[{"role":"user","content":"Reply with the single word OK."}],"webSearch":false}' "$DEPLOYED_URL/api/chat"`
    Expected: Contains `start`, then either `chunk` data or `error`, and always ends with `done`
    Evidence: .sisyphus/evidence/task-3-openai-chat.txt

  Scenario: Anthropic single chat completes visibly
    Tool: Bash
    Steps: Run `curl -sS -N -H "Content-Type: application/json" -X POST --data '{"model":"claude-opus-4-6","messages":[{"role":"user","content":"Reply with the single word OK."}],"webSearch":false}' "$DEPLOYED_URL/api/chat"`
    Expected: Contains `start`, then either `chunk` data or `error`, and always ends with `done`
    Evidence: .sisyphus/evidence/task-3-anthropic-chat.txt
  ```

  **Commit**: YES | Message: `fix(api-server): guarantee terminal SSE events for chat` | Files: `artifacts/api-server/src/routes/chat.ts`, `artifacts/api-server/src/lib/*`

- [x] 4. Rework `/api/multi-chat` to tolerate stalled providers and finish deterministically

  **What to do**: Refactor `artifacts/api-server/src/routes/multi-chat.ts` so each provider call is wrapped with the shared guard and resolved independently with a bounded timeout. Replace the current unbounded `Promise.all` behavior with a settled orchestration model that emits `model_done` or `model_error` for every requested provider, never waits forever on one stalled model, and always emits overall `done`. Preserve concurrent execution, but make completion semantics deterministic: if two or more models succeed, run the summarizer; if exactly one model succeeds, emit `summary_start`, stream that single successful response into the summary panel, then emit `summary_done`; if zero models succeed, emit `summary_error` and still end the stream cleanly.
  **Must NOT do**: Do not regress concurrency to serial provider execution. Do not leave summary generation dependent on `Promise.all` completing normally. Do not suppress provider-specific errors behind a generic summary failure.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: concurrent orchestration, partial-success policy, and terminal-event correctness across providers
  - Skills: `[]` — no extra skill required
  - Omitted: [`playwright`] — endpoint-level verification is curl-first

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 5, 6, 7 | Blocked By: 1, 2

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `artifacts/api-server/src/routes/multi-chat.ts:148-252` — current route shape, SSE event contract, and unbounded `Promise.all` orchestration
  - Pattern: `artifacts/api-server/src/routes/multi-chat.ts:205-247` — current `model_start`, `model_chunk`, `model_done`, `model_error`, `summary_*` event flow that the frontend already consumes
  - Pattern: `artifacts/chat-ui/src/pages/multi-chat.tsx:224-289` — client expects `model_*` and `summary_*` events; preserve names when hardening the server
  - External: `https://github.com/openai/openai-node/blob/master/helpers.md` — abortable stream handling for OpenAI provider isolation
  - External: `https://github.com/anthropics/anthropic-sdk-typescript/blob/main/helpers.md` — Anthropic `abort`, `done`, and `final*` terminal behavior

  **Acceptance Criteria** (agent-executable only):
  - [ ] Every requested model emits exactly one terminal provider event: `model_done` or `model_error`
  - [ ] One stalled provider cannot prevent overall `done`
  - [ ] Summary behavior matches the declared defaults: 2+ successes → summarizer; 1 success → summary mirrors that response; 0 successes → `summary_error`
  - [ ] `pnpm --filter @workspace/api-server run typecheck`

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Multi-chat completes with partial success
    Tool: Bash
    Steps: Run `curl -sS -N -H "Content-Type: application/json" -X POST --data '{"prompt":"Reply with the single word OK.","models":["gpt-5.2","claude-opus-4-6","gemini-3.1-pro-preview"],"webSearch":false}' "$DEPLOYED_URL/api/multi-chat"`
    Expected: Each model emits `model_done` or `model_error`, summary emits a terminal state, and the stream ends with `done`
    Evidence: .sisyphus/evidence/task-4-multi-chat-partial-success.txt

  Scenario: Multi-chat no longer closes after only model_start
    Tool: Bash
    Steps: Repeat the deployed probe that previously returned only `model_start` events and capture the full SSE transcript
    Expected: Transcript now includes terminal provider events plus overall `done`
    Evidence: .sisyphus/evidence/task-4-multi-chat-terminal-events.txt
  ```

  **Commit**: YES | Message: `fix(api-server): isolate stalled providers in multi-chat` | Files: `artifacts/api-server/src/routes/multi-chat.ts`, `artifacts/api-server/src/lib/*`

- [ ] 5. Update the chat UI to surface terminal SSE states and degraded results clearly

  **What to do**: Update `artifacts/chat-ui/src/pages/multi-chat.tsx` to handle explicit `done`, `search_start`, `search_done`, and `search_error` events; detect the case where the stream ends after `model_start` with no model output and convert it into visible per-model errors instead of leaving “Waiting…” indefinitely; and preserve the existing event names from the server. Keep the UI consistent with the backend defaults from Task 4 so a single successful provider still yields visible model content and a usable summary panel.
  **Must NOT do**: Do not introduce new server event names. Do not leave search failures silent. Do not clear already-streamed model content when another provider fails.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: frontend state transitions and degraded UX messaging
  - Skills: `[]` — no extra skill required
  - Omitted: [`playwright`] — optional for final verification only

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7 | Blocked By: 3, 4

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `artifacts/chat-ui/src/pages/multi-chat.tsx:153-329` — current submit/read loop and missing handling for `done` and `search_*`
  - Pattern: `artifacts/chat-ui/src/pages/multi-chat.tsx:224-289` — current switch statement that must be extended, not replaced
  - API/Type: `artifacts/chat-ui/src/types/chat.ts` — existing turn/model/search state shape
  - Pattern: `artifacts/chat-ui/src/components/Markdown.tsx` — current rendering path for model and summary content

  **Acceptance Criteria** (agent-executable only):
  - [ ] Frontend handles `done` and all emitted `search_*` events from the server
  - [ ] If the stream ends without model content or explicit model terminal events, the turn is converted into visible error state instead of remaining “Waiting…”
  - [ ] Partial-success responses preserve successful model content while failed providers show targeted errors
  - [ ] `pnpm --filter @workspace/chat-ui run typecheck`

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Deployed chat page renders partial success
    Tool: Playwright / interactive_bash
    Steps: Open `$DEPLOYED_URL/chat/<existing-chat-id>`, send `Reply with the single word OK.`, wait for SSE completion
    Expected: At least one model panel shows content or a targeted provider error, the summary panel reaches a terminal state, and the UI does not stay on indefinite “Waiting...”
    Evidence: .sisyphus/evidence/task-5-chat-ui-terminal-state.png

  Scenario: Search failure is visible
    Tool: Playwright / interactive_bash
    Steps: Enable the existing web-search path if exposed in UI, send a prompt while search is misconfigured or forced to fail in a controlled environment
    Expected: UI records a visible search error state instead of silently ignoring backend `search_error`
    Evidence: .sisyphus/evidence/task-5-chat-ui-search-error.png
  ```

  **Commit**: YES | Message: `fix(chat-ui): surface terminal ai stream states` | Files: `artifacts/chat-ui/src/pages/multi-chat.tsx`, `artifacts/chat-ui/src/types/chat.ts`

- [ ] 6. Add deployed Replit provider diagnostics and evidence capture

  **What to do**: Add a repeatable diagnostic entry point for maintainers that exercises `GET /api/healthz`, `POST /api/chat`, and `POST /api/multi-chat` against the deployed Replit base URL, captures raw SSE output, and makes it obvious which provider stalled or errored. Reuse `debug-chat.html` if that is the lowest-friction path, but also add a scriptable non-browser path under `scripts/` or the api-server workspace so mobile-only debugging can be done with a single command.
  **Must NOT do**: Do not add diagnostics that require browser DevTools or manual log spelunking only. Do not hardcode secrets into scripts. Do not invent unsupported package scripts outside the existing pnpm workspace pattern.

  **Recommended Agent Profile**:
  - Category: `writing` — Reason: reproducible diagnostic tooling plus operator-facing runbook clarity
  - Skills: `[]` — no extra skill required
  - Omitted: [`playwright`] — command-line diagnostics are the primary need

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7 | Blocked By: 3, 4

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `debug-chat.html:12-58` — existing ad hoc browser debug page that already prints SSE events
  - Pattern: `artifacts/api-server/src/routes/health.ts:6-8` — current health endpoint behavior
  - Pattern: `artifacts/chat-ui/vite.config.ts:54-58` — dev proxy target behavior; diagnostics should bypass ambiguity by probing deployed API directly
  - API/Type: `replit.md` — existing deployment-oriented notes and provider env context

  **Acceptance Criteria** (agent-executable only):
  - [ ] Maintainer can run one documented command to capture raw SSE output for `/api/chat` and `/api/multi-chat`
  - [ ] Diagnostic output identifies provider name, terminal state, and whether the stream ended cleanly
  - [ ] Replit-required env vars are listed with exact names and expected role
  - [ ] Any added script is invokable through the existing pnpm workspace command pattern

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Single-command deployed diagnostics
    Tool: Bash
    Steps: Run the documented diagnostic command against `$DEPLOYED_URL`
    Expected: Output includes health result plus raw SSE transcript for single-chat and multi-chat probes
    Evidence: .sisyphus/evidence/task-6-replit-diagnostics.txt

  Scenario: Provider env list is complete
    Tool: Bash
    Steps: Compare the documented env names against `lib/integrations-openai-ai-server/src/client.ts`, `lib/integrations-anthropic-ai/src/client.ts`, and `lib/integrations-gemini-ai/src/client.ts`
    Expected: Docs/script mention all six required `AI_INTEGRATIONS_*_{BASE_URL,API_KEY}` variables, plus `EXA_API_KEY` as optional search-only
    Evidence: .sisyphus/evidence/task-6-env-audit.txt
  ```

  **Commit**: YES | Message: `docs(debug): add replit ai provider diagnostics` | Files: `debug-chat.html`, `scripts/*`, `replit.md`

- [ ] 7. Validate the full deployed Replit flow end-to-end and lock in success evidence

  **What to do**: Run the final deployed validation sequence after tasks 1-6 land: typecheck the touched packages, probe each provider individually via `/api/chat`, probe mixed-provider combinations via `/api/multi-chat`, and verify the actual Replit `/chat/:id` UI renders a non-waiting terminal state. Record the raw SSE transcripts and any UI screenshots/video in `.sisyphus/evidence/` for the final verification wave.
  **Must NOT do**: Do not rely on local-only validation. Do not treat `/api/healthz` success as proof that providers work. Do not mark the task complete unless the deployed Replit URL shows terminal assistant behavior.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: cross-surface deployed verification with evidence capture
  - Skills: `[]` — no extra skill required
  - Omitted: [`playwright`] — only optional if curl evidence is insufficient for UI confirmation

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Final Verification Wave | Blocked By: 4, 5, 6

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `artifacts/api-server/src/routes/chat.ts:151-227` — expected single-chat terminal contract after hardening
  - Pattern: `artifacts/api-server/src/routes/multi-chat.ts:148-252` — expected multi-chat terminal contract after hardening
  - Pattern: `artifacts/chat-ui/src/pages/multi-chat.tsx:193-328` — frontend stream reader that must now settle visibly
  - Pattern: `artifacts/api-server/src/routes/health.ts:6-8` — health is a smoke check only, not provider proof

  **Acceptance Criteria** (agent-executable only):
  - [ ] `pnpm --filter @workspace/api-server run typecheck`
  - [ ] `pnpm --filter @workspace/chat-ui run typecheck`
  - [ ] `pnpm run typecheck`
  - [ ] Deployed `/api/chat` and `/api/multi-chat` probes produce deterministic terminal events for all tested providers
  - [ ] Deployed `/chat/:id` no longer remains on indefinite waiting after a send

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Provider-by-provider deployed validation
    Tool: Bash
    Steps: Run three separate `/api/chat` probes for `gpt-5.2`, `claude-opus-4-6`, and `gemini-3.1-pro-preview`
    Expected: Each transcript contains `start`, a terminal provider outcome (`chunk` or `error`), and `done`
    Evidence: .sisyphus/evidence/task-7-provider-matrix.txt

  Scenario: End-to-end deployed chat UI validation
    Tool: Playwright / interactive_bash
    Steps: Open the deployed `/chat/:id` route, submit `Reply with the single word OK.`, wait for completion, capture the visible result
    Expected: UI settles into visible content and/or targeted provider errors; no perpetual “Waiting...” state remains
    Evidence: .sisyphus/evidence/task-7-chat-ui-e2e.png
  ```

  **Commit**: NO | Message: `test(deploy): verify replit ai chat recovery` | Files: `.sisyphus/evidence/*`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy

- Commit after Wave 1 route/provider hardening
- Commit after Wave 2 frontend + runbook updates
- Final verification fixes get a separate follow-up commit if needed

## Success Criteria

- Deployed Replit `/chat/:id` shows assistant output instead of indefinite waiting
- Each provider path is diagnosable from logs and terminal SSE events
- Multi-chat is resilient to one provider stalling or failing
- `curl` probes on deployed endpoints produce deterministic terminal events
