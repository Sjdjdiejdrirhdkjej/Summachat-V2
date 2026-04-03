import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic client with lazy initialization.
 *
 * Resolution order:
 * 1. AI_INTEGRATIONS_ANTHROPIC_API_KEY + AI_INTEGRATIONS_ANTHROPIC_BASE_URL (direct)
 * 2. AGENTROUTER_API_KEY  → agentrouter.org (or AGENTROUTER_PROXY_URL)
 */

let client: Anthropic | null = null;
let initialized = false;
let initError: Error | null = null;

const wafGuardedFetch: typeof globalThis.fetch = async (input, init) => {
  const response = await globalThis.fetch(input, init);
  const ct = response.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    throw new Error(
      `API endpoint returned HTML instead of JSON — the upstream proxy may be blocked by a firewall (URL: ${url})`,
    );
  }
  return response;
};

function getClient(): Anthropic | null {
  if (initialized) {
    return client;
  }

  initialized = true;

  // Path 1: Replit AI Integrations (direct, preferred)
  const integrationsKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  const integrationsBase = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  if (integrationsKey && integrationsBase) {
    client = new Anthropic({ apiKey: integrationsKey, baseURL: integrationsBase });
    return client;
  }

  // Path 2: AgentRouter (fallback proxy)
  const agentRouterKey = process.env.AGENTROUTER_API_KEY;
  if (agentRouterKey) {
    const proxyUrl = process.env.AGENTROUTER_PROXY_URL;
    const baseURL = proxyUrl
      ? `${proxyUrl.replace(/\/$/, "")}/`
      : "https://agentrouter.org/";

    client = new Anthropic({ apiKey: agentRouterKey, baseURL, fetch: wafGuardedFetch });
    return client;
  }

  initError = new Error(
    "Anthropic is not configured. Set AGENTROUTER_API_KEY, or both AI_INTEGRATIONS_ANTHROPIC_API_KEY and AI_INTEGRATIONS_ANTHROPIC_BASE_URL.",
  );
  return null;
}

export function isAnthropicConfigured(): boolean {
  return Boolean(
    process.env.AGENTROUTER_API_KEY ||
      (process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY &&
        process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL),
  );
}

export function getAnthropicClient(): Anthropic {
  const c = getClient();
  if (c) {
    return c;
  }

  throw (
    initError ??
    new Error("Anthropic is not configured.")
  );
}

export function tryGetAnthropicClient(): Anthropic | null {
  return getClient();
}

export function getAnthropicInitError(): Error | null {
  if (!initialized) {
    getClient();
  }
  return initError;
}

export const anthropic: Anthropic = new Proxy({} as Anthropic, {
  get(_target, prop, receiver) {
    const c = getAnthropicClient();
    const value = Reflect.get(c, prop, receiver);
    if (typeof value === "function") {
      return value.bind(c);
    }
    return value;
  },
});
