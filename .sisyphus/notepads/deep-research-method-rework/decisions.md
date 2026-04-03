# Decisions: Deep Research Method Rework

## 2026-04-02

- Introduced a version marker (`schemaVersion: "research.v2"`) on `ResearchRunSnapshot`, `ResearchRunEventEnvelope`, and `ResearchResult` as additive contract metadata for phased rollout.
- Replaced phase-centric modeling with typed `ResearchActivity` on snapshots and added immutable per-run `ResearchRunConfig` to snapshot payloads.
- Added shared research-v2 schemas for structured execution metadata and outcomes: `ResearchStopReason`, `ResearchTraceEntry`, `ResearchUncertainty`, `ResearchDissent`, and `ResearchMinorityReport`.
- Kept `ResearchDebateEntry.citations` as `ResearchEvidence[]` to preserve UI/session-store compatibility and align with existing OpenAPI evidence shape.
- Kept lifecycle `status` enum strictly lifecycle-only (`queued|running|completed|failed|cancelling|cancelled`) and did not introduce `degraded` as a lifecycle state.
- Marked legacy `phase` as deprecated (non-required) for transition compatibility while introducing `activity` as the preferred activity contract.
- Resolved a full `ResearchRunConfig` exactly once at run creation via `createDefaultConfig()`, persisted it on the run snapshot, and deep-froze the stored config so later executors only read a stable per-run policy snapshot.
- Kept request compatibility by allowing legacy `options` to map into the new config soft caps when `config` is omitted, while preferring explicit `config` for new callers.
- Preserved the strict public lifecycle contract (`degraded` stays out of API snapshots) by normalizing the legacy internal `degraded` status to `completed` inside the run store until the orchestrator task removes that emission entirely.
- Replaced orchestrator lifecycle control emissions from `phase.updated` to typed `activity.updated` contracts and introduced explicit event constants for action/evidence/panel/consensus/dissent/budget/warning/result/error events to make replay deterministic and remove free-text orchestration control.
- Standardized runtime event payloads on `contractVersion: 1` and required `stopReason` on `result.ready` so consumers can reason about terminal outcomes (`converged`, `stalled`, `budget_guard`, `no_evidence`, `provider_failure`, `cancelled`) without inspecting implicit control flow.
- Kept `step.upserted` and `step.status.updated` as projection-focused UI helper events while shifting operational telemetry to the new activity/action/evidence event stream.
