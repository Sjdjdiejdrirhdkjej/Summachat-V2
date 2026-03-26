import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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

type ChatStatus = "idle" | "streaming" | "error";
type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

const newId = () => crypto.randomUUID();

export default function MultiChat() {
  const [modelId, setModelId] = useState<ModelId>("gpt-5.2");
  const [prompt, setPrompt] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const modelById = useMemo(() => {
    const map = new Map<ModelId, (typeof MODELS)[number]>();
    for (const m of MODELS) map.set(m.id, m);
    return map;
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || status === "streaming") return;

    abortRef.current = new AbortController();
    setStatus("streaming");
    setError(undefined);

    const userMessage: ChatMessage = {
      id: newId(),
      role: "user",
      content: trimmed,
    };
    const assistantMessage: ChatMessage = {
      id: newId(),
      role: "assistant",
      content: "",
    };
    const nextMessages: ChatMessage[] = [
      ...messages,
      userMessage,
      assistantMessage,
    ];
    setMessages(nextMessages);
    setPrompt("");

    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          messages: nextMessages
            .filter(({ content }) => content.length > 0)
            .map(({ role, content }) => ({ role, content })),
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
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("Stream error:", err);
      setStatus("error");
      setError("Stream failed");
    } finally {
      setStatus("idle");
    }
  }, [prompt, status, modelId, messages]);

  const handleSSEEvent = (event: {
    type: string;
    content?: string;
    error?: string;
  }) => {
    if (event.type === "chunk" && event.content) {
      setMessages((prev) => {
        const next = prev.slice();
        const lastIdx = next.map((m) => m.role).lastIndexOf("assistant");
        if (lastIdx === -1) return prev;
        next[lastIdx] = {
          ...next[lastIdx],
          content: next[lastIdx].content + event.content,
        };
        return next;
      });
      return;
    }

    if (event.type === "error") {
      setStatus("error");
      setError(event.error ?? "Model error");
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setStatus("idle");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const selectedModel = modelById.get(modelId);

  return (
    <div className="min-h-[100dvh] bg-gray-950 text-gray-100 flex flex-col pb-[env(safe-area-inset-bottom)]">
      <header className="border-b border-gray-800 px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 flex-shrink-0 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
            C
          </div>
          <div className="leading-tight">
            <h1 className="text-base sm:text-lg font-semibold tracking-tight">
              summachat V2
            </h1>
            <p className="text-xs text-gray-500">Chat</p>
          </div>
        </div>

        <div className="flex justify-center w-full sm:flex-1">
          <Select
            value={modelId}
            onValueChange={(v) => setModelId(v as ModelId)}
            disabled={status === "streaming"}
          >
            <SelectTrigger className="h-11 sm:h-9 w-full sm:w-[260px] bg-gray-950/40 border-gray-800 text-gray-200">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent className="bg-gray-950 border-gray-800">
              {MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "w-5 h-5 rounded-md flex items-center justify-center text-white text-[10px] font-bold",
                        m.color,
                      )}
                    >
                      {m.icon}
                    </span>
                    <span className="text-sm">{m.label}</span>
                    <span className="text-xs text-gray-500">{m.provider}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-end gap-2 w-full sm:w-auto sm:min-w-[220px]">
          {status === "streaming" && (
            <Button
              type="button"
              variant="outline"
              className="border-gray-800 bg-transparent text-gray-300 hover:text-white hover:bg-gray-900 h-11 sm:h-9 w-full sm:w-auto"
              onClick={handleStop}
            >
              Stop
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 w-full max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col gap-4">
        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 overflow-hidden flex flex-col flex-1 min-h-0">
          <div className="border-b border-gray-800 px-4 py-2 flex items-center justify-between text-xs text-gray-500">
            <div className="flex items-center gap-2">
              {selectedModel && (
                <span
                  className={cn(
                    "w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold",
                    selectedModel.color,
                  )}
                >
                  {selectedModel.icon}
                </span>
              )}
              <span>{selectedModel?.label ?? modelId}</span>
              {status === "streaming" && (
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  streaming
                </span>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              className="h-8 px-2 text-xs text-gray-400 hover:text-white hover:bg-gray-800"
              onClick={() => setMessages([])}
              disabled={status === "streaming" || messages.length === 0}
            >
              Clear
            </Button>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4 space-y-3">
              {messages.length === 0 ? (
                <div className="h-full min-h-[360px] flex items-center justify-center">
                  <div className="text-center space-y-2">
                    <p className="text-sm text-gray-400">
                      Start a conversation
                    </p>
                    <p className="text-xs text-gray-600">
                      Model selector is centered above
                    </p>
                  </div>
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex",
                      m.role === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
                        m.role === "user"
                          ? "bg-violet-600 text-white"
                          : "bg-gray-950/30 border border-gray-800 text-gray-200",
                      )}
                    >
                      {m.content}
                      {m.role === "assistant" &&
                        status === "streaming" &&
                        m.content.length > 0 && (
                          <span className="inline-block w-1.5 h-4 bg-gray-400 ml-0.5 animate-pulse align-text-bottom" />
                        )}
                    </div>
                  </div>
                ))
              )}
              {status === "error" && (
                <div className="text-xs text-red-400">
                  {error ?? "An error occurred"}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-3">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
            <div className="flex-1">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message…  (Ctrl+Enter to send)"
                className="bg-gray-950/40 border-gray-800 text-gray-100 placeholder:text-gray-600 resize-none min-h-[96px] focus:border-violet-500 focus:ring-violet-500/20"
                disabled={status === "streaming"}
              />
              <p className="mt-2 text-[11px] text-gray-600">
                Sending to{" "}
                <span className="text-gray-400">
                  {selectedModel?.label ?? modelId}
                </span>
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <Button
                onClick={handleSubmit}
                disabled={!prompt.trim() || status === "streaming"}
                className="bg-violet-600 hover:bg-violet-700 text-white px-6 h-11 sm:h-10 w-full sm:w-auto"
              >
                {status === "streaming" ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Sending
                  </span>
                ) : (
                  "Send"
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
