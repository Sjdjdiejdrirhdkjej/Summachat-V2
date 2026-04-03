import type {
  ResearchActivity,
  ResearchBudget,
  ResearchEvidence,
  ResearchSource,
  ResearchTraceEntry,
  ResearchResult,
  ResearchRunConfig,
  ResearchRunEventEnvelope,
  ResearchRunSnapshot,
  ResearchRunSnapshotStatus,
  ResearchStopReason,
  ResearchTaskStep,
  ResearchTaskStepStatus,
  ResearchWarning,
} from "@workspace/api-zod";

export type ResearchRunLifecycleStatus = ResearchRunSnapshotStatus | "degraded";

export type TerminalResearchRunStatus =
  | "completed"
  | "degraded"
  | "failed"
  | "cancelled";

export type ActiveResearchRunStatus = "queued" | "running" | "cancelling";

export type ResearchRunStoreSnapshot = Omit<ResearchRunSnapshot, "config"> & {
  config: ResearchRunConfig;
  checkpoint: ResearchRunCheckpoint;
};

export type CheckpointedPanelTurn = PanelTurnRecord & {
  stage?: string;
};

export type ResearchTranscriptSegment = {
  turnCount: number;
  fromRound: number;
  toRound: number;
  models: string[];
  stages: string[];
  citations: string[];
  highlights: string[];
  compactedAt: Date;
};

export type ResearchActivityTransition = {
  key: string;
  status: ResearchActivity["status"];
  phase?: string;
  message?: string;
  updatedAt: Date;
};

export type ResearchAcceptedEvidenceRecord = {
  query: string;
  sourceIds: string[];
  evidenceIds: string[];
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
  acceptedAt: Date;
};

export type ResearchRejectedEvidenceRecord = {
  query: string;
  reason: string;
  rejectedAt: Date;
};

export type ResearchRoundSummaryState = {
  summary: string;
  round: number;
  updatedAt: Date;
};

export type ResearchRunCheckpoint = {
  transcript: {
    totalTurns: number;
    compactedTurns: number;
    recentTurns: CheckpointedPanelTurn[];
    segments: ResearchTranscriptSegment[];
  };
  activity: {
    transitions: ResearchActivityTransition[];
  };
  evidence: {
    accepted: ResearchAcceptedEvidenceRecord[];
    rejected: ResearchRejectedEvidenceRecord[];
  };
  consensus?: ResearchRoundSummaryState;
  dissent?: ResearchRoundSummaryState;
  trace: ResearchTraceEntry[];
};

export type ResearchRunCreateOptions = {
  config?: ResearchRunConfig;
  maxSources?: number;
  maxRounds?: number;
  maxQueries?: number;
};

export const RESEARCH_RUN_EVENT = {
  STATUS_UPDATED: "status.updated",
  ACTIVITY_UPDATED: "activity.updated",
  PANEL_TURN_RECORDED: "panel.turn.recorded",
  ACTION_PROPOSED: "action.proposed",
  ACTION_SELECTED: "action.selected",
  ACTION_COMPLETED: "action.completed",
  EVIDENCE_ACCEPTED: "evidence.accepted",
  EVIDENCE_REJECTED: "evidence.rejected",
  CONSENSUS_UPDATED: "consensus.updated",
  DISSENT_UPDATED: "dissent.updated",
  STEP_UPSERTED: "step.upserted",
  STEP_STATUS_UPDATED: "step.status.updated",
  BUDGET_UPDATED: "budget.updated",
  WARNING_ADDED: "warning.added",
  WARNINGS_REPLACED: "warnings.replaced",
  RESULT_READY: "result.ready",
  RESULT_UPDATED: "result.updated",
  ERROR_SET: "error.set",
  ERROR_UPDATED: "error.updated",
  ERROR_CLEARED: "error.cleared",
} as const;

export type ResearchRunEventName =
  (typeof RESEARCH_RUN_EVENT)[keyof typeof RESEARCH_RUN_EVENT];

type EventContractV1 = {
  contractVersion: 1;
  emittedAt?: Date | string;
};

export type PanelTurnRecord = {
  id: string;
  round: number;
  model: string;
  type: string;
  content: string;
  citations: string[];
  createdAt: Date;
};

type ResearchRunStatusUpdatedEvent = {
  event: typeof RESEARCH_RUN_EVENT.STATUS_UPDATED;
  data: EventContractV1 & {
    status: ResearchRunLifecycleStatus;
  };
};

type ResearchRunActivityUpdatedEvent = {
  event: typeof RESEARCH_RUN_EVENT.ACTIVITY_UPDATED;
  data: EventContractV1 & {
    activity: ResearchActivity;
    phase?: string;
  };
};

type ResearchRunPanelTurnRecordedEvent = {
  event: typeof RESEARCH_RUN_EVENT.PANEL_TURN_RECORDED;
  data: EventContractV1 & {
    turn: PanelTurnRecord;
    stage?: string;
  };
};

type ResearchRunActionProposedEvent = {
  event: typeof RESEARCH_RUN_EVENT.ACTION_PROPOSED;
  data: EventContractV1 & {
    iteration: number;
    action: Record<string, unknown>;
  };
};

type ResearchRunActionSelectedEvent = {
  event: typeof RESEARCH_RUN_EVENT.ACTION_SELECTED;
  data: EventContractV1 & {
    iteration: number;
    action: Record<string, unknown>;
  };
};

type ResearchRunActionCompletedEvent = {
  event: typeof RESEARCH_RUN_EVENT.ACTION_COMPLETED;
  data: EventContractV1 & {
    iteration: number;
    actionType: string;
    success: boolean;
    detail?: string;
  };
};

type ResearchRunEvidenceAcceptedEvent = {
  event: typeof RESEARCH_RUN_EVENT.EVIDENCE_ACCEPTED;
  data: EventContractV1 & {
    query: string;
    sourceIds: string[];
    evidenceIds: string[];
    sources?: ResearchSource[];
    evidence?: ResearchEvidence[];
  };
};

type ResearchRunEvidenceRejectedEvent = {
  event: typeof RESEARCH_RUN_EVENT.EVIDENCE_REJECTED;
  data: EventContractV1 & {
    query: string;
    reason: string;
  };
};

type ResearchRunConsensusUpdatedEvent = {
  event: typeof RESEARCH_RUN_EVENT.CONSENSUS_UPDATED;
  data: EventContractV1 & {
    summary: string;
    round: number;
  };
};

type ResearchRunDissentUpdatedEvent = {
  event: typeof RESEARCH_RUN_EVENT.DISSENT_UPDATED;
  data: EventContractV1 & {
    summary: string;
    round: number;
  };
};

type ResearchRunStepUpsertedEvent = {
  event: typeof RESEARCH_RUN_EVENT.STEP_UPSERTED;
  data: EventContractV1 & {
    step: ResearchTaskStep;
  };
};

type ResearchRunStepStatusUpdatedEvent = {
  event: typeof RESEARCH_RUN_EVENT.STEP_STATUS_UPDATED;
  data: EventContractV1 & {
    stepPatch: ResearchRunStepPatch;
  };
};

type ResearchRunBudgetUpdatedEvent = {
  event: typeof RESEARCH_RUN_EVENT.BUDGET_UPDATED;
  data: EventContractV1 & {
    budget: Partial<ResearchBudget>;
  };
};

type ResearchRunWarningAddedEvent = {
  event: typeof RESEARCH_RUN_EVENT.WARNING_ADDED;
  data: EventContractV1 & {
    warning: ResearchWarning;
  };
};

type ResearchRunWarningsReplacedEvent = {
  event: typeof RESEARCH_RUN_EVENT.WARNINGS_REPLACED;
  data: EventContractV1 & {
    warnings: ResearchWarning[];
  };
};

type ResearchRunResultReadyEvent = {
  event: typeof RESEARCH_RUN_EVENT.RESULT_READY;
  data: EventContractV1 & {
    result: ResearchResult;
    stopReason: ResearchStopReason;
  };
};

type ResearchRunResultUpdatedEvent = {
  event: typeof RESEARCH_RUN_EVENT.RESULT_UPDATED;
  data: EventContractV1 & {
    result: ResearchResult;
  };
};

type ResearchRunErrorSetEvent = {
  event: typeof RESEARCH_RUN_EVENT.ERROR_SET;
  data: EventContractV1 & {
    error: string;
  };
};

type ResearchRunErrorUpdatedEvent = {
  event: typeof RESEARCH_RUN_EVENT.ERROR_UPDATED;
  data: EventContractV1 & {
    error: string;
  };
};

type ResearchRunErrorClearedEvent = {
  event: typeof RESEARCH_RUN_EVENT.ERROR_CLEARED;
  data: EventContractV1;
};

export type ResearchRunEventInput =
  | ResearchRunStatusUpdatedEvent
  | ResearchRunActivityUpdatedEvent
  | ResearchRunPanelTurnRecordedEvent
  | ResearchRunActionProposedEvent
  | ResearchRunActionSelectedEvent
  | ResearchRunActionCompletedEvent
  | ResearchRunEvidenceAcceptedEvent
  | ResearchRunEvidenceRejectedEvent
  | ResearchRunConsensusUpdatedEvent
  | ResearchRunDissentUpdatedEvent
  | ResearchRunStepUpsertedEvent
  | ResearchRunStepStatusUpdatedEvent
  | ResearchRunBudgetUpdatedEvent
  | ResearchRunWarningAddedEvent
  | ResearchRunWarningsReplacedEvent
  | ResearchRunResultReadyEvent
  | ResearchRunResultUpdatedEvent
  | ResearchRunErrorSetEvent
  | ResearchRunErrorUpdatedEvent
  | ResearchRunErrorClearedEvent;

export type ResearchRunStepPatch = {
  stepId: string;
  name?: string;
  status?: ResearchTaskStepStatus;
  startedAt?: Date | string;
  completedAt?: Date | string;
};

export type ResearchRunProjectionEventData = {
  status?: ResearchRunLifecycleStatus;
  activity?: ResearchActivity;
  phase?: string;
  turn?: PanelTurnRecord;
  iteration?: number;
  action?: Record<string, unknown>;
  actionType?: string;
  success?: boolean;
  detail?: string;
  query?: string;
  sourceIds?: string[];
  evidenceIds?: string[];
  sources?: ResearchSource[];
  evidence?: ResearchEvidence[];
  reason?: string;
  stage?: string;
  summary?: string;
  round?: number;
  step?: ResearchTaskStep;
  stepPatch?: ResearchRunStepPatch;
  budget?: Partial<ResearchBudget>;
  warning?: ResearchWarning;
  warnings?: ResearchWarning[];
  result?: ResearchResult;
  stopReason?: ResearchStopReason;
  error?: string;
  contractVersion?: number;
  emittedAt?: Date | string;
};

export type InternalResearchRunState = {
  runId: string;
  query: string;
  config: ResearchRunConfig;
  options: ResearchRunCreateOptions;
  snapshot: ResearchRunStoreSnapshot;
  replayBaseSnapshot: ResearchRunStoreSnapshot;
  retainedEvents: ResearchRunEventEnvelope[];
  nextEventId: number;
};

export type ResearchRunStoreOptions = {
  now?: () => Date;
  ttlMs?: number;
  cleanupIntervalMs?: number;
  autoStartCleanup?: boolean;
};
