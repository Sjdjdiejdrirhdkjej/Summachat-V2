# Deep Research Method Rework

## TL;DR

> **Summary**: Replace the current hardcoded deep-research pipeline with a transcript-first, multi-model discussion system where the three models can propose actions, challenge each other, iterate until convergence, and still remain observable, replayable, and cancellable.
> **Deliverables**:
>
> - Dynamic deep-research orchestration with configurable 3-model panel roles
> - Versioned run config, event model, and structured result schema
> - Updated API/store/UI contracts for dynamic discussion + trace output
> - Expanded automated tests plus a research-quality evaluation harness
>   **Effort**: Large
>   **Parallel**: YES - 3 waves
>   **Critical Path**: 1 → 3 → 5 → 8 → 9 → 10 → 11 → 12

## Context

### Original Request

- Rework the entire deep research method.
- Remove hardcoded steps.
- Let the 3 models discuss, argue, and do whatever it takes to produce a long, extensive, precise answer.

### Interview Summary

- Replace the current hardcoded internal 4-phase flow with a dynamic discussion core plus explicit outer lifecycle rails.
- Keep the current three models (`gpt-5.2`, `claude-opus-4-6`, `gemini-3.1-pro-preview`) as the default panel, but make panel roles and selection configurable instead of hardcoded.
- Require final answers to include citations, visible dissent/uncertainty, a research trace, and a minority report when disagreement remains.
- Use soft caps / quality-first runtime policy: budgets are safety valves, not the primary stop rule.
- Use tests-after plus a research-quality evaluation harness.

### Metis Review (gaps addressed)

- Explicitly cover hidden coupling across run-store lifecycle projection, generated API/Zod types, provider stream guards, UI transcript rendering, and citation shape compatibility.
- Treat OpenAPI, server events, store projection, and UI consumers as one coordinated contract migration instead of isolated changes.
- Add verification beyond unit happy paths: prompt snapshots, evaluation fixtures, cancellation coverage, unresolved-disagreement coverage, and provider-failure coverage.
- Apply a default silently: keep the current three models as defaults, but remove hardcoded role ownership.
- Incorporate Oracle guardrails: immutable per-run config, typed/versioned events, structured final result artifact, transcript compaction, stall detection, and explicit stop reasons.

## Work Objectives

### Core Objective

Ship a dynamic deep-research system where GPT, Claude, and Gemini collaborate as peers inside a transcript-first discussion loop that can search, analyze, challenge, revise, and converge without relying on hardcoded internal phases or fixed deliberation rounds.

### Deliverables

- Versioned deep-research run config with panel, tools, budgets, stop policy, and output schema metadata
- Dynamic orchestration loop replacing hardcoded collection/investigation/deliberation/synthesis sequencing
- Configurable panel protocol for proposal, challenge, support, revise, and converge behaviors
- Structured result artifact with final answer, citations, dissent, minority report, research trace, stop reason, and validation metadata
- Updated SSE/snapshot/UI contracts for dynamic activity and transcript rendering
- Automated regression coverage for orchestration behavior, API contracts, UI rendering, and research-quality evaluation

### Definition of Done (verifiable conditions with commands)

- `npm run -w @workspace/api-spec codegen` completes after schema changes.
- `npm run typecheck` passes repo-wide.
- `npm test` passes repo-wide.
- Deep-research runs expose dynamic activity/events without relying on hardcoded phase names like `collecting-evidence`, `investigating`, `deliberation`, or `synthesis`.
- Final research results include citations, dissent/uncertainty, research trace, minority report support, and stop metadata in the typed contract.
- Cancellation, degraded/provider-failure behavior, and unresolved-disagreement scenarios are covered by automated tests/evals.

### Must Have

- No single model retains permanent orchestration authority.
- One orchestrator remains the single writer of run state to preserve deterministic replay.
- Per-run config is frozen at run start and persisted with the run.
- Event and result schemas are explicitly versioned.
- UI rendering is data-driven from event/result contracts, not hardcoded to opening/discussion/consensus labels.
- Budget limits act as guardrails, not default early-stop triggers.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)

- Must NOT keep hardcoded internal flow control through fixed phase names or fixed `MAX_DISCUSSION_ROUNDS` semantics.
- Must NOT leave OpenAPI, api-zod, server, and UI contracts out of sync.
- Must NOT store transcript semantics only in free-text prompts; discussion state must be machine-readable.
- Must NOT collapse operational warnings and epistemic disagreement into the same output field.
- Must NOT introduce a second state-mutating orchestrator path beside the main run orchestrator.
- Must NOT treat “long answer” as permission for unbounded prompt growth; compaction/stall rules are required.

## Verification Strategy

> ZERO HUMAN INTERVENTION — all verification is agent-executed.

- Test decision: tests-after + evaluation harness using existing Vitest/supertest/UI test patterns
- QA policy: Every task includes agent-executed validation and evidence capture
- Evidence: .sisyphus/evidence/task-{N}-{slug}.{ext}

## Execution Strategy

### Parallel Execution Waves

> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: contract foundation — schema inventory, immutable run config, event model redesign, snapshot/projection retention updates

Wave 2: orchestration core — dynamic loop, panel protocol, evidence/tool policy, structured result artifact, route/SSE/cancel wiring

Wave 3: consumption + verification — UI adaptation, server/unit/integration regression coverage, evaluation harness and prompt snapshots

### Dependency Matrix (full, all tasks)

- 1 blocks 2, 3, 8, 9, 10, 11, 12
- 2 blocks 5, 6, 7, 8, 9
- 3 blocks 4, 5, 8, 9, 10, 11, 12
- 4 blocks 9, 10, 11, 12
- 5 blocks 6, 7, 8, 9, 10, 11, 12
- 6 blocks 8, 9, 10, 11, 12
- 7 blocks 8, 11, 12
- 8 blocks 9, 10, 11, 12
- 9 blocks 10, 11, 12
- 10 blocks 11, 12
- 11 blocks 12

### Agent Dispatch Summary (wave → task count → categories)

- Wave 1 → 4 tasks → unspecified-high / deep
- Wave 2 → 5 tasks → deep / unspecified-high
- Wave 3 → 3 tasks → visual-engineering / unspecified-high / writing

## TODOs

> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Replace phase-centric API contracts with versioned deep-research schemas

  **What to do**: Update the authoritative API contract so deep research is described as lifecycle status + dynamic activity + structured result, not lifecycle status + hardcoded `phase`. In `lib/api-spec/openapi.yaml:442-701`, replace the current `ResearchRunSnapshot.phase` model (`openapi.yaml:480-519`) with a typed `activity` object and add a `config` object persisted per run. Add new shared schemas for `ResearchRunConfig`, `ResearchActivity`, `ResearchStopReason`, `ResearchTraceEntry`, `ResearchUncertainty`, `ResearchDissent`, `ResearchMinorityReport`, and a version marker (for example `schemaVersion: "research.v2"`) on snapshots, events, and results. Keep lifecycle `status` strictly for run lifecycle (`queued|running|completed|failed|cancelling|cancelled`), and move degraded/provider-quality semantics into warnings/result metadata instead of a separate lifecycle state; this resolves the current mismatch between `run-store` and OpenAPI. Standardize `ResearchDebateEntry.citations` on `ResearchEvidence[]` because the UI and session store already expect evidence objects, while the orchestrator currently emits source-id strings.
  **Must NOT do**: Do not leave `phase` as a required contract field. Do not preserve `degraded` as a lifecycle status. Do not ship a partially updated contract where api-zod/generated client types lag behind the OpenAPI source.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: cross-package contract redesign touches OpenAPI, generated types, server, and UI expectations.
  - Skills: `[]` — no extra skill required.
  - Omitted: `['/git-master']` — no git work needed at this task level.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 8, 9, 10, 11, 12 | Blocked By: none

  **References** (executor has NO interview context — be exhaustive):
  - Contract baseline: `lib/api-spec/openapi.yaml:442-701` — current research request/snapshot/event/result schemas.
  - Status mismatch: `lib/api-spec/openapi.yaml:480-519` — snapshot status enum excludes `degraded` today.
  - Store lifecycle extension: `artifacts/api-server/src/lib/deep-research/run-store.types.ts:13-25` — store currently adds `degraded` outside OpenAPI.
  - Store status constants: `artifacts/api-server/src/lib/deep-research/run-store.ts:32-62` — current lifecycle sets and terminal-state handling.
  - Route terminal handling: `artifacts/api-server/src/routes/research.ts:27-35` — route logic currently treats `degraded` as terminal.
  - Debate citation mismatch source: `artifacts/api-server/src/lib/deep-research/orchestrator.ts:1107-1124` — synthesis appends string source IDs as citations.
  - UI citation expectation: `artifacts/chat-ui/src/components/research-result-utils.ts:49-81` — source excerpt builder expects `ResearchEvidence[]` citations.
  - Session persistence expectation: `artifacts/chat-ui/src/lib/session-store.ts:174-181` — debate citations are revived as research evidence objects.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `lib/api-spec/openapi.yaml` defines versioned research schemas with `activity`, `config`, `stopReason`, trace/dissent structures, and no required `phase` field.
  - [ ] `ResearchRunSnapshot.status` and generated types no longer expose `degraded` as a lifecycle enum member.
  - [ ] `ResearchDebateEntry.citations` is typed consistently end-to-end as `ResearchEvidence[]`.
  - [ ] `npm run -w @workspace/api-spec codegen && npm run typecheck` passes.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Generated schema matches the new research contract
    Tool: Bash
    Steps: Run `npm run -w @workspace/api-spec codegen` then `npm run typecheck`; inspect generated types for `ResearchRunSnapshot`, `ResearchResult`, and `ResearchDebateEntry` shape changes.
    Expected: Codegen succeeds; typecheck passes; generated types expose `activity/config/stopReason` and no `phase` requirement or `degraded` lifecycle status.
    Evidence: .sisyphus/evidence/task-1-contract-schema.txt

  Scenario: Contract drift is eliminated
    Tool: Bash
    Steps: Run a targeted test command covering deep research contract consumers, e.g. `npm test -- research.test.ts run-store.test.ts ResearchResultView.test.tsx`.
    Expected: Tests pass or fail only on implementation gaps that are resolved within the task; no type mismatch remains between OpenAPI/server/UI citations.
    Evidence: .sisyphus/evidence/task-1-contract-schema-error.txt
  ```

  **Commit**: YES | Message: `refactor(research): version research contracts` | Files: `lib/api-spec/openapi.yaml`, generated `lib/api-zod/*`, generated `lib/api-client-react/*` as needed

- [x] 2. Freeze immutable per-run config and default policy at run creation

  **What to do**: Introduce a single `ResearchRunConfig` object that is resolved exactly once at run creation, persisted with the run, and reused by the orchestrator, store, and UI. Put it on the request path in `lib/api-spec/openapi.yaml:442-459`, on store types in `artifacts/api-server/src/lib/deep-research/run-store.types.ts:27-66`, on store creation in `artifacts/api-server/src/lib/deep-research/run-store.ts:102-128`, and on route creation logic in `artifacts/api-server/src/routes/research.ts:153-172`. The config must include: default panel members (current three models), optional role labels per model, allowed action kinds (`search`, `analyze`, `challenge`, `summarize`), soft budget policy, compaction policy, stop policy, schema version, and output guarantees (citations, dissent, trace, minority report). Freeze the config after run creation; executors may read it but must not mutate it mid-run.
  **Must NOT do**: Do not allow arbitrary panel sizes or arbitrary model IDs in this milestone. Do not scatter defaults across `agent.ts`, `run-store.ts`, and `evidence-ledger.ts` after this task. Do not let SSE/UI derive behavior from implicit defaults.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: this is a broad TS contract + store + route refactor with clear local boundaries.
  - Skills: `[]` — no extra skill required.
  - Omitted: `['/git-master']` — no git work needed here.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5, 6, 7, 8, 9 | Blocked By: 1

  **References** (executor has NO interview context — be exhaustive):
  - Run creation request: `lib/api-spec/openapi.yaml:442-459` — existing request currently only allows `query` + simple options.
  - Current defaults in store: `artifacts/api-server/src/lib/deep-research/run-store.ts:23-31` — max sources/rounds/query defaults live here today.
  - Store create path: `artifacts/api-server/src/lib/deep-research/run-store.ts:102-128` — current createRun stores only query/options/snapshot.
  - Store types: `artifacts/api-server/src/lib/deep-research/run-store.types.ts:27-66` — extend options/internal state/snapshot types from here.
  - Route create path: `artifacts/api-server/src/routes/research.ts:153-172` — request parsing and createRun invocation.
  - Current model defaults: `artifacts/api-server/src/lib/deep-research/agent.ts:6-12` — current hardcoded three-model registry.
  - Current budget defaults: `artifacts/api-server/src/lib/deep-research/agent.ts:72-95` and `artifacts/api-server/src/lib/deep-research/evidence-ledger.ts:24-28` — defaults are currently split across modules.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Every created run persists a fully resolved `config` object in the snapshot/store.
  - [ ] Orchestrator startup reads runtime policy from `config` rather than directly from hardcoded module constants for panel membership and run policy.
  - [ ] Mid-run event processing cannot mutate `config`.
  - [ ] `npm run typecheck` passes after the config object is threaded through the server/UI types.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Run snapshot exposes frozen config
    Tool: Bash
    Steps: Start/create a research run through the route test or integration harness, fetch `/api/research/runs/:id`, and inspect the snapshot payload.
    Expected: Snapshot includes the resolved config with default 3-model panel, output guarantees, and policy objects; config stays stable across subsequent snapshot fetches.
    Evidence: .sisyphus/evidence/task-2-run-config.json

  Scenario: Conflicting implicit defaults are removed
    Tool: Bash
    Steps: Run targeted tests for route/store/orchestrator creation paths.
    Expected: No test relies on hidden constants outside the run config; panel membership and policy values are sourced from the persisted config.
    Evidence: .sisyphus/evidence/task-2-run-config-error.txt
  ```

  **Commit**: YES | Message: `refactor(research): persist immutable run config` | Files: `lib/api-spec/openapi.yaml`, `artifacts/api-server/src/routes/research.ts`, `artifacts/api-server/src/lib/deep-research/run-store.ts`, `artifacts/api-server/src/lib/deep-research/run-store.types.ts`, generated client/types

- [x] 3. Replace hardcoded phase events with versioned activity/event contracts

  **What to do**: Redesign the event model so it reports typed runtime activity instead of controlling behavior with `phase.updated`. Add versioned event kinds for at least: `activity.updated`, `panel.turn.recorded`, `action.proposed`, `action.selected`, `action.completed`, `evidence.accepted`, `evidence.rejected`, `consensus.updated`, `dissent.updated`, `budget.updated`, `warning.added`, `result.ready`, and `error.set`. Keep `step.upserted` and `step.status.updated` only as UI projection helpers, never as the source of orchestration truth. Introduce explicit stop reasons (`converged`, `stalled`, `budget_guard`, `no_evidence`, `provider_failure`, `cancelled`) and include them in result publication. Remove server reliance on literal activity strings like `collecting-evidence`, `investigating`, `deliberation`, and `synthesis`.
  **Must NOT do**: Do not leave mixed control flow where some modules still depend on `phase.updated`. Do not use free-text event names without schema versioning. Do not let UI-only step labels dictate orchestration logic.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: event taxonomy redesign impacts projection, SSE replay, orchestration, UI, and tests.
  - Skills: `[]` — no extra skill required.
  - Omitted: `['/git-master']` — git not needed for this task.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4, 5, 8, 9, 10, 11, 12 | Blocked By: 1

  **References** (executor has NO interview context — be exhaustive):
  - Current phase emissions: `artifacts/api-server/src/lib/deep-research/orchestrator.ts:157-209`, `372-392` — hardcoded collection/investigation/deliberation/synthesis transitions.
  - Current step previews: `artifacts/api-server/src/lib/deep-research/orchestrator.ts:262-366` — step events are emitted before and during action execution.
  - Current store projection: `artifacts/api-server/src/lib/deep-research/run-store.ts:303-357` — snapshot mutation logic is keyed off `phase.updated`, `step.*`, `budget.updated`, `result.ready`.
  - Current event data type: `artifacts/api-server/src/lib/deep-research/run-store.types.ts:46-56` — projection model currently assumes `phase?: string`.
  - Current route SSE streaming: `artifacts/api-server/src/routes/research.ts:227-287` — event stream transport should remain transport-only.
  - Current tests expecting phase events: `artifacts/api-server/src/lib/deep-research/orchestrator.test.ts:232-297`, `artifacts/api-server/src/lib/deep-research/run-store.test.ts:85-120`.

  **Acceptance Criteria** (agent-executable only):
  - [ ] No deep-research orchestration path emits or depends on `phase.updated` for control flow.
  - [ ] Event payloads include a version marker and typed activity/stop metadata.
  - [ ] Snapshot projection and SSE replay support the new event model without losing order or replay determinism.
  - [ ] Route/store/orchestrator tests are updated to assert new event names and payloads.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: SSE replay returns versioned activity events in order
    Tool: Bash
    Steps: Run the route integration tests covering event streaming and Last-Event-ID replay.
    Expected: The replayed stream contains versioned activity/action/result events with monotonic IDs and no `phase.updated` dependency.
    Evidence: .sisyphus/evidence/task-3-event-model.txt

  Scenario: Legacy phase assumptions are removed
    Tool: Bash
    Steps: Run targeted server tests for orchestrator + run-store after replacing phase events.
    Expected: Tests fail if any remaining assertions or reducer branches still require `phase.updated`; final suite passes once all are migrated.
    Evidence: .sisyphus/evidence/task-3-event-model-error.txt
  ```

  **Commit**: YES | Message: `refactor(research): replace phase events with activity contracts` | Files: `artifacts/api-server/src/lib/deep-research/orchestrator.ts`, `run-store.ts`, `run-store.types.ts`, `routes/research.ts`, tests, generated types if event schemas are exported

- [ ] 4. Add snapshot compaction and replay-safe transcript retention for long runs

  **What to do**: Update the run store so longer quality-first runs remain replayable without requiring unbounded retained events. Keep the existing single-writer store, but add compaction/checkpoint support: the replay base snapshot must preserve compacted transcript state, accepted evidence provenance, consensus state, dissent state, and result-adjacent trace metadata when older events are trimmed. Preserve the 500-event transport window only as a delivery optimization; do not treat it as the authoritative memory boundary for a long run. Extend `ResearchRunStoreSnapshot` and projection logic so reconnecting clients still receive semantically complete snapshots after compaction.
  **Must NOT do**: Do not move to a durable database in this milestone. Do not silently drop early debate/evidence context once retained events roll over. Do not make replay depend on UI-only step labels.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: localized store/projection work with tricky replay semantics.
  - Skills: `[]` — no extra skill required.
  - Omitted: `['/git-master']` — not needed.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 9, 10, 11, 12 | Blocked By: 3

  **References** (executor has NO interview context — be exhaustive):
  - Retention cap: `artifacts/api-server/src/lib/deep-research/run-store.ts:27-31` — current `MAX_RETAINED_EVENTS = 500`.
  - Retention rollover path: `artifacts/api-server/src/lib/deep-research/run-store.ts:154-181` — events are shifted into `replayBaseSnapshot` only through projection.
  - Snapshot rebuild path: `artifacts/api-server/src/lib/deep-research/run-store.ts:209-219` — deterministic replay depends on replay base + retained events.
  - Projection reducer: `artifacts/api-server/src/lib/deep-research/run-store.ts:300-374` — extend this reducer for compacted transcript/evidence/consensus state.
  - Current tests: `artifacts/api-server/src/lib/deep-research/run-store.test.ts:122-180` — deterministic replay baseline; extend here for compaction cases.
  - Oracle guardrail input: current store does not preserve full debate/trace semantics once events are trimmed; this task closes that gap.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Long runs retain enough snapshot/checkpoint state to reconstruct transcript/evidence/consensus meaning after event trimming.
  - [ ] `rebuildSnapshotFromEvents` remains deterministic for compacted runs.
  - [ ] Existing retention tests are expanded to cover compaction/checkpoint behavior.
  - [ ] `npm test -- run-store.test.ts` passes with new compaction scenarios.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Compacted run still rebuilds correctly
    Tool: Bash
    Steps: Run `npm test -- run-store.test.ts` with a new scenario that forces retained-event rollover beyond the transport cap.
    Expected: Rebuilt snapshot matches live snapshot and still includes compacted transcript/evidence/dissent state.
    Evidence: .sisyphus/evidence/task-4-compaction.txt

  Scenario: Early discussion context is not lost after rollover
    Tool: Bash
    Steps: Execute a targeted store/orchestrator test that generates a long multi-turn transcript, triggers trimming, then fetches snapshot + replayed events.
    Expected: Snapshot preserves semantically complete trace/checkpoint information even though older transport events have been trimmed.
    Evidence: .sisyphus/evidence/task-4-compaction-error.txt
  ```

  **Commit**: YES | Message: `refactor(research): preserve replay state across compaction` | Files: `artifacts/api-server/src/lib/deep-research/run-store.ts`, `run-store.types.ts`, tests

- [ ] 5. Rebuild the orchestrator around a transcript-first peer discussion loop

  **What to do**: Replace the current `executeRun` control flow in `artifacts/api-server/src/lib/deep-research/orchestrator.ts:138-450` with explicit outer rails (`run start`, `active discussion loop`, `finalization`, `terminal publish`) and a dynamic inner loop driven by model turns rather than named phases. The orchestrator must remain the single writer of state. In each loop cycle, request one structured turn from each active model using the frozen run config and current compacted state; each turn must include: current assessment, objections, newly supported/unsupported claims, one proposed next action or `converge`, vote/support metadata, and citations. Normalize proposals, deterministically select the next action, execute only that selected action, append the resulting transcript/evidence events, then iterate. Stop only when convergence, stall, safety valve, cancellation, or hard failure triggers. Convergence rule for this milestone: stop when at least 2 of the 3 models mark `converged`, there are no unresolved blocking objections, and the evidence threshold defined in config is met.
  **Must NOT do**: Do not preserve the hardcoded collection → investigation → deliberation → synthesis sequence internally. Do not allow models to mutate store state directly. Do not let multiple actions execute concurrently in the same selection cycle until replay semantics are explicitly modeled.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: this is the core architecture rewrite with deterministic loop semantics.
  - Skills: `[]` — no extra skill required.
  - Omitted: `['/git-master']` — git not needed.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 6, 7, 8, 9, 10, 11, 12 | Blocked By: 2, 3

  **References** (executor has NO interview context — be exhaustive):
  - Current hardcoded run flow: `artifacts/api-server/src/lib/deep-research/orchestrator.ts:138-450`.
  - Current fixed action loop: `artifacts/api-server/src/lib/deep-research/orchestrator.ts:211-370`.
  - Current fallback analysis shortcut: `artifacts/api-server/src/lib/deep-research/orchestrator.ts:457-483`.
  - Current deliberation sub-phase planner: `artifacts/api-server/src/lib/deep-research/orchestrator.ts:490-611` — remove this fixed choreography.
  - Current decision prompt authority: `artifacts/api-server/src/lib/deep-research/orchestrator.ts:783-850` and `artifacts/api-server/src/lib/deep-research/agent.ts:172-225`.
  - Current baseline test harness: `artifacts/api-server/src/lib/deep-research/orchestrator.test.ts:232-260` onward — reuse provider/evidence mocks.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `executeRun` no longer depends on four hardcoded internal phases or GPT-only orchestration.
  - [ ] Each discussion cycle records structured peer turns and selects exactly one next action through deterministic reducer logic.
  - [ ] Convergence, stall, cancellation, and hard-failure exits all publish explicit stop metadata.
  - [ ] Existing orchestrator tests are updated to validate the new loop behavior.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Three-model discussion iterates to convergence
    Tool: Bash
    Steps: Run the orchestrator test suite with mocked provider turns that produce proposals, objections, and convergence votes across multiple cycles.
    Expected: The run records peer turns, executes one selected action per cycle, then stops only after the configured convergence rule is satisfied.
    Evidence: .sisyphus/evidence/task-5-dynamic-loop.txt

  Scenario: No hardcoded phase path remains
    Tool: Bash
    Steps: Run targeted deep-research tests plus a code search assertion in the test harness for legacy phase flow assumptions.
    Expected: No test or runtime branch requires the old internal phase sequence to complete a run.
    Evidence: .sisyphus/evidence/task-5-dynamic-loop-error.txt
  ```

  **Commit**: YES | Message: `refactor(research): introduce dynamic discussion loop` | Files: `artifacts/api-server/src/lib/deep-research/orchestrator.ts`, related tests

- [ ] 6. Replace GPT-only decision prompts with a configurable peer-panel protocol

  **What to do**: Rewrite `artifacts/api-server/src/lib/deep-research/agent.ts` and the deliberation prompt builders in `artifacts/api-server/src/lib/deep-research/orchestrator.ts:691-781` so every model participates as a peer using the same structured turn schema. Remove `DECISION_SYSTEM_PROMPT`, `buildDecisionPrompt`, `getAgentDecision`, and `MAX_DISCUSSION_ROUNDS` as control primitives. Introduce a shared turn schema that all models must return, with fields for: `assessment`, `claimsSupported`, `claimsRejected`, `objections`, `proposal`, `vote`, `converged`, `confidenceDelta`, and `citations`. Keep configurable prompt emphasis profiles per model (for example strategy, rigor, counterexample-seeking), but do not encode a permanent leader. The config may choose a preferred final packager order, but not a permanent orchestration owner.
  **Must NOT do**: Do not retain GPT-5.2 as the sole action planner. Do not keep hardcoded opening/response/consensus prompt templates as the primary discussion model. Do not emit freeform, unparseable model turns.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: this is the core reasoning/protocol redesign that shapes how the three models interact.
  - Skills: `[]` — no extra skill required.
  - Omitted: `['/git-master']` — not needed.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 8, 9, 10, 11, 12 | Blocked By: 5

  **References** (executor has NO interview context — be exhaustive):
  - Model registry: `artifacts/api-server/src/lib/deep-research/agent.ts:6-12`.
  - Budget/round hardcoding: `artifacts/api-server/src/lib/deep-research/agent.ts:72-95`.
  - Forced synthesis thresholds: `artifacts/api-server/src/lib/deep-research/agent.ts:109-135`.
  - Current GPT-only decision prompt: `artifacts/api-server/src/lib/deep-research/agent.ts:172-225`.
  - Current opening/response/consensus prompt builders: `artifacts/api-server/src/lib/deep-research/orchestrator.ts:691-781`.
  - Current GPT-only decision callsite: `artifacts/api-server/src/lib/deep-research/orchestrator.ts:783-850`.

  **Acceptance Criteria** (agent-executable only):
  - [ ] No production code uses `getAgentDecision` or GPT-only decision authority.
  - [ ] `MAX_DISCUSSION_ROUNDS` is removed from control logic.
  - [ ] All model turns are parsed into a shared typed peer-turn structure.
  - [ ] Prompt/unit tests cover at least one agreement, disagreement, and unresolved-objection peer-turn output path.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Peer-turn protocol parses for all three models
    Tool: Bash
    Steps: Run unit/orchestrator tests with mocked GPT, Claude, and Gemini responses shaped to the new turn schema.
    Expected: Each model's turn is parsed successfully into the shared structure, with no model-specific special case required for orchestration ownership.
    Evidence: .sisyphus/evidence/task-6-panel-protocol.txt

  Scenario: Unparseable or incomplete peer turns degrade gracefully
    Tool: Bash
    Steps: Run a failure-path test where one provider returns malformed structured output.
    Expected: The orchestrator records a warning, continues with remaining valid panel input where allowed, and does not crash or silently skip contract validation.
    Evidence: .sisyphus/evidence/task-6-panel-protocol-error.txt
  ```

  **Commit**: YES | Message: `refactor(research): make the panel reason as peers` | Files: `artifacts/api-server/src/lib/deep-research/agent.ts`, `artifacts/api-server/src/lib/deep-research/orchestrator.ts`, tests

- [ ] 7. Move search/evidence/budget policy to proposal-driven tools with soft safety valves

  **What to do**: Rework search and evidence handling so tools are invoked because the panel selected them, not because a hardcoded phase requires them. Replace hardcoded caps in `artifacts/api-server/src/lib/deep-research/evidence-ledger.ts:24-28` and `agent.ts:83-95` with config-driven soft policies: evidence thresholds, search budget, model-call budget, compaction checkpoints, and stall heuristics. Emit explicit evidence acceptance/rejection events with reasons, track no-new-evidence streaks, and track no-position-change streaks. Stall rule for this milestone: stop with `stopReason = stalled` when two consecutive cycles produce neither accepted evidence nor a materially changed panel position. Keep URL deduplication and excerpt extraction behavior from the current ledger.
  **Must NOT do**: Do not keep hidden hard stops at 80% of budget as the default termination path. Do not allow duplicate-source acceptance. Do not drop evidence provenance when a model cites a claim.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: this is a contained policy refactor around the ledger, budgets, and reducer state.
  - Skills: `[]` — no extra skill required.
  - Omitted: `['/git-master']` — not needed.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 8, 11, 12 | Blocked By: 5

  **References** (executor has NO interview context — be exhaustive):
  - Current ledger limits: `artifacts/api-server/src/lib/deep-research/evidence-ledger.ts:24-28`.
  - Current targeted search path: `artifacts/api-server/src/lib/deep-research/evidence-ledger.ts:44-113`.
  - Current multi-pass evidence collector: `artifacts/api-server/src/lib/deep-research/evidence-ledger.ts:115-140` onward.
  - Current budget defaults: `artifacts/api-server/src/lib/deep-research/agent.ts:72-95`.
  - Current force-synthesize thresholds: `artifacts/api-server/src/lib/deep-research/agent.ts:109-135`.
  - Current search execution path: `artifacts/api-server/src/lib/deep-research/orchestrator.ts:857-905`.
  - Provider stream guard/timeouts to preserve: `artifacts/api-server/src/lib/provider-stream-guard.ts:73-218`.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Search/analyze/challenge execution is triggered only through selected panel proposals.
  - [ ] Budget and stall behavior is sourced from persisted run config, with soft caps and explicit stop reasons.
  - [ ] Evidence acceptance/rejection emits typed provenance events.
  - [ ] Duplicate URLs remain deduplicated and citation provenance remains intact.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Soft-cap policy allows continued work until convergence or stall
    Tool: Bash
    Steps: Run orchestrator tests where budgets are approached but useful new evidence still appears.
    Expected: The run continues past warning thresholds, records budget warnings, and stops only when convergence/stall/terminal failure conditions are actually reached.
    Evidence: .sisyphus/evidence/task-7-soft-budgets.txt

  Scenario: Stalled discussion exits explicitly
    Tool: Bash
    Steps: Run a test where two consecutive cycles add no accepted evidence and no material position change.
    Expected: The run stops with `stopReason = stalled`, emits the correct event/result metadata, and preserves prior evidence/trace state.
    Evidence: .sisyphus/evidence/task-7-soft-budgets-error.txt
  ```

  **Commit**: YES | Message: `refactor(research): make tool use proposal-driven` | Files: `artifacts/api-server/src/lib/deep-research/evidence-ledger.ts`, `agent.ts`, `orchestrator.ts`, tests

- [ ] 8. Assemble the final result deterministically with dissent, minority report, and trace

  **What to do**: Replace the thin final result assembly in `artifacts/api-server/src/lib/deep-research/orchestrator.ts:1040-1205` with a structured artifact builder. The orchestrator must assemble the final metadata deterministically from transcript/evidence state: `answer`, `sources`, `citationsValid`, `stopReason`, `trace`, `uncertainties`, `dissent`, `minorityReport`, `warnings`, and validation summary. A packager model may draft/refine the narrative `answer` text, but the orchestrator must deterministically derive citation validity, stop metadata, majority/minority alignment, and research trace from the recorded state. Choose the packager from config preference order; default order may match the current synthesis preference, but it is no longer a hidden constant. Publish the result through the versioned result schema and append a final transcript entry that matches the same citation object type used elsewhere.
  **Must NOT do**: Do not leave final output as only `{answer, citations}` JSON. Do not infer minority report text from operational warnings. Do not allow a synthesis model to invent citations or override the recorded trace metadata.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: structured finalization touches orchestration, schema, UI, and tests but is narrower than the full loop rewrite.
  - Skills: `[]` — no extra skill required.
  - Omitted: `['/git-master']` — not needed.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 9, 10, 11, 12 | Blocked By: 1, 5, 6, 7

  **References** (executor has NO interview context — be exhaustive):
  - Current synthesis path: `artifacts/api-server/src/lib/deep-research/orchestrator.ts:1040-1127`.
  - Current synthesis prompt: `artifacts/api-server/src/lib/deep-research/orchestrator.ts:1185-1205`.
  - Current result.ready emission: `artifacts/api-server/src/lib/deep-research/orchestrator.ts:428-449`.
  - Current result schema baseline: `lib/api-spec/openapi.yaml:687-701`.
  - Current source-panel/citation rendering: `artifacts/chat-ui/src/components/ResearchResultView.tsx:91-239` and `research-result-utils.ts:49-81`.
  - Current transcript citation expectation in tests: `artifacts/chat-ui/src/components/ResearchResultView.test.tsx:34-129`.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Final result payload includes answer, stop reason, research trace, uncertainties/dissent, and minority-report support.
  - [ ] Citation validation remains deterministic and is computed from recorded sources/evidence.
  - [ ] Final transcript entry citations match the same `ResearchEvidence[]` shape as the rest of the transcript.
  - [ ] Result emission and UI consumers compile against the new schema.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Final result contains dissent and trace when disagreement remains
    Tool: Bash
    Steps: Run orchestrator tests where two models converge and one remains in disagreement.
    Expected: Result includes a majority-backed answer, a minority report, explicit uncertainty/dissent fields, and a machine-readable trace.
    Evidence: .sisyphus/evidence/task-8-result-artifact.txt

  Scenario: Invalid final citations are rejected deterministically
    Tool: Bash
    Steps: Run a synthesis-path test where the packager returns missing or invalid citations.
    Expected: The run records validation failure, does not publish an invalid final result, and follows the configured fallback/error path.
    Evidence: .sisyphus/evidence/task-8-result-artifact-error.txt
  ```

  **Commit**: YES | Message: `refactor(research): publish structured final artifacts` | Files: `artifacts/api-server/src/lib/deep-research/orchestrator.ts`, `lib/api-spec/openapi.yaml`, generated types, tests

- [ ] 9. Rewire routes, SSE transport, cancellation, and provider guards around the new contracts

  **What to do**: Update `artifacts/api-server/src/routes/research.ts` to create runs with the new config contract, stream the new versioned activity/action/result events, and publish terminal responses using lifecycle-only statuses. Keep the current transport model (HTTP create + snapshot + SSE + explicit cancel) for this milestone. Preserve the current rule that client disconnect does **not** auto-cancel the run; cancellation remains explicit through `/cancel`. Keep `activeRuns` + `AbortController` coordination, but update terminal checks and cancel responses to reflect the new lifecycle/stop-reason semantics. Ensure provider stream guards continue to wrap all model calls and that timeout/abort outcomes are mapped into warnings/result metadata instead of a `degraded` lifecycle state.
  **Must NOT do**: Do not add a new queueing system or pubsub layer in this milestone. Do not auto-cancel on SSE disconnect. Do not leave route logic checking for `degraded` as a terminal lifecycle status.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: this is cross-cutting API wiring with clear transport boundaries and cancellation semantics.
  - Skills: `[]` — no extra skill required.
  - Omitted: `['/git-master']` — not needed.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 10, 11, 12 | Blocked By: 1, 2, 3, 5, 8

  **References** (executor has NO interview context — be exhaustive):
  - Route terminal statuses + active runs: `artifacts/api-server/src/routes/research.ts:27-35`.
  - Run launch path: `artifacts/api-server/src/routes/research.ts:102-150`.
  - Create route: `artifacts/api-server/src/routes/research.ts:153-189`.
  - SSE transport loop: `artifacts/api-server/src/routes/research.ts:220-287`.
  - Cancel route: `artifacts/api-server/src/routes/research.ts:290-328`.
  - Provider guard behavior: `artifacts/api-server/src/lib/provider-stream-guard.ts:73-218`.
  - Existing route test harness: `artifacts/api-server/src/routes/research.test.ts:32-105` and `165-220`.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Route responses and SSE payloads compile against the versioned research contracts.
  - [ ] Terminal route logic no longer relies on `degraded` lifecycle status.
  - [ ] Explicit cancellation still aborts the live run and returns consistent snapshot/cancel payloads.
  - [ ] Provider timeouts/aborts surface as warnings/result metadata rather than ad hoc status drift.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: SSE stream carries new activity contracts end-to-end
    Tool: Bash
    Steps: Run `npm test -- research.test.ts` and inspect the streamed envelopes from the integration harness.
    Expected: Create, snapshot, replay, and cancel flows all use the new event/result shapes and terminal statuses.
    Evidence: .sisyphus/evidence/task-9-routes-sse.txt

  Scenario: Cancel semantics remain explicit and stable
    Tool: Bash
    Steps: Run a long-run cancellation test while also disconnecting/reconnecting the SSE client.
    Expected: Disconnect alone does not cancel; `/cancel` aborts the run, emits cancellation metadata, and ends the stream cleanly.
    Evidence: .sisyphus/evidence/task-9-routes-sse-error.txt
  ```

  **Commit**: YES | Message: `refactor(research): align routes and streaming contracts` | Files: `artifacts/api-server/src/routes/research.ts`, `provider-stream-guard.ts` (if mapping changes), route tests

- [ ] 10. Make the Chat UI render dynamic activity, trace, dissent, and minority reports

  **What to do**: Update the Chat UI so it no longer assumes a fixed opening/discussion/consensus story. Replace hardcoded transcript copy and round labeling in `artifacts/chat-ui/src/components/ResearchResultView.tsx:227-253`, `artifacts/chat-ui/src/components/research-result-utils.ts:25-40`, and `artifacts/chat-ui/src/pages/unified-workspace.tsx:552-587` with data-driven rendering from the new event/result contracts. Add panels for: current activity, research trace, final uncertainty/dissent, and minority report. Preserve source-panel behavior and clickable inline citations, but update transcript grouping to use cycle/activity metadata rather than `opening` and `Round 1 — Opening`. Update session persistence so stored research turns revive the new result and transcript fields without data loss.
  **Must NOT do**: Do not leave UI copy that claims every run has opening statements, discussion rounds, and consensus sections. Do not drop citation excerpt rendering. Do not keep round labels hardcoded around the old choreography.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: UI/state rendering overhaul with contract-driven presentation and persistence changes.
  - Skills: `[]` — no extra skill required.
  - Omitted: `['/git-master']` — not needed.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 11, 12 | Blocked By: 1, 3, 4, 5, 8, 9

  **References** (executor has NO interview context — be exhaustive):
  - Current result view source panel + debate panel: `artifacts/chat-ui/src/components/ResearchResultView.tsx:91-239`.
  - Current hardcoded panel-discussion copy: `artifacts/chat-ui/src/components/ResearchResultView.tsx:233-238`.
  - Current round grouping/label helpers: `artifacts/chat-ui/src/components/research-result-utils.ts:25-40`.
  - Current source excerpt assembly: `artifacts/chat-ui/src/components/research-result-utils.ts:49-81`.
  - Current unified-workspace transcript grouping: `artifacts/chat-ui/src/pages/unified-workspace.tsx:552-587`.
  - Current citation rendering in unified workspace: `artifacts/chat-ui/src/pages/unified-workspace.tsx:1600-1698`.
  - Current session revive path: `artifacts/chat-ui/src/lib/session-store.ts:174-194`.
  - Current result-utils test baseline: `artifacts/chat-ui/src/components/ResearchResultView.test.tsx:8-129`.

  **Acceptance Criteria** (agent-executable only):
  - [ ] The UI renders dynamic activity/transcript/result data without hardcoded opening/consensus assumptions.
  - [ ] Source citations remain clickable and excerpt-backed.
  - [ ] Result view exposes uncertainty/dissent and minority-report sections when present.
  - [ ] Session persistence revives the expanded research result/transcript shape correctly.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Dynamic research result renders all new sections
    Tool: Bash
    Steps: Run the Chat UI test suite for `ResearchResultView`, result utils, and session store with fixtures containing trace, dissent, and minority-report data.
    Expected: Tests pass and assert that dynamic activity/result sections render without old round-label assumptions.
    Evidence: .sisyphus/evidence/task-10-ui-rendering.txt

  Scenario: Legacy fixed-round copy is removed
    Tool: Bash
    Steps: Run targeted component tests and, if needed, a grep assertion in the UI test harness for obsolete copy like `Opening statements` / `Building consensus` in rendered deep-research views.
    Expected: No deep-research UI component still depends on the previous fixed deliberation narrative.
    Evidence: .sisyphus/evidence/task-10-ui-rendering-error.txt
  ```

  **Commit**: YES | Message: `feat(chat-ui): render dynamic research traces` | Files: `artifacts/chat-ui/src/components/ResearchResultView.tsx`, `research-result-utils.ts`, `session-store.ts`, `pages/unified-workspace.tsx`, tests

- [ ] 11. Expand automated regression coverage for convergence, cancellation, provider failure, and replay

  **What to do**: Extend the existing deep-research test harnesses rather than inventing a new framework. In `artifacts/api-server/src/lib/deep-research/orchestrator.test.ts`, add scenarios for: multi-cycle convergence, unresolved dissent with minority report, stalled/no-new-evidence exit, provider malformed-turn recovery, provider timeout/abort mapping, and invalid-citation rejection. In `artifacts/api-server/src/lib/deep-research/run-store.test.ts`, add compaction/replay scenarios. In `artifacts/api-server/src/routes/research.test.ts`, add end-to-end streaming + cancel scenarios against the new contracts. In Chat UI tests, cover dynamic trace/dissent rendering and revived session data.
  **Must NOT do**: Do not rely only on manual verification. Do not replace existing provider harness patterns with ad hoc mocks. Do not skip replay/cancel coverage.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: broad but straightforward expansion of established test suites.
  - Skills: `[]` — no extra skill required.
  - Omitted: `['/git-master']` — not needed.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 12 | Blocked By: 1, 3, 4, 5, 7, 8, 9, 10

  **References** (executor has NO interview context — be exhaustive):
  - Provider harness + evidence mocks: `artifacts/api-server/src/lib/deep-research/orchestrator.test.ts:59-230`.
  - Existing autonomous happy-path baseline: `artifacts/api-server/src/lib/deep-research/orchestrator.test.ts:232-260` onward.
  - Existing route SSE parsing helper: `artifacts/api-server/src/routes/research.test.ts:111-158`.
  - Existing route create/replay tests: `artifacts/api-server/src/routes/research.test.ts:165-220`.
  - Existing replay baseline: `artifacts/api-server/src/lib/deep-research/run-store.test.ts:122-180`.
  - Existing UI citation/result tests: `artifacts/chat-ui/src/components/ResearchResultView.test.tsx:8-129`.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Automated tests cover convergence, unresolved disagreement, stall exit, timeout/abort mapping, replay, cancellation, and invalid-citation failure.
  - [ ] Existing happy-path coverage is updated to the new result/event contracts.
  - [ ] `npm test` passes repo-wide.
  - [ ] Test evidence clearly shows the new research method is replayable and contract-safe.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Full regression suite validates the rework
    Tool: Bash
    Steps: Run `npm test` from repo root after all deep-research/UI/server changes land.
    Expected: Repo-wide test suite passes, including updated deep-research, route, and UI coverage.
    Evidence: .sisyphus/evidence/task-11-regression-suite.txt

  Scenario: Failure-path assertions catch contract regressions
    Tool: Bash
    Steps: Temporarily run only deep-research-focused tests while introducing malformed-turn / invalid-citation / cancellation cases.
    Expected: The suite fails when the new contracts are violated and passes once protections are implemented.
    Evidence: .sisyphus/evidence/task-11-regression-suite-error.txt
  ```

  **Commit**: YES | Message: `test(research): expand dynamic research coverage` | Files: deep-research tests, route tests, UI tests

- [ ] 12. Add a research-quality evaluation harness and prompt snapshot regression layer

  **What to do**: Create a lightweight evaluation layer for deep research quality using the existing test stack. Add fixture-driven evaluation cases under the deep-research area (for example `artifacts/api-server/src/lib/deep-research/evals/`) that encode query, mocked evidence/tool outputs, expected stop reason, expected presence of dissent/minority report, and citation-validity expectations. Add prompt snapshot tests for the new peer-turn prompts and final packaging prompt so prompt contract drift is visible in review. Require at least these eval cases: strong convergence, unresolved disagreement, sparse evidence, duplicate-source rejection, provider timeout degradation, and stalled loop exit.
  **Must NOT do**: Do not treat evals as manual notes only. Do not snapshot unstable timestamps/UUIDs. Do not make prompt snapshots depend on live provider responses.

  **Recommended Agent Profile**:
  - Category: `writing` — Reason: evaluation fixtures and snapshot baselines are specification-heavy and need precise expected outputs.
  - Skills: `[]` — no extra skill required.
  - Omitted: `['/git-master']` — not needed.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: none | Blocked By: 1, 3, 5, 7, 8, 9, 10, 11

  **References** (executor has NO interview context — be exhaustive):
  - Existing prompt builders to snapshot: `artifacts/api-server/src/lib/deep-research/agent.ts` and `artifacts/api-server/src/lib/deep-research/orchestrator.ts:691-781`, `1185-1205`.
  - Existing provider harness pattern for deterministic evals: `artifacts/api-server/src/lib/deep-research/orchestrator.test.ts:59-230`.
  - Existing regression suites to extend: `artifacts/api-server/src/lib/deep-research/orchestrator.test.ts`, `routes/research.test.ts`, `run-store.test.ts`, `artifacts/chat-ui/src/components/ResearchResultView.test.tsx`.

  **Acceptance Criteria** (agent-executable only):
  - [ ] A deterministic fixture-driven evaluation suite exists for deep research quality behavior.
  - [ ] Prompt snapshot tests cover peer-turn prompt generation and final packaging prompt generation.
  - [ ] Eval fixtures assert stop reason, dissent/minority-report presence, and citation validity for key scenarios.
  - [ ] `npm test` includes the new eval/snapshot layer and passes.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Evaluation fixtures cover key research-quality behaviors
    Tool: Bash
    Steps: Run the deep-research eval suite with deterministic fixtures and mocked providers.
    Expected: The suite passes for convergence, disagreement, sparse evidence, duplicate-source rejection, timeout degradation, and stalled-loop fixtures.
    Evidence: .sisyphus/evidence/task-12-evals.txt

  Scenario: Prompt contract drift is caught automatically
    Tool: Bash
    Steps: Run the prompt snapshot tests after intentionally perturbing a prompt output shape in a local branch, then restore the correct implementation.
    Expected: Snapshot tests fail on drift and pass once the expected structured prompt contract is restored.
    Evidence: .sisyphus/evidence/task-12-evals-error.txt
  ```

  **Commit**: YES | Message: `test(research): add eval harness and prompt snapshots` | Files: new eval fixtures/tests under deep-research, prompt snapshot tests

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [ ] F1. Plan Compliance Audit — oracle

  **Tool**: oracle
  **Steps**:
  - Review the implemented diff against tasks 1-12 in this plan.
  - Check every Must Have / Must NOT Have item and every task acceptance criterion.
  - Verify the final implementation still uses lifecycle-only statuses, versioned contracts, immutable run config, and a single-writer orchestrator.
    **Expected**: Oracle returns approval only if no planned deliverable is missing, no forbidden shortcut remains, and no task acceptance criterion is unverified.
    **Evidence**: .sisyphus/evidence/f1-plan-compliance.md

- [ ] F2. Code Quality Review — unspecified-high

  **Tool**: unspecified-high
  **Steps**:
  - Review changed server/UI/test files for contract drift, dead code, hidden hardcoded flow control, and reducer/orchestrator race risks.
  - Run `npm run typecheck` and inspect diagnostics in touched areas.
  - Confirm generated types, server logic, and UI consumers all agree on citation/result/event shapes.
    **Expected**: Reviewer approves only if typecheck passes, no lingering hardcoded phase choreography remains, and the implementation is internally consistent.
    **Evidence**: .sisyphus/evidence/f2-code-quality.md

- [ ] F3. Agent-executed Product QA — unspecified-high (+ playwright if UI)

  **Tool**: unspecified-high + playwright
  **Steps**:
  - Start the relevant app surfaces and execute an end-to-end deep-research run through the UI/API.
  - Validate that the run shows dynamic activity, citations, trace, dissent/uncertainty, and minority-report behavior where applicable.
  - Exercise cancellation, replay/reconnect, and at least one disagreement or stall scenario.
    **Expected**: Agent-executed QA proves the product works without manual intervention; UI/API behavior matches the new contracts and no fixed opening/consensus story leaks through.
    **Evidence**: .sisyphus/evidence/f3-product-qa.md

- [ ] F4. Scope Fidelity Check — deep

  **Tool**: deep
  **Steps**:
  - Audit the final work against the original request and explicit plan exclusions.
  - Confirm the rework removed hardcoded internal steps, preserved the default 3-model panel, and did not expand into durable storage, arbitrary model counts, or transport rewrites.
  - Confirm the final system still prioritizes long, precise answers while using soft caps as safety valves.
    **Expected**: Reviewer approves only if the shipped work solves the requested deep-research redesign without scope creep or regression against stated exclusions.
    **Evidence**: .sisyphus/evidence/f4-scope-fidelity.md

## Commit Strategy

- Create atomic commits by task cluster, not by file type.
- Keep schema/codegen changes in the same commit as the server/UI code that consumes them.
- Do not mix Wave 1 contract refactors with Wave 2 behavior changes in a single commit.
- Keep the evaluation harness and prompt snapshot additions in a dedicated verification commit after functional behavior stabilizes.

## Success Criteria

- A research run can continue through multiple peer-model exchanges without fixed internal phase sequencing.
- The final answer contract always contains machine-readable citations, dissent/uncertainty, research trace, stop reason, and minority-report support.
- Snapshot + SSE replay remain deterministic and compatible with cancellation and retained-event rebuilding.
- The UI renders dynamic discussion data without assuming fixed opening/response/consensus choreography.
- Repo-wide typecheck and tests pass, and the evaluation harness exercises convergence, disagreement, sparse evidence, and degraded-provider scenarios.
