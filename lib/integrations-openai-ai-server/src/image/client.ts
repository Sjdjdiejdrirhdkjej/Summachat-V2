import fs from "node:fs";
import { toFile } from "openai";
import { Buffer } from "node:buffer";
import { getOpenAiClient } from "../client";

export type GeneratedOpenAIImage = {
  bytes: Buffer;
  mimeType: string;
  revisedPrompt: string | null;
};

export async function generateImageBuffer(
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024",
): Promise<GeneratedOpenAIImage> {
  const response = await getOpenAiClient().images.generate({
    model: "gpt-image-1",
    prompt,
    size,
  });

  const firstImage = response.data?.[0];
  const base64 = firstImage?.b64_json;
  if (!base64) {
    throw new Error("OpenAI image generation returned no image data");
  }

  return {
    bytes: Buffer.from(base64, "base64"),
    mimeType: "image/png",
    revisedPrompt: firstImage?.revised_prompt ?? null,
  };
}

export async function editImages(
  imageFiles: string[],
  prompt: string,
  outputPath?: string,
): Promise<Buffer> {
  const images = await Promise.all(
    imageFiles.map((file) =>
      toFile(fs.createReadStream(file), file, {
        type: "image/png",
      }),
    ),
  );

  const response = await getOpenAiClient().images.edit({
    model: "gpt-image-1",
    image: images,
    prompt,
  });

  const imageBase64 = response.data?.[0]?.b64_json;
  if (!imageBase64) {
    throw new Error("OpenAI image edit returned no image data");
  }
  const imageBytes = Buffer.from(imageBase64, "base64");

  if (outputPath) {
    fs.writeFileSync(outputPath, imageBytes);
  }

  return imageBytes;
}
