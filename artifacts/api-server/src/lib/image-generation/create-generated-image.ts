import { createHash, randomUUID } from "node:crypto";
import { db, generatedImages } from "@workspace/db";
import { routeImageGeneration } from "./router.js";
import { generateNormalizedProviderImage } from "./providers.js";
import { getImageStorage } from "./storage.js";
import type { RoutingCategory } from "./prompt-enhancer.js";

const imageStorage = getImageStorage();

export type GeneratedImageRecord = {
  id: string;
  anonymousOwnerIdHash: string;
  originalPrompt: string;
  enhancedPrompt: string;
  providerRevisedPrompt: string | null;
  provider: string;
  model: string;
  routingReason: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  storageBackend: string;
  storageKey: string;
  status: string;
  createdAt: Date;
};

export type CreateGeneratedImageOptions = {
  ownerId: string;
  prompt: string;
  routingCategory?: RoutingCategory;
  routingReason?: string;
  enhancedPrompt?: string;
};

export type CreateGeneratedImageResult =
  | { success: true; image: GeneratedImageRecord }
  | { success: false; error: string; blockReason?: string };

/**
 * Creates a generated image record by:
 * 1. Routing to appropriate provider based on prompt
 * 2. Generating the image
 * 3. Storing the image and DB record
 * 
 * Returns the full image record on success.
 */
export async function createGeneratedImage(
  options: CreateGeneratedImageOptions,
): Promise<CreateGeneratedImageResult> {
  const { ownerId, prompt, routingCategory, routingReason, enhancedPrompt } =
    options;

  // Route to appropriate image provider
  const target = routeImageGeneration(routingCategory ?? "low-confidence");

  // Generate the image
  const result = await generateNormalizedProviderImage(target, prompt);

  if (result.status === "blocked") {
    return {
      success: false,
      error: "Image generation blocked",
      blockReason: result.blockReason,
    };
  }

  // Store the image
  const imageId = randomUUID();
  const storageResult = await imageStorage.write(imageId, result.bytes, result.mimeType);

  // Create database record
  const sha256 = createHash("sha256").update(result.bytes).digest("hex");
  const [imageRecord] = await db
    .insert(generatedImages)
    .values({
      anonymousOwnerIdHash: ownerId,
      originalPrompt: prompt,
      enhancedPrompt: enhancedPrompt ?? prompt,
      providerRevisedPrompt: result.providerRevisedPrompt,
      provider: result.provider,
      model: result.model,
      routingReason: routingReason ?? "auto-routed",
      mimeType: result.mimeType,
      byteSize: result.bytes.byteLength,
      sha256,
      storageBackend: storageResult.storageBackend,
      storageKey: imageId,
      status: "ready",
    })
    .returning();

  if (!imageRecord) {
    return {
      success: false,
      error: "Failed to create image record",
    };
  }

  return {
    success: true,
    image: imageRecord,
  };
}