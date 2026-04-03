import { randomUUID } from "node:crypto";

import type {
  ResearchBudget,
  ResearchRunConfig,
  ResearchRunEventEnvelope,
  ResearchRunEventEnvelopeData,
  ResearchRunSnapshot,
  ResearchTaskStep,
  ResearchWarning,
} from "@workspace/api-zod";

import type {
  CheckpointedPanelTurn,
  InternalResearchRunState,
  ResearchAcceptedEvidenceRecord,
  ResearchActivityTransition,
  ResearchRoundSummaryState,
  ResearchRunCreateOptions,
  ResearchRunEventInput,
  ResearchRunLifecycleStatus,
  ResearchRunProjectionEventData,
  ResearchRunStoreSnapshot,
  ResearchRunStoreOptions,
  ResearchTranscriptSegment,
  ResearchRunStepPatch,
} from "./run-store.types";
import { RESEARCH_RUN_EVENT } from "./run-store.types";

const RESEARCH_SCHEMA_VERSION = "research.v2";
const DEFAULT_PANEL = [
  { modelId: "gpt-5.2" },
  { modelId: "claude-opus-4-6" },
  { modelId: "gemini-3.1-pro-preview" },
] as const satisfies ResearchRunConfig["panel"];
const DEFAULT_ALLOWED_ACTIONS = [
  "search",
  "analyze",
  "challenge",
  "summarize",
] as const satisfies ResearchRunConfig["allowedActions"];
const DEFAULT_BUDGET_POLICY = {
  mode: "soft",
  forceSynthesizeAtRatio: 0.8,
  softCaps: {
    maxQueries: 6,
    maxSources: 6,
    maxRounds: 3,
    maxIterations: 10,
    maxSearches: 5,
    maxAnalysisCalls: 6,
    maxDeliberationCalls: 15,
    maxQueryPasses: 3,
    maxAcceptedSources: 8,
  },
} as const satisfies ResearchRunConfig["budgetPolicy"];
const DEFAULT_COMPACTION_POLICY = {
  enabled: true,
  triggerTurns: 12,
  preserveRecentTurns: 6,
} as const satisfies ResearchRunConfig["compactionPolicy"];
const DEFAULT_STOP_POLICY = {
  mode: "quality-first",
  requireEvidence: true,
  maxStalledTurns: 3,
  allowBudgetGuard: true,
} as const satisfies ResearchRunConfig["stopPolicy"];
const DEFAULT_OUTPUT_GUARANTEES = {
  citations: true,
  dissent: true,
  trace: true,
  minorityReport: true,
} as const satisfies ResearchRunConfig["outputGuarantees"];

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 1000;
const MAX_CONCURRENT_RUNS = 3;
const MAX_RETAINED_EVENTS = 500;

const ACTIVE_STATUSES = new Set<ResearchRunLifecycleStatus>([
  "queued",
  "running",
  "cancelling",
]);

const KNOWN_STATUSES = new Set<ResearchRunLifecycleStatus>([
  "queued",
  "running",
  "completed",
  "degraded",
  "failed",
  "cancelling",
  "cancelled",
]);

const STEP_STATUSES = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);

const TERMINAL_STATUSES = new Set<ResearchRunLifecycleStatus>([
  "completed",
  "degraded",
  "failed",
  "cancelled",
]);

export function createDefaultConfig(
  options: ResearchRunCreateOptions = {},
): ResearchRunConfig {
  const base: ResearchRunConfig = {
    schemaVersion: RESEARCH_SCHEMA_VERSION,
    panel: DEFAULT_PANEL.map((member) => ({ ...member })),
    allowedActions: [...DEFAULT_ALLOWED_ACTIONS],
    budgetPolicy: {
      mode: DEFAULT_BUDGET_POLICY.mode,
      forceSynthesizeAtRatio: DEFAULT_BUDGET_POLICY.forceSynthesizeAtRatio,
      softCaps: { ...DEFAULT_BUDGET_POLICY.softCaps },
    },
    compactionPolicy: { ...DEFAULT_COMPACTION_POLICY },
    stopPolicy: { ...DEFAULT_STOP_POLICY },
    outputGuarantees: { ...DEFAULT_OUTPUT_GUARANTEES },
  };

  if (options.config) {
    return freezeResearchRunConfig(structuredClone(options.config));
  }

  if (options.maxSources !== undefined) {
    base.budgetPolicy.softCaps.maxSources = options.maxSources;
    base.budgetPolicy.softCaps.maxQueries =
      options.maxQueries ?? options.maxSources;
  }

  if (options.maxQueries !== undefined) {
    base.budgetPolicy.softCaps.maxQueries = options.maxQueries;
  }

  if (options.maxRounds !== undefined) {
    base.budgetPolicy.softCaps.maxRounds = options.maxRounds;
  }

  return freezeResearchRunConfig(base);
}

export class SaturationError extends Error {
  readonly code = "RUN_STORE_SATURATED";
  readonly retryable = true;

  constructor(message = "Research run capacity reached. Retry later.") {
    super(message);
    this.name = "SaturationError";
  }
}

export class ResearchRunStore {
  private static singleton: ResearchRunStore | null = null;

  private readonly runs = new Map<string, InternalResearchRunState>();
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private readonly cleanupIntervalMs: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  static getInstance(): ResearchRunStore {
    if (!ResearchRunStore.singleton) {
      ResearchRunStore.singleton = new ResearchRunStore();
    }
    return ResearchRunStore.singleton;
  }

  constructor(options: ResearchRunStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.cleanupIntervalMs =
      options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;

    const autoStartCleanup = options.autoStartCleanup ?? true;
    if (autoStartCleanup) {
      this.startCleanup();
    }
  }

  createRun(
    query: string,
    options: ResearchRunCreateOptions = {},
  ): { runId: string; snapshot: ResearchRunSnapshot } {
    if (this.getActiveRunCount() >= MAX_CONCURRENT_RUNS) {
      throw new SaturationError();
    }

    const runId = randomUUID();
    const now = this.now();
    const config = createDefaultConfig(options);
    const snapshot = createInitialSnapshot(runId, now, config);

    this.runs.set(runId, {
      runId,
      query,
      config,
      options,
      snapshot: cloneSnapshot(snapshot),
      replayBaseSnapshot: cloneSnapshot(snapshot),
      retainedEvents: [],
      nextEventId: 1,
    });

    return {
      runId,
      snapshot: toApiSnapshot(snapshot),
    };
  }

  getRun(runId: string): ResearchRunSnapshot | null {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }

    return toApiSnapshot(cloneSnapshot(run.snapshot));
  }

  getEvents(runId: string, afterEventId?: number): ResearchRunEventEnvelope[] {
    const run = this.runs.get(runId);
    if (!run) {
      return [];
    }

    if (afterEventId === undefined) {
      return run.retainedEvents.map(cloneEvent);
    }

    return run.retainedEvents
      .filter((eventEnvelope) => eventEnvelope.id > afterEventId)
      .map(cloneEvent);
  }

  appendEvent(runId: string, event: ResearchRunEventInput): void {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Unknown research run: ${runId}`);
    }

    const timestamp = this.now();
    const data = cloneEventData(event.data);
    data.emittedAt = new Date(timestamp);
    const envelope: ResearchRunEventEnvelope = {
      id: run.nextEventId,
      event: event.event,
      data,
    };

    run.nextEventId += 1;

    applyProjection(run.snapshot, envelope, timestamp);
    run.retainedEvents.push(envelope);

    while (run.retainedEvents.length > MAX_RETAINED_EVENTS) {
      const droppedEvent = run.retainedEvents.shift();
      if (droppedEvent) {
        applyProjection(
          run.replayBaseSnapshot,
          droppedEvent,
          timestampFromEvent(droppedEvent),
        );
      }
    }
  }

  updateStatus(runId: string, status: ResearchRunLifecycleStatus): void {
    this.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.STATUS_UPDATED,
      data: { contractVersion: 1, status },
    });
  }

  cancelRun(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run) {
      return false;
    }

    if (TERMINAL_STATUSES.has(run.snapshot.status)) {
      return false;
    }

    if (run.snapshot.status === "cancelling") {
      return false;
    }

    this.updateStatus(runId, "cancelling");
    return true;
  }

  rebuildSnapshotFromEvents(runId: string): ResearchRunSnapshot | null {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }

    const replayed = cloneSnapshot(run.replayBaseSnapshot);
    for (const eventEnvelope of run.retainedEvents) {
      applyProjection(
        replayed,
        eventEnvelope,
        timestampFromEvent(eventEnvelope),
      );
    }
    return toApiSnapshot(replayed);
  }

  sweepExpiredRuns(): number {
    const nowMs = this.now().getTime();
    let removed = 0;

    for (const [runId, run] of this.runs.entries()) {
      if (ACTIVE_STATUSES.has(run.snapshot.status)) {
        continue;
      }

      const ageMs = nowMs - run.snapshot.updatedAt.getTime();
      if (ageMs >= this.ttlMs) {
        this.runs.delete(runId);
        removed += 1;
      }
    }

    return removed;
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private startCleanup(): void {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.sweepExpiredRuns();
    }, this.cleanupIntervalMs);

    this.cleanupTimer.unref?.();
  }

  private getActiveRunCount(): number {
    let count = 0;
    for (const run of this.runs.values()) {
      if (ACTIVE_STATUSES.has(run.snapshot.status)) {
        count += 1;
      }
    }
    return count;
  }
}

function createEmptyCheckpoint() {
  return {
    transcript: {
      totalTurns: 0,
      compactedTurns: 0,
      recentTurns: [],
      segments: [],
    },
    activity: {
      transitions: [],
    },
    evidence: {
      accepted: [],
      rejected: [],
    },
    trace: [],
  } satisfies ResearchRunStoreSnapshot["checkpoint"];
}

function attachCheckpoint(
  snapshot: Omit<ResearchRunStoreSnapshot, "checkpoint">,
  checkpoint: ResearchRunStoreSnapshot["checkpoint"],
): ResearchRunStoreSnapshot {
  const withCheckpoint = snapshot as ResearchRunStoreSnapshot;
  Object.defineProperty(withCheckpoint, "checkpoint", {
    value: checkpoint,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return withCheckpoint;
}

function timestampFromEvent(eventEnvelope: ResearchRunEventEnvelope): Date {
  const emittedAt = toDateOrUndefined(
    (eventEnvelope.data as ResearchRunProjectionEventData).emittedAt,
  );
  return emittedAt ?? new Date(0);
}

function createInitialSnapshot(
  runId: string,
  now: Date,
  config: ResearchRunConfig,
): ResearchRunStoreSnapshot {
  return attachCheckpoint(
    {
      schemaVersion: RESEARCH_SCHEMA_VERSION,
      id: runId,
      status: "queued",
      activity: {
        key: "queued",
        status: "pending",
        updatedAt: new Date(now),
      },
      phase: "queued",
      config: cloneFrozenConfig(config),
      steps: [],
      budget: {
        maxQueries: config.budgetPolicy.softCaps.maxQueries,
        usedQueries: 0,
        maxSources: config.budgetPolicy.softCaps.maxSources,
        acceptedSources: 0,
        maxRounds: config.budgetPolicy.softCaps.maxRounds,
        completedRounds: 0,
      },
      warnings: [],
      createdAt: new Date(now),
      updatedAt: new Date(now),
    },
    createEmptyCheckpoint(),
  );
}

function applyProjection(
  snapshot: ResearchRunStoreSnapshot,
  eventEnvelope: ResearchRunEventEnvelope,
  timestamp: Date,
): void {
  const data = eventEnvelope.data as ResearchRunProjectionEventData;

  switch (eventEnvelope.event) {
    case RESEARCH_RUN_EVENT.STATUS_UPDATED: {
      if (isKnownStatus(data.status)) {
        snapshot.status = normalizeStatus(data.status);
        if (data.status === "running" && snapshot.phase === "queued") {
          snapshot.phase = "running";
        }
        appendTrace(
          snapshot,
          timestamp,
          eventEnvelope.event,
          `status=${data.status}`,
        );
      }
      break;
    }
    case RESEARCH_RUN_EVENT.ACTIVITY_UPDATED: {
      if (data.activity) {
        snapshot.activity = structuredClone(data.activity);
        appendActivityTransition(snapshot, data.activity, data.phase);
      }
      if (typeof data.phase === "string" && data.phase.length > 0) {
        snapshot.phase = data.phase;
      }
      appendTrace(
        snapshot,
        timestamp,
        eventEnvelope.event,
        formatActivityTraceDetail(data),
      );
      break;
    }
    case RESEARCH_RUN_EVENT.PANEL_TURN_RECORDED: {
      if (isPanelTurnRecord(data.turn)) {
        appendPanelTurn(snapshot, data.turn, data.stage, timestamp);
      }
      break;
    }
    case RESEARCH_RUN_EVENT.STEP_UPSERTED: {
      if (isResearchStep(data.step)) {
        upsertStep(snapshot.steps, data.step);
      }
      break;
    }
    case RESEARCH_RUN_EVENT.STEP_STATUS_UPDATED: {
      if (isStepPatch(data.stepPatch)) {
        applyStepPatch(snapshot.steps, data.stepPatch);
      }
      break;
    }
    case RESEARCH_RUN_EVENT.BUDGET_UPDATED: {
      if (data.budget) {
        snapshot.budget = mergeBudget(snapshot.budget, data.budget);
      }
      break;
    }
    case RESEARCH_RUN_EVENT.WARNING_ADDED: {
      if (isResearchWarning(data.warning)) {
        snapshot.warnings = [...snapshot.warnings, cloneWarning(data.warning)];
        appendTrace(
          snapshot,
          timestamp,
          eventEnvelope.event,
          `${data.warning.code}: ${truncate(data.warning.message, 160)}`,
        );
      }
      break;
    }
    case RESEARCH_RUN_EVENT.WARNINGS_REPLACED: {
      if (Array.isArray(data.warnings)) {
        snapshot.warnings = data.warnings
          .filter(isResearchWarning)
          .map(cloneWarning);
        appendTrace(
          snapshot,
          timestamp,
          eventEnvelope.event,
          `count=${snapshot.warnings.length}`,
        );
      }
      break;
    }
    case RESEARCH_RUN_EVENT.EVIDENCE_ACCEPTED: {
      if (typeof data.query === "string") {
        appendAcceptedEvidence(snapshot, data, timestamp);
      }
      break;
    }
    case RESEARCH_RUN_EVENT.EVIDENCE_REJECTED: {
      if (typeof data.query === "string" && typeof data.reason === "string") {
        snapshot.checkpoint.evidence.rejected.push({
          query: data.query,
          reason: data.reason,
          rejectedAt: new Date(timestamp),
        });
        appendTrace(
          snapshot,
          timestamp,
          eventEnvelope.event,
          `query=${data.query}; reason=${truncate(data.reason, 120)}`,
        );
      }
      break;
    }
    case RESEARCH_RUN_EVENT.CONSENSUS_UPDATED: {
      if (typeof data.summary === "string" && typeof data.round === "number") {
        snapshot.checkpoint.consensus = createRoundSummaryState(
          data.summary,
          data.round,
          timestamp,
        );
        appendTrace(
          snapshot,
          timestamp,
          eventEnvelope.event,
          `round=${data.round}; ${truncate(data.summary, 120)}`,
        );
      }
      break;
    }
    case RESEARCH_RUN_EVENT.DISSENT_UPDATED: {
      if (typeof data.summary === "string" && typeof data.round === "number") {
        snapshot.checkpoint.dissent = createRoundSummaryState(
          data.summary,
          data.round,
          timestamp,
        );
        appendTrace(
          snapshot,
          timestamp,
          eventEnvelope.event,
          `round=${data.round}; ${truncate(data.summary, 120)}`,
        );
      }
      break;
    }
    case RESEARCH_RUN_EVENT.ACTION_PROPOSED:
    case RESEARCH_RUN_EVENT.ACTION_SELECTED:
    case RESEARCH_RUN_EVENT.ACTION_COMPLETED: {
      appendTrace(
        snapshot,
        timestamp,
        eventEnvelope.event,
        formatActionTraceDetail(data),
      );
      break;
    }
    case RESEARCH_RUN_EVENT.RESULT_READY:
    case RESEARCH_RUN_EVENT.RESULT_UPDATED: {
      if (data.result) {
        const nextResult = structuredClone(data.result);
        if (data.stopReason) {
          nextResult.stopReason = data.stopReason;
        }
        snapshot.result = nextResult;
        appendTrace(
          snapshot,
          timestamp,
          eventEnvelope.event,
          formatResultTraceDetail(nextResult.answer, nextResult.sources.length),
        );
      }
      break;
    }
    case RESEARCH_RUN_EVENT.ERROR_SET:
    case RESEARCH_RUN_EVENT.ERROR_UPDATED: {
      if (typeof data.error === "string" && data.error.length > 0) {
        snapshot.error = data.error;
        appendTrace(
          snapshot,
          timestamp,
          eventEnvelope.event,
          truncate(data.error, 160),
        );
      }
      break;
    }
    case RESEARCH_RUN_EVENT.ERROR_CLEARED: {
      delete snapshot.error;
      appendTrace(snapshot, timestamp, eventEnvelope.event, "cleared");
      break;
    }
    default:
      break;
  }

  snapshot.updatedAt = new Date(timestamp);
}

function appendActivityTransition(
  snapshot: ResearchRunStoreSnapshot,
  activity: NonNullable<ResearchRunProjectionEventData["activity"]>,
  phase?: string,
): void {
  const transitions = snapshot.checkpoint.activity.transitions;
  const updatedAt =
    toDateOrUndefined(activity.updatedAt) ??
    new Date(timestampFromSnapshot(snapshot));
  const next: ResearchActivityTransition = {
    key: activity.key,
    status: activity.status,
    phase,
    message: activity.message,
    updatedAt,
  };
  const last = transitions.at(-1);
  if (
    last &&
    last.key === next.key &&
    last.status === next.status &&
    last.phase === next.phase &&
    last.message === next.message
  ) {
    last.updatedAt = next.updatedAt;
    return;
  }
  transitions.push(next);
}

function appendPanelTurn(
  snapshot: ResearchRunStoreSnapshot,
  turn: NonNullable<ResearchRunProjectionEventData["turn"]>,
  stage: string | undefined,
  timestamp: Date,
): void {
  const transcript = snapshot.checkpoint.transcript;
  transcript.totalTurns += 1;
  transcript.recentTurns.push({
    ...clonePanelTurn(turn),
    stage,
  });
  compactTranscript(snapshot, timestamp);
  appendTrace(
    snapshot,
    timestamp,
    RESEARCH_RUN_EVENT.PANEL_TURN_RECORDED,
    formatTurnTraceDetail(turn, stage),
  );
}

function compactTranscript(
  snapshot: ResearchRunStoreSnapshot,
  timestamp: Date,
): void {
  const policy = snapshot.config.compactionPolicy;
  if (!policy.enabled) {
    return;
  }

  const preserveRecentTurns = Math.max(0, policy.preserveRecentTurns);
  if (
    snapshot.checkpoint.transcript.totalTurns <= policy.triggerTurns ||
    snapshot.checkpoint.transcript.recentTurns.length <= preserveRecentTurns
  ) {
    return;
  }

  const compactCount =
    snapshot.checkpoint.transcript.recentTurns.length - preserveRecentTurns;
  const compactedTurns = snapshot.checkpoint.transcript.recentTurns.splice(
    0,
    compactCount,
  );
  if (compactedTurns.length === 0) {
    return;
  }

  snapshot.checkpoint.transcript.compactedTurns += compactedTurns.length;
  snapshot.checkpoint.transcript.segments.push(
    createTranscriptSegment(compactedTurns, timestamp),
  );
}

function createTranscriptSegment(
  turns: CheckpointedPanelTurn[],
  timestamp: Date,
): ResearchTranscriptSegment {
  return {
    turnCount: turns.length,
    fromRound: Math.min(...turns.map((turn) => turn.round)),
    toRound: Math.max(...turns.map((turn) => turn.round)),
    models: unique(turns.map((turn) => turn.model)),
    stages: unique(
      turns
        .map((turn) => turn.stage)
        .filter((stage): stage is string => typeof stage === "string"),
    ),
    citations: unique(turns.flatMap((turn) => turn.citations)),
    highlights: turns.map((turn) => formatTranscriptHighlight(turn)),
    compactedAt: new Date(timestamp),
  };
}

function appendAcceptedEvidence(
  snapshot: ResearchRunStoreSnapshot,
  data: ResearchRunProjectionEventData,
  timestamp: Date,
): void {
  const record: ResearchAcceptedEvidenceRecord = {
    query: data.query ?? "",
    sourceIds: [...(data.sourceIds ?? [])],
    evidenceIds: [...(data.evidenceIds ?? [])],
    sources: Array.isArray(data.sources) ? structuredClone(data.sources) : [],
    evidence: Array.isArray(data.evidence)
      ? structuredClone(data.evidence)
      : [],
    acceptedAt: new Date(timestamp),
  };
  snapshot.checkpoint.evidence.accepted.push(record);
  appendTrace(
    snapshot,
    timestamp,
    RESEARCH_RUN_EVENT.EVIDENCE_ACCEPTED,
    `query=${record.query}; sources=${record.sourceIds.length}; evidence=${record.evidenceIds.length}`,
  );
}

function createRoundSummaryState(
  summary: string,
  round: number,
  timestamp: Date,
): ResearchRoundSummaryState {
  return {
    summary,
    round,
    updatedAt: new Date(timestamp),
  };
}

function appendTrace(
  snapshot: ResearchRunStoreSnapshot,
  timestamp: Date,
  event: string,
  detail?: string,
): void {
  snapshot.checkpoint.trace.push({
    at: new Date(timestamp),
    event,
    detail,
  });
}

function formatActivityTraceDetail(
  data: ResearchRunProjectionEventData,
): string | undefined {
  if (!data.activity) {
    return undefined;
  }
  const parts = [`key=${data.activity.key}`, `status=${data.activity.status}`];
  if (data.phase) {
    parts.push(`phase=${data.phase}`);
  }
  if (data.activity.message) {
    parts.push(`message=${truncate(data.activity.message, 120)}`);
  }
  return parts.join("; ");
}

function formatActionTraceDetail(
  data: ResearchRunProjectionEventData,
): string | undefined {
  const parts: string[] = [];
  if (typeof data.iteration === "number") {
    parts.push(`iteration=${data.iteration}`);
  }
  if (data.action && typeof data.action.type === "string") {
    parts.push(`action=${data.action.type}`);
  } else if (typeof data.actionType === "string") {
    parts.push(`action=${data.actionType}`);
  }
  if (typeof data.success === "boolean") {
    parts.push(`success=${data.success}`);
  }
  if (typeof data.detail === "string" && data.detail.length > 0) {
    parts.push(`detail=${truncate(data.detail, 120)}`);
  }
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function formatResultTraceDetail(answer: string, sourceCount: number): string {
  return `sources=${sourceCount}; answer=${truncate(answer, 120)}`;
}

function formatTurnTraceDetail(
  turn: NonNullable<ResearchRunProjectionEventData["turn"]>,
  stage?: string,
): string {
  const parts = [
    `round=${turn.round}`,
    `model=${turn.model}`,
    `type=${turn.type}`,
  ];
  if (stage) {
    parts.push(`stage=${stage}`);
  }
  if (turn.citations.length > 0) {
    parts.push(`citations=${turn.citations.join(",")}`);
  }
  parts.push(`content=${truncate(turn.content, 120)}`);
  return parts.join("; ");
}

function formatTranscriptHighlight(turn: CheckpointedPanelTurn): string {
  const stage = turn.stage ? `/${turn.stage}` : "";
  return `r${turn.round} ${turn.model}:${turn.type}${stage} ${truncate(turn.content, 160)}`;
}

function clonePanelTurn(
  turn: NonNullable<ResearchRunProjectionEventData["turn"]>,
): CheckpointedPanelTurn {
  return {
    ...turn,
    citations: [...turn.citations],
    createdAt: new Date(turn.createdAt),
  };
}

function isPanelTurnRecord(
  value: unknown,
): value is NonNullable<ResearchRunProjectionEventData["turn"]> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeTurn = value as Partial<CheckpointedPanelTurn>;
  return (
    typeof maybeTurn.id === "string" &&
    typeof maybeTurn.round === "number" &&
    typeof maybeTurn.model === "string" &&
    typeof maybeTurn.type === "string" &&
    typeof maybeTurn.content === "string" &&
    Array.isArray(maybeTurn.citations)
  );
}

function upsertStep(steps: ResearchTaskStep[], step: ResearchTaskStep): void {
  const cloned = cloneStep(step);
  const index = steps.findIndex((existing) => existing.id === step.id);
  if (index === -1) {
    steps.push(cloned);
    return;
  }

  steps[index] = cloned;
}

function applyStepPatch(
  steps: ResearchTaskStep[],
  patch: ResearchRunStepPatch,
): void {
  const index = steps.findIndex((existing) => existing.id === patch.stepId);
  const existing: ResearchTaskStep =
    index === -1
      ? {
          id: patch.stepId,
          name: patch.name ?? patch.stepId,
          status: "pending",
        }
      : steps[index];

  const next: ResearchTaskStep = {
    ...existing,
    name: patch.name ?? existing.name,
    status: isStepStatus(patch.status) ? patch.status : existing.status,
  };

  const startedAt = toDateOrUndefined(patch.startedAt);
  if (startedAt) {
    next.startedAt = startedAt;
  }

  const completedAt = toDateOrUndefined(patch.completedAt);
  if (completedAt) {
    next.completedAt = completedAt;
  }

  if (index === -1) {
    steps.push(next);
    return;
  }
  steps[index] = next;
}

function mergeBudget(
  base: ResearchBudget,
  patch: Partial<ResearchBudget>,
): ResearchBudget {
  return {
    maxQueries: safeNonNegative(patch.maxQueries, base.maxQueries),
    usedQueries: safeNonNegative(patch.usedQueries, base.usedQueries),
    maxSources: safeNonNegative(patch.maxSources, base.maxSources),
    acceptedSources: safeNonNegative(
      patch.acceptedSources,
      base.acceptedSources,
    ),
    maxRounds: safeNonNegative(patch.maxRounds, base.maxRounds),
    completedRounds: safeNonNegative(
      patch.completedRounds,
      base.completedRounds,
    ),
  };
}

function safeNonNegative(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return value;
}

function cloneSnapshot(
  snapshot: ResearchRunStoreSnapshot,
): ResearchRunStoreSnapshot {
  return attachCheckpoint(
    {
      ...snapshot,
      config: cloneFrozenConfig(snapshot.config),
      steps: snapshot.steps.map(cloneStep),
      budget: { ...snapshot.budget },
      warnings: snapshot.warnings.map(cloneWarning),
      result: snapshot.result ? structuredClone(snapshot.result) : undefined,
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
    },
    cloneCheckpoint(snapshot.checkpoint),
  );
}

function cloneStep(step: ResearchTaskStep): ResearchTaskStep {
  return {
    ...step,
    startedAt: step.startedAt ? new Date(step.startedAt) : undefined,
    completedAt: step.completedAt ? new Date(step.completedAt) : undefined,
  };
}

function cloneWarning(warning: ResearchWarning): ResearchWarning {
  return { ...warning };
}

function cloneEventData(
  data: ResearchRunEventEnvelopeData,
): ResearchRunEventEnvelopeData {
  return structuredClone(data);
}

function cloneEvent(
  eventEnvelope: ResearchRunEventEnvelope,
): ResearchRunEventEnvelope {
  return {
    id: eventEnvelope.id,
    event: eventEnvelope.event,
    data: cloneEventData(eventEnvelope.data),
  };
}

function timestampFromSnapshot(snapshot: ResearchRunStoreSnapshot): Date {
  return new Date(snapshot.updatedAt);
}

function cloneCheckpoint(
  checkpoint: ResearchRunStoreSnapshot["checkpoint"],
): ResearchRunStoreSnapshot["checkpoint"] {
  return {
    transcript: {
      totalTurns: checkpoint.transcript.totalTurns,
      compactedTurns: checkpoint.transcript.compactedTurns,
      recentTurns: checkpoint.transcript.recentTurns.map((turn) => ({
        ...turn,
        citations: [...turn.citations],
        createdAt: new Date(turn.createdAt),
      })),
      segments: checkpoint.transcript.segments.map((segment) => ({
        ...segment,
        models: [...segment.models],
        stages: [...segment.stages],
        citations: [...segment.citations],
        highlights: [...segment.highlights],
        compactedAt: new Date(segment.compactedAt),
      })),
    },
    activity: {
      transitions: checkpoint.activity.transitions.map((transition) => ({
        ...transition,
        updatedAt: new Date(transition.updatedAt),
      })),
    },
    evidence: {
      accepted: checkpoint.evidence.accepted.map((record) => ({
        ...record,
        sourceIds: [...record.sourceIds],
        evidenceIds: [...record.evidenceIds],
        sources: structuredClone(record.sources),
        evidence: structuredClone(record.evidence),
        acceptedAt: new Date(record.acceptedAt),
      })),
      rejected: checkpoint.evidence.rejected.map((record) => ({
        ...record,
        rejectedAt: new Date(record.rejectedAt),
      })),
    },
    consensus: checkpoint.consensus
      ? {
          ...checkpoint.consensus,
          updatedAt: new Date(checkpoint.consensus.updatedAt),
        }
      : undefined,
    dissent: checkpoint.dissent
      ? {
          ...checkpoint.dissent,
          updatedAt: new Date(checkpoint.dissent.updatedAt),
        }
      : undefined,
    trace: checkpoint.trace.map((entry) => ({
      ...entry,
      at: new Date(entry.at),
    })),
  };
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isKnownStatus(status: unknown): status is ResearchRunLifecycleStatus {
  return (
    typeof status === "string" &&
    KNOWN_STATUSES.has(status as ResearchRunLifecycleStatus)
  );
}

function normalizeStatus(
  status: ResearchRunLifecycleStatus,
): ResearchRunSnapshot["status"] {
  return status === "degraded" ? "completed" : status;
}

function isStepStatus(status: unknown): status is ResearchTaskStep["status"] {
  return typeof status === "string" && STEP_STATUSES.has(status);
}

function isResearchStep(value: unknown): value is ResearchTaskStep {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeStep = value as Partial<ResearchTaskStep>;
  return (
    typeof maybeStep.id === "string" &&
    typeof maybeStep.name === "string" &&
    isStepStatus(maybeStep.status)
  );
}

function isResearchWarning(value: unknown): value is ResearchWarning {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeWarning = value as Partial<ResearchWarning>;
  return (
    typeof maybeWarning.code === "string" &&
    typeof maybeWarning.message === "string"
  );
}

function isStepPatch(value: unknown): value is ResearchRunStepPatch {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybePatch = value as Partial<ResearchRunStepPatch>;
  return typeof maybePatch.stepId === "string";
}

function toDateOrUndefined(value: Date | string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toApiSnapshot(
  snapshot: ResearchRunStoreSnapshot,
): ResearchRunSnapshot {
  return snapshot as unknown as ResearchRunSnapshot;
}

function cloneFrozenConfig(config: ResearchRunConfig): ResearchRunConfig {
  return freezeResearchRunConfig(structuredClone(config));
}

function freezeResearchRunConfig(config: ResearchRunConfig): ResearchRunConfig {
  return deepFreeze(config);
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) {
      deepFreeze(entry);
    }

    return Object.freeze(value);
  }

  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }

    return Object.freeze(value);
  }

  return value;
}

export const researchRunStore = ResearchRunStore.getInstance();
