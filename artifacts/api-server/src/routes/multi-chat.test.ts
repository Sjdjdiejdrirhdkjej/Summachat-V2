import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GuardedProviderStreamResult } from "../lib/provider-stream-guard.js";
import app from "../app";

type SseEvent = Record<string, unknown>;

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {},
}));

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {},
}));

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: {},
}));

const invocationCount = new Map<string, number>();
let openAiScenario: "retryable-first-error" | "non-retryable-error" =
  "retryable-first-error";

function resultFor(
  status: GuardedProviderStreamResult["status"],
  output: string,
  errorMessage?: string,
): GuardedProviderStreamResult {
  return {
    status,
    output,
    firstChunkMs: 1,
    totalMs: 2,
    error: errorMessage ? new Error(errorMessage) : undefined,
  };
}

vi.mock("../lib/provider-stream-guard.js", () => {
  return {
    runGuardedProviderStream: vi.fn(
      async (options: { provider: string }): Promise<GuardedProviderStreamResult> => {
        const current = (invocationCount.get(options.provider) ?? 0) + 1;
        invocationCount.set(options.provider, current);

        if (options.provider === "openai:gpt-5.2") {
          if (openAiScenario === "non-retryable-error") {
            return resultFor("errored", "", "Invalid API key");
          }
          if (current === 1) {
            return resultFor(
              "errored",
              "",
              "Incomplete JSON segment at the end",
            );
          }
          return resultFor("success", "Recovered GPT output");
        }

        if (options.provider === "anthropic:claude-opus-4-6") {
          return resultFor("success", "Claude stable output");
        }

        if (options.provider === "anthropic:claude-opus-4-6-moderator") {
          return resultFor(
            "success",
            "Response 1 is the best. Side note: strongest answer.",
          );
        }

        if (options.provider === "anthropic:claude-opus-4-6-summary") {
          return resultFor("success", "Final precise answer");
        }

        return resultFor("success", "ok");
      },
    ),
    toTerminalError: (
      result: GuardedProviderStreamResult,
    ): string | null => {
      if (result.status === "success") return null;
      if (result.status === "timed_out") return "Provider stream timed out";
      if (result.status === "aborted") return "Provider stream aborted";
      if (result.status === "empty") return "Provider returned empty output";
      return result.error?.message ?? "Provider stream failed";
    },
  };
});

function parseSseEvents(raw: string): SseEvent[] {
  return raw
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .map((json) => JSON.parse(json) as SseEvent);
}

describe("multi-chat retry handling", () => {
  beforeEach(() => {
    invocationCount.clear();
    openAiScenario = "retryable-first-error";
  });

  it("retries retriable provider failures in precise mode", async () => {
    const response = await request(app).post("/api/multi-chat").send({
      prompt: "Give me a precise answer",
      models: ["gpt-5.2", "claude-opus-4-6"],
      webSearch: false,
      mode: "chat",
      history: [],
    });

    expect(response.status).toBe(200);
    const events = parseSseEvents(response.text);

    const gptStarts = events.filter(
      (event) =>
        event.type === "model_start" &&
        event.model === "gpt-5.2",
    );
    expect(gptStarts).toHaveLength(2);
    expect(gptStarts[0]?.attempt).toBe(1);
    expect(gptStarts[1]?.attempt).toBe(2);

    const gptErrors = events.filter(
      (event) =>
        event.type === "model_error" &&
        event.model === "gpt-5.2",
    );
    expect(gptErrors).toHaveLength(0);

    const gptDone = events.find(
      (event) => event.type === "model_done" && event.model === "gpt-5.2",
    );
    expect(gptDone).toBeTruthy();

    const summaryDone = events.find((event) => event.type === "summary_done");
    const doneEvent = events.find((event) => event.type === "done");
    expect(summaryDone).toBeTruthy();
    expect(doneEvent).toBeTruthy();
  });

  it("does not retry non-retriable provider failures", async () => {
    openAiScenario = "non-retryable-error";

    const response = await request(app).post("/api/multi-chat").send({
      prompt: "Give me a precise answer",
      models: ["gpt-5.2", "claude-opus-4-6"],
      webSearch: false,
      mode: "chat",
      history: [],
    });

    expect(response.status).toBe(200);
    const events = parseSseEvents(response.text);

    const gptStarts = events.filter(
      (event) =>
        event.type === "model_start" &&
        event.model === "gpt-5.2",
    );
    expect(gptStarts).toHaveLength(1);
    expect(gptStarts[0]?.attempt).toBe(1);

    const gptErrors = events.filter(
      (event) =>
        event.type === "model_error" &&
        event.model === "gpt-5.2",
    );
    expect(gptErrors).toHaveLength(1);
  });
});
