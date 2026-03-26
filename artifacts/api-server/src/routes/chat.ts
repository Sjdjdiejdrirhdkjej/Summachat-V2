import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { ai } from "@workspace/integrations-gemini-ai";
import { z } from "zod";

const router = Router();

const MODELS = {
  "gpt-5.2": "GPT 5.4 High",
  "claude-opus-4-6": "Claude Opus 4.6",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
} as const;

type ModelId = keyof typeof MODELS;

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
});

type ChatMessage = z.infer<typeof ChatSchema>["messages"][number];

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

function toGeminiContents(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: m.content }],
  }));
}

async function callGPT(messages: ChatMessage[], onChunk: (text: string) => void): Promise<string> {
  let full = "";
  const stream = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 8192,
    messages: toOpenAiMessages(messages),
    stream: true,
  });
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      full += content;
      onChunk(content);
    }
  }
  return full;
}

async function callClaude(messages: ChatMessage[], onChunk: (text: string) => void): Promise<string> {
  let full = "";
  const stream = anthropic.messages.stream({
    model: "claude-opus-4-6",
    max_tokens: 8192,
    messages: toClaudeMessages(messages),
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      full += event.delta.text;
      onChunk(event.delta.text);
    }
  }
  return full;
}

async function callGemini(messages: ChatMessage[], onChunk: (text: string) => void): Promise<string> {
  let full = "";
  const stream = await ai.models.generateContentStream({
    model: "gemini-3.1-pro-preview",
    contents: toGeminiContents(messages),
    config: { maxOutputTokens: 8192 },
  });
  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) {
      full += text;
      onChunk(text);
    }
  }
  return full;
}

router.post("/chat", async (req, res) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { model, messages }: { model: ModelId; messages: ChatMessage[] } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    (res as any).flush?.();
  };

  send({ type: "start", model, label: MODELS[model] });
  try {
    if (model === "gpt-5.2") {
      await callGPT(messages, (text) => send({ type: "chunk", content: text }));
    } else if (model === "claude-opus-4-6") {
      await callClaude(messages, (text) => send({ type: "chunk", content: text }));
    } else if (model === "gemini-3.1-pro-preview") {
      await callGemini(messages, (text) => send({ type: "chunk", content: text }));
    }
    send({ type: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    send({ type: "error", error: message });
  } finally {
    res.end();
  }
});

export default router;
