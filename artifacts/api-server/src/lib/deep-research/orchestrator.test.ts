import type Anthropic from "@anthropic-ai/sdk";
import type { GoogleGenAI } from "@google/genai";
import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import type { EvidenceLedger, TargetedSearchResult } from "./evidence-ledger";
import { ResearchOrchestrator } from "./orchestrator";
import { ResearchRunStore } from "./run-store";
import { RESEARCH_RUN_EVENT } from "./run-store.types";

function makeSearchResult(count = 2, startOrdinal = 1): TargetedSearchResult {
  const sources = Array.from({ length: count }, (_, index) => ({
    sourceId: `src-${startOrdinal + index}`,
    ordinal: startOrdinal + index,
    title: `Source ${startOrdinal + index}`,
    domain: `example${startOrdinal + index}.com`,
    url: `https://example${startOrdinal + index}.com/article`,
    retrievedAt: new Date("2026-01-01T00:00:00.000Z"),
  }));

  const evidence = sources.map((source) => ({
    evidenceId: `ev-${source.sourceId}`,
    sourceId: source.sourceId,
    excerpt: `Evidence from ${source.title}.`,
  }));

  return { sources, evidence, warnings: [], success: true };
}

function makeFailedSearchResult(): TargetedSearchResult {
  return {
    sources: [],
    evidence: [],
    warnings: [{ code: "SEARCH_FAILED", message: "Search failed" }],
    success: false,
  };
}

function makeDecisionJson(decision: {
  reasoning?: string;
  actions?: {
    type: string;
    query?: string;
    focus?: string;
    claim?: string;
    model?: string;
    reason?: string;
  }[];
  readyToSynthesize?: boolean;
  confidence?: string;
}): string {
  return JSON.stringify({
    reasoning: decision.reasoning ?? "test reasoning",
    actions: decision.actions ?? [],
    readyToSynthesize: decision.readyToSynthesize ?? false,
    confidence: decision.confidence ?? "medium",
  });
}

function makeOpenAiStream(
  text: string,
  delayMs = 0,
): AsyncIterable<{
  choices: [{ delta: { content: string } }];
}> {
  return {
    async *[Symbol.asyncIterator]() {
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      yield {
        choices: [{ delta: { content: text } }],
      };
    },
  };
}

function makeAnthropicStream(
  text: string,
  delayMs = 0,
): AsyncIterable<{
  type: "content_block_delta";
  delta: { type: "text_delta"; text: string };
}> & {
  abort: () => void;
} {
  let aborted = false;
  return {
    abort: () => {
      aborted = true;
    },
    async *[Symbol.asyncIterator]() {
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      if (aborted) return;
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text },
      };
    },
  };
}

function makeGeminiStream(
  text: string,
  delayMs = 0,
): AsyncIterable<{ text: string }> {
  return {
    async *[Symbol.asyncIterator]() {
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      yield { text };
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type DecisionOrAnalysis =
  | { kind: "decision"; json: string }
  | { kind: "stream"; text: string }
  | { kind: "throw"; message: string };

function createProviderHarness(options: {
  openaiSequence?: DecisionOrAnalysis[];
  anthropicOverride?: DecisionOrAnalysis;
  geminiOverride?: DecisionOrAnalysis;
}) {
  let openaiCallIndex = 0;

  const openaiCreate = vi.fn(
    async (
      request: Record<string, unknown>,
      _opts?: Record<string, unknown>,
    ) => {
      const entry =
        options.openaiSequence?.[openaiCallIndex] ??
        options.openaiSequence?.[options.openaiSequence.length - 1];
      openaiCallIndex += 1;

      if (entry?.kind === "throw") {
        throw new Error(entry.message);
      }

      if (request.stream) {
        const text =
          entry?.kind === "stream"
            ? entry.text
            : "Analysis with [S1] evidence.";
        return makeOpenAiStream(text);
      }

      const json =
        entry?.kind === "decision"
          ? entry.json
          : makeDecisionJson({ readyToSynthesize: true, confidence: "high" });
      return {
        choices: [{ message: { content: json } }],
      };
    },
  );

  const anthropicStream = vi.fn(() => {
    const entry = options.anthropicOverride;
    if (entry?.kind === "throw") {
      throw new Error(entry.message);
    }
    const text =
      entry?.kind === "stream"
        ? entry.text
        : "Claude analysis with [S1] [S2] evidence.";
    return makeAnthropicStream(text);
  });

  const geminiStream = vi.fn(async () => {
    const entry = options.geminiOverride;
    if (entry?.kind === "throw") {
      throw new Error(entry.message);
    }
    const text =
      entry?.kind === "stream"
        ? entry.text
        : "Gemini analysis with [S1] evidence.";
    return makeGeminiStream(text);
  });

  const openai = {
    chat: { completions: { create: openaiCreate } },
  } as unknown as OpenAI;

  const anthropic = {
    messages: { stream: anthropicStream },
  } as unknown as Anthropic;

  const gemini = {
    models: { generateContentStream: geminiStream },
  } as unknown as GoogleGenAI;

  return {
    openai,
    anthropic,
    gemini,
    openaiCreate,
    anthropicStream,
    geminiStream,
  };
}

function createEvidenceLedgerMock(searchResults?: TargetedSearchResult[]) {
  let searchIndex = 0;
  const searchTargeted = vi.fn(async () => {
    const result =
      searchResults?.[searchIndex] ?? searchResults?.[searchResults.length - 1];
    searchIndex += 1;
    return result ?? makeSearchResult();
  });

  return {
    searchTargeted,
    collectEvidence: vi.fn().mockResolvedValue({
      sources: [],
      evidence: [],
      warnings: [],
      success: false,
    }),
  } as unknown as EvidenceLedger;
}

describe("ResearchOrchestrator (autonomous)", () => {
  it("completes a full autonomous research run with search, analysis, and synthesis", async () => {
    const synthesisJson = JSON.stringify({
      answer: "Final synthesized answer [[1]] [[2]]",
      citations: [1, 2],
    });

    const providers = createProviderHarness({
      openaiSequence: [
        {
          kind: "decision",
          json: makeDecisionJson({
            actions: [
              {
                type: "analyze",
                focus: "key claims",
                model: "gpt-5.2",
                reason: "initial analysis",
              },
              {
                type: "challenge",
                claim: "main finding",
                model: "gemini-3.1-pro-preview",
                reason: "verification",
              },
            ],
            confidence: "medium",
          }),
        },
        { kind: "stream", text: "GPT analysis with [S1] [S2] findings." },
        {
          kind: "decision",
          json: makeDecisionJson({
            readyToSynthesize: true,
            confidence: "high",
          }),
        },
      ],
      anthropicOverride: { kind: "stream", text: synthesisJson },
    });

    const ledger = createEvidenceLedgerMock([makeSearchResult(3)]);
    const runStore = new ResearchRunStore({ autoStartCleanup: false });

    const orchestrator = new ResearchOrchestrator({
      openai: providers.openai,
      anthropic: providers.anthropic,
      gemini: providers.gemini,
      evidenceLedger: ledger,
      runStore,
    });

    const result = await orchestrator.runResearch("test autonomous research");

    expect(result.status).toBe("completed");
    expect(result.citationsValid).toBe(true);
    expect(result.answer).toContain("Final synthesized answer");
    expect(result.sources.length).toBeGreaterThanOrEqual(2);
    expect(result.logs.some((entry) => entry.type === "opening")).toBe(true);
    expect(result.logs.some((entry) => entry.type === "synthesis")).toBe(true);
    expect(result.logs.some((entry) => entry.type === "response")).toBe(true);
    expect(result.logs.some((entry) => entry.type === "consensus")).toBe(true);

    const events = runStore.getEvents(result.runId);
    expect(
      events.some((e) => e.event === RESEARCH_RUN_EVENT.ACTIVITY_UPDATED),
    ).toBe(true);
    expect(
      events.some((e) => e.event === RESEARCH_RUN_EVENT.RESULT_READY),
    ).toBe(true);
  });

  it("degrades when analysis model fails but synthesis succeeds", async () => {
    const synthesisJson = JSON.stringify({
      answer: "Degraded answer [[1]]",
      citations: [1],
    });

    const providers = createProviderHarness({
      openaiSequence: [
        {
          kind: "decision",
          json: makeDecisionJson({
            actions: [
              {
                type: "analyze",
                focus: "key claims",
                model: "gpt-5.2",
                reason: "analysis",
              },
            ],
            confidence: "medium",
          }),
        },
        { kind: "stream", text: "GPT analysis with [S1]." },
        {
          kind: "decision",
          json: makeDecisionJson({
            actions: [
              {
                type: "analyze",
                focus: "deeper analysis",
                model: "gemini-3.1-pro-preview",
                reason: "cross-check",
              },
            ],
            confidence: "medium",
          }),
        },
        {
          kind: "decision",
          json: makeDecisionJson({
            readyToSynthesize: true,
            confidence: "medium",
          }),
        },
        { kind: "stream", text: synthesisJson },
      ],
      geminiOverride: { kind: "throw", message: "gemini unavailable" },
    });

    const ledger = createEvidenceLedgerMock([makeSearchResult(2)]);
    const runStore = new ResearchRunStore({ autoStartCleanup: false });

    const orchestrator = new ResearchOrchestrator({
      openai: providers.openai,
      anthropic: providers.anthropic,
      gemini: providers.gemini,
      evidenceLedger: ledger,
      runStore,
    });

    const result = await orchestrator.runResearch("degradation test");

    expect(result.status).toBe("degraded");
    expect(result.citationsValid).toBe(true);
    expect(result.answer).toContain("Degraded answer");
    expect(
      result.warnings.some(
        (w) => w.code === "CHALLENGE_FAILED" || w.code === "ANALYSIS_FAILED",
      ),
    ).toBe(true);
  });

  it("uses GPT fallback when Claude synthesis fails", async () => {
    const gptSynthesisJson = JSON.stringify({
      answer: "GPT fallback synthesis [[1]]",
      citations: [1],
    });

    const providers = createProviderHarness({
      openaiSequence: [
        {
          kind: "decision",
          json: makeDecisionJson({
            actions: [
              {
                type: "analyze",
                focus: "evidence",
                model: "gpt-5.2",
                reason: "analysis",
              },
            ],
            confidence: "medium",
          }),
        },
        { kind: "stream", text: "GPT analysis with [S1]." },
        {
          kind: "decision",
          json: makeDecisionJson({
            readyToSynthesize: true,
            confidence: "high",
          }),
        },
        { kind: "stream", text: gptSynthesisJson },
      ],
      anthropicOverride: { kind: "throw", message: "claude synthesis failed" },
    });

    const ledger = createEvidenceLedgerMock([makeSearchResult(2)]);
    const runStore = new ResearchRunStore({ autoStartCleanup: false });

    const orchestrator = new ResearchOrchestrator({
      openai: providers.openai,
      anthropic: providers.anthropic,
      gemini: providers.gemini,
      evidenceLedger: ledger,
      runStore,
    });

    const result = await orchestrator.runResearch("synthesis fallback");

    expect(result.status).toBe("degraded");
    expect(result.citationsValid).toBe(true);
    expect(result.answer).toContain("GPT fallback synthesis");
    expect(
      result.warnings.some(
        (w) => w.code === "SYNTHESIS_FAILED" && w.model === "claude-opus-4-6",
      ),
    ).toBe(true);
  });

  it("falls back to default analysis when decision LLM fails", async () => {
    const synthesisJson = JSON.stringify({
      answer: "Fallback answer [[1]]",
      citations: [1],
    });

    const providers = createProviderHarness({
      openaiSequence: [
        { kind: "throw", message: "decision failed" },
        { kind: "throw", message: "decision failed retry" },
        { kind: "stream", text: "Fallback analysis [S1]." },
        { kind: "stream", text: synthesisJson },
      ],
    });

    const ledger = createEvidenceLedgerMock([makeSearchResult(2)]);
    const runStore = new ResearchRunStore({ autoStartCleanup: false });

    const orchestrator = new ResearchOrchestrator({
      openai: providers.openai,
      anthropic: providers.anthropic,
      gemini: providers.gemini,
      evidenceLedger: ledger,
      runStore,
    });

    const result = await orchestrator.runResearch("decision failure test");

    expect(["completed", "degraded"]).toContain(result.status);
    expect(result.citationsValid).toBe(true);
    expect(result.answer).toContain("Fallback answer");
    expect(result.logs.some((entry) => entry.type === "opening")).toBe(true);
  });

  it("fails when no evidence is found", async () => {
    const providers = createProviderHarness({});
    const ledger = createEvidenceLedgerMock([makeFailedSearchResult()]);
    const runStore = new ResearchRunStore({ autoStartCleanup: false });

    const orchestrator = new ResearchOrchestrator({
      openai: providers.openai,
      anthropic: providers.anthropic,
      gemini: providers.gemini,
      evidenceLedger: ledger,
      runStore,
    });

    const result = await orchestrator.runResearch("no evidence query");

    expect(result.status).toBe("failed");
    expect(result.answer).toBe("");
    expect(result.citationsValid).toBe(false);
  });

  it("forces synthesis when budget threshold is reached", async () => {
    const synthesisJson = JSON.stringify({
      answer: "Budget-forced synthesis [[1]]",
      citations: [1],
    });

    const searchAction = {
      type: "search" as const,
      query: "more evidence",
      reason: "need more",
    };

    const providers = createProviderHarness({
      openaiSequence: [
        {
          kind: "decision",
          json: makeDecisionJson({
            actions: [searchAction],
            confidence: "low",
          }),
        },
        {
          kind: "decision",
          json: makeDecisionJson({
            actions: [searchAction],
            confidence: "low",
          }),
        },
        {
          kind: "decision",
          json: makeDecisionJson({
            actions: [searchAction],
            confidence: "low",
          }),
        },
        { kind: "stream", text: "Forced analysis [S1]." },
      ],
      anthropicOverride: { kind: "stream", text: synthesisJson },
    });

    const ledger = createEvidenceLedgerMock([
      makeSearchResult(2, 1),
      makeSearchResult(1, 3),
      makeSearchResult(1, 4),
      makeSearchResult(1, 5),
    ]);
    const runStore = new ResearchRunStore({ autoStartCleanup: false });

    const orchestrator = new ResearchOrchestrator({
      openai: providers.openai,
      anthropic: providers.anthropic,
      gemini: providers.gemini,
      evidenceLedger: ledger,
      runStore,
    });

    const result = await orchestrator.runResearch("budget exhaustion test");

    expect(["completed", "degraded"]).toContain(result.status);
    expect(result.citationsValid).toBe(true);
    expect(result.answer).toContain("Budget-forced synthesis");
  });

  it("emits proper events for the agent loop lifecycle", async () => {
    const synthesisJson = JSON.stringify({
      answer: "Event lifecycle answer [[1]]",
      citations: [1],
    });

    const providers = createProviderHarness({
      openaiSequence: [
        {
          kind: "decision",
          json: makeDecisionJson({
            actions: [
              {
                type: "analyze",
                focus: "main topic",
                model: "gpt-5.2",
                reason: "analysis",
              },
            ],
            readyToSynthesize: false,
            confidence: "medium",
          }),
        },
        { kind: "stream", text: "Analysis [S1]." },
        {
          kind: "decision",
          json: makeDecisionJson({
            readyToSynthesize: true,
            confidence: "high",
          }),
        },
      ],
      anthropicOverride: { kind: "stream", text: synthesisJson },
    });

    const ledger = createEvidenceLedgerMock([makeSearchResult(2)]);
    const runStore = new ResearchRunStore({ autoStartCleanup: false });

    const orchestrator = new ResearchOrchestrator({
      openai: providers.openai,
      anthropic: providers.anthropic,
      gemini: providers.gemini,
      evidenceLedger: ledger,
      runStore,
    });

    const result = await orchestrator.runResearch("lifecycle events");

    expect(result.status).toBe("completed");

    const events = runStore.getEvents(result.runId);
    const activities = events
      .filter((e) => e.event === RESEARCH_RUN_EVENT.ACTIVITY_UPDATED)
      .map((e) => (e.data as Record<string, unknown>).phase);

    expect(activities).toContain("evidence.collection");
    expect(activities).toContain("investigation.autonomous-loop");
    expect(activities).toContain("panel.deliberation");
    expect(activities).toContain("result.synthesis");

    const steps = events.filter(
      (e) =>
        e.event === RESEARCH_RUN_EVENT.STEP_UPSERTED ||
        e.event === RESEARCH_RUN_EVENT.STEP_STATUS_UPDATED,
    );
    expect(steps.length).toBeGreaterThanOrEqual(4);

    const budgets = events.filter(
      (e) => e.event === RESEARCH_RUN_EVENT.BUDGET_UPDATED,
    );
    expect(budgets.length).toBeGreaterThanOrEqual(1);

    const debateEntries = events.filter(
      (e) => e.event === RESEARCH_RUN_EVENT.PANEL_TURN_RECORDED,
    );
    expect(debateEntries.length).toBeGreaterThanOrEqual(1);

    expect(
      events.some((e) => e.event === RESEARCH_RUN_EVENT.ACTION_PROPOSED),
    ).toBe(true);
    expect(
      events.some((e) => e.event === RESEARCH_RUN_EVENT.ACTION_SELECTED),
    ).toBe(true);
    expect(
      events.some((e) => e.event === RESEARCH_RUN_EVENT.ACTION_COMPLETED),
    ).toBe(true);
    expect(
      events.some((e) => e.event === RESEARCH_RUN_EVENT.EVIDENCE_ACCEPTED),
    ).toBe(true);
    expect(
      events.some((e) => e.event === RESEARCH_RUN_EVENT.CONSENSUS_UPDATED),
    ).toBe(true);

    const ready = events.find(
      (e) => e.event === RESEARCH_RUN_EVENT.RESULT_READY,
    );
    expect(ready).toBeDefined();
    expect((ready?.data as Record<string, unknown>).stopReason).toBeTruthy();
  });
});
