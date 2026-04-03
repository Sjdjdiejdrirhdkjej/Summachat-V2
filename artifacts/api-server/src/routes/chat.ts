import { Router } from "express";
import {
  tryGetOpenAiClient,
} from "@workspace/integrations-openai-ai-server";
import {
  tryGetAnthropicClient,
} from "@workspace/integrations-anthropic-ai";
import {
  ai,
  getActiveProvider as getGeminiActiveProvider,
} from "@workspace/integrations-gemini-ai";
import {
  resolveAnthropicUpstreamModel,
  resolveGeminiUpstreamModel,
  resolveOpenAiUpstreamModel,
} from "../lib/agentrouter-upstream-models.js";
import { buildWebContext, searchWeb } from "../lib/web-search.js";
import {
  runGuardedProviderStream,
  toTerminalError,
  type GuardedProviderStreamResult,
} from "../lib/provider-stream-guard.js";
import { z } from "zod";

const router = Router();

const MODELS = {
  "gpt-5.2": "GPT 5.4 High",
  "claude-opus-4-6": "Claude Opus 4.6",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
} as const;

const ChatSchema = z.object({
  model: z.enum(["gpt-5.2", "claude-opus-4-6", "gemini-3.1-pro-preview"]),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      }),
    )
    .min(1),
  webSearch: z.boolean().optional().default(false),
});

type ChatMessage = z.infer<typeof ChatSchema>["messages"][number];

type StreamRequestContext = {
  requestId?: string;
  logger: {
    info: (bindings: Record<string, unknown>, message?: string) => void;
    warn: (bindings: Record<string, unknown>, message?: string) => void;
    error: (bindings: Record<string, unknown>, message?: string) => void;
  };
  signal: AbortSignal;
};

type ChatProvider = z.infer<typeof ChatSchema>["model"];

const PROVIDER_OVERALL_TIMEOUT_MS = 120_000;
const PROVIDER_FIRST_CHUNK_TIMEOUT_MS = 45_000;
const GEMINI_OVERALL_TIMEOUT_MS = 600_000;
const GEMINI_FIRST_CHUNK_TIMEOUT_MS = 180_000;

function toOpenAiMessages(messages: ChatMessage[]) {
  return messages.map((m) => ({ role: m.role, content: m.content })) as {
    role: "user" | "assistant";
    content: string;
  }[];
}

function toClaudeMessages(messages: ChatMessage[]) {
  return messages.map((m) => ({ role: m.role, content: m.content })) as {
    role: "user" | "assistant";
    content: string;
  }[];
}

function toGeminiContents(messages: ChatMessage[], webContext: string | null) {
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

  for (const m of messages) {
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }

  return contents;
}

function getSearchQuery(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages[index].content;
    }
  }
  return messages[messages.length - 1]?.content ?? "";
}

function getGeminiChunkText(chunk: unknown): string | null {
  // Gemini SDK stream chunks are `GenerateContentResponse` objects where
  // `chunk.text` may be temporarily `undefined` depending on the chunk.
  // Fall back to extracting text parts from candidates.
  const c = chunk as {
    text?: string;
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    }>;
  };

  if (typeof c.text === "string" && c.text.length > 0) {
    return c.text;
  }

  const parts = c.candidates?.[0]?.content?.parts;
  if (!parts) return null;

  let out = "";
  for (const part of parts) {
    if (part.thought) continue;
    if (typeof part.text === "string" && part.text.length > 0) {
      out += part.text;
    }
  }

  return out.length > 0 ? out : null;
}

async function callGPT(
  messages: ChatMessage[],
  webContext: string | null,
  onChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult> {
  const openai = tryGetOpenAiClient();
  if (!openai) {
    return {
      status: "errored",
      output: "",
      firstChunkMs: null,
      totalMs: 0,
      error: new Error("OpenAI integration is not configured"),
    };
  }

  const requestMessages: {
    role: "system" | "user" | "assistant";
    content: string;
  }[] = [];
  if (webContext) {
    requestMessages.push({ role: "system", content: webContext });
  }
  requestMessages.push(...toOpenAiMessages(messages));

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
          model: resolveOpenAiUpstreamModel("gpt-5.2"),
          max_completion_tokens: 8192,
          messages: requestMessages,
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
  messages: ChatMessage[],
  webContext: string | null,
  onChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult> {
  const anthropic = tryGetAnthropicClient();
  if (!anthropic) {
    return {
      status: "errored",
      output: "",
      firstChunkMs: null,
      totalMs: 0,
      error: new Error("Anthropic integration is not configured"),
    };
  }

  return runGuardedProviderStream({
    provider: "anthropic:claude-opus-4-6",
    requestId: context.requestId,
    logger: context.logger,
    overallTimeoutMs: PROVIDER_OVERALL_TIMEOUT_MS,
    firstChunkTimeoutMs: PROVIDER_FIRST_CHUNK_TIMEOUT_MS,
    externalAbortSignal: context.signal,
    startStream: async () => {
      const stream = anthropic.messages.stream({
        model: resolveAnthropicUpstreamModel("claude-opus-4-6"),
        max_tokens: 8192,
        system: webContext ?? undefined,
        messages: toClaudeMessages(messages),
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
  messages: ChatMessage[],
  webContext: string | null,
  onChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult> {
  const contents = toGeminiContents(messages, webContext);
  const geminiProvider = getGeminiActiveProvider();

  return runGuardedProviderStream({
    provider: `gemini:gemini-3.1-pro-preview:${geminiProvider ?? "unknown"}`,
    requestId: context.requestId,
    logger: context.logger,
    overallTimeoutMs: GEMINI_OVERALL_TIMEOUT_MS,
    firstChunkTimeoutMs: GEMINI_FIRST_CHUNK_TIMEOUT_MS,
    externalAbortSignal: context.signal,
    startStream: async ({ signal }) => {
      const stream = (await ai.models.generateContentStream({
        model: resolveGeminiUpstreamModel("gemini-3.1-pro-preview"),
        contents,
        config: { maxOutputTokens: 8192, abortSignal: signal },
      })) as AsyncIterable<unknown>;
      return { stream };
    },
    getChunkText: (chunk) => getGeminiChunkText(chunk),
    onChunk,
  });
}

function getProviderLabel(model: ChatProvider): string {
  if (model === "gpt-5.2") {
    return "openai:gpt-5.2";
  }
  if (model === "claude-opus-4-6") {
    return "anthropic:claude-opus-4-6";
  }
  return "gemini:gemini-3.1-pro-preview";
}

router.post("/chat", async (req, res) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { model, messages, webSearch } = parsed.data;
  const requestWithLog = req as typeof req & {
    id?: string;
    log: StreamRequestContext["logger"];
  };
  const streamAbortController = new AbortController();
  const providerLabel = getProviderLabel(model);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let connectionClosed = false;
  let streamFinalized = false;
  req.on("aborted", () => {
    connectionClosed = true;
    if (!streamFinalized) {
      requestWithLog.log.warn(
        { requestId: requestWithLog.id, provider: providerLabel },
        "chat_request_aborted",
      );
    }
    if (!streamFinalized && !streamAbortController.signal.aborted) {
      streamAbortController.abort("request_aborted");
    }
  });
  res.on("close", () => {
    connectionClosed = true;
    if (!streamFinalized) {
      requestWithLog.log.warn(
        { requestId: requestWithLog.id, provider: providerLabel },
        "chat_response_closed",
      );
    }
    if (!streamFinalized && !streamAbortController.signal.aborted) {
      streamAbortController.abort("response_closed");
    }
  });

  const send = (data: object): boolean => {
    if (connectionClosed || res.writableEnded || res.destroyed) {
      return false;
    }
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    const flushableResponse = res as typeof res & { flush?: () => void };
    flushableResponse.flush?.();
    return true;
  };

  send({
    type: "start",
    model,
    label: MODELS[model],
  });

  try {
    let webContext: string | null = null;
    if (webSearch) {
      send({ type: "search_start" });
      try {
        const searchResults = await searchWeb(getSearchQuery(messages));
        if (searchResults.length > 0) {
          webContext = buildWebContext(searchResults);
        }
        send({
          type: "search_done",
          results: searchResults.map((result) => ({
            title: result.title,
            url: result.url,
          })),
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

    requestWithLog.log.info(
      {
        requestId: requestWithLog.id,
        provider: providerLabel,
        model,
        webSearch,
      },
      "chat_provider_invoke_start",
    );

    let providerResult: GuardedProviderStreamResult | null = null;
    let emittedVisibleChunk = false;

    const onChunk = (text: string) => {
      emittedVisibleChunk =
        send({ type: "chunk", content: text }) || emittedVisibleChunk;
    };

    if (model === "gpt-5.2") {
      providerResult = await callGPT(
        messages,
        webContext,
        onChunk,
        streamContext,
      );
    } else if (model === "claude-opus-4-6") {
      providerResult = await callClaude(
        messages,
        webContext,
        onChunk,
        streamContext,
      );
    } else if (model === "gemini-3.1-pro-preview") {
      providerResult = await callGemini(
        messages,
        webContext,
        onChunk,
        streamContext,
      );
    }

    if (providerResult) {
      requestWithLog.log.info(
        {
          requestId: requestWithLog.id,
          provider: providerLabel,
          model,
          status: providerResult.status,
          firstChunkMs: providerResult.firstChunkMs,
          totalMs: providerResult.totalMs,
          outputLength: providerResult.output.length,
          hadVisibleChunk: emittedVisibleChunk,
        },
        "chat_provider_invoke_done",
      );

      if (!emittedVisibleChunk) {
        const terminalError =
          toTerminalError(providerResult) ??
          "Provider stream opened but emitted no chunks";
        const sentError = send({ type: "error", error: terminalError });
        if (!sentError) {
          requestWithLog.log.warn(
            {
              requestId: requestWithLog.id,
              provider: providerLabel,
              model,
              status: providerResult.status,
              terminalError,
            },
            "chat_provider_terminal_error_not_visible",
          );
        }
      }
    } else {
      const terminalError = "Provider stream did not start";
      send({ type: "error", error: terminalError });
      requestWithLog.log.error(
        {
          requestId: requestWithLog.id,
          provider: providerLabel,
          model,
        },
        "chat_provider_missing_result",
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    send({ type: "error", error: message });
    requestWithLog.log.error(
      {
        requestId: requestWithLog.id,
        provider: providerLabel,
        model,
        err,
      },
      "chat_route_errored",
    );
  } finally {
    streamFinalized = true;
    const sentDone = send({ type: "done" });
    if (!sentDone) {
      requestWithLog.log.warn(
        { requestId: requestWithLog.id, provider: providerLabel, model },
        "chat_done_not_visible",
      );
    }
    res.end();
  }
});

export default router;
