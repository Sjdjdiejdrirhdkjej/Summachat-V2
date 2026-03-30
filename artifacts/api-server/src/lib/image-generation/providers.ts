import { Buffer } from "node:buffer";
import { ai } from "@workspace/integrations-gemini-ai";
import { generateImageBuffer } from "@workspace/integrations-openai-ai-server";
import { type RoutedImageTarget } from "./router.js";

export type ProviderSafetyMetadata = {
  blockReason: string | null;
  finishReason: string | null;
  promptFeedback: unknown;
  candidateSafetyRatings: unknown;
};

type NormalizedProviderBaseResult = {
  provider: RoutedImageTarget["provider"];
  model: RoutedImageTarget["model"];
  providerRevisedPrompt: string | null;
  providerSafetyMetadata: ProviderSafetyMetadata | null;
};

export type NormalizedImageProviderReadyResult =
  NormalizedProviderBaseResult & {
    status: "ready";
    bytes: Buffer;
    mimeType: string;
  };

export type NormalizedImageProviderBlockedResult =
  NormalizedProviderBaseResult & {
    status: "blocked";
    blockReason: string;
  };

export type NormalizedImageProviderResult =
  | NormalizedImageProviderReadyResult
  | NormalizedImageProviderBlockedResult;

function toBlockReason(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function generateNormalizedProviderImage(
  target: RoutedImageTarget,
  prompt: string,
): Promise<NormalizedImageProviderResult> {
  if (target.provider === "openai") {
    const openaiResult = await generateImageBuffer(prompt, "1024x1024");

    return {
      status: "ready",
      bytes: openaiResult.bytes,
      mimeType: openaiResult.mimeType,
      provider: target.provider,
      model: target.model,
      providerRevisedPrompt: openaiResult.revisedPrompt,
      providerSafetyMetadata: null,
    };
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const candidate = response.candidates?.[0];
  const finishReason = toBlockReason(candidate?.finishReason);
  const promptBlockReason = toBlockReason(response.promptFeedback?.blockReason);

  const providerSafetyMetadata: ProviderSafetyMetadata = {
    blockReason: promptBlockReason,
    finishReason,
    promptFeedback: response.promptFeedback ?? null,
    candidateSafetyRatings: candidate?.safetyRatings ?? null,
  };

  const imagePart = candidate?.content?.parts?.find((part) =>
    Boolean(part.inlineData?.data),
  );
  const imageData = imagePart?.inlineData?.data;

  const normalizedBlockReason =
    promptBlockReason ??
    (finishReason === "SAFETY" ? "candidate_finish_reason_safety" : null);

  if (!imageData && normalizedBlockReason) {
    return {
      status: "blocked",
      blockReason: normalizedBlockReason,
      provider: target.provider,
      model: target.model,
      providerRevisedPrompt: null,
      providerSafetyMetadata,
    };
  }

  if (!imageData) {
    throw new Error("Gemini image generation returned no image data");
  }

  return {
    status: "ready",
    bytes: Buffer.from(imageData, "base64"),
    mimeType: imagePart?.inlineData?.mimeType ?? "image/png",
    provider: target.provider,
    model: target.model,
    providerRevisedPrompt: null,
    providerSafetyMetadata,
  };
}
