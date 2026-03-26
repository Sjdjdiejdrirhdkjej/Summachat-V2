import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { getFingerprint } from "@/lib/fingerprint";
import { listChats, deleteChat, type StoredChat } from "@/lib/chat-store";
import { ChatSidebar } from "@/components/ChatSidebar";
import { cn } from "@/lib/utils";

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
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Home() {
  const [, navigate] = useLocation();
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [fp, setFp] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    getFingerprint().then((fingerprint) => {
      setFp(fingerprint);
      setChats(listChats(fingerprint));
    });
  }, []);

  const handleNew = () => {
    const id = crypto.randomUUID();
    navigate(`/chat/${id}`);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteChat(id);
    if (fp) setChats(listChats(fp));
  };

  return (
    <div className="min-h-[100dvh] bg-gray-950 text-gray-100 flex flex-col">
      <ChatSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <header className="border-b border-gray-800 px-4 sm:px-6 py-4 flex items-center justify-between flex-shrink-0">
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
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
            S
          </div>
          <div>
            <h1 className="text-sm font-semibold">summachat V2</h1>
            <p className="text-[11px] text-gray-500">Multi-Model Chat</p>
          </div>
        </div>
        <Button
          onClick={handleNew}
          className="bg-violet-600 hover:bg-violet-700 text-white px-4 h-9 text-sm"
        >
          New Chat
        </Button>
      </header>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 py-8">
        {chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="text-center space-y-2">
              <p className="text-gray-400 text-sm">No chats yet</p>
              <p className="text-gray-600 text-xs">
                Start a new conversation to get going
              </p>
            </div>
            <Button
              onClick={handleNew}
              className="bg-violet-600 hover:bg-violet-700 text-white px-6"
            >
              Start your first chat
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <h2 className="text-xs text-gray-500 font-medium mb-4 tracking-wide uppercase">
              Recent chats
            </h2>
            {chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => navigate(`/chat/${chat.id}`)}
                className="w-full text-left group flex items-start gap-3 p-3 rounded-xl border border-gray-800 bg-gray-900/30 hover:bg-gray-900/70 hover:border-gray-700 transition-all"
              >
                <div className="flex gap-0.5 mt-0.5 flex-shrink-0">
                  {chat.selectedModels.map((id) => (
                    <span
                      key={id}
                      className={cn(
                        "w-3 h-3 rounded-sm flex items-center justify-center text-white text-[7px] font-bold",
                        MODEL_COLORS[id] ?? "bg-gray-600"
                      )}
                    >
                      {MODEL_ICONS[id] ?? "?"}
                    </span>
                  ))}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 truncate">{chat.title}</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {chat.turns.length} {chat.turns.length === 1 ? "turn" : "turns"} ·{" "}
                    {formatDate(chat.updatedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => handleDelete(chat.id, e)}
                  className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                  aria-label="Delete chat"
                >
                  ✕
                </button>
              </button>
            ))}
          </div>
        )}

        {fp && (
          <p className="text-center text-[10px] text-gray-800 mt-8">
            Session ID: {fp}
          </p>
        )}
      </div>
    </div>
  );
}
