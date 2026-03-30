import type { ModelId, ModelState, SearchResult } from "./chat";

// Turn type discriminator
export type TurnType = "text" | "compare" | "image";

// Base turn interface
export interface BaseTurn {
  id: string;
  type: TurnType;
  prompt: string;
  createdAt: number;
}

// Text turn - single model response
export interface TextTurn extends BaseTurn {
  type: "text";
  modelId: ModelId;
  modelState: ModelState;
  webSearch: boolean;
  searchStatus: "idle" | "searching" | "done" | "error";
  searchResults: SearchResult[];
  searchError?: string;
}

// Compare turn - multi-model comparison
export interface CompareTurn extends BaseTurn {
  type: "compare";
  selectedModels: ModelId[];
  models: Partial<Record<ModelId, ModelState>>;
  moderatorChoice?: ModelId;
  moderatorNote?: string;
  moderatorStatus: "idle" | "streaming" | "done" | "error";
  moderatorError?: string;
  summary: string;
  summaryThinking?: string;
  summaryStatus: "idle" | "streaming" | "done" | "error";
  summaryError?: string;
  webSearch: boolean;
  searchStatus: "idle" | "searching" | "done" | "error";
  searchResults: SearchResult[];
  searchError?: string;
}

// Image generation turn
export interface ImageTurn extends BaseTurn {
  type: "image";
  status: "idle" | "generating" | "done" | "error";
  imageId?: string;
  originalPrompt: string;
  enhancedPrompt?: string;
  provider?: string;
  model?: string;
  error?: string;
  variations?: string[]; // IDs of variations
}

// Union of all turn types
export type UnifiedTurn = TextTurn | CompareTurn | ImageTurn;

// Composer modes
export type ComposerMode = "ask" | "compare" | "image";

// Composer state for mode selection
export interface ComposerState {
  mode: ComposerMode;
  selectedModel: ModelId;
  selectedModels: Set<ModelId>;
  webSearch: boolean;
  imageAspectRatio?: "square" | "wide" | "tall";
}

// Legacy type aliases for compatibility during migration
// TODO: Remove after full migration
export type { ModelId, ModelState, SearchResult };
// Re-export Turn from chat for backward compatibility
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type LegacyTurn = import("./chat").Turn;