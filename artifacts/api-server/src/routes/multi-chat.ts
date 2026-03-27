import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { ai } from "@workspace/integrations-gemini-ai";
import {
  buildWebContext,
  searchWeb,
  type SearchResult,
} from "../lib/web-search.js";
import {
  runGuardedProviderStream,
  type GuardedProviderStreamResult,
} from "../lib/provider-stream-guard.js";
import { z } from "zod";

const router = Router();

const MODELS = {
  "gpt-5.2": "GPT 5.4 High",
  "claude-opus-4-6": "Claude Opus 4.6",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
} as const;

type ModelId = keyof typeof MODELS;

type StreamRequestContext = {
  requestId?: string;
  logger: {
    info: (bindings: Record<string, unknown>, message?: string) => void;
    warn: (bindings: Record<string, unknown>, message?: string) => void;
    error: (bindings: Record<string, unknown>, message?: string) => void;
  };
  signal: AbortSignal;
};

const PROVIDER_OVERALL_TIMEOUT_MS = 120_000;
const PROVIDER_FIRST_CHUNK_TIMEOUT_MS = 45_000;
const PROVIDER_HARD_TIMEOUT_MS = PROVIDER_OVERALL_TIMEOUT_MS + 10_000;
const GEMINI_OVERALL_TIMEOUT_MS = 600_000;
const GEMINI_FIRST_CHUNK_TIMEOUT_MS = 180_000;
const GEMINI_HARD_TIMEOUT_MS = GEMINI_OVERALL_TIMEOUT_MS + 10_000;
const SUMMARIZER_FIRST_CHUNK_TIMEOUT_MS = PROVIDER_OVERALL_TIMEOUT_MS;

const MultiChatSchema = z.object({
  prompt: z.string().min(1),
  models: z
    .array(z.enum(["gpt-5.2", "claude-opus-4-6", "gemini-3.1-pro-preview"]))
    .min(2)
    .refine((models) => new Set(models).size === models.length, {
      message: "Models must be unique",
    }),
  webSearch: z.boolean().optional().default(false),
});

async function callGPT(
  prompt: string,
  webContext: string | null,
  onChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult> {
  const messages: { role: "system" | "user"; content: string }[] = [];
  if (webContext) messages.push({ role: "system", content: webContext });
  messages.push({ role: "user", content: prompt });

  return runGuardedProviderStream({
    provider: "openai:gpt-5.2",
    requestId: context.requestId,
    logger: context.logger,
    overallTimeoutMs: PROVIDER_OVERALL_TIMEOUT_MS,
    firstChunkTimeoutMs: PROVIDER_FIRST_CHUNK_TIMEOUT_MS,
    externalAbortSignal: context.signal,
    startStream: async ({ signal }) => {
      const stream = await openai.chat.completions.create(
        {
          model: "gpt-5.2",
          max_completion_tokens: 8192,
          messages,
          stream: true,
        },
        { signal },
      );
      return { stream };
    },
    getChunkText: (chunk) => chunk.choices[0]?.delta?.content,
    onChunk,
  });
}

async function callClaude(
  prompt: string,
  webContext: string | null,
  onChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult> {
  return runGuardedProviderStream({
    provider: "anthropic:claude-opus-4-6",
    requestId: context.requestId,
    logger: context.logger,
    overallTimeoutMs: PROVIDER_OVERALL_TIMEOUT_MS,
    firstChunkTimeoutMs: PROVIDER_FIRST_CHUNK_TIMEOUT_MS,
    externalAbortSignal: context.signal,
    startStream: async () => {
      const stream = anthropic.messages.stream({
        model: "claude-opus-4-6",
        max_tokens: 8192,
        system: webContext ?? undefined,
        messages: [{ role: "user", content: prompt }],
      });
      return { stream, abort: () => stream.abort() };
    },
    getChunkText: (event) => {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        return event.delta.text;
      }
      return null;
    },
    onChunk,
  });
}

async function callGemini(
  prompt: string,
  webContext: string | null,
  onChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult> {
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  if (webContext) {
    contents.push({ role: "user", parts: [{ text: webContext }] });
    contents.push({
      role: "model",
      parts: [
        { text: "Understood. I will use these results to inform my answer." },
      ],
    });
  }
  contents.push({ role: "user", parts: [{ text: prompt }] });

  const provider = "gemini:gemini-3.1-pro-preview";
  const startAt = Date.now();
  let firstChunkAt: number | null = null;
  let output = "";

  const abortController = new AbortController();

  const onExternalAbort = () => abortController.abort("external_abort");
  if (context.signal.aborted) {
    abortController.abort("external_abort");
  } else {
    context.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const overallTimer = setTimeout(
    () => abortController.abort("overall_timeout"),
    GEMINI_OVERALL_TIMEOUT_MS,
  );
  const firstChunkTimer = setTimeout(
    () => abortController.abort("first_chunk_timeout"),
    GEMINI_FIRST_CHUNK_TIMEOUT_MS,
  );

  context.logger.info(
    { requestId: context.requestId, provider, overallTimeoutMs: GEMINI_OVERALL_TIMEOUT_MS, firstChunkTimeoutMs: GEMINI_FIRST_CHUNK_TIMEOUT_MS },
    "provider_stream_started",
  );

  try {
    const sdkStream = await ai.models.generateContentStream({
      model: "gemini-3.1-pro-preview",
      contents,
      config: {
        maxOutputTokens: 8192,
        abortSignal: abortController.signal,
      },
    });

    for await (const chunk of sdkStream) {
      if (abortController.signal.aborted) break;
      const text = chunk.text;
      if (!text) continue;

      if (firstChunkAt === null) {
        firstChunkAt = Date.now();
        clearTimeout(firstChunkTimer);
        context.logger.info(
          { requestId: context.requestId, provider, firstChunkMs: firstChunkAt - startAt },
          "provider_stream_first_chunk",
        );
      }

      output += text;
      onChunk(text);
    }

    const totalMs = Date.now() - startAt;

    if (abortController.signal.aborted) {
      const reason = abortController.signal.reason as string;
      const status =
        reason === "overall_timeout" || reason === "first_chunk_timeout"
          ? "timed_out"
          : "aborted";
      context.logger.warn(
        { requestId: context.requestId, provider, status, reason, totalMs },
        status === "timed_out" ? "provider_stream_timed_out" : "provider_stream_aborted",
      );
      return { status, output, firstChunkMs: firstChunkAt === null ? null : firstChunkAt - startAt, totalMs };
    }

    if (output.length === 0) {
      context.logger.warn({ requestId: context.requestId, provider, totalMs }, "provider_stream_empty_output");
      return { status: "empty", output, firstChunkMs: null, totalMs };
    }

    context.logger.info(
      { requestId: context.requestId, provider, totalMs, firstChunkMs: firstChunkAt === null ? null : firstChunkAt - startAt, outputLength: output.length },
      "provider_stream_completed",
    );
    return { status: "success", output, firstChunkMs: firstChunkAt === null ? null : firstChunkAt - startAt, totalMs };
  } catch (error) {
    const totalMs = Date.now() - startAt;
    const normalizedError = error instanceof Error ? error : new Error("Unknown Gemini stream error");

    if (abortController.signal.aborted) {
      const reason = abortController.signal.reason as string;
      const status =
        reason === "overall_timeout" || reason === "first_chunk_timeout"
          ? "timed_out"
          : "aborted";
      context.logger.warn(
        { requestId: context.requestId, provider, status, reason, totalMs, err: normalizedError },
        status === "timed_out" ? "provider_stream_timed_out" : "provider_stream_aborted",
      );
      return { status, output, firstChunkMs: firstChunkAt === null ? null : firstChunkAt - startAt, totalMs, error: normalizedError };
    }

    context.logger.error(
      { requestId: context.requestId, provider, totalMs, err: normalizedError },
      "provider_stream_errored",
    );
    return { status: "errored", output, firstChunkMs: firstChunkAt === null ? null : firstChunkAt - startAt, totalMs, error: normalizedError };
  } finally {
    clearTimeout(overallTimer);
    clearTimeout(firstChunkTimer);
    context.signal.removeEventListener("abort", onExternalAbort);
  }
}

async function callSummarizer(
  prompt: string,
  responses: { model: ModelId; label: string; response: string }[],
  onChunk: (text: string) => void,
  onThinkingChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult> {
  const responseBlock = responses
    .map((r) => `### ${r.label}\n${r.response}`)
    .join("\n\n");

  const systemPrompt = `You are a summariser. You will be given a user's question and several responses to it. Write a single, clear, concise summary of those responses. Do not mention any AI models, agents, or sources — just summarise the content as if it were your own unified answer.`;
  const userMessage = `User's question:\n"${prompt}"\n\nResponses:\n\n${responseBlock}\n\nSummarise these responses.`;

  return runGuardedProviderStream({
    provider: "openai:gpt-5.2-summary",
    requestId: context.requestId,
    logger: context.logger,
    overallTimeoutMs: PROVIDER_OVERALL_TIMEOUT_MS,
    firstChunkTimeoutMs: SUMMARIZER_FIRST_CHUNK_TIMEOUT_MS,
    externalAbortSignal: context.signal,
    startStream: async ({ signal }) => {
      const stream = await openai.chat.completions.create(
        {
          model: "gpt-5.2",
          max_completion_tokens: 8192,
          reasoning_effort: "xhigh",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          stream: true,
        },
        { signal },
      );
      return { stream };
    },
    getChunkText: (chunk) => {
      const delta = chunk.choices[0]?.delta;
      if (delta && "reasoning_content" in delta) {
        const reasoning = (delta as (typeof delta) & { reasoning_content?: string | null }).reasoning_content;
        if (reasoning) {
          onThinkingChunk(reasoning);
        }
      }
      return delta?.content;
    },
    onChunk,
  });
}

function toTerminalError(result: GuardedProviderStreamResult): string | null {
  if (result.status === "success") {
    return null;
  }
  if (result.status === "timed_out") {
    return "Provider stream timed out";
  }
  if (result.status === "aborted") {
    return "Provider stream aborted";
  }
  if (result.status === "empty") {
    return "Provider returned empty output";
  }
  return result.error?.message ?? "Provider stream failed";
}

router.post("/multi-chat", async (req, res) => {
  const parsed = MultiChatSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { prompt, models, webSearch } = parsed.data;
  const requestWithLog = req as typeof req & {
    id?: string;
    log: StreamRequestContext["logger"];
  };
  const streamAbortController = new AbortController();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let connectionClosed = false;
  req.on("aborted", () => {
    connectionClosed = true;
    if (!streamAbortController.signal.aborted) {
      streamAbortController.abort("request_aborted");
    }
  });
  res.on("close", () => {
    connectionClosed = true;
    if (!streamAbortController.signal.aborted) {
      streamAbortController.abort("response_closed");
    }
  });

  const send = (data: object) => {
    if (connectionClosed || res.writableEnded || res.destroyed) {
      return;
    }
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    const flushableResponse = res as typeof res & { flush?: () => void };
    flushableResponse.flush?.();
  };

  let webContext: string | null = null;
  let searchResults: SearchResult[] = [];

  try {
    if (webSearch) {
      send({ type: "search_start" });
      try {
        searchResults = await searchWeb(prompt);
        if (searchResults.length > 0) {
          webContext = buildWebContext(searchResults);
        }
        send({
          type: "search_done",
          results: searchResults.map((r) => ({ title: r.title, url: r.url })),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Search failed";
        send({ type: "search_error", error: message });
      }
    }

    const streamContext: StreamRequestContext = {
      requestId: requestWithLog.id,
      logger: requestWithLog.log,
      signal: streamAbortController.signal,
    };

    const invokeModel = async (
      modelId: ModelId,
    ): Promise<
      | {
          success: true;
          model: ModelId;
          label: string;
          response: string;
        }
      | { success: false; model: ModelId }
    > => {
      send({ type: "model_start", model: modelId, label: MODELS[modelId] });

      let terminalEmitted = false;
      let modelFinalized = false;
      const modelAbortController = new AbortController();

      const emitModelDone = () => {
        if (terminalEmitted) {
          return;
        }
        terminalEmitted = true;
        send({ type: "model_done", model: modelId });
      };

      const emitModelError = (error: string) => {
        if (terminalEmitted) {
          return;
        }
        terminalEmitted = true;
        send({ type: "model_error", model: modelId, error });
      };

      const modelSignal = AbortSignal.any([
        streamContext.signal,
        modelAbortController.signal,
      ]);
      const modelContext: StreamRequestContext = {
        requestId: streamContext.requestId,
        logger: streamContext.logger,
        signal: modelSignal,
      };

      try {
        const modelCallPromise: Promise<GuardedProviderStreamResult | null> =
          (async () => {
            if (modelId === "gpt-5.2") {
              return callGPT(
                prompt,
                webContext,
                (text) => {
                  if (!modelFinalized) {
                    send({
                      type: "model_chunk",
                      model: modelId,
                      content: text,
                    });
                  }
                },
                modelContext,
              );
            }

            if (modelId === "claude-opus-4-6") {
              return callClaude(
                prompt,
                webContext,
                (text) => {
                  if (!modelFinalized) {
                    send({
                      type: "model_chunk",
                      model: modelId,
                      content: text,
                    });
                  }
                },
                modelContext,
              );
            }

            if (modelId === "gemini-3.1-pro-preview") {
              return callGemini(
                prompt,
                webContext,
                (text) => {
                  if (!modelFinalized) {
                    send({
                      type: "model_chunk",
                      model: modelId,
                      content: text,
                    });
                  }
                },
                modelContext,
              );
            }

            return null;
          })();

        let hardTimeoutHandle: NodeJS.Timeout | null = null;

        const modelHardTimeoutMs =
          modelId === "gemini-3.1-pro-preview"
            ? GEMINI_HARD_TIMEOUT_MS
            : PROVIDER_HARD_TIMEOUT_MS;

        const raceResult = await Promise.race<
          GuardedProviderStreamResult | null | "hard_timeout"
        >([
          modelCallPromise,
          new Promise<"hard_timeout">((resolve) => {
            hardTimeoutHandle = setTimeout(
              () => resolve("hard_timeout"),
              modelHardTimeoutMs,
            );
          }),
        ]);

        if (hardTimeoutHandle) {
          clearTimeout(hardTimeoutHandle);
        }

        if (raceResult === "hard_timeout") {
          modelFinalized = true;
          if (!modelAbortController.signal.aborted) {
            modelAbortController.abort("model_hard_timeout");
          }
          emitModelError("Provider call timed out");
          void modelCallPromise.catch(() => undefined);
          return { success: false, model: modelId };
        }

        modelFinalized = true;

        if (!raceResult) {
          emitModelError("Unknown model");
          return { success: false, model: modelId };
        }

        const terminalError = toTerminalError(raceResult);
        if (terminalError) {
          emitModelError(terminalError);
          return { success: false, model: modelId };
        }

        emitModelDone();
        return {
          success: true,
          model: modelId,
          label: MODELS[modelId],
          response: raceResult.output,
        };
      } catch (err) {
        modelFinalized = true;
        const message = err instanceof Error ? err.message : "Unknown error";
        emitModelError(message);
        return { success: false, model: modelId };
      }
    };

    const modelOutcomes = await Promise.allSettled(
      models.map((modelId) => invokeModel(modelId)),
    );

    const successfulResponses = modelOutcomes.flatMap((outcome, index) => {
      if (outcome.status === "fulfilled" && outcome.value.success) {
        return [
          {
            model: outcome.value.model,
            label: outcome.value.label,
            response: outcome.value.response,
          },
        ];
      }

      if (outcome.status === "rejected") {
        requestWithLog.log.error(
          {
            requestId: requestWithLog.id,
            model: models[index],
            err: outcome.reason,
          },
          "multi_chat_model_invoke_rejected",
        );
      }

      return [];
    });

    if (successfulResponses.length >= 2) {
      send({ type: "summary_start" });
      try {
        const summaryResult = await callSummarizer(
          prompt,
          successfulResponses,
          (text) => {
            send({ type: "summary_chunk", content: text });
          },
          (text) => {
            send({ type: "summary_thinking_chunk", content: text });
          },
          streamContext,
        );
        const terminalError = toTerminalError(summaryResult);
        if (terminalError) {
          send({ type: "summary_error", error: terminalError });
        } else {
          send({ type: "summary_done" });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send({ type: "summary_error", error: message });
      }
    } else if (successfulResponses.length === 1) {
      send({ type: "summary_start" });
      send({ type: "summary_chunk", content: successfulResponses[0].response });
      send({ type: "summary_done" });
    } else {
      send({ type: "summary_error", error: "No successful model responses" });
    }
  } finally {
    send({ type: "done" });
    res.end();
  }
});

export default router;
