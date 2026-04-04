/**
 * When requests actually go through agentrouter.org, model IDs differ from our
 * app-level aliases. Map internal IDs to upstream IDs only in that mode;
 * direct AI integrations keep the original names.
 *
 * AgentRouter is only used as a fallback when direct AI integration keys are
 * not configured for a given provider.
 */

function hasDirectOpenAiKeys(): boolean {
  return Boolean(
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY &&
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  );
}

function hasDirectAnthropicKeys(): boolean {
  return Boolean(
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY &&
      process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  );
}

function hasDirectGeminiKeys(): boolean {
  return Boolean(
    process.env.AI_INTEGRATIONS_GEMINI_API_KEY &&
      process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  );
}

function isAgentRouterUpstreamMode(): boolean {
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
