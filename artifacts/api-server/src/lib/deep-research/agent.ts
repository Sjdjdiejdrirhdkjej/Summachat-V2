import type {
  ResearchEvidence,
  ResearchSource,
} from "@workspace/api-zod";

export const MODEL_IDS = [
  "gpt-5.2",
  "claude-opus-4-6",
  "gemini-3.1-pro-preview",
] as const;

export type DebateModel = (typeof MODEL_IDS)[number];

export type AgentSearchAction = {
  type: "search";
  query: string;
  reason: string;
};

export type AgentAnalyzeAction = {
  type: "analyze";
  focus: string;
  model: DebateModel;
  reason: string;
};

export type AgentChallengeAction = {
  type: "challenge";
  claim: string;
  model: DebateModel;
  reason: string;
};

export type AgentAction =
  | AgentSearchAction
  | AgentAnalyzeAction
  | AgentChallengeAction;

export type AgentDecision = {
  reasoning: string;
  actions: AgentAction[];
  readyToSynthesize: boolean;
  confidence: "low" | "medium" | "high";
};

export type AnalysisEntry = {
  id: string;
  model: DebateModel;
  focus: string;
  content: string;
  citations: string[];
  iteration: number;
};

export type ActionHistoryEntry = {
  action: string;
  success: boolean;
  detail: string;
};

export type AgentState = {
  query: string;
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
  analyses: AnalysisEntry[];
  iteration: number;
  searchQueries: string[];
  actionHistory: ActionHistoryEntry[];
  confidence: "low" | "medium" | "high";
};

export type AgentBudget = {
  maxIterations: number;
  maxSearches: number;
  maxAnalysisCalls: number;
  maxDeliberationCalls: number;
  iterationsUsed: number;
  searchesUsed: number;
  analysisCallsUsed: number;
  deliberationCallsUsed: number;
};

export const DEFAULT_AGENT_BUDGET: AgentBudget = {
  maxIterations: 10,
  maxSearches: 5,
  maxAnalysisCalls: 6,
  maxDeliberationCalls: 15,
  iterationsUsed: 0,
  searchesUsed: 0,
  analysisCallsUsed: 0,
  deliberationCallsUsed: 0,
};

export const MAX_DISCUSSION_ROUNDS = 2;

export function createInitialAgentState(query: string): AgentState {
  return {
    query,
    sources: [],
    evidence: [],
    analyses: [],
    iteration: 0,
    searchQueries: [],
    actionHistory: [],
    confidence: "low",
  };
}

export function shouldForceSynthesize(
  state: AgentState,
  budget: AgentBudget,
): boolean {
  const iterationThreshold = Math.floor(budget.maxIterations * 0.8);
  const searchThreshold = Math.floor(budget.maxSearches * 0.8);
  const analysisThreshold = Math.floor(budget.maxAnalysisCalls * 0.8);

  if (budget.iterationsUsed >= iterationThreshold) return true;
  if (budget.searchesUsed >= searchThreshold) return true;
  if (budget.analysisCallsUsed >= analysisThreshold) return true;

  if (
    state.confidence === "high" &&
    state.sources.length >= 2 &&
    state.analyses.length >= 1
  ) {
    return true;
  }

  if (state.actionHistory.length >= 3) {
    const recent = state.actionHistory.slice(-3);
    if (recent.every((entry) => !entry.success)) return true;
  }

  return false;
}

export function canSearch(budget: AgentBudget): boolean {
  return budget.searchesUsed < budget.maxSearches;
}

export function canCallModel(budget: AgentBudget): boolean {
  return budget.analysisCallsUsed < budget.maxAnalysisCalls;
}

export function canDeliberate(budget: AgentBudget): boolean {
  return budget.deliberationCallsUsed < budget.maxDeliberationCalls;
}

export function getModelLabel(model: string): string {
  if (model.includes("gpt")) return "GPT";
  if (model.includes("claude")) return "Claude";
  if (model.includes("gemini")) return "Gemini";
  return model;
}

function summarizeSources(sources: ResearchSource[]): string {
  if (sources.length === 0) return "None";
  const domains = [...new Set(sources.map((source) => source.domain))];
  return `${sources.length} sources from [${domains.join(", ")}]`;
}

function summarizeAnalyses(analyses: AnalysisEntry[]): string {
  if (analyses.length === 0) return "None";
  return analyses
    .map(
      (analysis) =>
        `- ${analysis.model}: ${analysis.focus} (iter ${analysis.iteration})`,
    )
    .join("\n");
}

export const DECISION_SYSTEM_PROMPT =
  "You are an autonomous research agent deciding what to investigate next. Analyze the current state carefully and choose strategic actions to build a thorough, well-evidenced answer. Return strict JSON only, no markdown fences.";

export const DECISION_MAX_TOKENS = 1024;

export function buildDecisionPrompt(
  state: AgentState,
  budget: AgentBudget,
): string {
  const searchesLeft = budget.maxSearches - budget.searchesUsed;
  const modelCallsLeft = budget.maxAnalysisCalls - budget.analysisCallsUsed;
  const iterationsLeft = budget.maxIterations - budget.iterationsUsed;

  const recentActions =
    state.actionHistory
      .slice(-5)
      .map(
        (entry) =>
          `${entry.action}: ${entry.success ? "\u2713" : "\u2717"} ${entry.detail}`,
      )
      .join("\n") || "None yet";

  return [
    `Research query: ${state.query}`,
    "",
    "=== Current State ===",
    `Evidence: ${summarizeSources(state.sources)}`,
    `Analyses completed: ${state.analyses.length}`,
    summarizeAnalyses(state.analyses),
    `Search queries used: [${state.searchQueries.map((q) => `"${q}"`).join(", ")}]`,
    `Current confidence: ${state.confidence}`,
    "",
    "=== Budget Remaining ===",
    `Searches: ${searchesLeft}/${budget.maxSearches}`,
    `Model calls: ${modelCallsLeft}/${budget.maxAnalysisCalls}`,
    `Iterations: ${iterationsLeft}/${budget.maxIterations}`,
    "",
    "=== Recent Actions ===",
    recentActions,
    "",
    "Choose 1-3 actions. Available:",
    '- search: {"type":"search","query":"specific targeted query","reason":"why this search helps"}',
    '- analyze: {"type":"analyze","focus":"what aspect to analyze","model":"gpt-5.2|claude-opus-4-6|gemini-3.1-pro-preview","reason":"why"}',
    '- challenge: {"type":"challenge","claim":"specific claim to verify","model":"model-name","reason":"why this needs verification"}',
    "",
    "Rules:",
    "- Search first if no evidence collected yet",
    "- Need evidence and at least 1 analysis before setting readyToSynthesize=true",
    "- Use diverse models — rotate between gpt-5.2, claude-opus-4-6, gemini-3.1-pro-preview",
    "- Generate targeted search queries that fill specific knowledge gaps",
    "- Set readyToSynthesize=true when evidence is sufficient and well-verified",
    "",
    'Return JSON: {"reasoning":"...","actions":[...],"readyToSynthesize":false,"confidence":"low|medium|high"}',
  ].join("\n");
}

function isValidModel(value: unknown): value is DebateModel {
  return (
    typeof value === "string" &&
    (MODEL_IDS as readonly string[]).includes(value)
  );
}

export function parseAgentDecision(raw: string): AgentDecision | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const reasoning =
      typeof parsed.reasoning === "string" ? parsed.reasoning : "";
    const readyToSynthesize = parsed.readyToSynthesize === true;

    const rawConfidence =
      typeof parsed.confidence === "string" ? parsed.confidence : "low";
    const confidence = (["low", "medium", "high"] as const).includes(
      rawConfidence as AgentDecision["confidence"],
    )
      ? (rawConfidence as AgentDecision["confidence"])
      : "low";

    const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
    const actions: AgentAction[] = [];

    for (const rawAction of rawActions.slice(0, 3)) {
      if (!rawAction || typeof rawAction !== "object") continue;
      const action = rawAction as Record<string, unknown>;
      const type = action.type;

      if (type === "search" && typeof action.query === "string") {
        actions.push({
          type: "search",
          query: action.query,
          reason: typeof action.reason === "string" ? action.reason : "",
        });
      } else if (
        type === "analyze" &&
        typeof action.focus === "string" &&
        isValidModel(action.model)
      ) {
        actions.push({
          type: "analyze",
          focus: action.focus,
          model: action.model,
          reason: typeof action.reason === "string" ? action.reason : "",
        });
      } else if (
        type === "challenge" &&
        typeof action.claim === "string" &&
        isValidModel(action.model)
      ) {
        actions.push({
          type: "challenge",
          claim: action.claim,
          model: action.model,
          reason: typeof action.reason === "string" ? action.reason : "",
        });
      }
    }

    if (actions.length === 0 && !readyToSynthesize) {
      return null;
    }

    return { reasoning, actions, readyToSynthesize, confidence };
  } catch {
    return null;
  }
}
