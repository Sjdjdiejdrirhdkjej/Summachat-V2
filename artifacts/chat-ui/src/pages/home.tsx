import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { getFingerprint } from "@/lib/fingerprint";
import { listChats, deleteChat } from "@/lib/chat-store";
import { listSessions, deleteSession } from "@/lib/session-store";
import { ChatSidebar } from "@/components/ChatSidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type HomeItem = {
  id: string;
  title: string;
  selectedModels: string[];
  turnCount: number;
  updatedAt: number;
  source: "chat" | "session";
};

function buildHomeItems(fingerprint: string): HomeItem[] {
  const chatItems: HomeItem[] = listChats(fingerprint).map((c) => ({
    id: c.id,
    title: c.title,
    selectedModels: c.selectedModels,
    turnCount: c.turns.length,
    updatedAt: c.updatedAt,
    source: "chat",
  }));
  const sessionItems: HomeItem[] = listSessions(fingerprint).map((s) => ({
    id: s.id,
    title: s.title,
    selectedModels: s.selectedModels,
    turnCount: s.turns.length,
    updatedAt: s.updatedAt,
    source: "session",
  }));
  return [...chatItems, ...sessionItems].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

const MODEL_COLORS: Record<string, string> = {
  "gpt-5.2": "bg-emerald-500",
  "claude-opus-4-6": "bg-orange-500",
  "gemini-3.1-pro-preview": "bg-blue-500",
};
const MODEL_ICONS: Record<string, string> = {
  "gpt-5.2": "⬡",
  "claude-opus-4-6": "◈",
  "gemini-3.1-pro-preview": "✦",
};

function formatDate(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / MS_PER_DAY);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Home() {
  const [, navigate] = useLocation();
  const [items, setItems] = useState<HomeItem[]>([]);
  const [fp, setFp] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    getFingerprint().then((fingerprint) => {
      setFp(fingerprint);
      setItems(buildHomeItems(fingerprint));
    });
  }, []);

  const handleNew = () => {
    const id = crypto.randomUUID();
    navigate(`/session/${id}`);
  };

  const handleDeleteItem = (item: HomeItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.source === "session") {
      deleteSession(item.id);
    } else {
      deleteChat(item.id);
    }
    if (fp) setItems(buildHomeItems(fp));
  };

  return (
    <div className="h-[100dvh] bg-background text-foreground flex flex-row overflow-hidden">
      <ChatSidebar
        collapsed={!sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-border px-4 sm:px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0"
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
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-sky-600 flex items-center justify-center text-primary-foreground font-bold text-sm">
              S
            </div>
            <div>
              <h1 className="text-sm font-semibold">SummaChat V2</h1>
              <p className="text-[11px] text-muted-foreground">Multi-Model Chat</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              onClick={handleNew}
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 h-9 text-sm"
            >
              New Session
            </Button>
          </div>
        </header>

        <div className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 pb-8 pt-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <div className="text-center space-y-2">
                <p className="text-muted-foreground text-sm">No chats yet</p>
                <p className="text-muted-foreground/80 text-xs">
                  Start a new conversation to get going
                </p>
              </div>
              <Button
                onClick={handleNew}
                className="bg-primary hover:bg-primary/90 text-primary-foreground px-6"
              >
                Start your first chat
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <h2 className="text-xs text-muted-foreground font-medium mb-4 tracking-wide uppercase">
                Recent chats
              </h2>
              {items.map((item) => (
                <div
                  key={`${item.source}-${item.id}`}
                  className="w-full text-left group relative rounded-xl border border-border bg-muted/30 hover:bg-card/70 hover:border-border transition-all"
                >
                  <a
                    href={
                      item.source === "session"
                        ? `/session/${item.id}`
                        : `/chat/${item.id}`
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(
                        item.source === "session"
                          ? `/session/${item.id}`
                          : `/chat/${item.id}`,
                      );
                    }}
                    className="flex w-full items-start gap-3 p-3 pr-10"
                  >
                    <div className="flex gap-0.5 mt-0.5 flex-shrink-0">
                      {item.selectedModels.map((id) => (
                        <span
                          key={id}
                          className={cn(
                            "w-3 h-3 rounded-sm flex items-center justify-center text-primary-foreground text-[7px] font-bold",
                            MODEL_COLORS[id] ?? "bg-muted-foreground",
                          )}
                        >
                          {MODEL_ICONS[id] ?? "?"}
                        </span>
                      ))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">
                        {item.title}
                      </p>
                      <p className="text-xs text-muted-foreground/80 mt-0.5">
                        {item.turnCount}{" "}
                        {item.turnCount === 1 ? "turn" : "turns"} ·{" "}
                        {formatDate(item.updatedAt)}
                      </p>
                    </div>
                  </a>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteItem(item, e)}
                    className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 text-muted-foreground/80 hover:text-red-400 transition-all text-xs px-1.5 py-0.5 rounded"
                    aria-label="Delete chat"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {fp && (
            <p className="text-center text-[10px] text-muted-foreground mt-8">
              Session ID: {fp}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
