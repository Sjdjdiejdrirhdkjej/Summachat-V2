import { type RoutingCategory } from "./prompt-enhancer.js";

export type ImageProvider = "openai" | "gemini";
export type ImageModel = "gpt-image-1" | "gemini-2.5-flash-image";

export type RoutedImageTarget = {
  provider: ImageProvider;
  model: ImageModel;
};

const ROUTING_TABLE: Record<RoutingCategory, RoutedImageTarget> = {
  "text-heavy": { provider: "openai", model: "gpt-image-1" },
  "layout-product": { provider: "openai", model: "gpt-image-1" },
  "scene-photoreal": {
    provider: "gemini",
    model: "gemini-2.5-flash-image",
  },
  "scene-illustration": {
    provider: "gemini",
    model: "gemini-2.5-flash-image",
  },
  "low-confidence": { provider: "openai", model: "gpt-image-1" },
};

export function routeImageGeneration(
  category: RoutingCategory,
): RoutedImageTarget {
  return ROUTING_TABLE[category];
}
