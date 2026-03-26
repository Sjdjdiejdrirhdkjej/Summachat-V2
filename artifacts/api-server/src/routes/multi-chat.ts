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

const MultiChatSchema = z.object({
  prompt: z.string().min(1),
  models: z.array(z.enum(["gpt-5.2", "claude-opus-4-6", "gemini-3.1-pro-preview"])).min(2),
});

async function callGPT(prompt: string, onChunk: (text: string) => void): Promise<string> {
  let full = "";
  const stream = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
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

async function callClaude(prompt: string, onChunk: (text: string) => void): Promise<string> {
  let full = "";
  const stream = anthropic.messages.stream({
    model: "claude-opus-4-6",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      full += event.delta.text;
      onChunk(event.delta.text);
    }
  }
  return full;
}

async function callGemini(prompt: string, onChunk: (text: string) => void): Promise<string> {
  let full = "";
  const stream = await ai.models.generateContentStream({
    model: "gemini-3.1-pro-preview",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
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

async function callSummarizer(
  prompt: string,
  responses: { model: ModelId; label: string; response: string }[],
  onChunk: (text: string) => void
): Promise<string> {
  const responseBlock = responses
    .map((r) => `### ${r.label}\n${r.response}`)
    .join("\n\n");

  const systemPrompt = `You are a summariser. You will be given a user's question and several responses to it. Write a single, clear, concise summary of those responses. Do not mention any AI models, agents, or sources — just summarise the content as if it were your own unified answer.`;

  const userMessage = `User's question:\n"${prompt}"\n\nResponses:\n\n${responseBlock}\n\nSummarise these responses.`;

  let full = "";
  const stream = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
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

router.post("/multi-chat", async (req, res) => {
  const parsed = MultiChatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { prompt, models }: { prompt: string; models: ModelId[] } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    (res as any).flush?.();
  };

  const modelResponses: { model: ModelId; label: string; response: string }[] = [];

  const modelCalls = models.map((modelId) => {
    return (async () => {
      try {
        send({ type: "model_start", model: modelId, label: MODELS[modelId] });

        let response = "";
        const onChunk = (text: string) => {
          send({ type: "model_chunk", model: modelId, content: text });
        };

        if (modelId === "gpt-5.2") {
          response = await callGPT(prompt, onChunk);
        } else if (modelId === "claude-opus-4-6") {
          response = await callClaude(prompt, onChunk);
        } else if (modelId === "gemini-3.1-pro-preview") {
          response = await callGemini(prompt, onChunk);
        }

        modelResponses.push({ model: modelId, label: MODELS[modelId], response });
        send({ type: "model_done", model: modelId });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send({ type: "model_error", model: modelId, error: message });
      }
    })();
  });

  await Promise.all(modelCalls);

  if (modelResponses.length >= 2) {
    send({ type: "summary_start" });
    try {
      await callSummarizer(prompt, modelResponses, (text) => {
        send({ type: "summary_chunk", content: text });
      });
      send({ type: "summary_done" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      send({ type: "summary_error", error: message });
    }
  }

  send({ type: "done" });
  res.end();
});

export default router;
