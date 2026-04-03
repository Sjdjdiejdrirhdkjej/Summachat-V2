# Learnings: Deep Research Method Rework

## Key Findings from Exploration

### Citation Type Mismatch (CRITICAL)

- **OpenAPI spec** (lines 656-659): `ResearchDebateEntry.citations` typed as `ResearchEvidence[]`
- **Orchestrator implementation** (lines 1113-1117): Sets citations as `string[]` (sourceIds)
- Code: `citations: parsed.citations.map((ordinal) => sourceIdForOrdinal(ordinal, state.sources)).filter(...)`

### Status/Lifecycle Issues

- OpenAPI enum (line 487): `queued | running | completed | failed | cancelling | cancelled`
- Store extension (run-store.types.ts:13): Adds `"degraded"` outside OpenAPI contract
- Result (orchestrator.ts:440): Uses `degraded` as lifecycle status when warnings exist

### Hardcoded Phase Emissions

Lines in orchestrator.ts:

- 158-161: `phase.updated` → `collecting-evidence`
- 206-209: `phase.updated` → `investigating`
- 372-376: `phase.updated` → `deliberation`
- 388-392: `phase.updated` → `synthesis`

### Event Model Issues

- All event data uses `additionalProperties: true` (untyped)
- No versioning on events/results
- Missing typed payloads for activity/action events

### Current Model Defaults

- Panel: `gpt-5.2`, `claude-opus-4-6`, `gemini-3.1-pro-preview`
- GPT-only decision authority (getAgentDecision)

## UI Expectations

- Citations: ResearchEvidence[] (evidenceId, sourceId, excerpt)
- Round labels: 0="Initial Analysis", 1="Round 1 — Opening", N>1="Round N"
- Session revival preserves full citation shape
- Panel descriptions mention "opening statements, discussion, consensus" (decorative)

## Budget Defaults Summary

- Agent: maxIterations=10, maxSearches=5, maxAnalysisCalls=6, maxDeliberationCalls=15
- Run store: DEFAULT_MAX_SOURCES=6, DEFAULT_MAX_ROUNDS=3, DEFAULT_MAX_QUERIES=6
- Force synthesize at 80% of budget limits

## Timestamps

- 2026-04-02T01:32: Initial exploration
- 2026-04-02T01:33: Complete exploration (all 3 agents)
