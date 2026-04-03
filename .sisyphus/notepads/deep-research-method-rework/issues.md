# Issues: Deep Research Method Rework

## Open Issues

### 1. Citation Type Contract Drift

- **Issue**: OpenAPI defines `citations: ResearchEvidence[]` but code emits sourceId strings
- **Impact**: Type mismatch between API contract and actual behavior
- **Resolution**: Part of Task 1 - standardize on ResearchEvidence[]

### 2. Degraded Status Outside Contract

- **Issue**: Store adds "degraded" status not in OpenAPI enum
- **Impact**: Type safety gap, potential runtime errors
- **Resolution**: Part of Task 1 - remove from lifecycle, move to warnings/result metadata

### 3. Phase Field Required

- **Issue**: OpenAPI requires `phase` field, but plan wants dynamic activity
- **Impact**: Cannot remove without contract change
- **Resolution**: Task 1 - make optional or replace with `activity`

## Resolved Issues

- Route/store creation now persist a frozen `ResearchRunConfig` snapshot with the default three-model panel, output guarantees, and policy objects instead of reconstructing defaults implicitly from scattered constants.

## Verification Notes

- `artifacts/chat-ui/src/lib/session-store.test.ts` still fails because `getSession()` returns `null` in the current test harness; this did not block repo-wide `npm run typecheck` or `npm run build`, and the failure path does not exercise the new run-config logic.

## Timestamps

- 2026-04-02T01:32: Initial issue log
