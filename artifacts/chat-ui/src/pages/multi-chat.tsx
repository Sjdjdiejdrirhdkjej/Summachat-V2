import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/Markdown";
import { getFingerprint } from "@/lib/fingerprint";
import { saveChat, getChat, deriveChatTitle } from "@/lib/chat-store";
import { ChatSidebar } from "@/components/ChatSidebar";
import type { ModelId, Turn, ModelState } from "@/types/chat";

const MODELS = [
  {
    id: "gpt-5.2" as ModelId,
    label: "GPT 5.4 High",
    provider: "OpenAI",
    color: "bg-emerald-500",
    borderColor: "border-emerald-500",
    headerClass: "bg-emerald-950/60 border-emerald-800",
    chipActive: "bg-emerald-900/60 border-emerald-500 text-emerald-300",
    chipInactive:
      "bg-gray-900/30 border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400",
    icon: "⬡",
  },
  {
    id: "claude-opus-4-6" as ModelId,
    label: "Claude Opus 4.6",
    provider: "Anthropic",
    color: "bg-orange-500",
    borderColor: "border-orange-500",
    headerClass: "bg-orange-950/60 border-orange-800",
    chipActive: "bg-orange-900/60 border-orange-500 text-orange-300",
    chipInactive:
      "bg-gray-900/30 border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400",
    icon: "◈",
  },
  {
    id: "gemini-3.1-pro-preview" as ModelId,
    label: "Gemini 3.1 Pro",
    provider: "Google",
    color: "bg-blue-500",
    borderColor: "border-blue-500",
    headerClass: "bg-blue-950/60 border-blue-800",
    chipActive: "bg-blue-900/60 border-blue-500 text-blue-300",
    chipInactive:
      "bg-gray-900/30 border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400",
    icon: "✦",
  },
] as const;

const MODEL_MAP = Object.fromEntries(MODELS.map((m) => [m.id, m])) as Record<
  ModelId,
  (typeof MODELS)[number]
>;

type AppStatus = "idle" | "streaming";

interface Props {
  chatId: string;
}

export default function MultiChat({ chatId }: Props) {
  const [, navigate] = useLocation();
  const [selectedModels, setSelectedModels] = useState<Set<ModelId>>(
    new Set(["gpt-5.2", "claude-opus-4-6", "gemini-3.1-pro-preview"] as ModelId[])
  );
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [appStatus, setAppStatus] = useState<AppStatus>("idle");
  const [fp, setFp] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getFingerprint().then(setFp);
  }, []);

  useEffect(() => {
    const stored = getChat(chatId);
    if (stored) {
      setTurns(stored.turns);
      setSelectedModels(new Set(stored.selectedModels));
    } else {
      setTurns([]);
    }
  }, [chatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const persistChat = useCallback(
    (nextTurns: Turn[], models: Set<ModelId>) => {
      if (!fp) return;
      saveChat({
        id: chatId,
        fingerprint: fp,
        title: deriveChatTitle(nextTurns),
        selectedModels: Array.from(models) as ModelId[],
        turns: nextTurns,
        createdAt: getChat(chatId)?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      });
    },
    [chatId, fp]
  );

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

    const turnId = crypto.randomUUID();
    const modelIds = Array.from(selectedModels) as ModelId[];
    const initialModels: Partial<Record<ModelId, ModelState>> = {};
    for (const id of modelIds) {
      initialModels[id] = { content: "", status: "idle" };
    }

    const newTurn: Turn = {
      id: turnId,
      prompt: trimmed,
      selectedModels: modelIds,
      models: initialModels,
      summary: "",
      summaryStatus: "idle",
      webSearch,
      searchStatus: webSearch ? "searching" : "idle",
      searchResults: [],
    };

    const nextTurns = [...turns, newTurn];
    setTurns(nextTurns);

    const updateTurn = (updater: (t: Turn) => Turn) => {
      setTurns((prev) => prev.map((t) => (t.id === turnId ? updater(t) : t)));
    };

    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await fetch(`${base}/api/multi-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed, models: modelIds, webSearch }),
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
            const modelId = event.model as ModelId | undefined;

            switch (event.type) {
              case "model_start":
                if (!modelId) break;
                updateTurn((t) => ({
                  ...t,
                  models: {
                    ...t.models,
                    [modelId]: { content: "", status: "streaming" },
                  },
                }));
                break;
              case "model_chunk":
                if (!modelId || !event.content) break;
                updateTurn((t) => ({
                  ...t,
                  models: {
                    ...t.models,
                    [modelId]: {
                      ...t.models[modelId]!,
                      content: t.models[modelId]!.content + event.content,
                    },
                  },
                }));
                break;
              case "model_done":
                if (!modelId) break;
                updateTurn((t) => ({
                  ...t,
                  models: {
                    ...t.models,
                    [modelId]: { ...t.models[modelId]!, status: "done" },
                  },
                }));
                break;
              case "model_error":
                if (!modelId) break;
                updateTurn((t) => ({
                  ...t,
                  models: {
                    ...t.models,
                    [modelId]: {
                      ...t.models[modelId]!,
                      status: "error",
                      error: event.error,
                    },
                  },
                }));
                break;
              case "summary_start":
                updateTurn((t) => ({ ...t, summaryStatus: "streaming" }));
                break;
              case "summary_chunk":
                if (!event.content) break;
                updateTurn((t) => ({
                  ...t,
                  summary: t.summary + event.content,
                }));
                break;
              case "summary_done":
                updateTurn((t) => ({ ...t, summaryStatus: "done" }));
                break;
              case "summary_error":
                updateTurn((t) => ({ ...t, summaryStatus: "error" }));
                break;
            }
          } catch {}
        }
      }

      setTurns((finalTurns) => {
        persistChat(finalTurns, selectedModels);
        return finalTurns;
      });
      setAppStatus("idle");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setAppStatus("idle");
        return;
      }
      console.error(err);
      setAppStatus("idle");
    }
  }, [prompt, appStatus, selectedModels, turns, persistChat]);

  const handleStop = () => {
    abortRef.current?.abort();
    setAppStatus("idle");
  };

  const handleNew = () => {
    const id = crypto.randomUUID();
    navigate(`/chat/${id}`);
  };

  const canSend =
    prompt.trim().length > 0 &&
    selectedModels.size >= 2 &&
    appStatus === "idle";

  return (
    <div className="min-h-[100dvh] bg-gray-950 text-gray-100 flex flex-col">
      <ChatSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        currentChatId={chatId}
      />

      <header className="border-b border-gray-800 px-4 sm:px-6 py-3 flex flex-col gap-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors flex-shrink-0"
              aria-label="Open menu"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
            >
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                S
              </div>
              <div className="leading-tight text-left">
                <h1 className="text-sm font-semibold tracking-tight">
                  summachat V2
                </h1>
                <p className="text-[11px] text-gray-500">Multi-Model Chat</p>
              </div>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {appStatus === "streaming" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-gray-700 bg-transparent text-gray-300 hover:text-white hover:bg-gray-800 h-8 text-xs"
                onClick={handleStop}
              >
                Stop
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-gray-500 hover:text-gray-300 h-8 text-xs"
              onClick={handleNew}
              disabled={appStatus === "streaming"}
            >
              New Chat
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-gray-500 mr-1">Models:</span>
          {MODELS.map((m) => {
            const active = selectedModels.has(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleModel(m.id)}
                disabled={appStatus === "streaming"}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all",
                  active ? m.chipActive : m.chipInactive,
                  appStatus === "streaming" &&
                    "opacity-50 cursor-not-allowed"
                )}
              >
                <span
                  className={cn(
                    "w-4 h-4 rounded-sm flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0",
                    m.color
                  )}
                >
                  {m.icon}
                </span>
                {m.label}
              </button>
            );
          })}
          {selectedModels.size < 2 && (
            <span className="text-[11px] text-red-400">Select at least 2</span>
          )}
        </div>

        <p className="text-[10px] text-gray-800 font-mono truncate">
          /chat/{chatId}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto">
        {turns.length === 0 ? (
          <div className="h-full flex items-center justify-center px-4 py-16">
            <div className="text-center space-y-2">
              <p className="text-gray-400 text-sm">Start a conversation</p>
              <p className="text-gray-600 text-xs">
                Your message goes to all selected models at once
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-8">
            {turns.map((turn) => {
              const modelList = turn.selectedModels.map((id) => MODEL_MAP[id]).filter(Boolean);
              return (
                <div key={turn.id} className="space-y-4">
                  <div className="flex justify-end">
                    <div className="max-w-[75%] bg-violet-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                      {turn.prompt}
                    </div>
                  </div>

                  <div
                    className={cn(
                      "grid gap-px bg-gray-800 rounded-xl overflow-hidden border border-gray-800",
                      modelList.length === 2
                        ? "grid-cols-1 sm:grid-cols-2"
                        : "grid-cols-1 sm:grid-cols-3"
                    )}
                  >
                    {modelList.map((m) => {
                      const ms = turn.models[m.id];
                      return (
                        <div
                          key={m.id}
                          className="flex flex-col bg-gray-950 min-h-[120px]"
                        >
                          <div
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 border-b",
                              m.headerClass
                            )}
                          >
                            <span
                              className={cn(
                                "w-5 h-5 rounded flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0",
                                m.color
                              )}
                            >
                              {m.icon}
                            </span>
                            <span className="text-[11px] font-medium text-gray-300">
                              {m.label}
                            </span>
                            {ms?.status === "streaming" && (
                              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                            )}
                          </div>
                          <div className="p-3 flex-1">
                            {!ms || ms.status === "idle" ? (
                              <div className="flex items-center gap-1.5 text-xs text-gray-600">
                                <span className="w-3 h-3 rounded-full border-2 border-gray-700 border-t-gray-500 animate-spin" />
                                Waiting…
                              </div>
                            ) : ms.status === "error" ? (
                              <p className="text-xs text-red-400">
                                {ms.error ?? "Error"}
                              </p>
                            ) : (
                              <div className="text-xs">
                                <Markdown>{ms.content}</Markdown>
                                {ms.status === "streaming" && (
                                  <span className="inline-block w-1 h-3.5 bg-gray-500 ml-0.5 animate-pulse align-text-bottom" />
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-start">
                    <div className="max-w-[85%] flex gap-3">
                      <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5">
                        ∑
                      </div>
                      <div className="bg-gray-900 border border-gray-800 rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed text-gray-200 min-w-[120px]">
                        {turn.summaryStatus === "idle" ? (
                          <span className="flex items-center gap-1.5 text-xs text-gray-600">
                            <span className="w-3 h-3 rounded-full border-2 border-gray-700 border-t-gray-500 animate-spin" />
                            Waiting for models…
                          </span>
                        ) : turn.summaryStatus === "error" ? (
                          <span className="text-xs text-red-400">
                            Summary failed.
                          </span>
                        ) : (
                          <>
                            <Markdown>{turn.summary}</Markdown>
                            {turn.summaryStatus === "streaming" && (
                              <span className="inline-block w-1 h-4 bg-gray-400 ml-0.5 animate-pulse align-text-bottom" />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-gray-800 bg-gray-900/30 px-4 sm:px-6 py-3 flex-shrink-0">
        <div className="max-w-5xl mx-auto flex gap-3 items-end">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Message all models…  (Ctrl+Enter to send)"
            className="flex-1 bg-gray-950/60 border-gray-800 text-gray-100 placeholder:text-gray-600 resize-none min-h-[72px] max-h-[200px] focus:border-violet-500 focus:ring-violet-500/20"
            disabled={appStatus === "streaming"}
          />
          <Button
            onClick={handleSubmit}
            disabled={!canSend}
            className="bg-violet-600 hover:bg-violet-700 text-white px-5 h-10 flex-shrink-0"
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
