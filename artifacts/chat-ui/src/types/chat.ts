export type ModelId = "gpt-5.2" | "claude-opus-4-6" | "gemini-3.1-pro-preview";

export type ModelState = {
  content: string;
  status: "idle" | "streaming" | "done" | "error";
  error?: string;
};

export type SearchResult = {
  title: string;
  url: string;
};

export type TurnMode = "chat" | "image";

export type GeneratedImageState = {
  status: "idle" | "generating" | "done" | "error";
  imageId?: string;
  provider?: string;
  model?: string;
  routingReason?: string;
  error?: string;
  blockReason?: string;
};

export type Turn = {
  id: string;
  prompt: string;
  mode: TurnMode;
  selectedModels: ModelId[];
  models: Partial<Record<ModelId, ModelState>>;
  moderatorChoice?: ModelId;
  moderatorNote?: string;
  moderatorStatus: "idle" | "streaming" | "done" | "error";
  moderatorError?: string;
  summary: string;
  summaryThinking?: string;
  summaryStatus: "idle" | "streaming" | "done" | "error";
  webSearch: boolean;
  searchStatus: "idle" | "searching" | "done" | "error";
  searchResults: SearchResult[];
  imageGeneration: GeneratedImageState;
};
