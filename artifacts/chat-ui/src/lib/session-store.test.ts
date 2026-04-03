import { beforeEach, expect, test } from "vitest";

import {
  createResearchTurn,
  createStoredSession,
  getSession,
  saveSession,
  updateResearchTurn,
  updateStoredSession,
} from "./session-store";

beforeEach(() => {
  localStorage.clear();
});

test("persists and reloads research turns", () => {
  const session = createStoredSession(
    "session-1",
    "fingerprint-1",
    [
      createResearchTurn({
        id: "turn-1",
        type: "research",
        prompt: "Research the deployment strategy",
        runId: "run-1",
        status: "completed",
        phase: "finalize",
        steps: [
          {
            id: "step-1",
            name: "Gather sources",
            status: "completed",
            startedAt: new Date("2026-03-31T10:00:00.000Z"),
            completedAt: new Date("2026-03-31T10:02:00.000Z"),
          },
        ],
        budget: {
          maxQueries: 5,
          usedQueries: 2,
          maxSources: 4,
          acceptedSources: 2,
          maxRounds: 3,
          completedRounds: 1,
        },
        warnings: [
          {
            code: "low-confidence",
            message: "Need one more source",
          },
        ],
        logs: [
          {
            id: "debate-1",
            round: 1,
            model: "gpt-5.2",
            type: "opening",
            content: "The deployment should stay blue/green.",
            citations: [
              {
                evidenceId: "evidence-1",
                sourceId: "source-1",
                excerpt: "Blue/green keeps a fallback ready.",
              },
            ],
            createdAt: new Date("2026-03-31T10:03:00.000Z"),
          },
        ],
        result: {
          answer: "Use blue/green with a smoke-test gate.",
          sources: [
            {
              sourceId: "source-1",
              ordinal: 1,
              title: "Blue/green deployment guide",
              domain: "example.com",
              url: "https://example.com/blue-green",
              retrievedAt: new Date("2026-03-31T10:01:00.000Z"),
            },
          ],
          citationsValid: true,
        },
        lastEventId: 9,
        terminalReason: "completed",
      }),
    ],
    "research",
    "gpt-5.2",
    ["gpt-5.2"],
  );

  saveSession(session);

  expect(getSession("session-1")).toEqual(session);
});

test("event replay restores run state from saved turn", () => {
  const initialTurn = createResearchTurn({
    id: "turn-2",
    type: "research",
    prompt: "Research caching options",
    runId: "run-2",
    status: "queued",
    phase: "planning",
    steps: [],
    budget: {
      maxQueries: 4,
      usedQueries: 0,
      maxSources: 3,
      acceptedSources: 0,
      maxRounds: 2,
      completedRounds: 0,
    },
    warnings: [],
    logs: [],
    lastEventId: 1,
  });

  const storedSession = createStoredSession(
    "session-2",
    "fingerprint-2",
    [initialTurn],
    "research",
    "gpt-5.2",
    ["gpt-5.2"],
  );

  saveSession(storedSession);

  const hydrated = getSession("session-2");
  expect(hydrated).not.toBeNull();

  const replayedTurn = updateResearchTurn(
    hydrated!.turns[0] as typeof initialTurn,
    {
      status: "completed",
      steps: [
        {
          id: "step-1",
          name: "Gather sources",
          status: "completed",
          startedAt: new Date("2026-03-31T11:00:00.000Z"),
          completedAt: new Date("2026-03-31T11:05:00.000Z"),
        },
      ],
      logs: [
        {
          id: "debate-2",
          round: 1,
          model: "claude-opus-4-6",
          type: "synthesis",
          content: "A local cache is enough for the first pass.",
          citations: [],
          createdAt: new Date("2026-03-31T11:06:00.000Z"),
        },
      ],
      result: {
        answer: "Use an in-memory cache with a TTL.",
        sources: [],
        citationsValid: false,
      },
      lastEventId: 2,
      terminalReason: "completed",
    },
  );

  saveSession(
    updateStoredSession(hydrated!, {
      turns: [replayedTurn],
    }),
  );

  const reloaded = getSession("session-2");
  expect(reloaded?.turns[0]).toMatchObject({
    runId: "run-2",
    status: "completed",
    lastEventId: 2,
    terminalReason: "completed",
    result: {
      answer: "Use an in-memory cache with a TTL.",
      citationsValid: false,
    },
  });
  expect(
    (reloaded?.turns[0] as typeof initialTurn).steps[0]?.startedAt,
  ).toBeInstanceOf(Date);
});
