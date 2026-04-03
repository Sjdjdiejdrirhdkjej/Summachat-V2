import { describe, expect, test } from "vitest";

import { ResearchRunStore, SaturationError } from "./run-store";
import { RESEARCH_RUN_EVENT } from "./run-store.types";

function createClock(startMs = Date.UTC(2026, 0, 1, 0, 0, 0)) {
  let nowMs = startMs;
  return {
    now: () => new Date(nowMs),
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

function normalizeSnapshot(snapshot: ReturnType<ResearchRunStore["getRun"]>) {
  if (!snapshot) {
    return snapshot;
  }

  return {
    ...snapshot,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
    steps: snapshot.steps.map((step) => ({
      ...step,
      startedAt: step.startedAt?.toISOString(),
      completedAt: step.completedAt?.toISOString(),
    })),
  };
}

describe("ResearchRunStore", () => {
  test("creates a run with UUID and queued snapshot", () => {
    const clock = createClock();
    const store = new ResearchRunStore({
      now: clock.now,
      autoStartCleanup: false,
    });

    const created = store.createRun("test deep research");

    expect(created.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(created.snapshot.status).toBe("queued");
    expect(created.snapshot.phase).toBe("queued");
    expect(created.snapshot.steps).toEqual([]);
    expect(created.snapshot.config.schemaVersion).toBe("research.v2");
    expect(
      created.snapshot.config.panel.map((member) => member.modelId),
    ).toEqual(["gpt-5.2", "claude-opus-4-6", "gemini-3.1-pro-preview"]);
    expect(created.snapshot.config.outputGuarantees).toEqual({
      citations: true,
      dissent: true,
      trace: true,
      minorityReport: true,
    });
    expect(Object.isFrozen(created.snapshot.config)).toBe(true);
    expect(created.snapshot.budget.usedQueries).toBe(0);
    expect(created.snapshot.createdAt.toISOString()).toBe(
      clock.now().toISOString(),
    );
  });

  test("supports lifecycle status transitions", () => {
    const clock = createClock();
    const store = new ResearchRunStore({
      now: clock.now,
      autoStartCleanup: false,
    });

    const { runId } = store.createRun("status transitions");

    store.updateStatus(runId, "running");
    expect(store.getRun(runId)?.status).toBe("running");

    store.updateStatus(runId, "failed");
    expect(store.getRun(runId)?.status).toBe("failed");

    const cancelledRun = store.createRun("cancelled path").runId;
    const cancelled = store.cancelRun(cancelledRun);
    expect(cancelled).toBe(true);
    expect(store.getRun(cancelledRun)?.status).toBe("cancelling");
    store.updateStatus(cancelledRun, "cancelled");
    expect(store.getRun(cancelledRun)?.status).toBe("cancelled");

    const completedRun = store.createRun("completed path").runId;
    store.updateStatus(completedRun, "running");
    store.updateStatus(completedRun, "completed");
    expect(store.getRun(completedRun)?.status).toBe("completed");
  });

  test("appends events with monotonic IDs and supports replay fetch", () => {
    const clock = createClock();
    const store = new ResearchRunStore({
      now: clock.now,
      autoStartCleanup: false,
    });
    const { runId } = store.createRun("event retrieval");

    store.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.ACTIVITY_UPDATED,
      data: {
        contractVersion: 1,
        phase: "searching",
        activity: {
          key: "searching",
          status: "active",
          updatedAt: clock.now(),
        },
      },
    });
    store.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.BUDGET_UPDATED,
      data: {
        contractVersion: 1,
        budget: {
          usedQueries: 2,
        },
      },
    });
    store.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.WARNING_ADDED,
      data: {
        contractVersion: 1,
        warning: {
          code: "LOW_CONFIDENCE",
          message: "Sources disagree",
        },
      },
    });

    const all = store.getEvents(runId);
    expect(all.map((eventEnvelope) => eventEnvelope.id)).toEqual([1, 2, 3]);

    const after2 = store.getEvents(runId, 2);
    expect(after2.map((eventEnvelope) => eventEnvelope.id)).toEqual([3]);
  });

  test("rebuilds deterministic snapshot from retained events", () => {
    const clock = createClock();
    const store = new ResearchRunStore({
      now: clock.now,
      autoStartCleanup: false,
    });
    const { runId } = store.createRun("deterministic replay", {
      maxSources: 10,
      maxRounds: 4,
    });

    store.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.STATUS_UPDATED,
      data: { contractVersion: 1, status: "running" },
    });
    store.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.ACTIVITY_UPDATED,
      data: {
        contractVersion: 1,
        phase: "gathering-evidence",
        activity: {
          key: "gathering-evidence",
          status: "active",
          updatedAt: clock.now(),
        },
      },
    });
    store.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.STEP_UPSERTED,
      data: {
        contractVersion: 1,
        step: {
          id: "search",
          name: "Search web",
          status: "running",
          startedAt: clock.now(),
        },
      },
    });
    store.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.BUDGET_UPDATED,
      data: {
        contractVersion: 1,
        budget: {
          usedQueries: 3,
          acceptedSources: 5,
          completedRounds: 1,
        },
      },
    });
    store.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.RESULT_READY,
      data: {
        contractVersion: 1,
        stopReason: "converged",
        result: {
          answer: "Synthesized answer",
          sources: [],
          citationsValid: true,
          stopReason: "converged",
        },
      },
    });
    store.appendEvent(runId, {
      event: RESEARCH_RUN_EVENT.STATUS_UPDATED,
      data: { contractVersion: 1, status: "completed" },
    });

    const live = normalizeSnapshot(store.getRun(runId));
    const replayed = normalizeSnapshot(store.rebuildSnapshotFromEvents(runId));
    expect(replayed).toEqual(live);
  });

  test("TTL cleanup removes expired terminal runs but keeps active runs", () => {
    const ttlMs = 60 * 60 * 1000;
    const clock = createClock();
    const store = new ResearchRunStore({
      now: clock.now,
      ttlMs,
      autoStartCleanup: false,
    });

    const completedRun = store.createRun("terminal ttl run").runId;
    const activeRun = store.createRun("active ttl run").runId;

    store.updateStatus(completedRun, "completed");
    store.updateStatus(activeRun, "running");

    clock.advance(ttlMs + 1);

    const removed = store.sweepExpiredRuns();
    expect(removed).toBe(1);
    expect(store.getRun(completedRun)).toBeNull();
    expect(store.getRun(activeRun)?.status).toBe("running");
  });

  test("enforces max 3 active runs with retryable saturation error", () => {
    const clock = createClock();
    const store = new ResearchRunStore({
      now: clock.now,
      autoStartCleanup: false,
    });

    store.createRun("r1");
    store.createRun("r2");
    const r3 = store.createRun("r3");

    let thrown: unknown;
    try {
      store.createRun("r4");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SaturationError);
    expect((thrown as SaturationError).retryable).toBe(true);

    store.updateStatus(r3.runId, "completed");
    expect(() => store.createRun("r4-after-complete")).not.toThrow();
  });

  test("retains only last 500 events per run", () => {
    const clock = createClock();
    const store = new ResearchRunStore({
      now: clock.now,
      autoStartCleanup: false,
    });
    const { runId } = store.createRun("ring buffer");

    for (let index = 0; index < 550; index += 1) {
      store.appendEvent(runId, {
        event: RESEARCH_RUN_EVENT.ACTIVITY_UPDATED,
        data: {
          contractVersion: 1,
          phase: `p-${index}`,
          activity: {
            key: `activity-${index}`,
            status: "active",
            updatedAt: clock.now(),
          },
        },
      });
    }

    const events = store.getEvents(runId);
    expect(events).toHaveLength(500);
    expect(events[0]?.id).toBe(51);
    expect(events[499]?.id).toBe(550);

    const replayed = store.rebuildSnapshotFromEvents(runId);
    expect(replayed?.phase).toBe("p-549");
  });

  test("resolves and freezes a default config from legacy budget overrides", () => {
    const clock = createClock();
    const store = new ResearchRunStore({
      now: clock.now,
      autoStartCleanup: false,
    });

    const created = store.createRun("legacy options", {
      maxSources: 9,
      maxRounds: 4,
    });

    expect(created.snapshot.config.budgetPolicy.softCaps.maxSources).toBe(9);
    expect(created.snapshot.config.budgetPolicy.softCaps.maxQueries).toBe(9);
    expect(created.snapshot.config.budgetPolicy.softCaps.maxRounds).toBe(4);
    expect(created.snapshot.budget.maxSources).toBe(9);
    expect(created.snapshot.budget.maxQueries).toBe(9);
    expect(created.snapshot.budget.maxRounds).toBe(4);
    expect(() => {
      created.snapshot.config.budgetPolicy.softCaps.maxSources = 99;
    }).toThrow(TypeError);
  });
});
