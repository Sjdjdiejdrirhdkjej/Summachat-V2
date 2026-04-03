import { GoogleGenAI } from "@google/genai";

/**
 * Gemini AI client with lazy initialization.
 *
 * Resolution order:
 * 1. AI_INTEGRATIONS_GEMINI_API_KEY + AI_INTEGRATIONS_GEMINI_BASE_URL (direct)
 * 2. AGENTROUTER_API_KEY  → agentrouter.org (or AGENTROUTER_PROXY_URL)
 */

let primaryClient: GoogleGenAI | null = null;
let primaryInitialized = false;
let primaryError: Error | null = null;
let activeSource: "agentrouter" | "ai-integrations" | null = null;

function getPrimaryClient(): GoogleGenAI | null {
  if (primaryInitialized) {
    return primaryClient;
  }

  primaryInitialized = true;

  // Path 1: Replit AI Integrations (direct, preferred)
  const integrationsKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const integrationsBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (integrationsKey && integrationsBase) {
    primaryClient = new GoogleGenAI({
      apiKey: integrationsKey,
      httpOptions: { apiVersion: "", baseUrl: integrationsBase },
    });
    activeSource = "ai-integrations";
    return primaryClient;
  }

  // Path 2: AgentRouter (fallback proxy)
  const agentRouterKey = process.env.AGENTROUTER_API_KEY;
  if (agentRouterKey) {
    const proxyUrl = process.env.AGENTROUTER_PROXY_URL;
    const baseUrl = proxyUrl
      ? `${proxyUrl.replace(/\/$/, "")}/`
      : "https://agentrouter.org/";

    primaryClient = new GoogleGenAI({
      apiKey: agentRouterKey,
      httpOptions: { apiVersion: "", baseUrl },
    });
    activeSource = "agentrouter";
    return primaryClient;
  }

  primaryError = new Error(
    "Gemini is not configured. Set AGENTROUTER_API_KEY, or both AI_INTEGRATIONS_GEMINI_API_KEY and AI_INTEGRATIONS_GEMINI_BASE_URL.",
  );
  return null;
}

export function isGeminiAvailable(): boolean {
  return Boolean(
    process.env.AGENTROUTER_API_KEY ||
      (process.env.AI_INTEGRATIONS_GEMINI_API_KEY &&
        process.env.AI_INTEGRATIONS_GEMINI_BASE_URL),
  );
}

export function getGeminiClient(): GoogleGenAI {
  const primary = getPrimaryClient();
  if (primary) {
    return primary;
  }

  throw (
    primaryError ??
    new Error("Gemini is not configured.")
  );
}

export const ai: GoogleGenAI = new Proxy({} as GoogleGenAI, {
  get(_target, prop, receiver) {
    const client = getGeminiClient();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});

export function getActiveProvider(): "agentrouter" | "ai-integrations" | null {
  if (getPrimaryClient()) {
    return activeSource;
  }
  return null;
}
