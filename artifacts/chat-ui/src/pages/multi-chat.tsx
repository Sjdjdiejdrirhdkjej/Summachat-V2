import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const MODELS = [
  {
    id: "gpt-5.2" as const,
    label: "GPT 5.4 High",
    provider: "OpenAI",
    color: "bg-emerald-500",
    borderColor: "border-emerald-500",
    ringColor: "ring-emerald-500",
    badgeClass: "bg-emerald-900/40 text-emerald-300 border-emerald-700",
    headerClass: "bg-emerald-950/50 border-emerald-800",
    icon: "⬡",
  },
  {
    id: "claude-opus-4-6" as const,
    label: "Claude Opus 4.6",
    provider: "Anthropic",
    color: "bg-orange-500",
    borderColor: "border-orange-500",
    ringColor: "ring-orange-500",
    badgeClass: "bg-orange-900/40 text-orange-300 border-orange-700",
    headerClass: "bg-orange-950/50 border-orange-800",
    icon: "◈",
  },
  {
    id: "gemini-3.1-pro-preview" as const,
    label: "Gemini 3.1 Pro",
    provider: "Google",
    color: "bg-blue-500",
    borderColor: "border-blue-500",
    ringColor: "ring-blue-500",
    badgeClass: "bg-blue-900/40 text-blue-300 border-blue-700",
    headerClass: "bg-blue-950/50 border-blue-800",
    icon: "✦",
  },
] as const;

type ModelId = (typeof MODELS)[number]["id"];
type AppStatus = "idle" | "streaming" | "done" | "error";

type ModelState = {
  content: string;
  status: "idle" | "streaming" | "done" | "error";
  error?: string;
};

type RoundState = {
  prompt: string;
  models: Record<ModelId, ModelState>;
  summary: string;
  summaryStatus: "idle" | "streaming" | "done" | "error";
};

const MODEL_MAP = Object.fromEntries(MODELS.map((m) => [m.id, m])) as Record<
  ModelId,
  (typeof MODELS)[number]
>;

export default function MultiChat() {
  const [selectedModels, setSelectedModels] = useState<Set<ModelId>>(
    new Set(["gpt-5.2", "claude-opus-4-6"] as ModelId[])
  );
  const [prompt, setPrompt] = useState("");
  const [appStatus, setAppStatus] = useState<AppStatus>("idle");
  const [round, setRound] = useState<RoundState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const toggleModel = (id: ModelId) => {
    if (appStatus === "streaming") return;
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size <= 2) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSubmit = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || appStatus === "streaming" || selectedModels.size < 2) return;

    abortRef.current = new AbortController();
    setAppStatus("streaming");
    setPrompt("");

    const initialModelStates: Record<string, ModelState> = {};
    for (const id of selectedModels) {
      initialModelStates[id] = { content: "", status: "idle" };
    }

    const newRound: RoundState = {
      prompt: trimmed,
      models: initialModelStates as Record<ModelId, ModelState>,
      summary: "",
      summaryStatus: "idle",
    };
    setRound(newRound);

    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await fetch(`${base}/api/multi-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          models: Array.from(selectedModels),
        }),
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
          } catch {}
        }
      }

      setAppStatus("done");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setAppStatus("idle");
        return;
      }
      console.error("Stream error:", err);
      setAppStatus("error");
    }
  }, [prompt, appStatus, selectedModels]);

  const handleSSEEvent = (event: {
    type: string;
    model?: string;
    label?: string;
    content?: string;
    error?: string;
  }) => {
    const modelId = event.model as ModelId | undefined;

    switch (event.type) {
      case "model_start":
        if (!modelId) return;
        setRound((prev) =>
          prev
            ? {
                ...prev,
                models: {
                  ...prev.models,
                  [modelId]: { content: "", status: "streaming" },
                },
              }
            : prev
        );
        break;

      case "model_chunk":
        if (!modelId || !event.content) return;
        setRound((prev) =>
          prev
            ? {
                ...prev,
                models: {
                  ...prev.models,
                  [modelId]: {
                    ...prev.models[modelId],
                    content: prev.models[modelId].content + event.content,
                  },
                },
              }
            : prev
        );
        break;

      case "model_done":
        if (!modelId) return;
        setRound((prev) =>
          prev
            ? {
                ...prev,
                models: {
                  ...prev.models,
                  [modelId]: { ...prev.models[modelId], status: "done" },
                },
              }
            : prev
        );
        break;

      case "model_error":
        if (!modelId) return;
        setRound((prev) =>
          prev
            ? {
                ...prev,
                models: {
                  ...prev.models,
                  [modelId]: {
                    ...prev.models[modelId],
                    status: "error",
                    error: event.error,
                  },
                },
              }
            : prev
        );
        break;

      case "summary_start":
        setRound((prev) =>
          prev ? { ...prev, summaryStatus: "streaming" } : prev
        );
        break;

      case "summary_chunk":
        if (!event.content) return;
        setRound((prev) =>
          prev
            ? { ...prev, summary: prev.summary + event.content }
            : prev
        );
        break;

      case "summary_done":
        setRound((prev) =>
          prev ? { ...prev, summaryStatus: "done" } : prev
        );
        break;

      case "summary_error":
        setRound((prev) =>
          prev ? { ...prev, summaryStatus: "error" } : prev
        );
        break;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setAppStatus("idle");
  };

  const handleReset = () => {
    if (appStatus === "streaming") return;
    setRound(null);
    setAppStatus("idle");
  };

  const selectedModelList = MODELS.filter((m) => selectedModels.has(m.id));

  return (
    <div className="min-h-[100dvh] bg-gray-950 text-gray-100 flex flex-col">
      <header className="border-b border-gray-800 px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            S
          </div>
          <div className="leading-tight min-w-0">
            <h1 className="text-base sm:text-lg font-semibold tracking-tight">
              summachat V2
            </h1>
            <p className="text-xs text-gray-500">Multi-Model Synthesis</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {round && appStatus !== "streaming" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-gray-700 bg-transparent text-gray-400 hover:text-white hover:bg-gray-800"
              onClick={handleReset}
            >
              New Chat
            </Button>
          )}
          {appStatus === "streaming" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-gray-700 bg-transparent text-gray-300 hover:text-white hover:bg-gray-800"
              onClick={handleStop}
            >
              Stop
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 flex flex-col min-h-0 overflow-auto">
        {!round ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 gap-8">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-semibold text-gray-100">
                Ask multiple models at once
              </h2>
              <p className="text-sm text-gray-400 max-w-md">
                Select 2 or more models. Your prompt is sent to all of them
                simultaneously, then a synthesis summarises the results.
              </p>
            </div>

            <div className="flex flex-wrap gap-3 justify-center">
              {MODELS.map((m) => {
                const selected = selectedModels.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleModel(m.id)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-2xl border-2 transition-all duration-150 cursor-pointer select-none",
                      selected
                        ? cn(
                            "border-opacity-100 bg-gray-900",
                            m.borderColor
                          )
                        : "border-gray-800 bg-gray-900/30 opacity-60 hover:opacity-80"
                    )}
                  >
                    <span
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0",
                        m.color
                      )}
                    >
                      {m.icon}
                    </span>
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-100">
                        {m.label}
                      </p>
                      <p className="text-xs text-gray-500">{m.provider}</p>
                    </div>
                    <span
                      className={cn(
                        "ml-1 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                        selected
                          ? cn("border-current text-current", m.borderColor)
                          : "border-gray-700"
                      )}
                    >
                      {selected && (
                        <span className="w-2.5 h-2.5 rounded-full bg-current" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="text-xs text-gray-600">
              {selectedModels.size < 2
                ? "Select at least 2 models"
                : `${selectedModels.size} models selected`}
            </p>

            <div className="w-full max-w-2xl rounded-2xl border border-gray-800 bg-gray-900/40 p-3">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder="Ask anything… (Ctrl+Enter to send)"
                className="bg-gray-950/40 border-gray-800 text-gray-100 placeholder:text-gray-600 resize-none min-h-[96px] focus:border-violet-500 focus:ring-violet-500/20"
              />
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-gray-600">
                  {selectedModels.size >= 2 ? (
                    <>
                      Sending to{" "}
                      <span className="text-gray-400">
                        {selectedModelList.map((m) => m.label).join(", ")}
                      </span>
                    </>
                  ) : (
                    "Select at least 2 models"
                  )}
                </p>
                <Button
                  onClick={handleSubmit}
                  disabled={
                    !prompt.trim() ||
                    selectedModels.size < 2 ||
                    appStatus === "streaming"
                  }
                  className="bg-violet-600 hover:bg-violet-700 text-white px-6"
                >
                  Send
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-0 min-h-0 flex-1">
            <div className="px-4 sm:px-6 py-4 border-b border-gray-800 bg-gray-900/20">
              <p className="text-xs text-gray-500 mb-1">Your prompt</p>
              <p className="text-sm text-gray-200 whitespace-pre-wrap">
                {round.prompt}
              </p>
            </div>

            <div
              className={cn(
                "grid gap-px bg-gray-800 flex-1 min-h-0",
                selectedModelList.length === 2
                  ? "grid-cols-1 sm:grid-cols-2"
                  : "grid-cols-1 sm:grid-cols-3"
              )}
            >
              {selectedModelList.map((m) => {
                const ms = round.models[m.id];
                return (
                  <div
                    key={m.id}
                    className="flex flex-col bg-gray-950 min-h-[200px]"
                  >
                    <div
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 border-b",
                        m.headerClass
                      )}
                    >
                      <span
                        className={cn(
                          "w-6 h-6 rounded-md flex items-center justify-center text-white text-xs font-bold flex-shrink-0",
                          m.color
                        )}
                      >
                        {m.icon}
                      </span>
                      <span className="text-xs font-medium text-gray-200">
                        {m.label}
                      </span>
                      {ms?.status === "streaming" && (
                        <span className="ml-auto flex items-center gap-1 text-xs text-gray-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          generating
                        </span>
                      )}
                      {ms?.status === "done" && (
                        <span className="ml-auto text-xs text-gray-600">
                          done
                        </span>
                      )}
                      {ms?.status === "error" && (
                        <span className="ml-auto text-xs text-red-400">
                          error
                        </span>
                      )}
                    </div>
                    <ScrollArea className="flex-1">
                      <div className="p-4">
                        {ms?.status === "idle" ? (
                          <div className="flex items-center gap-2 text-xs text-gray-600">
                            <span className="w-3 h-3 rounded-full border-2 border-gray-700 border-t-gray-400 animate-spin" />
                            Waiting…
                          </div>
                        ) : ms?.status === "error" ? (
                          <p className="text-xs text-red-400">
                            {ms.error ?? "An error occurred"}
                          </p>
                        ) : (
                          <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                            {ms?.content}
                            {ms?.status === "streaming" && (
                              <span className="inline-block w-1.5 h-4 bg-gray-400 ml-0.5 animate-pulse align-text-bottom" />
                            )}
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-gray-800 bg-gray-900/30">
              <div className="flex items-center gap-2 px-4 sm:px-6 py-3 border-b border-gray-800/50">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  ∑
                </div>
                <span className="text-xs font-medium text-gray-200">
                  Synthesis
                </span>
                {round.summaryStatus === "streaming" && (
                  <span className="ml-auto flex items-center gap-1 text-xs text-gray-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                    summarising
                  </span>
                )}
                {round.summaryStatus === "idle" &&
                  appStatus === "streaming" && (
                    <span className="ml-auto text-xs text-gray-600">
                      waiting for models…
                    </span>
                  )}
              </div>
              <ScrollArea className="max-h-64">
                <div className="px-4 sm:px-6 py-4">
                  {round.summaryStatus === "idle" ? (
                    <p className="text-xs text-gray-600 italic">
                      Synthesis will appear here once all models respond.
                    </p>
                  ) : round.summaryStatus === "error" ? (
                    <p className="text-xs text-red-400">
                      Synthesis failed.
                    </p>
                  ) : (
                    <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                      {round.summary}
                      {round.summaryStatus === "streaming" && (
                        <span className="inline-block w-1.5 h-4 bg-gray-400 ml-0.5 animate-pulse align-text-bottom" />
                      )}
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>

            {appStatus !== "streaming" && (
              <div className="border-t border-gray-800 px-4 sm:px-6 py-4 bg-gray-900/20">
                <div className="w-full max-w-2xl mx-auto rounded-2xl border border-gray-800 bg-gray-900/40 p-3">
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleSubmit();
                      }
                    }}
                    placeholder="Ask a follow-up… (Ctrl+Enter to send)"
                    className="bg-gray-950/40 border-gray-800 text-gray-100 placeholder:text-gray-600 resize-none min-h-[72px] focus:border-violet-500 focus:ring-violet-500/20"
                  />
                  <div className="mt-2 flex items-center justify-end">
                    <Button
                      onClick={handleSubmit}
                      disabled={!prompt.trim() || appStatus === "streaming"}
                      className="bg-violet-600 hover:bg-violet-700 text-white px-6"
                    >
                      Send Again
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
