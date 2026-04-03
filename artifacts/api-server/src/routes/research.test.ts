import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import app from "../app";

type SseEvent = {
  id: number;
  event: string;
  envelope: { id: number; event: string; data: Record<string, unknown> };
};

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {},
  tryGetOpenAiClient: () => ({}),
}));

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {},
  tryGetAnthropicClient: () => ({}),
}));

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: {},
  isGeminiAvailable: () => true,
}));

vi.mock("exa-js", () => ({
  default: class MockExa {
    constructor(_apiKey: string) {}
  },
}));

vi.mock("../lib/deep-research/orchestrator.js", async () => {
  return {
    ResearchOrchestrator: class MockResearchOrchestrator {
      private readonly runStore: {
        updateStatus: (runId: string, status: string) => void;
        appendEvent: (
          runId: string,
          event: { event: string; data: Record<string, unknown> },
        ) => void;
      };
      private readonly signal?: AbortSignal;

      constructor(options: {
        runStore: {
          updateStatus: (runId: string, status: string) => void;
          appendEvent: (
            runId: string,
            event: { event: string; data: Record<string, unknown> },
          ) => void;
        };
        signal?: AbortSignal;
      }) {
        this.runStore = options.runStore;
        this.signal = options.signal;
      }

      async runExistingRun(runId: string, query: string): Promise<void> {
        this.runStore.updateStatus(runId, "running");
        this.runStore.appendEvent(runId, {
          event: "activity.updated",
          data: {
            contractVersion: 1,
            phase: "evidence.collection",
            activity: {
              key: "evidence.collection",
              status: "active",
              updatedAt: new Date(),
            },
          },
        });

        const delayMs = query.includes("long-run") ? 300 : 50;
        const stepMs = 25;
        const steps = Math.ceil(delayMs / stepMs);

        for (let index = 0; index < steps; index += 1) {
          await sleep(stepMs);
          if (this.signal?.aborted) {
            throw new Error("Research run aborted");
          }

          this.runStore.appendEvent(runId, {
            event: "step.status.updated",
            data: {
              contractVersion: 1,
              stepPatch: {
                stepId: "mock-step",
                name: "mock-step",
                status: "running",
              },
            },
          });
        }

        if (this.signal?.aborted) {
          throw new Error("Research run aborted");
        }

        this.runStore.appendEvent(runId, {
          event: "result.ready",
          data: {
            contractVersion: 1,
            stopReason: "converged",
            result: {
              answer: `answer for ${query}`,
              sources: [],
              citationsValid: true,
              stopReason: "converged",
            },
          },
        });
        this.runStore.updateStatus(runId, "completed");
      }
    },
  };
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSse(text: string): SseEvent[] {
  return text
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const idLine = lines.find((line) => line.startsWith("id: "));
      const eventLine = lines.find((line) => line.startsWith("event: "));
      const dataLine = lines.find((line) => line.startsWith("data: "));

      if (!idLine || !eventLine || !dataLine) {
        throw new Error(`Malformed SSE chunk: ${chunk}`);
      }

      const id = Number.parseInt(idLine.slice(4), 10);
      const event = eventLine.slice(7);
      const envelope = JSON.parse(dataLine.slice(6)) as {
        id: number;
        event: string;
        data: Record<string, unknown>;
      };

      return { id, event, envelope };
    });
}

async function waitForRunStatus(
  runId: string,
  predicate: (status: string) => boolean,
  timeoutMs = 2_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await request(app)
      .get(`/api/research/runs/${runId}`)
      .expect(200)
      .then((response) => response.body as { status: string });

    if (predicate(snapshot.status)) {
      return snapshot.status;
    }

    await sleep(25);
  }

  throw new Error(`Timed out waiting for run ${runId} status`);
}

describe("research routes", () => {
  beforeEach(() => {
    process.env.EXA_API_KEY = "test-exa-key";
  });

  it("creates a run, streams events, and serves snapshots", async () => {
    const create = await request(app)
      .post("/api/research/runs")
      .send({ query: "short-run" })
      .expect(202);

    expect(create.body.runId).toEqual(expect.any(String));
    expect(create.body.eventsUrl).toBe(
      `/api/research/runs/${create.body.runId}/events`,
    );
    expect(create.body.snapshotUrl).toBe(
      `/api/research/runs/${create.body.runId}`,
    );
    expect(create.body.cancelUrl).toBe(
      `/api/research/runs/${create.body.runId}/cancel`,
    );

    await waitForRunStatus(
      create.body.runId,
      (status) => status === "completed",
    );

    const eventsResponse = await request(app)
      .get(create.body.eventsUrl)
      .expect(200);

    const events = parseSse(eventsResponse.text);
    expect(events.length).toBeGreaterThan(2);
    expect(events.every((item, index) => item.id === index + 1)).toBe(true);
    expect(events.every((item) => item.envelope.id === item.id)).toBe(true);
    expect(events.some((item) => item.event === "result.ready")).toBe(true);

    const snapshot = await request(app)
      .get(create.body.snapshotUrl)
      .expect(200);
    expect(snapshot.body.id).toBe(create.body.runId);
    expect(snapshot.body.status).toBe("completed");
    expect(snapshot.body.config.schemaVersion).toBe("research.v2");
    expect(
      snapshot.body.config.panel.map(
        (member: { modelId: string }) => member.modelId,
      ),
    ).toEqual(["gpt-5.2", "claude-opus-4-6", "gemini-3.1-pro-preview"]);
    expect(snapshot.body.config.allowedActions).toEqual([
      "search",
      "analyze",
      "challenge",
      "summarize",
    ]);
    expect(snapshot.body.result.answer).toBe("answer for short-run");
  });

  it("supports SSE replay with Last-Event-ID", async () => {
    const create = await request(app)
      .post("/api/research/runs")
      .send({ query: "replay-run" })
      .expect(202);

    await waitForRunStatus(
      create.body.runId,
      (status) => status === "completed",
    );

    const full = await request(app).get(create.body.eventsUrl).expect(200);
    const allEvents = parseSse(full.text);
    expect(allEvents.length).toBeGreaterThan(2);

    const replayFrom = allEvents[1]!.id;
    const replay = await request(app)
      .get(create.body.eventsUrl)
      .set("Last-Event-ID", String(replayFrom))
      .expect(200);
    const replayEvents = parseSse(replay.text);

    expect(replayEvents.length).toBeGreaterThan(0);
    expect(replayEvents.every((event) => event.id > replayFrom)).toBe(true);
    expect(replayEvents.length).toBeLessThan(allEvents.length);
  });

  it("keeps run active across disconnect and only cancels on explicit cancel", async () => {
    const create = await request(app)
      .post("/api/research/runs")
      .send({ query: "long-run" })
      .expect(202);

    const server = app.listen(0);
    const address = server.address() as AddressInfo;
    const eventsUrl = new URL(
      create.body.eventsUrl,
      `http://127.0.0.1:${address.port}`,
    );

    await new Promise<void>((resolve) => {
      const streamRequest = http.request(
        eventsUrl,
        {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
          },
        },
        (response) => {
          response.once("data", () => {
            response.destroy();
            resolve();
          });
          response.on("error", () => resolve());
        },
      );

      streamRequest.on("error", () => resolve());
      streamRequest.end();
    });

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    const afterDisconnect = await request(app)
      .get(create.body.snapshotUrl)
      .expect(200)
      .then((response) => response.body as { status: string });
    expect(["running", "queued", "cancelling", "completed"]).toContain(
      afterDisconnect.status,
    );
    expect(afterDisconnect.status).not.toBe("cancelled");

    const cancelResponse = await request(app)
      .post(create.body.cancelUrl)
      .expect(202);
    expect(["cancelling", "cancelled"]).toContain(cancelResponse.body.status);

    await waitForRunStatus(
      create.body.runId,
      (status) => status === "cancelled",
      3_000,
    );

    const replayAfterCancel = await request(app)
      .get(create.body.eventsUrl)
      .expect(200);
    const eventsAfterCancel = parseSse(replayAfterCancel.text);
    const statusEvents = eventsAfterCancel
      .filter((event) => event.event === "status.updated")
      .map((event) => event.envelope.data["status"]);

    expect(statusEvents).toContain("cancelling");
    expect(statusEvents).toContain("cancelled");
    expect(statusEvents).not.toContain("completed");
  });

  it("resolves legacy create options into a persisted run config", async () => {
    const create = await request(app)
      .post("/api/research/runs")
      .send({
        query: "legacy-budget-overrides",
        options: {
          maxSources: 9,
          maxRounds: 4,
        },
      })
      .expect(202);

    await waitForRunStatus(
      create.body.runId,
      (status) => status === "completed",
    );

    const snapshot = await request(app)
      .get(create.body.snapshotUrl)
      .expect(200)
      .then(
        (response) =>
          response.body as {
            budget: {
              maxQueries: number;
              maxSources: number;
              maxRounds: number;
            };
            config: {
              budgetPolicy: {
                softCaps: {
                  maxQueries: number;
                  maxSources: number;
                  maxRounds: number;
                };
              };
            };
          },
      );

    expect(snapshot.config.budgetPolicy.softCaps.maxSources).toBe(9);
    expect(snapshot.config.budgetPolicy.softCaps.maxQueries).toBe(9);
    expect(snapshot.config.budgetPolicy.softCaps.maxRounds).toBe(4);
    expect(snapshot.budget.maxSources).toBe(9);
    expect(snapshot.budget.maxQueries).toBe(9);
    expect(snapshot.budget.maxRounds).toBe(4);
  });
});
