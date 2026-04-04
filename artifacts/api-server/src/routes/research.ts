import { Router } from "express";
import { z } from "zod";
import {
  CancelResearchRunParams,
  CreateResearchRunBody,
  GetResearchRunEventsParams,
  GetResearchRunSnapshotParams,
  type ResearchRunCreateRequest,
  type ResearchRunCreateResponse,
  type ResearchRunEventEnvelope,
  type ResearchRunSnapshot,
} from "@workspace/api-zod";
import { tryGetOpenAiClient } from "@workspace/integrations-openai-ai-server";
import { tryGetAnthropicClient } from "@workspace/integrations-anthropic-ai";
import {
  ai as gemini,
  isGeminiAvailable,
} from "@workspace/integrations-gemini-ai";
import Exa from "exa-js";

import { EvidenceLedger } from "../lib/deep-research/evidence-ledger.js";
import { ResearchOrchestrator } from "../lib/deep-research/orchestrator.js";
import {
  SaturationError,
  createDefaultConfig,
  researchRunStore,
} from "../lib/deep-research/run-store.js";
import { logger } from "../lib/logger.js";

const router = Router();
const isProduction = process.env["NODE_ENV"] === "production";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

const activeRuns = new Map<string, AbortController>();

const eventIdHeaderSchema = z.coerce.number().int().nonnegative();

function createEvidenceLedger(): EvidenceLedger {
  const apiKey = process.env["EXA_API_KEY"];
  if (!apiKey) {
    throw new Error("EXA_API_KEY must be set");
  }

  return new EvidenceLedger(new Exa(apiKey));
}

function runUrls(runId: string): ResearchRunCreateResponse {
  return {
    runId,
    eventsUrl: `/api/research/runs/${runId}/events`,
    snapshotUrl: `/api/research/runs/${runId}`,
    cancelUrl: `/api/research/runs/${runId}/cancel`,
  };
}

function getAfterEventId(
  lastEventIdHeader: string | undefined,
): number | undefined {
  if (!lastEventIdHeader) {
    return undefined;
  }

  const parsed = eventIdHeaderSchema.safeParse(lastEventIdHeader);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

function sendSseEnvelope(
  res: {
    writableEnded: boolean;
    destroyed: boolean;
    write: (chunk: string) => boolean;
    flush?: () => void;
  },
  envelope: ResearchRunEventEnvelope,
): boolean {
  if (res.writableEnded || res.destroyed) {
    return false;
  }

  const payload = JSON.stringify(envelope);
  res.write(`id: ${envelope.id}\n`);
  res.write(`event: ${envelope.event}\n`);
  res.write(`data: ${payload}\n\n`);
  res.flush?.();
  return true;
}

function ensureCancelled(runId: string): void {
  const snapshot = researchRunStore.getRun(runId);
  if (!snapshot) {
    return;
  }

  if (snapshot.status !== "cancelled") {
    researchRunStore.updateStatus(runId, "cancelled");
  }
}

function launchResearchRun(
  runId: string,
  request: ResearchRunCreateRequest,
): void {
  const openai = tryGetOpenAiClient();
  const anthropic = tryGetAnthropicClient();
  const geminiAvailable = isGeminiAvailable();

  if (!openai || !anthropic || !geminiAvailable) {
    const missing: string[] = [];
    if (!openai) missing.push("OpenAI");
    if (!anthropic) missing.push("Anthropic");
    if (!geminiAvailable) missing.push("Gemini");
    throw new Error(
      `Research requires all AI providers. Missing: ${missing.join(", ")}`,
    );
  }

  const abortController = new AbortController();
  activeRuns.set(runId, abortController);

  const orchestrator = new ResearchOrchestrator({
    openai: openai as unknown as ConstructorParameters<
      typeof ResearchOrchestrator
    >[0]["openai"],
    anthropic: anthropic as unknown as ConstructorParameters<
      typeof ResearchOrchestrator
    >[0]["anthropic"],
    gemini: gemini as unknown as ConstructorParameters<
      typeof ResearchOrchestrator
    >[0]["gemini"],
    evidenceLedger: createEvidenceLedger(),
    runStore: researchRunStore,
    signal: abortController.signal,
  });

  void orchestrator
    .runExistingRun(runId, request.query)
    .catch(() => {
      const current = researchRunStore.getRun(runId);
      if (abortController.signal.aborted || current?.status === "cancelling") {
        ensureCancelled(runId);
        return;
      }

      if (!current || TERMINAL_STATUSES.has(current.status)) {
        return;
      }
      researchRunStore.updateStatus(runId, "failed");
      researchRunStore.appendEvent(runId, {
        event: "error.set",
        data: {
          contractVersion: 1,
          error: "Research run failed unexpectedly.",
        },
      });
    })
    .finally(() => {
      activeRuns.delete(runId);
      const current = researchRunStore.getRun(runId);
      if (current?.status === "cancelling") {
        ensureCancelled(runId);
      }
    });
}

function resolveRunConfig(
  request: ResearchRunCreateRequest,
): ReturnType<typeof createDefaultConfig> {
  return createDefaultConfig({
    config: request.config,
    maxSources: request.options?.maxSources,
    maxRounds: request.options?.maxRounds,
    maxQueries: request.options?.maxQueries,
  });
}

router.post("/runs", (req, res) => {
  const parsed = CreateResearchRunBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: parsed.error.issues,
    });
    return;
  }

  const body = parsed.data as ResearchRunCreateRequest;

  try {
    const created = researchRunStore.createRun(body.query, {
      config: resolveRunConfig(body),
    });

    launchResearchRun(created.runId, body);
    res.status(202).json(runUrls(created.runId));
    return;
  } catch (error) {
    if (error instanceof SaturationError) {
      res.status(503).json({
        error: "Service temporarily unavailable",
        message: isProduction ? undefined : error.message,
      });
      return;
    }

    logger.error({ err: error }, "Research run creation error");
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      error: "Internal server error",
      message: isProduction ? undefined : message,
    });
  }
});

router.get("/runs/:runId", (req, res) => {
  const parsed = GetResearchRunSnapshotParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: parsed.error.issues,
    });
    return;
  }

  const run = researchRunStore.getRun(parsed.data.runId);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  res.json(run as ResearchRunSnapshot);
});

router.get("/runs/:runId/events", (req, res) => {
  const parsed = GetResearchRunEventsParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: parsed.error.issues,
    });
    return;
  }

  const runId = parsed.data.runId;
  const snapshot = researchRunStore.getRun(runId);
  if (!snapshot) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  const afterEventId = getAfterEventId(req.get("Last-Event-ID") ?? undefined);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const flushableResponse = res as typeof res & { flush?: () => void };

  let closed = false;
  let lastSeenEventId = afterEventId ?? 0;

  const flushEvents = () => {
    const events = researchRunStore.getEvents(runId, lastSeenEventId);
    for (const envelope of events) {
      const sent = sendSseEnvelope(flushableResponse, envelope);
      if (!sent) {
        closed = true;
        return;
      }
      lastSeenEventId = envelope.id;
    }
  };

  const maybeEnd = () => {
    const current = researchRunStore.getRun(runId);
    if (!current) {
      closed = true;
      res.end();
      return;
    }

    if (TERMINAL_STATUSES.has(current.status)) {
      closed = true;
      res.end();
    }
  };

  flushEvents();
  maybeEnd();

  const ticker = setInterval(() => {
    if (closed) {
      return;
    }
    flushEvents();
    maybeEnd();
  }, 200);

  ticker.unref?.();

  req.on("aborted", () => {
    closed = true;
    clearInterval(ticker);
  });

  res.on("close", () => {
    closed = true;
    clearInterval(ticker);
  });
});

router.post("/runs/:runId/cancel", (req, res) => {
  const parsed = CancelResearchRunParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: parsed.error.issues,
    });
    return;
  }

  const runId = parsed.data.runId;
  const run = researchRunStore.getRun(runId);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  if (TERMINAL_STATUSES.has(run.status)) {
    res
      .status(202)
      .json({ id: run.id, status: run.status, cancelledAt: new Date() });
    return;
  }

  researchRunStore.cancelRun(runId);
  const controller = activeRuns.get(runId);
  if (controller && !controller.signal.aborted) {
    controller.abort("cancelled_by_user");
  } else {
    ensureCancelled(runId);
  }

  const current = researchRunStore.getRun(runId);
  res.status(202).json({
    id: runId,
    status: current?.status ?? "cancelled",
    cancelledAt: new Date(),
  });
});

export default router;
