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

export type Turn = {
  id: string;
  prompt: string;
  selectedModels: ModelId[];
  models: Partial<Record<ModelId, ModelState>>;
  summary: string;
  summaryStatus: "idle" | "streaming" | "done" | "error";
  webSearch: boolean;
  searchStatus: "idle" | "searching" | "done" | "error";
  searchResults: SearchResult[];
};
