import { afterEach, describe, expect, it } from "vitest";
import {
  resolveAnthropicUpstreamModel,
  resolveGeminiUpstreamModel,
  resolveOpenAiUpstreamModel,
} from "./agentrouter-upstream-models.js";

function saveEnv(key: string): string | undefined {
  return process.env[key];
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

const DIRECT_KEYS = [
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
  "AI_INTEGRATIONS_ANTHROPIC_BASE_URL",
  "AI_INTEGRATIONS_GEMINI_API_KEY",
  "AI_INTEGRATIONS_GEMINI_BASE_URL",
] as const;

describe("agentrouter-upstream-models", () => {
  const origKey = saveEnv("AGENTROUTER_API_KEY");
  const origDirect = DIRECT_KEYS.map((k) => [k, saveEnv(k)] as const);

  afterEach(() => {
    restoreEnv("AGENTROUTER_API_KEY", origKey);
    for (const [k, v] of origDirect) {
      restoreEnv(k, v);
    }
  });

  it("passes through internal ids when AgentRouter is not configured", () => {
    delete process.env.AGENTROUTER_API_KEY;
    expect(resolveOpenAiUpstreamModel("gpt-5.2")).toBe("gpt-5.2");
    expect(resolveAnthropicUpstreamModel("claude-opus-4-6")).toBe(
      "claude-opus-4-6",
    );
    expect(resolveGeminiUpstreamModel("gemini-3.1-pro-preview")).toBe(
      "gemini-3.1-pro-preview",
    );
  });

  it("maps app aliases to AgentRouter upstream model ids", () => {
    process.env.AGENTROUTER_API_KEY = "test-key";
    for (const k of DIRECT_KEYS) {
      delete process.env[k];
    }
    expect(resolveOpenAiUpstreamModel("gpt-5.2")).toBe("gpt-5.1");
    expect(resolveAnthropicUpstreamModel("claude-opus-4-6")).toBe(
      "claude-opus-4-20250514",
    );
    expect(resolveGeminiUpstreamModel("gemini-3.1-pro-preview")).toBe(
      "gemini-3-pro-preview",
    );
  });

  it("maps when AgentRouter is configured even with direct keys present", () => {
    process.env.AGENTROUTER_API_KEY = "test-key";
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "direct-key";
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://direct";
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "direct-key";
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "https://direct";
    process.env.AI_INTEGRATIONS_GEMINI_API_KEY = "direct-key";
    process.env.AI_INTEGRATIONS_GEMINI_BASE_URL = "https://direct";
    expect(resolveOpenAiUpstreamModel("gpt-5.2")).toBe("gpt-5.1");
    expect(resolveAnthropicUpstreamModel("claude-opus-4-6")).toBe(
      "claude-opus-4-20250514",
    );
    expect(resolveGeminiUpstreamModel("gemini-3.1-pro-preview")).toBe(
      "gemini-3-pro-preview",
    );
  });
});
