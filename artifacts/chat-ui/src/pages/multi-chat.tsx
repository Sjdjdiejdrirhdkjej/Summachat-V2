import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const MODELS = [
  {
    id: "gpt-5.2" as const,
    label: "GPT 5.4 High",
    provider: "OpenAI",
    color: "bg-emerald-500",
    borderColor: "border-emerald-400",
    badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-200",
    icon: "⬡",
  },
  {
    id: "claude-opus-4-6" as const,
    label: "Claude Opus 4.6",
    provider: "Anthropic",
    color: "bg-orange-500",
    borderColor: "border-orange-400",
    badgeClass: "bg-orange-100 text-orange-800 border-orange-200",
    icon: "◈",
  },
  {
    id: "gemini-3.1-pro-preview" as const,
    label: "Gemini 3.1 Pro",
    provider: "Google",
    color: "bg-blue-500",
    borderColor: "border-blue-400",
    badgeClass: "bg-blue-100 text-blue-800 border-blue-200",
    icon: "✦",
  },
] as const;

type ModelId = (typeof MODELS)[number]["id"];

interface ModelState {
  status: "idle" | "streaming" | "done" | "error";
  content: string;
  error?: string;
}

interface ChatState {
  modelStates: Record<ModelId, ModelState>;
  summaryStatus: "idle" | "streaming" | "done" | "error";
  summaryContent: string;
  summaryError?: string;
  isRunning: boolean;
}

const defaultModelState = (): ModelState => ({ status: "idle", content: "" });

const defaultChatState = (): ChatState => ({
  modelStates: {
    "gpt-5.2": defaultModelState(),
    "claude-opus-4-6": defaultModelState(),
    "gemini-3.1-pro-preview": defaultModelState(),
  },
  summaryStatus: "idle",
  summaryContent: "",
  isRunning: false,
});

export default function MultiChat() {
  const [selectedModels, setSelectedModels] = useState<Set<ModelId>>(
    new Set(["gpt-5.2", "claude-opus-4-6"])
  );
  const [prompt, setPrompt] = useState("");
  const [chatState, setChatState] = useState<ChatState>(defaultChatState());
  const abortRef = useRef<AbortController | null>(null);

  const toggleModel = (id: ModelId) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 2) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || selectedModels.size < 2 || chatState.isRunning) return;

    abortRef.current = new AbortController();
    setChatState({
      ...defaultChatState(),
      isRunning: true,
    });

    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await fetch(`${base}/api/multi-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), models: Array.from(selectedModels) }),
        signal: abortRef.current.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            handleSSEEvent(event);
          } catch {
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("Stream error:", err);
      }
    } finally {
      setChatState((prev) => ({ ...prev, isRunning: false }));
    }
  }, [prompt, selectedModels, chatState.isRunning]);

  const handleSSEEvent = (event: { type: string; model?: ModelId; content?: string; error?: string }) => {
    const { type, model } = event;

    if (type === "model_start" && model) {
      setChatState((prev) => ({
        ...prev,
        modelStates: {
          ...prev.modelStates,
          [model]: { status: "streaming", content: "" },
        },
      }));
    } else if (type === "model_chunk" && model && event.content) {
      setChatState((prev) => ({
        ...prev,
        modelStates: {
          ...prev.modelStates,
          [model]: {
            ...prev.modelStates[model],
            content: prev.modelStates[model].content + event.content,
          },
        },
      }));
    } else if (type === "model_done" && model) {
      setChatState((prev) => ({
        ...prev,
        modelStates: {
          ...prev.modelStates,
          [model]: { ...prev.modelStates[model], status: "done" },
        },
      }));
    } else if (type === "model_error" && model) {
      setChatState((prev) => ({
        ...prev,
        modelStates: {
          ...prev.modelStates,
          [model]: { status: "error", content: "", error: event.error },
        },
      }));
    } else if (type === "summary_start") {
      setChatState((prev) => ({ ...prev, summaryStatus: "streaming", summaryContent: "" }));
    } else if (type === "summary_chunk" && event.content) {
      setChatState((prev) => ({
        ...prev,
        summaryContent: prev.summaryContent + event.content,
      }));
    } else if (type === "summary_done") {
      setChatState((prev) => ({ ...prev, summaryStatus: "done" }));
    } else if (type === "summary_error") {
      setChatState((prev) => ({
        ...prev,
        summaryStatus: "error",
        summaryError: event.error,
      }));
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setChatState((prev) => ({ ...prev, isRunning: false }));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const selectedModelsList = MODELS.filter((m) => selectedModels.has(m.id));
  const hasResults = Object.values(chatState.modelStates).some((s) => s.content);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
            M
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Multi-Model Chat</h1>
        </div>
        <span className="text-gray-500 text-sm ml-1">Compare AI responses side by side</span>
      </header>

      <div className="flex flex-col flex-1 max-w-7xl w-full mx-auto px-6 py-6 gap-6">
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium text-gray-400 mb-3">Select 2 or more models</p>
            <div className="flex flex-wrap gap-3">
              {MODELS.map((model) => {
                const isSelected = selectedModels.has(model.id);
                const canDeselect = selectedModels.size > 2;
                return (
                  <button
                    key={model.id}
                    onClick={() => toggleModel(model.id)}
                    disabled={isSelected && !canDeselect}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all duration-150 text-left",
                      isSelected
                        ? `${model.borderColor} bg-gray-800`
                        : "border-gray-700 bg-gray-900 hover:border-gray-600",
                      isSelected && !canDeselect && "opacity-60 cursor-not-allowed"
                    )}
                  >
                    <span
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center text-white text-lg font-bold",
                        isSelected ? model.color : "bg-gray-700"
                      )}
                    >
                      {model.icon}
                    </span>
                    <div>
                      <p className={cn("text-sm font-medium", isSelected ? "text-white" : "text-gray-300")}>
                        {model.label}
                      </p>
                      <p className="text-xs text-gray-500">{model.provider}</p>
                    </div>
                    <div
                      className={cn(
                        "w-4 h-4 rounded border-2 flex items-center justify-center ml-1 flex-shrink-0",
                        isSelected ? `${model.borderColor} ${model.color}` : "border-gray-600"
                      )}
                    >
                      {isSelected && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask something... (Ctrl+Enter to send)"
                className="bg-gray-900 border-gray-700 text-gray-100 placeholder:text-gray-600 resize-none min-h-[80px] focus:border-violet-500 focus:ring-violet-500/20"
                disabled={chatState.isRunning}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleSubmit}
                disabled={!prompt.trim() || selectedModels.size < 2 || chatState.isRunning}
                className="bg-violet-600 hover:bg-violet-700 text-white px-6 h-10"
              >
                {chatState.isRunning ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Running
                  </span>
                ) : (
                  "Send"
                )}
              </Button>
              {chatState.isRunning && (
                <Button
                  onClick={handleStop}
                  variant="outline"
                  className="border-gray-700 text-gray-400 hover:text-gray-200 h-10 px-6"
                >
                  Stop
                </Button>
              )}
            </div>
          </div>
        </div>

        {hasResults && (
          <>
            <Separator className="bg-gray-800" />

            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: `repeat(${selectedModelsList.length}, minmax(0, 1fr))` }}
            >
              {selectedModelsList.map((model) => {
                const state = chatState.modelStates[model.id];
                return (
                  <Card key={model.id} className={cn("bg-gray-900 border-gray-800 flex flex-col", state.status === "streaming" && `border-t-2 ${model.borderColor}`)}>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "w-6 h-6 rounded flex items-center justify-center text-white text-xs font-bold",
                              model.color
                            )}
                          >
                            {model.icon}
                          </span>
                          <CardTitle className="text-sm font-medium text-gray-200">
                            {model.label}
                          </CardTitle>
                        </div>
                        {state.status === "streaming" && (
                          <span className="flex items-center gap-1 text-xs text-gray-500">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            Streaming
                          </span>
                        )}
                        {state.status === "done" && (
                          <Badge variant="outline" className="text-xs text-gray-500 border-gray-700">
                            Done
                          </Badge>
                        )}
                        {state.status === "error" && (
                          <Badge variant="outline" className="text-xs text-red-400 border-red-900">
                            Error
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 flex-1">
                      {state.status === "error" ? (
                        <p className="text-sm text-red-400">{state.error ?? "An error occurred"}</p>
                      ) : (
                        <ScrollArea className="max-h-72">
                          <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                            {state.content}
                            {state.status === "streaming" && (
                              <span className="inline-block w-1.5 h-4 bg-gray-400 ml-0.5 animate-pulse align-text-bottom" />
                            )}
                          </p>
                        </ScrollArea>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {(chatState.summaryStatus !== "idle") && (
              <Card className={cn(
                "bg-gray-900 border-gray-800",
                chatState.summaryStatus === "streaming" && "border-t-2 border-violet-400"
              )}>
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded bg-violet-600 flex items-center justify-center text-white text-xs font-bold">
                        ∑
                      </span>
                      <CardTitle className="text-sm font-medium text-gray-200">
                        Synthesis
                      </CardTitle>
                      <span className="text-xs text-gray-500">GPT 5.4 High summarising all responses</span>
                    </div>
                    {chatState.summaryStatus === "streaming" && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                        Synthesising
                      </span>
                    )}
                    {chatState.summaryStatus === "done" && (
                      <Badge variant="outline" className="text-xs text-gray-500 border-gray-700">
                        Done
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {chatState.summaryStatus === "error" ? (
                    <p className="text-sm text-red-400">{chatState.summaryError ?? "Synthesis failed"}</p>
                  ) : (
                    <ScrollArea className="max-h-80">
                      <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                        {chatState.summaryContent}
                        {chatState.summaryStatus === "streaming" && (
                          <span className="inline-block w-1.5 h-4 bg-gray-400 ml-0.5 animate-pulse align-text-bottom" />
                        )}
                      </p>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {!hasResults && !chatState.isRunning && (
          <div className="flex-1 flex items-center justify-center py-16">
            <div className="text-center space-y-3">
              <div className="flex justify-center gap-2 text-2xl">
                {MODELS.map((m) => (
                  <span
                    key={m.id}
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center text-white",
                      selectedModels.has(m.id) ? m.color : "bg-gray-800 text-gray-600"
                    )}
                  >
                    {m.icon}
                  </span>
                ))}
              </div>
              <p className="text-gray-500 text-sm">
                Select models, type a prompt, and hit Send
              </p>
              <p className="text-gray-700 text-xs">All models receive the same prompt simultaneously</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
