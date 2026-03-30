import { openai } from "@workspace/integrations-openai-ai-server";
import { z } from "zod";

export const routingCategorySchema = z.enum([
  "text-heavy",
  "layout-product",
  "scene-photoreal",
  "scene-illustration",
  "low-confidence",
]);

export type RoutingCategory = z.infer<typeof routingCategorySchema>;

export const promptEnhancementResultSchema = z
  .object({
    enhancedPrompt: z.string().min(1),
    routingCategory: routingCategorySchema,
    routingReason: z.string().min(1),
  })
  .strict();

export type PromptEnhancementResult = z.infer<
  typeof promptEnhancementResultSchema
>;

const ENHANCER_SYSTEM_PROMPT = `You are an image-prompt enhancer and deterministic router.

Return JSON only with exactly these keys:
- enhancedPrompt
- routingCategory
- routingReason

Allowed routingCategory values:
- text-heavy
- layout-product
- scene-photoreal
- scene-illustration
- low-confidence

Routing policy:
- text-heavy: poster/typography/logo-heavy/text-critical outputs
- layout-product: product shots, packshots, mockups, UI/layout-focused compositions
- scene-photoreal: realistic scenes, photos, cinematic or documentary framing
- scene-illustration: stylized or illustrative art, anime, painterly, vector/cartoon
- low-confidence: ambiguous intent or mixed signals where confidence is low

Keep routingReason concise (one sentence). Do not include markdown.`;

function parseEnhancerJson(content: string): PromptEnhancementResult {
  const direct = tryParseJson(content);
  if (direct) {
    return direct;
  }

  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const extracted = tryParseJson(objectMatch[0]);
    if (extracted) {
      return extracted;
    }
  }

  throw new Error("Prompt enhancer returned invalid JSON content");
}

function tryParseJson(content: string): PromptEnhancementResult | null {
  try {
    const parsed = JSON.parse(content);
    const result = promptEnhancementResultSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function enhanceImagePrompt(
  prompt: string,
): Promise<PromptEnhancementResult> {
  const completion = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 512,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: ENHANCER_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Prompt enhancer returned empty content");
  }

  return parseEnhancerJson(content);
}
