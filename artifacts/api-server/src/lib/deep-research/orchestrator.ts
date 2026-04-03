import { randomUUID } from "node:crypto";

import type Anthropic from "@anthropic-ai/sdk";
import type { GoogleGenAI } from "@google/genai";
import type OpenAI from "openai";

import type {
  ResearchSource,
  ResearchStopReason,
  ResearchWarning,
} from "@workspace/api-zod";

import {
  resolveAnthropicUpstreamModel,
  resolveGeminiUpstreamModel,
  resolveOpenAiUpstreamModel,
} from "../agentrouter-upstream-models.js";
import {
  runGuardedProviderStream,
  toTerminalError,
  type GuardedProviderStreamResult,
} from "../provider-stream-guard";
import type { EvidenceLedger } from "./evidence-ledger";
import type { ResearchRunStore } from "./run-store";
import { RESEARCH_RUN_EVENT } from "./run-store.types";
import {
  type AgentAnalyzeAction,
  type AgentBudget,
  type AgentChallengeAction,
  type AgentDecision,
  type AgentState,
  type DebateModel,
  buildDecisionPrompt,
  canCallModel,
  canDeliberate,
  canSearch,
  createInitialAgentState,
  DECISION_MAX_TOKENS,
  DECISION_SYSTEM_PROMPT,
  DEFAULT_AGENT_BUDGET,
  getModelLabel,
  MAX_DISCUSSION_ROUNDS,
  MODEL_IDS,
  parseAgentDecision,
  shouldForceSynthesize,
} from "./agent";

export type { DebateModel } from "./agent";

const PROVIDER_OVERALL_TIMEOUT_MS = 120_000;
const PROVIDER_FIRST_CHUNK_TIMEOUT_MS = 45_000;
const GEMINI_OVERALL_TIMEOUT_MS = 600_000;
const GEMINI_FIRST_CHUNK_TIMEOUT_MS = 180_000;

const MAX_DECISION_RETRIES = 1;

export type DebateEntryType =
  | "opening"
  | "response"
  | "rebuttal"
  | "consensus"
  | "synthesis";

const PANEL_MODELS: readonly DebateModel[] = [...MODEL_IDS];

export type DebateEntry = {
  id: string;
  round: number;
  model: DebateModel;
  type: DebateEntryType;
  content: string;
  citations: string[];
  createdAt: Date;
};

export type ResearchResult = {
  runId: string;
  status: "completed" | "degraded" | "failed";
  answer: string;
  sources: ResearchSource[];
  citationsValid: boolean;
  stopReason?: ResearchStopReason;
  logs: DebateEntry[];
  warnings: ResearchWarning[];
};

type Logger = {
  info: (bindings: Record<string, unknown>, message?: string) => void;
  warn: (bindings: Record<string, unknown>, message?: string) => void;
  error: (bindings: Record<string, unknown>, message?: string) => void;
};

type ResearchOrchestratorOptions = {
  openai: OpenAI;
  anthropic: Anthropic;
  gemini: GoogleGenAI;
  evidenceLedger: EvidenceLedger;
  runStore: ResearchRunStore;
  logger?: Logger;
  signal?: AbortSignal;
  providerOverallTimeoutMs?: number;
  providerFirstChunkTimeoutMs?: number;
  geminiOverallTimeoutMs?: number;
  geminiFirstChunkTimeoutMs?: number;
};

export class ResearchOrchestrator {
  private readonly openai: OpenAI;
  private readonly anthropic: Anthropic;
  private readonly gemini: GoogleGenAI;
  private readonly evidenceLedger: EvidenceLedger;
  private readonly runStore: ResearchRunStore;
  private readonly logger: Logger;
  private readonly signal?: AbortSignal;
  private readonly providerOverallTimeoutMs: number;
  private readonly providerFirstChunkTimeoutMs: number;
  private readonly geminiOverallTimeoutMs: number;
  private readonly geminiFirstChunkTimeoutMs: number;

  constructor(options: ResearchOrchestratorOptions) {
    this.openai = options.openai;
    this.anthropic = options.anthropic;
    this.gemini = options.gemini;
    this.evidenceLedger = options.evidenceLedger;
    this.runStore = options.runStore;
    this.logger = options.logger ?? createNoopLogger();
    this.signal = options.signal;
    this.providerOverallTimeoutMs =
      options.providerOverallTimeoutMs ?? PROVIDER_OVERALL_TIMEOUT_MS;
    this.providerFirstChunkTimeoutMs =
      options.providerFirstChunkTimeoutMs ?? PROVIDER_FIRST_CHUNK_TIMEOUT_MS;
    this.geminiOverallTimeoutMs =
      options.geminiOverallTimeoutMs ?? GEMINI_OVERALL_TIMEOUT_MS;
    this.geminiFirstChunkTimeoutMs =
      options.geminiFirstChunkTimeoutMs ?? GEMINI_FIRST_CHUNK_TIMEOUT_MS;
  }

  async runResearch(query: string): Promise<ResearchResult> {
    const created = this.runStore.createRun(query, {
      maxRounds: DEFAULT_AGENT_BUDGET.maxIterations,
    });
    return this.executeRun(created.runId, query);
  }

  async runExistingRun(runId: string, query: string): Promise<ResearchResult> {
    return this.executeRun(runId, query);
  }

  private async executeRun(
    runId: string,
    query: string,
  ): Promise<ResearchResult> {
    const snapshot = this.runStore.getRun(runId);

    this.throwIfAborted();
    this.runStore.updateStatus(runId, "running");

    const state = createInitialAgentState(query);
    const budget: AgentBudget = {
      ...DEFAULT_AGENT_BUDGET,
      maxIterations:
        snapshot?.budget.maxRounds ?? DEFAULT_AGENT_BUDGET.maxIterations,
    };
    const warnings: ResearchWarning[] = [];
    const debate: DebateEntry[] = [];
    let stepCounter = 0;
    let stopReason: ResearchStopReason | null = null;

    this.emitActivityUpdated(runId, "evidence.collection", "active");

    const initialStepId = `plan-${++stepCounter}`;
    this.emitStepStart(
      runId,
      initialStepId,
      `Searching: ${truncate(query, 50)}`,
    );

    const initialSearchSuccess = await this.executeSearch(
      runId,
      query,
      state,
      budget,
      warnings,
    );
    this.throwIfAborted();

    this.emitStepDone(
      runId,
      initialStepId,
      initialSearchSuccess ? "completed" : "failed",
    );

    this.emitBudgetUpdate(runId, budget, state.sources.length);

    if (state.sources.length === 0) {
      const error = "No validated evidence available.";
      this.runStore.appendEvent(runId, {
        event: RESEARCH_RUN_EVENT.ERROR_SET,
        data: { contractVersion: 1, error },
      });
      stopReason = "no_evidence";
      this.runStore.updateStatus(runId, "failed");
      return {
        runId,
        status: "failed",
        answer: "",
        sources: [],
        citationsValid: false,
        stopReason,
        logs: debate,
        warnings,
      };
    }

    this.emitActivityUpdated(runId, "investigation.autonomous-loop", "active");

    while (budget.iterationsUsed < budget.maxIterations) {
      this.throwIfAborted();
      budget.iterationsUsed += 1;

      if (shouldForceSynthesize(state, budget)) {
        stopReason = "budget_guard";
        stepCounter = await this.ensureFallbackAnalysis(
          runId,
          state,
          budget,
          debate,
          warnings,
          stepCounter,
        );
        break;
      }

      const decision = await this.getAgentDecision(
        runId,
        state,
        budget,
        warnings,
      );
      this.throwIfAborted();

      if (!decision) {
        stopReason = "provider_failure";
        stepCounter = await this.ensureFallbackAnalysis(
          runId,
          state,
          budget,
          debate,
          warnings,
          stepCounter,
        );
        break;
      }

      if (decision.readyToSynthesize) {
        stopReason = "converged";
        state.confidence = decision.confidence;
        stepCounter = await this.ensureFallbackAnalysis(
          runId,
          state,
          budget,
          debate,
          warnings,
          stepCounter,
        );
        break;
      }

      state.confidence = decision.confidence;

      // Emit pending step previews for each planned action
      const pendingStepIds: {
        counter: number;
        action: (typeof decision.actions)[number];
      }[] = [];
      for (const action of decision.actions) {
        this.emitActionProposed(runId, budget.iterationsUsed, action);
        const pendingCounter = ++stepCounter;
        const pendingStepId = `plan-${pendingCounter}`;
        const pendingName =
          action.type === "search"
            ? `Searching: ${truncate(action.query, 50)}`
            : action.type === "analyze"
              ? `Analyzing: ${truncate(action.focus, 50)}`
              : `Verifying: ${truncate(action.claim, 50)}`;
        this.emitStepPending(runId, pendingStepId, pendingName);
        pendingStepIds.push({ counter: pendingCounter, action });
      }

      for (const { counter, action } of pendingStepIds) {
        this.throwIfAborted();
        const actionStepId = `plan-${counter}`;
        this.emitActionSelected(runId, budget.iterationsUsed, action);

        switch (action.type) {
          case "search": {
            if (!canSearch(budget)) {
              this.emitActionCompleted(
                runId,
                budget.iterationsUsed,
                "search",
                false,
                "search budget exhausted",
              );
              continue;
            }
            this.emitStepStart(
              runId,
              actionStepId,
              `Searching: ${truncate(action.query, 50)}`,
            );
            const success = await this.executeSearch(
              runId,
              action.query,
              state,
              budget,
              warnings,
            );
            this.emitStepDone(
              runId,
              actionStepId,
              success ? "completed" : "failed",
            );
            state.actionHistory.push({
              action: "search",
              success,
              detail: action.query,
            });
            this.emitActionCompleted(
              runId,
              budget.iterationsUsed,
              "search",
              success,
              action.query,
            );
            break;
          }
          case "analyze": {
            if (!canCallModel(budget)) {
              this.emitActionCompleted(
                runId,
                budget.iterationsUsed,
                "analyze",
                false,
                "analysis budget exhausted",
              );
              continue;
            }
            this.emitStepStart(
              runId,
              actionStepId,
              `Analyzing: ${truncate(action.focus, 50)}`,
            );
            const success = await this.executeAnalysis(
              runId,
              action,
              state,
              budget,
              debate,
              warnings,
            );
            this.emitStepDone(
              runId,
              actionStepId,
              success ? "completed" : "failed",
            );
            state.actionHistory.push({
              action: "analyze",
              success,
              detail: `${action.model}: ${action.focus}`,
            });
            this.emitActionCompleted(
              runId,
              budget.iterationsUsed,
              "analyze",
              success,
              `${action.model}: ${action.focus}`,
            );
            break;
          }
          case "challenge": {
            if (!canCallModel(budget)) {
              this.emitActionCompleted(
                runId,
                budget.iterationsUsed,
                "challenge",
                false,
                "analysis budget exhausted",
              );
              continue;
            }
            this.emitStepStart(
              runId,
              actionStepId,
              `Verifying: ${truncate(action.claim, 50)}`,
            );
            const success = await this.executeChallenge(
              runId,
              action,
              state,
              budget,
              debate,
              warnings,
            );
            this.emitStepDone(
              runId,
              actionStepId,
              success ? "completed" : "failed",
            );
            state.actionHistory.push({
              action: "challenge",
              success,
              detail: `${action.model}: ${action.claim}`,
            });
            this.emitActionCompleted(
              runId,
              budget.iterationsUsed,
              "challenge",
              success,
              `${action.model}: ${action.claim}`,
            );
            break;
          }
        }
      }

      state.iteration = budget.iterationsUsed;
      this.emitBudgetUpdate(runId, budget, state.sources.length);
    }

    if (!stopReason && budget.iterationsUsed >= budget.maxIterations) {
      stopReason = "stalled";
    }

    this.emitActivityUpdated(runId, "panel.deliberation", "active");

    stepCounter = await this.runDeliberation(
      runId,
      state,
      budget,
      debate,
      warnings,
      stepCounter,
    );
    this.throwIfAborted();

    this.emitActivityUpdated(runId, "result.synthesis", "active");

    const synthesisStepId = `plan-${++stepCounter}`;
    this.emitStepStart(runId, synthesisStepId, "Synthesizing final answer");

    const synthesis = await this.synthesizeFromState(
      runId,
      state,
      debate,
      warnings,
    );
    this.throwIfAborted();

    if (!synthesis.success || !synthesis.citationsValid) {
      this.emitStepDone(runId, synthesisStepId, "failed");
      const error =
        synthesis.error ??
        "Unable to produce a validated synthesis from available evidence.";
      this.runStore.appendEvent(runId, {
        event: RESEARCH_RUN_EVENT.ERROR_SET,
        data: { contractVersion: 1, error },
      });
      stopReason = "provider_failure";
      this.runStore.updateStatus(runId, "failed");
      return {
        runId,
        status: "failed",
        answer: "",
        sources: state.sources,
        citationsValid: false,
        stopReason,
        logs: debate,
        warnings,
      };
    }

    this.emitStepDone(runId, synthesisStepId, "completed");

    this.runStore.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.RESULT_READY,
      data: {
        contractVersion: 1,
        stopReason: stopReason ?? "converged",
        result: {
          answer: synthesis.answer,
          sources: state.sources,
          citationsValid: true,
          stopReason: stopReason ?? "converged",
        },
      },
    });

    const degraded = warnings.length > 0;
    this.runStore.updateStatus(runId, degraded ? "degraded" : "completed");

    return {
      runId,
      status: degraded ? "degraded" : "completed",
      answer: synthesis.answer,
      sources: state.sources,
      citationsValid: true,
      stopReason: stopReason ?? "converged",
      logs: debate,
      warnings,
    };
  }

  // ---------------------------------------------------------------------------
  // Agent decision
  // ---------------------------------------------------------------------------

  private async ensureFallbackAnalysis(
    runId: string,
    state: AgentState,
    budget: AgentBudget,
    debate: DebateEntry[],
    warnings: ResearchWarning[],
    stepCounter: number,
  ): Promise<number> {
    if (state.analyses.length > 0) return stepCounter;

    const fallbackStepId = `plan-${++stepCounter}`;
    this.emitStepStart(runId, fallbackStepId, "Analyzing collected evidence");
    await this.executeAnalysis(
      runId,
      {
        type: "analyze",
        focus: "key findings, claims, and overall assessment",
        model: "gpt-5.2",
        reason: "pre-synthesis analysis",
      },
      state,
      budget,
      debate,
      warnings,
    );
    this.emitStepDone(runId, fallbackStepId, "completed");
    return stepCounter;
  }

  // ---------------------------------------------------------------------------
  // Deliberation (group meeting)
  // ---------------------------------------------------------------------------

  private async runDeliberation(
    runId: string,
    state: AgentState,
    budget: AgentBudget,
    debate: DebateEntry[],
    warnings: ResearchWarning[],
    stepCounter: number,
  ): Promise<number> {
    if (!canDeliberate(budget)) return stepCounter;

    let deliberationRound = state.iteration + 1;

    const modelsWithOpenings = new Set(
      debate
        .filter((entry) => entry.type === "opening")
        .map((entry) => entry.model),
    );
    const modelsNeedingOpenings = PANEL_MODELS.filter(
      (model) => !modelsWithOpenings.has(model),
    );

    // Emit pending steps for planned deliberation sub-phases
    const pendingDeliberationSteps: { counter: number; label: string }[] = [];

    if (modelsNeedingOpenings.length > 0) {
      pendingDeliberationSteps.push({
        counter: ++stepCounter,
        label: "Opening statements",
      });
    }

    const remainingDeliberation =
      budget.maxDeliberationCalls - budget.deliberationCallsUsed;
    const discussionRounds = Math.min(
      MAX_DISCUSSION_ROUNDS,
      Math.floor(
        (remainingDeliberation -
          (modelsNeedingOpenings.length > 0 ? PANEL_MODELS.length : 0)) /
          (PANEL_MODELS.length * 2),
      ),
    );

    for (let i = 0; i < discussionRounds; i += 1) {
      pendingDeliberationSteps.push({
        counter: ++stepCounter,
        label: `Discussion round ${i + 1}`,
      });
    }

    if (
      modelsNeedingOpenings.length > 0 ||
      discussionRounds > 0 ||
      canDeliberate(budget)
    ) {
      pendingDeliberationSteps.push({
        counter: ++stepCounter,
        label: "Building consensus",
      });
    }

    for (const pending of pendingDeliberationSteps) {
      this.emitStepPending(runId, `plan-${pending.counter}`, pending.label);
    }

    // Now execute — steps will be upgraded from pending to running
    let pendingIdx = 0;

    if (modelsNeedingOpenings.length > 0) {
      const openingStepId = `plan-${pendingDeliberationSteps[pendingIdx]!.counter}`;
      this.emitStepStart(runId, openingStepId, "Opening statements");
      await Promise.allSettled(
        modelsNeedingOpenings.map((model) =>
          this.executeDeliberationEntry(
            runId,
            model,
            deliberationRound,
            "opening",
            this.buildOpeningPrompt(model, state),
            state,
            budget,
            debate,
            warnings,
          ),
        ),
      );
      this.emitStepDone(runId, openingStepId, "completed");
      deliberationRound += 1;
      pendingIdx += 1;
    }

    for (let i = 0; i < MAX_DISCUSSION_ROUNDS; i += 1) {
      this.throwIfAborted();
      const remaining =
        budget.maxDeliberationCalls - budget.deliberationCallsUsed;
      if (remaining < PANEL_MODELS.length * 2) break;

      const discussionStepId = `plan-${pendingDeliberationSteps[pendingIdx]!.counter}`;
      this.emitStepStart(runId, discussionStepId, `Discussion round ${i + 1}`);
      await Promise.allSettled(
        PANEL_MODELS.map((model) =>
          this.executeDeliberationEntry(
            runId,
            model,
            deliberationRound,
            "response",
            this.buildResponsePrompt(model, state, debate),
            state,
            budget,
            debate,
            warnings,
          ),
        ),
      );
      this.emitStepDone(runId, discussionStepId, "completed");
      deliberationRound += 1;
      pendingIdx += 1;
    }

    this.throwIfAborted();
    if (canDeliberate(budget)) {
      const consensusStepId = `plan-${pendingDeliberationSteps[pendingIdx]!.counter}`;
      this.emitStepStart(runId, consensusStepId, "Building consensus");
      await Promise.allSettled(
        PANEL_MODELS.map((model) =>
          this.executeDeliberationEntry(
            runId,
            model,
            deliberationRound,
            "consensus",
            this.buildConsensusPrompt(model, state, debate),
            state,
            budget,
            debate,
            warnings,
          ),
        ),
      );
      this.emitStepDone(runId, consensusStepId, "completed");
    }

    this.emitBudgetUpdate(runId, budget, state.sources.length);
    return stepCounter;
  }

  private async executeDeliberationEntry(
    runId: string,
    model: DebateModel,
    round: number,
    type: DebateEntryType,
    prompt: string,
    state: AgentState,
    budget: AgentBudget,
    debate: DebateEntry[],
    warnings: ResearchWarning[],
  ): Promise<boolean> {
    if (!canDeliberate(budget)) return false;

    const callResult = await this.callModelWithRetry({
      runId,
      model,
      prompt,
      systemPrompt: this.getDeliberationSystemPrompt(type),
      label: type,
    });

    budget.deliberationCallsUsed += 1;

    if (!callResult.success) {
      const warning: ResearchWarning = {
        code: "DELIBERATION_FAILED",
        message: `${getModelLabel(model)} ${type} failed: ${callResult.error}`,
        model,
      };
      warnings.push(warning);
      this.runStore.appendEvent(runId, {
        event: RESEARCH_RUN_EVENT.WARNING_ADDED,
        data: { contractVersion: 1, warning },
      });
      return false;
    }

    const citations = this.extractSourceIds(callResult.output, state.sources);
    const entry: DebateEntry = {
      id: randomUUID(),
      round,
      model,
      type,
      content: callResult.output,
      citations,
      createdAt: new Date(),
    };

    debate.push(entry);
    this.emitPanelTurnRecorded(runId, type, entry);
    if (type === "consensus") {
      this.runStore.appendEvent(runId, {
        event: RESEARCH_RUN_EVENT.CONSENSUS_UPDATED,
        data: {
          contractVersion: 1,
          summary: truncate(entry.content, 280),
          round,
        },
      });
    }
    if (type === "rebuttal") {
      this.runStore.appendEvent(runId, {
        event: RESEARCH_RUN_EVENT.DISSENT_UPDATED,
        data: {
          contractVersion: 1,
          summary: truncate(entry.content, 280),
          round,
        },
      });
    }

    return true;
  }

  private getDeliberationSystemPrompt(type: DebateEntryType): string {
    switch (type) {
      case "opening":
        return "You are a research analyst presenting your initial findings to a panel of fellow AI researchers (GPT, Claude, Gemini). Ground every claim in evidence using [S<ordinal>] citations. Be thorough but concise.";
      case "response":
        return "You are a research panelist in a scholarly group discussion with GPT, Claude, and Gemini. Address your fellow panelists by name. Agree, disagree, and build on their specific points. Ground claims in evidence using [S<ordinal>] citations. Be direct and constructive.";
      case "rebuttal":
        return "You are a critical reviewer in a research panel. Challenge weak reasoning and verify factual claims using [S<ordinal>] citations.";
      case "consensus":
        return "You are a research panelist concluding a group discussion. State your final position clearly, noting where the panel agrees, what disagreements were resolved, and what remains uncertain. Ground claims in evidence using [S<ordinal>] citations.";
      case "synthesis":
        return "You are the final synthesis model. Produce only valid JSON.";
    }
  }

  private buildOpeningPrompt(model: DebateModel, state: AgentState): string {
    const modelName = getModelLabel(model);
    const otherModels = PANEL_MODELS.filter((m) => m !== model)
      .map(getModelLabel)
      .join(" and ");

    const parts = [
      `You are ${modelName}. Present your interpretation of the evidence to the research panel.`,
      `Research query: ${state.query}`,
      "Structure your opening statement:",
      "1. KEY FINDINGS: The most important facts and claims, with evidence citations",
      "2. ASSESSMENT: Your conclusions from the evidence",
      "3. UNCERTAINTIES: Where evidence is weak, contradictory, or missing",
      `4. QUESTIONS FOR THE PANEL: What would you ask ${otherModels} about?`,
      renderSourceContext(state.sources),
    ];

    const priorAnalyses = state.analyses;
    if (priorAnalyses.length > 0) {
      parts.push(
        "Preliminary investigation findings:",
        ...priorAnalyses.map(
          (a) =>
            `- ${getModelLabel(a.model)} on ${a.focus}: ${truncate(a.content, 300)}`,
        ),
      );
    }

    parts.push(
      `\nYour fellow panelists (${otherModels}) will respond to your points. Make your position clear.`,
    );

    return parts.join("\n\n");
  }

  private buildResponsePrompt(
    model: DebateModel,
    state: AgentState,
    debate: DebateEntry[],
  ): string {
    const modelName = getModelLabel(model);

    return [
      `You are ${modelName} in a research panel discussion.`,
      `Research query: ${state.query}`,
      renderDiscussionTranscript(debate),
      `Now respond directly to your fellow panelists:`,
      `1. AGREEMENTS: Quote specific points from other panelists you agree with. Say "I agree with [Name]'s point that [X] because..."`,
      `2. DISAGREEMENTS: Challenge specific claims with counter-evidence. Say "I disagree with [Name]'s claim that [X] because..."`,
      `3. NEW INSIGHTS: What has this discussion revealed that wasn't obvious initially?`,
      `4. REFINED POSITION: How has your assessment evolved based on the discussion?`,
      `\nAddress other panelists BY NAME. Be specific about what you're responding to. Cite sources as [S<ordinal>].`,
      renderSourceContext(state.sources),
    ].join("\n\n");
  }

  private buildConsensusPrompt(
    model: DebateModel,
    state: AgentState,
    debate: DebateEntry[],
  ): string {
    const modelName = getModelLabel(model);

    return [
      `You are ${modelName}. The panel discussion is concluding.`,
      `Research query: ${state.query}`,
      renderDiscussionTranscript(debate),
      "State your FINAL POSITION:",
      "1. CONSENSUS: What has the panel clearly agreed on? Reference where agreement emerged.",
      "2. RESOLVED DISAGREEMENTS: Which disagreements were settled through discussion, and how?",
      "3. REMAINING UNCERTAINTIES: What couldn't be resolved with available evidence?",
      "4. FINAL ANSWER: Your precise, evidence-backed answer to the research query.",
      "\nThis is your closing statement. Be precise, comprehensive, and cite sources as [S<ordinal>].",
      renderSourceContext(state.sources),
    ].join("\n\n");
  }

  private async getAgentDecision(
    runId: string,
    state: AgentState,
    budget: AgentBudget,
    warnings: ResearchWarning[],
  ): Promise<AgentDecision | null> {
    for (let attempt = 0; attempt <= MAX_DECISION_RETRIES; attempt += 1) {
      try {
        const response = await this.openai.chat.completions.create(
          {
            model: resolveOpenAiUpstreamModel("gpt-5.2"),
            max_completion_tokens: DECISION_MAX_TOKENS,
            messages: [
              { role: "system", content: DECISION_SYSTEM_PROMPT },
              {
                role: "user",
                content: buildDecisionPrompt(state, budget),
              },
            ],
          },
          { signal: this.signal },
        );

        const rawContent = response.choices[0]?.message?.content ?? "";
        const decision = parseAgentDecision(rawContent);

        if (decision) {
          this.logger.info(
            {
              runId,
              reasoning: decision.reasoning,
              actionCount: decision.actions.length,
              readyToSynthesize: decision.readyToSynthesize,
              confidence: decision.confidence,
            },
            "agent_decision",
          );
          return decision;
        }

        if (attempt < MAX_DECISION_RETRIES) {
          this.logger.warn(
            { runId, attempt, rawContent: rawContent.slice(0, 200) },
            "agent_decision_parse_failed_retrying",
          );
        }
      } catch (error) {
        const message = toErrorMessage(error);
        if (attempt < MAX_DECISION_RETRIES) {
          this.logger.warn(
            { runId, attempt, err: message },
            "agent_decision_call_failed_retrying",
          );
        } else {
          const warning: ResearchWarning = {
            code: "DECISION_FAILED",
            message: `Agent decision failed: ${message}`,
          };
          warnings.push(warning);
          this.runStore.appendEvent(runId, {
            event: RESEARCH_RUN_EVENT.WARNING_ADDED,
            data: { contractVersion: 1, warning },
          });
        }
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Action executors
  // ---------------------------------------------------------------------------

  private async executeSearch(
    runId: string,
    query: string,
    state: AgentState,
    budget: AgentBudget,
    warnings: ResearchWarning[],
  ): Promise<boolean> {
    let success = false;
    try {
      const existingUrls = new Set(state.sources.map((source) => source.url));
      const startingOrdinal = state.sources.length + 1;

      const result = await this.evidenceLedger.searchTargeted(
        query,
        existingUrls,
        startingOrdinal,
        { signal: this.signal },
      );

      for (const warning of result.warnings) {
        warnings.push(warning);
        this.runStore.appendEvent(runId, {
          event: RESEARCH_RUN_EVENT.WARNING_ADDED,
          data: { contractVersion: 1, warning },
        });
      }

      if (result.sources.length > 0) {
        state.sources.push(...result.sources);
        state.evidence.push(...result.evidence);
        this.runStore.appendEvent(runId, {
          event: RESEARCH_RUN_EVENT.EVIDENCE_ACCEPTED,
          data: {
            contractVersion: 1,
            query,
            sourceIds: result.sources.map((source) => source.sourceId),
            evidenceIds: result.evidence.map((evidence) => evidence.evidenceId),
          },
        });
      } else {
        this.runStore.appendEvent(runId, {
          event: RESEARCH_RUN_EVENT.EVIDENCE_REJECTED,
          data: {
            contractVersion: 1,
            query,
            reason: "no_sources_returned",
          },
        });
      }

      success = result.success && result.sources.length > 0;
    } catch (error) {
      const warning: ResearchWarning = {
        code: "SEARCH_FAILED",
        message: `Search failed: ${toErrorMessage(error)}`,
      };
      warnings.push(warning);
      this.runStore.appendEvent(runId, {
        event: RESEARCH_RUN_EVENT.WARNING_ADDED,
        data: { contractVersion: 1, warning },
      });
      this.runStore.appendEvent(runId, {
        event: RESEARCH_RUN_EVENT.EVIDENCE_REJECTED,
        data: {
          contractVersion: 1,
          query,
          reason: warning.message,
        },
      });
    }

    budget.searchesUsed += 1;
    state.searchQueries.push(query);
    return success;
  }

  private async executeAnalysis(
    runId: string,
    action: AgentAnalyzeAction,
    state: AgentState,
    budget: AgentBudget,
    debate: DebateEntry[],
    warnings: ResearchWarning[],
  ): Promise<boolean> {
    const prompt = this.buildAnalysisPrompt(
      state.query,
      action.focus,
      state.sources,
      debate,
    );

    const callResult = await this.callModelWithRetry({
      runId,
      model: action.model,
      prompt,
      systemPrompt:
        "You are a research analyst. Ground every claim in provided evidence sources using [S<ordinal>] citations.",
      label: "analysis",
    });

    budget.analysisCallsUsed += 1;

    if (!callResult.success) {
      const warning: ResearchWarning = {
        code: "ANALYSIS_FAILED",
        message: `${action.model} analysis failed: ${callResult.error}`,
        model: action.model,
      };
      warnings.push(warning);
      this.runStore.appendEvent(runId, {
        event: RESEARCH_RUN_EVENT.WARNING_ADDED,
        data: { contractVersion: 1, warning },
      });
      return false;
    }

    const citations = this.extractSourceIds(callResult.output, state.sources);
    const entry: DebateEntry = {
      id: randomUUID(),
      round: state.iteration,
      model: action.model,
      type: "opening",
      content: callResult.output,
      citations,
      createdAt: new Date(),
    };

    debate.push(entry);
    this.emitPanelTurnRecorded(runId, "analysis", entry);

    state.analyses.push({
      id: entry.id,
      model: action.model,
      focus: action.focus,
      content: callResult.output,
      citations,
      iteration: state.iteration,
    });

    return true;
  }

  private async executeChallenge(
    runId: string,
    action: AgentChallengeAction,
    state: AgentState,
    budget: AgentBudget,
    debate: DebateEntry[],
    warnings: ResearchWarning[],
  ): Promise<boolean> {
    const prompt = this.buildChallengePrompt(
      state.query,
      action.claim,
      state.sources,
      debate,
    );

    const callResult = await this.callModelWithRetry({
      runId,
      model: action.model,
      prompt,
      systemPrompt:
        "You are a critical reviewer. Challenge weak reasoning, identify evidence gaps, and verify factual claims using [S<ordinal>] citations.",
      label: "challenge",
    });

    budget.analysisCallsUsed += 1;

    if (!callResult.success) {
      const warning: ResearchWarning = {
        code: "CHALLENGE_FAILED",
        message: `${action.model} challenge failed: ${callResult.error}`,
        model: action.model,
      };
      warnings.push(warning);
      this.runStore.appendEvent(runId, {
        event: RESEARCH_RUN_EVENT.WARNING_ADDED,
        data: { contractVersion: 1, warning },
      });
      return false;
    }

    const citations = this.extractSourceIds(callResult.output, state.sources);
    const entry: DebateEntry = {
      id: randomUUID(),
      round: state.iteration,
      model: action.model,
      type: "rebuttal",
      content: callResult.output,
      citations,
      createdAt: new Date(),
    };

    debate.push(entry);
    this.emitPanelTurnRecorded(runId, "challenge", entry);
    this.runStore.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.DISSENT_UPDATED,
      data: {
        contractVersion: 1,
        summary: truncate(entry.content, 280),
        round: state.iteration,
      },
    });

    return true;
  }

  // ---------------------------------------------------------------------------
  // Synthesis
  // ---------------------------------------------------------------------------

  private async synthesizeFromState(
    runId: string,
    state: AgentState,
    debate: DebateEntry[],
    warnings: ResearchWarning[],
  ): Promise<{
    success: boolean;
    answer: string;
    citationsValid: boolean;
    error?: string;
  }> {
    const synthesizers: DebateModel[] = ["claude-opus-4-6", "gpt-5.2"];
    const maxDebateRound = debate.reduce(
      (max, entry) => Math.max(max, entry.round),
      0,
    );

    for (const model of synthesizers) {
      const prompt = this.buildSynthesisPrompt(
        state.query,
        state.sources,
        debate,
      );

      const callResult = await this.callModelWithRetry({
        runId,
        model,
        prompt,
        systemPrompt:
          "You are the final synthesis model. Produce only valid JSON.",
        label: "synthesis",
      });

      if (!callResult.success) {
        const warning: ResearchWarning = {
          code: "SYNTHESIS_FAILED",
          message: `${model} synthesis failed: ${callResult.error}`,
          model,
        };
        warnings.push(warning);
        this.runStore.appendEvent(runId, {
          event: RESEARCH_RUN_EVENT.WARNING_ADDED,
          data: { contractVersion: 1, warning },
        });
        continue;
      }

      const parsed = parseSynthesisOutput(callResult.output);
      const citationsValid = this.validateCitationOrdinals(
        parsed.citations,
        state.sources,
      );

      if (!citationsValid) {
        const warning: ResearchWarning = {
          code: "SYNTHESIS_INVALID_CITATIONS",
          message: `${model} synthesis did not provide valid source citations.`,
          model,
        };
        warnings.push(warning);
        this.runStore.appendEvent(runId, {
          event: RESEARCH_RUN_EVENT.WARNING_ADDED,
          data: { contractVersion: 1, warning },
        });
        continue;
      }

      const entry: DebateEntry = {
        id: randomUUID(),
        round: maxDebateRound + 1,
        model,
        type: "synthesis",
        content: parsed.answer,
        citations: parsed.citations
          .map((ordinal) => sourceIdForOrdinal(ordinal, state.sources))
          .filter(
            (citation): citation is string => typeof citation === "string",
          ),
        createdAt: new Date(),
      };
      debate.push(entry);
      this.emitPanelTurnRecorded(runId, "synthesis", entry);

      return { success: true, answer: parsed.answer, citationsValid: true };
    }

    return {
      success: false,
      answer: "",
      citationsValid: false,
      error: "Primary and fallback synthesis paths failed.",
    };
  }

  // ---------------------------------------------------------------------------
  // Prompt builders
  // ---------------------------------------------------------------------------

  private buildAnalysisPrompt(
    query: string,
    focus: string,
    sources: ResearchSource[],
    debate: DebateEntry[],
  ): string {
    const parts = [
      `Research query: ${query}`,
      `Analysis focus: ${focus}`,
      "Analyze the evidence below. Ground every claim in sources using [S<ordinal>] citations.",
      "Return 3-5 key findings with supporting evidence.",
      "End with any gaps or uncertainties you've identified.",
      renderSourceContext(sources),
    ];

    if (debate.length > 0) {
      parts.push(renderDebateContext(debate));
    }

    return parts.join("\n\n");
  }

  private buildChallengePrompt(
    query: string,
    claim: string,
    sources: ResearchSource[],
    debate: DebateEntry[],
  ): string {
    const parts = [
      `Research query: ${query}`,
      `Claim to challenge: ${claim}`,
      "Critically examine this claim against the available evidence.",
      "Identify weaknesses, counterarguments, and areas where evidence is thin.",
      "Cite sources as [S<ordinal>].",
      renderSourceContext(sources),
    ];

    if (debate.length > 0) {
      parts.push(renderDebateContext(debate));
    }

    return parts.join("\n\n");
  }

  private buildSynthesisPrompt(
    query: string,
    sources: ResearchSource[],
    debate: DebateEntry[],
  ): string {
    const hasDiscussion = debate.some(
      (entry) => entry.type === "response" || entry.type === "consensus",
    );

    return [
      `User query: ${query}`,
      hasDiscussion
        ? "A panel of AI models (GPT, Claude, Gemini) has discussed and debated this research question. Synthesize the final answer from their consensus, resolved disagreements, and strongest evidence-backed claims."
        : "Synthesize the best-supported final answer from the shared evidence and research analyses.",
      "Return strict JSON only:",
      '{"answer":"...","citations":[1,2]}',
      "citations must be source ordinals and must refer to evidence used in answer.",
      "Use [[N]] inline citations in the answer text to reference sources by ordinal.",
      renderSourceContext(sources),
      renderDiscussionTranscript(debate),
    ].join("\n\n");
  }

  // ---------------------------------------------------------------------------
  // Event helpers
  // ---------------------------------------------------------------------------

  private emitActivityUpdated(
    runId: string,
    key: string,
    status:
      | "pending"
      | "active"
      | "completed"
      | "blocked"
      | "failed"
      | "cancelled",
    message?: string,
  ): void {
    this.runStore.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.ACTIVITY_UPDATED,
      data: {
        contractVersion: 1,
        activity: {
          key,
          status,
          message,
          updatedAt: new Date(),
        },
        phase: key,
      },
    });
  }

  private emitPanelTurnRecorded(
    runId: string,
    stage: string,
    entry: DebateEntry,
  ): void {
    this.runStore.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.PANEL_TURN_RECORDED,
      data: {
        contractVersion: 1,
        stage,
        turn: {
          id: entry.id,
          round: entry.round,
          model: entry.model,
          type: entry.type,
          content: entry.content,
          citations: [...entry.citations],
          createdAt: entry.createdAt,
        },
      },
    });
  }

  private emitActionProposed(
    runId: string,
    iteration: number,
    action: Record<string, unknown>,
  ): void {
    this.runStore.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.ACTION_PROPOSED,
      data: {
        contractVersion: 1,
        iteration,
        action,
      },
    });
  }

  private emitActionSelected(
    runId: string,
    iteration: number,
    action: Record<string, unknown>,
  ): void {
    this.runStore.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.ACTION_SELECTED,
      data: {
        contractVersion: 1,
        iteration,
        action,
      },
    });
  }

  private emitActionCompleted(
    runId: string,
    iteration: number,
    actionType: string,
    success: boolean,
    detail?: string,
  ): void {
    this.runStore.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.ACTION_COMPLETED,
      data: {
        contractVersion: 1,
        iteration,
        actionType,
        success,
        detail,
      },
    });
  }

  private emitStepStart(runId: string, stepId: string, name: string): void {
    this.runStore.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.STEP_UPSERTED,
      data: {
        contractVersion: 1,
        step: {
          id: stepId,
          name,
          status: "running",
          startedAt: new Date(),
        },
      },
    });
  }

  private emitStepDone(
    runId: string,
    stepId: string,
    status: "completed" | "failed" | "skipped",
  ): void {
    this.runStore.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.STEP_STATUS_UPDATED,
      data: {
        contractVersion: 1,
        stepPatch: {
          stepId,
          status,
          completedAt: new Date(),
        },
      },
    });
  }

  private emitStepPending(runId: string, stepId: string, name: string): void {
    this.runStore.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.STEP_UPSERTED,
      data: {
        contractVersion: 1,
        step: {
          id: stepId,
          name,
          status: "pending",
        },
      },
    });
  }

  private emitBudgetUpdate(
    runId: string,
    budget: AgentBudget,
    acceptedSources: number,
  ): void {
    this.runStore.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.BUDGET_UPDATED,
      data: {
        contractVersion: 1,
        budget: {
          maxQueries: budget.maxSearches,
          usedQueries: budget.searchesUsed,
          maxSources: budget.maxSearches * 8,
          acceptedSources,
          maxRounds: budget.maxIterations,
          completedRounds: budget.iterationsUsed,
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Provider dispatch (preserved from original)
  // ---------------------------------------------------------------------------

  private throwIfAborted(): void {
    if (this.signal?.aborted) {
      throw new Error("Research run aborted");
    }
  }

  private async callModelWithRetry(options: {
    runId: string;
    model: DebateModel;
    prompt: string;
    systemPrompt: string;
    label: string;
  }): Promise<
    { success: true; output: string } | { success: false; error: string }
  > {
    const { runId, model, prompt, systemPrompt, label } = options;
    const firstAttempt = await this.callModel({
      runId,
      model,
      prompt,
      systemPrompt,
      label,
    });

    if (firstAttempt.success) {
      return firstAttempt;
    }

    if (!firstAttempt.transient) {
      return { success: false, error: firstAttempt.error };
    }

    const retryWarning: ResearchWarning = {
      code: "MODEL_RETRY",
      message: `Retrying transient ${label} failure for ${model}.`,
      model,
    };
    this.runStore.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.WARNING_ADDED,
      data: { contractVersion: 1, warning: retryWarning },
    });

    const retryAttempt = await this.callModel({
      runId,
      model,
      prompt,
      systemPrompt,
      label,
    });

    if (retryAttempt.success) {
      return retryAttempt;
    }

    return { success: false, error: retryAttempt.error };
  }

  private async callModel(options: {
    runId: string;
    model: DebateModel;
    prompt: string;
    systemPrompt: string;
    label: string;
  }): Promise<
    | { success: true; output: string }
    | { success: false; error: string; transient: boolean }
  > {
    const { runId, model, prompt, systemPrompt } = options;

    try {
      const result = await this.dispatchProviderCall({
        runId,
        model,
        prompt,
        systemPrompt,
      });
      const terminalError = toTerminalError(result);
      if (terminalError) {
        return {
          success: false,
          error: terminalError,
          transient: isTransientProviderFailure(result, terminalError),
        };
      }
      return { success: true, output: result.output };
    } catch (error) {
      const message = toErrorMessage(error);
      return {
        success: false,
        error: message,
        transient: isTransientErrorMessage(message),
      };
    }
  }

  private dispatchProviderCall(options: {
    runId: string;
    model: DebateModel;
    prompt: string;
    systemPrompt: string;
  }): Promise<GuardedProviderStreamResult> {
    const { runId, model, prompt, systemPrompt } = options;

    if (model === "gpt-5.2") {
      const messages: { role: "system" | "user"; content: string }[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ];
      return runGuardedProviderStream({
        provider: "openai:gpt-5.2",
        requestId: runId,
        logger: this.logger,
        overallTimeoutMs: this.providerOverallTimeoutMs,
        firstChunkTimeoutMs: this.providerFirstChunkTimeoutMs,
        externalAbortSignal: this.signal,
        startStream: async ({ signal }) => {
          const stream = await this.openai.chat.completions.create(
            {
              model: resolveOpenAiUpstreamModel("gpt-5.2"),
              max_completion_tokens: 4096,
              messages,
              stream: true,
            },
            { signal },
          );
          return { stream };
        },
        getChunkText: (chunk) => chunk.choices[0]?.delta?.content,
        onChunk: () => undefined,
      });
    }

    if (model === "claude-opus-4-6") {
      return runGuardedProviderStream({
        provider: "anthropic:claude-opus-4-6",
        requestId: runId,
        logger: this.logger,
        overallTimeoutMs: this.providerOverallTimeoutMs,
        firstChunkTimeoutMs: this.providerFirstChunkTimeoutMs,
        externalAbortSignal: this.signal,
        startStream: async () => {
          const stream = this.anthropic.messages.stream({
            model: resolveAnthropicUpstreamModel("claude-opus-4-6"),
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: "user", content: prompt }],
          });
          return { stream, abort: () => stream.abort() };
        },
        getChunkText: (event) => {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            return event.delta.text;
          }
          return null;
        },
        onChunk: () => undefined,
      });
    }

    return runGuardedProviderStream({
      provider: "gemini:gemini-3.1-pro-preview",
      requestId: runId,
      logger: this.logger,
      overallTimeoutMs: this.geminiOverallTimeoutMs,
      firstChunkTimeoutMs: this.geminiFirstChunkTimeoutMs,
      externalAbortSignal: this.signal,
      startStream: async ({ signal }) => {
        const stream = (await this.gemini.models.generateContentStream({
          model: resolveGeminiUpstreamModel("gemini-3.1-pro-preview"),
          contents: [
            { role: "user", parts: [{ text: `${systemPrompt}\n\n${prompt}` }] },
          ],
          config: {
            maxOutputTokens: 4096,
            abortSignal: signal,
          },
        })) as AsyncIterable<unknown>;
        return { stream };
      },
      getChunkText: (chunk) => getGeminiChunkText(chunk),
      onChunk: () => undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers (preserved from original)
  // ---------------------------------------------------------------------------

  private extractSourceIds(
    content: string,
    sources: ResearchSource[],
  ): string[] {
    const matches = content.matchAll(/\[S(\d+)\]/g);
    const ids = new Set<string>();
    for (const match of matches) {
      const ordinal = Number.parseInt(match[1] ?? "", 10);
      if (Number.isNaN(ordinal)) {
        continue;
      }
      const sourceId = sourceIdForOrdinal(ordinal, sources);
      if (sourceId) {
        ids.add(sourceId);
      }
    }
    return [...ids];
  }

  private validateCitationOrdinals(
    ordinals: number[],
    sources: ResearchSource[],
  ): boolean {
    if (ordinals.length === 0) {
      return false;
    }
    const sourceOrdinals = new Set(sources.map((source) => source.ordinal));
    return ordinals.every((ordinal) => sourceOrdinals.has(ordinal));
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function getGeminiChunkText(chunk: unknown): string | null {
  const c = chunk as {
    text?: string;
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    }>;
  };

  if (typeof c.text === "string" && c.text.length > 0) {
    return c.text;
  }

  const parts = c.candidates?.[0]?.content?.parts;
  if (!parts) return null;

  let out = "";
  for (const part of parts) {
    if (part.thought) continue;
    if (typeof part.text === "string" && part.text.length > 0) {
      out += part.text;
    }
  }

  return out.length > 0 ? out : null;
}

function renderSourceContext(sources: ResearchSource[]): string {
  const lines = sources.map(
    (source) =>
      `[S${source.ordinal}] ${source.title} (${source.domain}) ${source.url}`,
  );
  return `Evidence ledger sources:\n${lines.join("\n")}`;
}

function renderDebateContext(entries: DebateEntry[]): string {
  if (entries.length === 0) {
    return "No prior analysis entries.";
  }

  return [
    "Prior analysis entries:",
    ...entries.map((entry) => {
      return `- round=${entry.round} model=${entry.model} type=${entry.type} citations=${
        entry.citations.join(",") || "none"
      }\n${entry.content}`;
    }),
  ].join("\n");
}

function renderDiscussionTranscript(entries: DebateEntry[]): string {
  if (entries.length === 0) {
    return "No prior discussion.";
  }

  const byRound = new Map<number, DebateEntry[]>();
  for (const entry of entries) {
    const existing = byRound.get(entry.round) ?? [];
    byRound.set(entry.round, [...existing, entry]);
  }

  const parts: string[] = ["=== Panel Discussion Transcript ==="];
  for (const [round, roundEntries] of [...byRound.entries()].sort(
    ([a], [b]) => a - b,
  )) {
    parts.push(`--- Round ${round} ---`);
    for (const entry of roundEntries) {
      const name = getModelLabel(entry.model);
      parts.push(`**${name}** [${entry.type}]:\n${entry.content}`);
    }
  }

  return parts.join("\n\n");
}

function sourceIdForOrdinal(
  ordinal: number,
  sources: ResearchSource[],
): string | null {
  const source = sources.find((item) => item.ordinal === ordinal);
  return source?.sourceId ?? null;
}

function parseSynthesisOutput(output: string): {
  answer: string;
  citations: number[];
} {
  const maybeJson = output.trim();

  try {
    const parsed = JSON.parse(maybeJson) as {
      answer?: unknown;
      citations?: unknown;
    };
    const answer =
      typeof parsed.answer === "string" ? parsed.answer.trim() : "";
    const citationsRaw = Array.isArray(parsed.citations)
      ? parsed.citations
      : [];
    const citations = citationsRaw
      .map((citation) =>
        typeof citation === "number"
          ? citation
          : typeof citation === "string"
            ? Number.parseInt(citation, 10)
            : Number.NaN,
      )
      .filter((citation) => Number.isInteger(citation) && citation > 0);

    return { answer, citations };
  } catch {
    return { answer: "", citations: [] };
  }
}

function isTransientProviderFailure(
  result: GuardedProviderStreamResult,
  terminalError: string,
): boolean {
  if (result.status === "timed_out" || result.status === "aborted") {
    return true;
  }
  return isTransientErrorMessage(terminalError);
}

function isTransientErrorMessage(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("temporar") ||
    text.includes("network") ||
    text.includes("aborted") ||
    text.includes("rate limit")
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function createNoopLogger(): {
  info: (bindings: Record<string, unknown>, message?: string) => void;
  warn: (bindings: Record<string, unknown>, message?: string) => void;
  error: (bindings: Record<string, unknown>, message?: string) => void;
} {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trimEnd()}…`;
}
