/**
 * When `AGENTROUTER_API_KEY` is set, requests go to agentrouter.org, which uses
 * different model IDs than our app-level aliases (Replit modelfarm names).
 * Map internal IDs to upstream IDs only in that mode; Replit AI integrations
 * keep the original names.
 */

export function isAgentRouterUpstreamMode(): boolean {
  return Boolean(process.env.AGENTROUTER_API_KEY);
}

/** App alias → OpenAI-compatible id on AgentRouter */
const OPENAI_AGENTROUTER: Record<string, string> = {
  "gpt-5.2": "gpt-5.1",
};

/** App alias → Anthropic model id on AgentRouter */
const ANTHROPIC_AGENTROUTER: Record<string, string> = {
  "claude-opus-4-6": "claude-opus-4-20250514",
};

/** App alias → Gemini model id on AgentRouter */
const GEMINI_AGENTROUTER: Record<string, string> = {
  "gemini-3.1-pro-preview": "gemini-3-pro-preview",
};

export function resolveOpenAiUpstreamModel(internalModel: string): string {
  if (!isAgentRouterUpstreamMode()) {
    return internalModel;
  }
  return OPENAI_AGENTROUTER[internalModel] ?? internalModel;
}

export function resolveAnthropicUpstreamModel(internalModel: string): string {
  if (!isAgentRouterUpstreamMode()) {
    return internalModel;
  }
  return ANTHROPIC_AGENTROUTER[internalModel] ?? internalModel;
}

export function resolveGeminiUpstreamModel(internalModel: string): string {
  if (!isAgentRouterUpstreamMode()) {
    return internalModel;
  }
  return GEMINI_AGENTROUTER[internalModel] ?? internalModel;
}
