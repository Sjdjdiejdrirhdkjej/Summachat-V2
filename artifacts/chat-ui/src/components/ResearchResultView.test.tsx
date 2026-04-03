import { expect, test } from "vitest";
import type { ResearchDebateEntry, ResearchResult } from "@workspace/api-zod";
import {
  buildResearchSourceEntries,
  replaceInlineCitationTokens,
} from "./research-result-utils";

function createResult(): ResearchResult {
  return {
    answer:
      "Use blue/green deployment [[1]] and validate with smoke tests [[2]].",
    citationsValid: true,
    sources: [
      {
        sourceId: "source-2",
        ordinal: 2,
        title: "Smoke testing checklist",
        domain: "ops.example.com",
        url: "https://ops.example.com/smoke-tests",
        retrievedAt: new Date("2026-03-31T12:00:00.000Z"),
      },
      {
        sourceId: "source-1",
        ordinal: 1,
        title: "Blue/green deployment guide",
        domain: "deploy.example.com",
        url: "https://deploy.example.com/blue-green",
        retrievedAt: new Date("2026-03-31T11:00:00.000Z"),
      },
    ],
  };
}

function createDebate(): ResearchDebateEntry[] {
  return [
    {
      id: "debate-1",
      round: 1,
      model: "gpt-5.2",
      type: "opening",
      content: "Blue/green keeps a safe fallback.",
      citations: [
        {
          evidenceId: "evidence-1",
          sourceId: "source-1",
          excerpt: "Blue/green keeps a fallback ready.",
        },
      ],
      createdAt: new Date("2026-03-31T11:05:00.000Z"),
    },
    {
      id: "debate-2",
      round: 1,
      model: "claude-opus-4-6",
      type: "synthesis",
      content: "Smoke tests catch bad deploys quickly.",
      citations: [
        {
          evidenceId: "evidence-2",
          sourceId: "source-2",
          excerpt: "Smoke tests verify the core path before traffic shifts.",
        },
      ],
      createdAt: new Date("2026-03-31T11:06:00.000Z"),
    },
  ];
}

test("buildResearchSourceEntries sorts sources and attaches excerpts", () => {
  expect(buildResearchSourceEntries(createResult(), createDebate())).toEqual([
    {
      ordinal: 1,
      title: "Blue/green deployment guide",
      domain: "deploy.example.com",
      url: "https://deploy.example.com/blue-green",
      excerpts: ["Blue/green keeps a fallback ready."],
    },
    {
      ordinal: 2,
      title: "Smoke testing checklist",
      domain: "ops.example.com",
      url: "https://ops.example.com/smoke-tests",
      excerpts: ["Smoke tests verify the core path before traffic shifts."],
    },
  ]);
});

test("replaceInlineCitationTokens strips unknown citations", () => {
  expect(
    replaceInlineCitationTokens(
      "Answer [[1]] with unknown [[9]].",
      new Set([1]),
    ),
  ).toBe("Answer [1](#research-source-1) with unknown .");
});

test("replaceInlineCitationTokens keeps known citations clickable", () => {
  expect(
    replaceInlineCitationTokens(
      "Known [[1]] and [[2]] citations stay clickable.",
      new Set([1, 2]),
    ),
  ).toBe(
    "Known [1](#research-source-1) and [2](#research-source-2) citations stay clickable.",
  );
});

test("buildResearchSourceEntries deduplicates repeated excerpts", () => {
  expect(
    buildResearchSourceEntries(createResult(), [
      ...createDebate(),
      {
        id: "debate-3",
        round: 2,
        model: "gemini-3.1-pro-preview",
        type: "rebuttal",
        content: "Blue/green still looks best.",
        citations: [
          {
            evidenceId: "evidence-3",
            sourceId: "source-1",
            excerpt: "Blue/green keeps a fallback ready.",
          },
        ],
        createdAt: new Date("2026-03-31T11:07:00.000Z"),
      },
    ])[0]?.excerpts,
  ).toEqual(["Blue/green keeps a fallback ready."]);
});
