import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { resolveApiUrl } from "@/lib/api-base";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/Markdown";
import { getFingerprint } from "@/lib/fingerprint";
import { saveChat, getChat, deriveChatTitle } from "@/lib/chat-store";
import { ChatSidebar } from "@/components/ChatSidebar";
import type { ModelId, Turn, ModelState, GeneratedImageState } from "@/types/chat";

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
    icon: "/logo-openai.png",
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
    icon: "/logo-anthropic.png",
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
    icon: "/logo-gemini.png",
  },
] as const;

const MODEL_MAP = Object.fromEntries(MODELS.map((m) => [m.id, m])) as Record<
  ModelId,
  (typeof MODELS)[number]
>;

type AppStatus = "idle" | "streaming";

type MultiChatTurn = Turn & {
  moderatorOutput?: string;
  searchError?: string;
  summaryError?: string;
};

const DEFAULT_IMAGE_GENERATION_STATE: GeneratedImageState = {
  status: "idle",
};

const INCOMPLETE_MODEL_ERROR =
  "Connection ended before this model produced a complete response.";
const INCOMPLETE_MODERATOR_ERROR =
  "Connection ended before the moderator finished.";
const INCOMPLETE_SUMMARY_ERROR =
  "Connection ended before the summary finished.";
const INCOMPLETE_SEARCH_ERROR = "Connection ended before web search finished.";
const MISSING_MODEL_TERMINAL_ERROR =
  "This model never reached a terminal response state.";
const MISSING_MODERATOR_TERMINAL_ERROR =
  "Moderator review never reached a terminal response state.";
const MISSING_SEARCH_TERMINAL_ERROR =
  "Web search never reached a terminal response state.";

function isModelId(value: unknown): value is ModelId {
  return typeof value === "string" && value in MODEL_MAP;
}

function normalizeTurn(
  turn: Turn & { moderatorOutput?: string },
): MultiChatTurn {
  return {
    ...turn,
    mode: turn.mode ?? "chat",
    imageGeneration: turn.imageGeneration ?? { status: "idle" },
    moderatorStatus: turn.moderatorStatus ?? "idle",
    moderatorOutput: turn.moderatorOutput ?? "",
    summaryThinking: turn.summaryThinking ?? "",
  };
}

const settleTurnAfterStream = (
  turn: MultiChatTurn,
  sawDoneEvent: boolean,
): MultiChatTurn => {
  const models = { ...turn.models };

  for (const modelId of turn.selectedModels) {
    const modelState = models[modelId];

    if (!modelState || modelState.status === "idle") {
      models[modelId] = {
        content: modelState?.content ?? "",
        status: "error",
        error: sawDoneEvent
          ? MISSING_MODEL_TERMINAL_ERROR
          : INCOMPLETE_MODEL_ERROR,
      };
      continue;
    }

    if (modelState.status === "streaming") {
      models[modelId] = modelState.content
        ? { ...modelState, status: "done" }
        : {
            ...modelState,
            status: "error",
            error: sawDoneEvent
              ? MISSING_MODEL_TERMINAL_ERROR
              : INCOMPLETE_MODEL_ERROR,
          };
    }
  }

  const successfulModels = turn.selectedModels.filter(
    (modelId) => models[modelId]?.status === "done",
  );

  let moderatorStatus = turn.moderatorStatus;
  let moderatorError = turn.moderatorError;

  if (successfulModels.length >= 2) {
    const hasModeratorResult =
      Boolean(turn.moderatorChoice) ||
      Boolean(turn.moderatorNote) ||
      Boolean(turn.moderatorOutput);

    if (moderatorStatus === "streaming") {
      if (hasModeratorResult) {
        moderatorStatus = "done";
      } else {
        moderatorStatus = "error";
        moderatorError = moderatorError ?? INCOMPLETE_MODERATOR_ERROR;
      }
    } else if (moderatorStatus === "idle") {
      if (hasModeratorResult) {
        moderatorStatus = "done";
      } else {
        moderatorStatus = "error";
        moderatorError =
          moderatorError ??
          (sawDoneEvent
            ? MISSING_MODERATOR_TERMINAL_ERROR
            : INCOMPLETE_MODERATOR_ERROR);
      }
    }
  }

  let summaryStatus = turn.summaryStatus;
  let summaryError = turn.summaryError;

  if (summaryStatus === "streaming") {
    if (turn.summary) {
      summaryStatus = "done";
    } else {
      summaryStatus = "error";
      summaryError = summaryError ?? INCOMPLETE_SUMMARY_ERROR;
    }
  } else if (summaryStatus === "idle") {
    if (turn.summary) {
      summaryStatus = "done";
    } else {
      summaryStatus = "error";
      summaryError =
        summaryError ??
        (successfulModels.length > 0
          ? sawDoneEvent
            ? "Summary was not returned."
            : INCOMPLETE_SUMMARY_ERROR
          : "No successful model responses.");
    }
  }

  let searchStatus = turn.searchStatus;
  let searchError = turn.searchError;

  if (turn.webSearch && searchStatus === "searching") {
    searchStatus = turn.searchResults.length > 0 ? "done" : "error";
    searchError =
      searchError ??
      (turn.searchResults.length > 0
        ? undefined
        : sawDoneEvent
          ? MISSING_SEARCH_TERMINAL_ERROR
          : INCOMPLETE_SEARCH_ERROR);
  }

  return {
    ...turn,
    models,
    moderatorStatus,
    moderatorError,
    summaryStatus,
    summaryError,
    searchStatus,
    searchError,
  };
};

function AutoScrollBox({
  streaming,
  className,
  children,
}: {
  streaming: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (streaming && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  });

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

interface Props {
  chatId: string;
}

export default function MultiChat({ chatId }: Props) {
  const [, navigate] = useLocation();
  const [selectedModels, setSelectedModels] = useState<Set<ModelId>>(
    new Set([
      "gpt-5.2",
      "claude-opus-4-6",
      "gemini-3.1-pro-preview",
    ] as ModelId[]),
  );
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<MultiChatTurn[]>([]);
  const [appStatus, setAppStatus] = useState<AppStatus>("idle");
  const [fp, setFp] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedPanels, setExpandedPanels] = useState<Set<string>>(new Set());
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);
  const [webSearch, setWebSearch] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getFingerprint().then(setFp);
  }, []);

  useEffect(() => {
    const stored = getChat(chatId);
    if (stored) {
      setTurns(stored.turns.map(normalizeTurn));
      setSelectedModels(new Set(stored.selectedModels));
    } else {
      setTurns([]);
    }
  }, [chatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const persistChat = useCallback(
    (nextTurns: MultiChatTurn[], models: Set<ModelId>) => {
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
    [chatId, fp],
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
    if (!trimmed || appStatus === "streaming" || selectedModels.size < 2)
      return;

    abortRef.current = new AbortController();
    setAppStatus("streaming");
    setPrompt("");

    const turnId = crypto.randomUUID();
    const modelIds = Array.from(selectedModels) as ModelId[];
    const initialModels: Partial<Record<ModelId, ModelState>> = {};
    for (const id of modelIds) {
      initialModels[id] = { content: "", status: "idle" };
    }

    const newTurn: MultiChatTurn = {
      id: turnId,
      prompt: trimmed,
      mode: imageMode ? "image" : "chat",
      selectedModels: modelIds,
      models: initialModels,
      moderatorStatus: "idle",
      moderatorOutput: "",
      summary: "",
      summaryThinking: "",
      summaryStatus: "idle",
      webSearch,
      searchStatus: webSearch ? "searching" : "idle",
      searchResults: [],
      imageGeneration: { status: imageMode ? "generating" : "idle" },
    };

    const nextTurns = [...turns, newTurn];
    setTurns(nextTurns);

    const updateTurn = (updater: (t: MultiChatTurn) => MultiChatTurn) => {
      setTurns((prev) => prev.map((t) => (t.id === turnId ? updater(t) : t)));
    };

    let sawDoneEvent = false;

    const handleEvent = (event: Record<string, unknown>) => {
      const modelId = event.model as ModelId | undefined;

      switch (event.type) {
        case "search_start":
          updateTurn((t) => ({
            ...t,
            searchStatus: "searching",
            searchError: undefined,
            searchResults: [],
          }));
          break;
        case "search_done":
          updateTurn((t) => ({
            ...t,
            searchStatus: "done",
            searchError: undefined,
            searchResults: Array.isArray(event.results)
              ? event.results
                  .filter(
                    (
                      result,
                    ): result is {
                      title: string;
                      url: string;
                    } => {
                      if (!result || typeof result !== "object") return false;

                      const { title, url } = result as {
                        title?: unknown;
                        url?: unknown;
                      };

                      return (
                        typeof title === "string" && typeof url === "string"
                      );
                    },
                  )
                  .map(({ title, url }) => ({ title, url }))
              : [],
          }));
          break;
        case "search_error":
          updateTurn((t) => ({
            ...t,
            searchStatus: "error",
            searchError:
              typeof event.error === "string"
                ? event.error
                : "Web search failed.",
          }));
          break;
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
          if (!modelId || typeof event.content !== "string") break;
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
                error:
                  typeof event.error === "string"
                    ? event.error
                    : "Model response failed.",
              },
            },
          }));
          break;
        case "moderator_start":
          updateTurn((t) => ({
            ...t,
            moderatorStatus: "streaming",
            moderatorError: undefined,
            moderatorChoice: undefined,
            moderatorNote: undefined,
            moderatorOutput: "",
          }));
          break;
        case "moderator_chunk":
          if (typeof event.content !== "string") break;
          updateTurn((t) => ({
            ...t,
            moderatorOutput: (t.moderatorOutput ?? "") + event.content,
          }));
          break;
        case "moderator_done":
          updateTurn((t) => ({
            ...t,
            moderatorStatus: "done",
            moderatorChoice: isModelId(event.choice)
              ? event.choice
              : t.moderatorChoice,
            moderatorNote:
              typeof event.note === "string" ? event.note : t.moderatorNote,
          }));
          break;
        case "moderator_error":
          updateTurn((t) => ({
            ...t,
            moderatorStatus: "error",
            moderatorError:
              typeof event.error === "string"
                ? event.error
                : "Moderator failed.",
          }));
          break;
        case "summary_start":
          updateTurn((t) => ({
            ...t,
            summaryStatus: "streaming",
            summaryError: undefined,
          }));
          break;
        case "summary_thinking_chunk":
          if (typeof event.content !== "string") break;
          updateTurn((t) => ({
            ...t,
            summaryThinking: (t.summaryThinking ?? "") + event.content,
          }));
          break;
        case "summary_chunk":
          if (typeof event.content !== "string") break;
          updateTurn((t) => ({
            ...t,
            summary: t.summary + event.content,
          }));
          break;
        case "summary_done":
          updateTurn((t) => ({ ...t, summaryStatus: "done" }));
          break;
        case "summary_error":
          updateTurn((t) => ({
            ...t,
            summaryStatus: "error",
            summaryError:
              typeof event.error === "string" ? event.error : "Summary failed.",
          }));
          break;
        case "image_generation_start":
          updateTurn((t) => ({
            ...t,
            imageGeneration: { status: "generating" },
          }));
          break;
        case "image_generation_routed":
          updateTurn((t) => ({
            ...t,
            imageGeneration: {
              ...t.imageGeneration,
              provider: typeof event.provider === "string" ? event.provider : undefined,
              routingReason: typeof event.routingReason === "string" ? event.routingReason : undefined,
            },
          }));
          break;
        case "image_generation_done":
          updateTurn((t) => ({
            ...t,
            imageGeneration: {
              status: "done",
              imageId: typeof event.imageId === "string" ? event.imageId : undefined,
              provider: typeof event.provider === "string" ? event.provider : undefined,
              model: typeof event.model === "string" ? event.model : undefined,
              routingReason: typeof event.routingReason === "string" ? event.routingReason : undefined,
            },
          }));
          break;
        case "image_generation_error":
          updateTurn((t) => ({
            ...t,
            imageGeneration: {
              status: "error",
              error: typeof event.error === "string" ? event.error : "Image generation failed.",
              blockReason: typeof event.blockReason === "string" ? event.blockReason : undefined,
            },
          }));
          break;
        case "done":
          sawDoneEvent = true;
          break;
      }
    };

    const processSseChunk = (chunk: string) => {
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;

        try {
          handleEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
        } catch (e) {
          console.error("Failed to parse SSE event:", e, "Line:", line);
        }
      }
    };

    try {
      const history = turns.flatMap((t) => {
        if (!t.summary || t.summaryStatus !== "done") return [];
        return [
          { role: "user" as const, content: t.prompt },
          { role: "assistant" as const, content: t.summary },
        ];
      });

      const response = await fetch(resolveApiUrl("/api/multi-chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          models: modelIds,
          webSearch,
          mode: imageMode ? "image" : "chat",
          history,
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
        if (done) {
          buffer += decoder.decode();
          if (buffer) {
            processSseChunk(buffer);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        processSseChunk(lines.join("\n"));
      }

      setTurns((finalTurns) => {
        const settledTurns = finalTurns.map((turn) =>
          turn.id === turnId ? settleTurnAfterStream(turn, sawDoneEvent) : turn,
        );

        persistChat(settledTurns, selectedModels);
        return settledTurns;
      });
      setAppStatus("idle");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setAppStatus("idle");
        return;
      }
      setAppStatus("idle");
    }
  }, [prompt, appStatus, selectedModels, turns, persistChat, webSearch, imageMode]);

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
    (imageMode || selectedModels.size >= 2) &&
    appStatus === "idle";

  return (
    <div className="h-[100dvh] bg-gray-950 text-gray-100 flex flex-row overflow-hidden">
      <ChatSidebar
        collapsed={!sidebarOpen}
        onToggle={() => setSidebarOpen((o) => !o)}
        currentChatId={chatId}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
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
                <path
                  d="M2 4h12M2 8h12M2 12h12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
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

          <div className="flex items-center gap-1 sm:gap-2">
            {appStatus === "streaming" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-gray-700 bg-transparent text-gray-300 hover:text-white hover:bg-gray-800 h-10 min-h-[44px] px-3 sm:px-4 text-xs sm:text-xs"
                onClick={handleStop}
              >
                <span className="hidden sm:inline">Stop</span>
                <span className="sm:hidden">■</span>
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-gray-500 hover:text-gray-300 h-10 min-h-[44px] px-3 sm:px-4 text-xs sm:text-xs"
              onClick={handleNew}
              disabled={appStatus === "streaming"}
            >
              <span className="hidden sm:inline">New Chat</span>
              <span className="sm:hidden">+</span>
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={appStatus === "streaming" || imageMode}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-700 bg-gray-900/50 text-xs font-medium text-gray-300 transition-all hover:border-gray-600 min-h-[44px]",
                  (appStatus === "streaming" || imageMode) && "opacity-50 cursor-not-allowed",
                )}
              >
                <div className="flex items-center -space-x-1">
                  {MODELS.filter((m) => selectedModels.has(m.id)).map((m) => (
                    <img
                      key={m.id}
                      src={m.icon}
                      alt={m.provider}
                      className="w-4 h-4 rounded-sm object-contain ring-1 ring-gray-900"
                    />
                  ))}
                </div>
                <span>{selectedModels.size} Models</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="bg-gray-900 border-gray-700">
              <DropdownMenuLabel className="text-gray-400 text-xs">Select models (2+)</DropdownMenuLabel>
              {MODELS.map((m) => (
                <DropdownMenuCheckboxItem
                  key={m.id}
                  checked={selectedModels.has(m.id)}
                  onCheckedChange={() => toggleModel(m.id)}
                  onSelect={(e) => e.preventDefault()}
                  className="text-gray-200 focus:bg-gray-800 focus:text-gray-100"
                >
                  <div className="flex items-center gap-2">
                    <img src={m.icon} alt={m.provider} className="w-4 h-4 rounded-sm object-contain" />
                    <span>{m.label}</span>
                    <span className="text-[10px] text-gray-500">{m.provider}</span>
                  </div>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {selectedModels.size < 2 && (
            <span className="text-[11px] text-red-400">Select 2+</span>
          )}
        </div>

        <p className="text-[10px] text-gray-800 font-mono truncate">
          /chat/{chatId}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto min-h-0">
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
              const modelList = turn.selectedModels
                .map((id) => MODEL_MAP[id])
                .filter(Boolean);
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
                        : "grid-cols-1 sm:grid-cols-3",
                    )}
                  >
                    {modelList.map((m) => {
                      const ms = turn.models[m.id];
                      const panelKey = `${turn.id}-${m.id}`;
                      const isExpanded = expandedPanels.has(panelKey);
                      const canExpand =
                        ms?.status === "done" || ms?.status === "error";
                      const toggleExpand = () => {
                        if (!canExpand) return;
                        setExpandedPanels((prev) => {
                          const next = new Set(prev);
                          if (isMobile && !next.has(panelKey)) {
                            next.clear();
                          }
                          if (next.has(panelKey)) {
                            next.delete(panelKey);
                          } else {
                            next.add(panelKey);
                          }
                          return next;
                        });
                      };
                      return (
                        <div
                          key={m.id}
                          className="flex flex-col bg-gray-950 min-h-[10rem]"
                        >
                          <div
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 border-b flex-shrink-0",
                              m.headerClass,
                            )}
                          >
                            <img
                              src={m.icon}
                              alt={m.provider}
                              className="w-5 h-5 rounded flex-shrink-0 object-contain"
                            />
                            <span className="text-[11px] font-medium text-gray-300">
                              {m.label}
                            </span>
                            {ms?.status === "streaming" ? (
                              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                            ) : canExpand && ms?.content ? (
                              <button
                                type="button"
                                onClick={toggleExpand}
                                className="ml-auto text-gray-500 hover:text-gray-300 transition-colors p-0.5 rounded"
                                aria-label={isExpanded ? "Collapse" : "Expand"}
                              >
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className={cn(
                                    "transition-transform",
                                    isExpanded && "rotate-180",
                                  )}
                                >
                                  <path d="m6 9 6 6 6-6" />
                                </svg>
                              </button>
                            ) : null}
                          </div>
                          <div
                            className={cn(
                              "relative",
                              canExpand && !isExpanded && "cursor-pointer",
                            )}
                            onClick={
                              canExpand && !isExpanded
                                ? toggleExpand
                                : undefined
                            }
                          >
                            <AutoScrollBox
                              streaming={ms?.status === "streaming"}
                              className={cn(
                                "p-3 overflow-y-auto",
                                isExpanded ? "max-h-[60vh]" : "max-h-[10rem]",
                              )}
                            >
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
                            </AutoScrollBox>
                            {!isExpanded && canExpand && ms?.content && (
                              <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-gray-950 to-transparent pointer-events-none" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-start">
                    <div className="max-w-[85%] flex gap-3">
                      <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5">
                        M
                      </div>
                      <div className="bg-amber-950/30 border border-amber-900/50 rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed text-amber-100 min-w-[120px]">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-300/80">
                            Moderator
                          </span>
                          {turn.moderatorChoice && (
                            <span className="inline-flex items-center rounded-full border border-amber-700/70 bg-amber-900/40 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                              {MODEL_MAP[turn.moderatorChoice].label}
                            </span>
                          )}
                          {turn.moderatorStatus === "streaming" && (
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                          )}
                        </div>
                        {turn.moderatorStatus === "idle" ? (
                          <span className="flex items-center gap-1.5 text-xs text-amber-200/60">
                            <span className="w-3 h-3 rounded-full border-2 border-amber-900 border-t-amber-400 animate-spin" />
                            Waiting to compare responses…
                          </span>
                        ) : turn.moderatorStatus === "error" ? (
                          <span className="text-xs text-red-300">
                            {turn.moderatorError ?? "Moderator failed."}
                          </span>
                        ) : (
                          <div className="text-xs leading-relaxed text-amber-100/90">
                            {turn.moderatorNote ? (
                              <p>{turn.moderatorNote}</p>
                            ) : turn.moderatorOutput ? (
                              <p className="whitespace-pre-wrap">
                                {turn.moderatorOutput}
                              </p>
                            ) : (
                              <span className="text-amber-200/60">
                                Moderator finished without a note.
                              </span>
                            )}
                            {turn.moderatorStatus === "streaming" && (
                              <span className="inline-block w-1 h-3.5 bg-amber-300 ml-0.5 animate-pulse align-text-bottom" />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
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
                            {turn.summaryError ?? "Summary failed."}
                          </span>
                        ) : (
                          <>
                            {turn.summaryThinking && (
                              <details open className="mb-3 group">
                                <summary className="text-[11px] text-violet-400 cursor-pointer hover:text-violet-300 select-none flex items-center gap-1.5 transition-colors font-medium">
                                  <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="transition-transform group-open:rotate-90"
                                  >
                                    <path d="m9 18 6-6-6-6" />
                                  </svg>
                                  Reasoning
                                  {turn.summaryStatus === "streaming" &&
                                    !turn.summary && (
                                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                                    )}
                                </summary>
                                <AutoScrollBox
                                  streaming={
                                    turn.summaryStatus === "streaming" &&
                                    !turn.summary
                                  }
                                  className="mt-2 p-3 bg-violet-950/30 border border-violet-900/50 rounded-lg text-xs text-gray-400 leading-relaxed max-h-[10rem] overflow-y-auto"
                                >
                                  <Markdown>{turn.summaryThinking}</Markdown>
                                  {turn.summaryStatus === "streaming" &&
                                    !turn.summary && (
                                      <span className="inline-block w-1 h-3.5 bg-violet-400 ml-0.5 animate-pulse align-text-bottom" />
                                    )}
                                </AutoScrollBox>
                              </details>
                            )}
                            {!turn.summary &&
                            turn.summaryStatus === "streaming" &&
                            !turn.summaryThinking ? (
                              <span className="flex items-center gap-1.5 text-xs text-gray-600">
                                <span className="w-3 h-3 rounded-full border-2 border-gray-700 border-t-gray-500 animate-spin" />
                                Thinking…
                              </span>
                            ) : !turn.summary &&
                              turn.summaryStatus === "streaming" &&
                              turn.summaryThinking ? (
                              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                                Writing response…
                              </span>
                            ) : (
                              <Markdown>{turn.summary}</Markdown>
                            )}
                            {turn.summaryStatus === "streaming" &&
                              turn.summary && (
                                <span className="inline-block w-1 h-4 bg-gray-400 ml-0.5 animate-pulse align-text-bottom" />
                              )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Image Generation Result */}
                  {turn.mode === "image" && turn.imageGeneration.status !== "idle" && (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] flex gap-3">
                        <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5">
                          ⊛
                        </div>
                        <div className="bg-gray-900 border border-gray-800 rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed text-gray-200 min-w-[120px]">
                          {turn.imageGeneration.status === "generating" && (
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-violet-400 animate-pulse" />
                              <span className="text-xs text-gray-400">
                                Generating image
                                {turn.imageGeneration.routingReason && <span className="ml-1 text-gray-500">— {turn.imageGeneration.routingReason}</span>}
                              </span>
                            </div>
                          )}
                          {turn.imageGeneration.status === "done" && turn.imageGeneration.imageId && (
                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-300/80">
                                  Generated Image
                                </span>
                                {turn.imageGeneration.model && (
                                  <span className="inline-flex items-center rounded-full border border-violet-700/70 bg-violet-900/40 px-2 py-0.5 text-[11px] font-medium text-violet-200">
                                    {turn.imageGeneration.model}
                                  </span>
                                )}
                              </div>
                              <div className="relative rounded-lg overflow-hidden bg-gray-950 border border-gray-800">
                                <img
                                  src={resolveApiUrl(
                                    `/api/images/${turn.imageGeneration.imageId}/content`,
                                  )}
                                  alt="Generated"
                                  className="w-full h-auto max-h-[400px] object-contain"
                                />
                              </div>
                              {turn.imageGeneration.routingReason && (
                                <p className="text-[10px] text-gray-500">
                                  Routed: {turn.imageGeneration.routingReason}
                                </p>
                              )}
                            </div>
                          )}
                          {turn.imageGeneration.status === "error" && (
                            <div className="text-xs text-red-400">
                              {turn.imageGeneration.error}
                              {turn.imageGeneration.blockReason && (
                                <span className="block mt-1 text-red-300/70">
                                  Blocked: {turn.imageGeneration.blockReason}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-gray-800 bg-gray-900/30 px-3 sm:px-4 py-3 flex-shrink-0">
        <div className="max-w-5xl mx-auto space-y-2">
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setWebSearch((v) => !v)}
              disabled={appStatus === "streaming"}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 sm:px-2.5 sm:py-1 rounded-full border text-xs font-medium transition-all min-h-[44px]",
                webSearch
                  ? "bg-sky-900/60 border-sky-500 text-sky-300"
                  : "bg-gray-900/30 border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400",
                appStatus === "streaming" && "opacity-50 cursor-not-allowed",
              )}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="flex-shrink-0"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span className="hidden sm:inline">Web Search</span>
              <span className="sm:hidden">Web</span>
            </button>
            <button
              onClick={() => {
                setImageMode((v) => !v);
                // Auto-select all 3 models when image mode is enabled
                if (!imageMode) {
                  setSelectedModels(new Set(["gpt-5.2", "claude-opus-4-6", "gemini-3.1-pro-preview"] as ModelId[]));
                }
              }}
              disabled={appStatus === "streaming"}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 sm:px-2.5 sm:py-1 rounded-full border text-xs font-medium transition-all min-h-[44px]",
                imageMode
                  ? "bg-violet-900/60 border-violet-500 text-violet-300"
                  : "bg-gray-900/30 border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400",
                appStatus === "streaming" && "opacity-50 cursor-not-allowed",
              )}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="flex-shrink-0"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span className="hidden sm:inline">Image Gen</span>
              <span className="sm:hidden">Img</span>
            </button>
          </div>
          <div className="flex gap-2 sm:gap-3 items-end">
            <div className="flex-1 relative">
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
                className="bg-gray-950/60 border-gray-800 text-gray-100 placeholder:text-gray-600 resize-none min-h-[48px] max-h-[120px] focus:border-violet-500 focus:ring-violet-500/20 text-base sm:text-sm"
                disabled={appStatus === "streaming"}
                style={{
                  paddingBottom: "12px",
                  paddingTop: "12px",
                  fieldSizing: "content",
                  minHeight: "48px",
                }}
              />
            </div>
            <Button
              onClick={handleSubmit}
              disabled={!canSend}
              className="bg-violet-600 hover:bg-violet-700 text-white px-4 sm:px-5 h-12 min-h-[48px] flex-shrink-0 text-sm"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="sm:hidden"
              >
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
              <span className="hidden sm:inline">Send</span>
            </Button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
