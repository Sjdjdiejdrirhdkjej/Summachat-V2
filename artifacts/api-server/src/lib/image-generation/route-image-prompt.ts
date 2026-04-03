import { openai } from "@workspace/integrations-openai-ai-server";
import { resolveOpenAiUpstreamModel } from "../agentrouter-upstream-models.js";
import { z } from "zod";
import { routingCategorySchema, type RoutingCategory } from "./prompt-enhancer.js";

const routePromptSchema = z.object({
  routingCategory: routingCategorySchema,
  routingReason: z.string(),
});

type RoutePromptResult = z.infer<typeof routePromptSchema>;

const ROUTER_SYSTEM_PROMPT = `You are an image-prompt deterministic router.

Return JSON only with exactly these keys:
- routingCategory
- routingReason

Allowed routingCategory values:
- text-heavy: poster/typography/logo-heavy/text-critical outputs
- layout-product: product shots, packshots, mockups, UI/layout-focused compositions
- scene-photoreal: realistic scenes, photos, cinematic or documentary framing
- scene-illustration: stylized or illustrative art, anime, painterly, vector/cartoon
- low-confidence: ambiguous intent or mixed signals where confidence is low

Routing policy:
- text-heavy: poster/typography/logo-heavy/text-critical outputs
- layout-product: product shots, packshots, mockups, UI/layout-focused compositions
- scene-photoreal: realistic scenes, photos, cinematic or documentary framing
- scene-illustration: stylized or illustrative art, anime, painterly, vector/cartoon
- low-confidence: ambiguous intent or mixed signals where confidence is low

Keep routingReason concise (one sentence). Do not include markdown.`;

function parseRouterJson(content: string): RoutePromptResult {
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

  throw new Error("Image prompt router returned invalid JSON content");
}

function tryParseJson(content: string): RoutePromptResult | null {
  try {
    const parsed = JSON.parse(content);
    const result = routePromptSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Routes an image prompt to the appropriate category for model selection.
 * Does NOT enhance/rewrite the prompt - just determines routing.
 */
export async function routeImagePrompt(prompt: string): Promise<{
  routingCategory: RoutingCategory;
  routingReason: string;
}> {
  const completion = await openai.chat.completions.create({
    model: resolveOpenAiUpstreamModel("gpt-5.2"),
    max_completion_tokens: 256,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: ROUTER_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Image prompt router returned empty content");
  }

  return parseRouterJson(content);
}