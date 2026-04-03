import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db, generatedImages } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { enhanceImagePrompt } from "../lib/image-generation/prompt-enhancer";
import {
  routeImageGeneration,
  type RoutedImageTarget,
} from "../lib/image-generation/router";
import { generateNormalizedProviderImage } from "../lib/image-generation/providers";
import { getImageStorage } from "../lib/image-generation/storage";
import { createHash, randomUUID } from "node:crypto";
import { getOrCreateAnonymousOwnerId } from "../lib/anonymous-owner.js";

const router = Router();
const imageStorage = getImageStorage();

// Create image generation
router.post(
  "/generations",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const requestSchema = z.object({
        prompt: z.string().min(1).max(1000),
      });

      const { prompt } = requestSchema.parse(req.body);
      const anonymousOwnerId = getOrCreateAnonymousOwnerId(req);

      // Enhance prompt and determine routing
      const enhanced = await enhanceImagePrompt(prompt);
      const target: RoutedImageTarget = routeImageGeneration(
        enhanced.routingCategory,
      );

      // Generate image using the appropriate provider
      const result = await generateNormalizedProviderImage(target, prompt);

      if (result.status === "blocked") {
        res.status(400).json({
          error: "Image generation blocked",
          reason: result.blockReason,
          provider: result.provider,
          model: result.model,
        });
        return;
      }

      // Store the image
      const imageId = randomUUID();
      const storageResult = await imageStorage.write(
        imageId,
        result.bytes,
        result.mimeType,
      );

      // Create database record
      const sha256 = createHash("sha256").update(result.bytes).digest("hex");
      const [imageRecord] = await db
        .insert(generatedImages)
        .values({
          anonymousOwnerIdHash: anonymousOwnerId,
          originalPrompt: prompt,
          enhancedPrompt: enhanced.enhancedPrompt,
          providerRevisedPrompt: result.providerRevisedPrompt,
          provider: result.provider,
          model: result.model,
          routingReason: enhanced.routingReason,
          mimeType: result.mimeType,
          byteSize: result.bytes.byteLength,
          sha256,
          storageBackend: storageResult.storageBackend,
          storageKey: imageId,
          status: "ready",
        })
        .returning();

      if (!imageRecord) {
        throw new Error("Failed to create image record");
      }

      res.cookie("imagegen_owner_id", anonymousOwnerId, {
        path: "/",
        httpOnly: true,
        secure: process.env["NODE_ENV"] === "production",
        sameSite: "strict",
        maxAge: 31536000 * 1000, // 1 year in milliseconds
      });

      res.json({
        id: imageRecord.id,
        anonymousOwnerId: anonymousOwnerId,
        originalPrompt: imageRecord.originalPrompt,
        enhancedPrompt: imageRecord.enhancedPrompt,
        providerRevisedPrompt: imageRecord.providerRevisedPrompt,
        provider: imageRecord.provider,
        model: imageRecord.model,
        routingReason: imageRecord.routingReason,
        mimeType: imageRecord.mimeType,
        byteSize: imageRecord.byteSize,
        sha256: imageRecord.sha256,
        storageBackend: imageRecord.storageBackend,
        storageKey: imageRecord.storageKey,
        status: imageRecord.status,
        createdAt: imageRecord.createdAt.toISOString(),
      });
      return;
    } catch (error) {
      console.error("Image generation error:", error);
      res.status(500).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return;
    }
  },
);

// List generated images
router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const anonymousOwnerId = getOrCreateAnonymousOwnerId(req);

    const images = await db
      .select()
      .from(generatedImages)
      .where(eq(generatedImages.anonymousOwnerIdHash, anonymousOwnerId))
      .orderBy(desc(generatedImages.createdAt))
      .limit(50);

    const response = {
      images: images.map((img) => ({
        id: img.id,
        originalPrompt: img.originalPrompt,
        enhancedPrompt: img.enhancedPrompt,
        provider: img.provider,
        model: img.model,
        routingReason: img.routingReason,
        mimeType: img.mimeType,
        byteSize: img.byteSize,
        sha256: img.sha256,
        status: img.status,
        createdAt: img.createdAt.toISOString(),
      })),
    };

    res.cookie("imagegen_owner_id", anonymousOwnerId, {
      path: "/",
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "strict",
      maxAge: 31536000 * 1000, // 1 year in milliseconds
    });

    res.json(response);
    return;
  } catch (error) {
    console.error("List images error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return;
  }
});

// Get image content
router.get(
  "/:imageId/content",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const paramsSchema = z.object({
        imageId: z.string().uuid(),
      });

      const { imageId } = paramsSchema.parse(req.params);
      const anonymousOwnerId = getOrCreateAnonymousOwnerId(req);

      const [image] = await db
        .select()
        .from(generatedImages)
        .where(eq(generatedImages.id, imageId))
        .limit(1);

      if (!image) {
        res.status(404).json({ error: "Image not found" });
        return;
      }

      if (image.anonymousOwnerIdHash !== anonymousOwnerId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      // Retrieve from storage
      const streamResult = await imageStorage.readStream(image.storageKey);

      if (streamResult.status === "not_found") {
        res.status(404).json({ error: "Image file not found" });
        return;
      }

      // Set appropriate headers
      res.setHeader("Content-Type", image.mimeType);
      res.setHeader("Cache-Control", "public, max-age=31536000");
      res.setHeader("ETag", image.sha256);

      // Stream the image
      streamResult.stream.pipe(res);
      return;
    } catch (error) {
      console.error("Get image content error:", error);
      res.status(500).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return;
    }
  },
);

export default router;
