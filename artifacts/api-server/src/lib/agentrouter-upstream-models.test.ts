import { afterEach, describe, expect, it } from "vitest";
import {
  resolveAnthropicUpstreamModel,
  resolveGeminiUpstreamModel,
  resolveOpenAiUpstreamModel,
} from "./agentrouter-upstream-models.js";

describe("agentrouter-upstream-models", () => {
  const origKey = process.env.AGENTROUTER_API_KEY;

  afterEach(() => {
    if (origKey === undefined) {
      delete process.env.AGENTROUTER_API_KEY;
    } else {
      process.env.AGENTROUTER_API_KEY = origKey;
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
    expect(resolveOpenAiUpstreamModel("gpt-5.2")).toBe("gpt-5.1");
    expect(resolveAnthropicUpstreamModel("claude-opus-4-6")).toBe(
      "claude-opus-4-20250514",
    );
    expect(resolveGeminiUpstreamModel("gemini-3.1-pro-preview")).toBe(
      "gemini-3-pro-preview",
    );
  });
});
