import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { getFingerprint } from "@/lib/fingerprint";
import { listChats, deleteChat } from "@/lib/chat-store";
import { listSessions, deleteSession } from "@/lib/session-store";

const MODEL_ICONS: Record<string, string> = {
  "gpt-5.2": "/logo-openai.png",
  "claude-opus-4-6": "/logo-anthropic.png",
  "gemini-3.1-pro-preview": "/logo-gemini.png",
};

function formatDate(ts: number) {
  const d = new Date(ts);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface Props {
  open: boolean;
  onClose: () => void;
  currentChatId?: string;
}

type SidebarItem = {
  id: string;
  title: string;
  selectedModels: string[];
  turnCount: number;
  updatedAt: number;
  source: "chat" | "session";
};

function buildSidebarItems(fingerprint: string): SidebarItem[] {
  const chatItems: SidebarItem[] = listChats(fingerprint).map((c) => ({
    id: c.id,
    title: c.title,
    selectedModels: c.selectedModels,
    turnCount: c.turns.length,
    updatedAt: c.updatedAt,
    source: "chat",
  }));
  const sessionItems: SidebarItem[] = listSessions(fingerprint).map((s) => ({
    id: s.id,
    title: s.title,
    selectedModels: s.selectedModels,
    turnCount: s.turns.length,
    updatedAt: s.updatedAt,
    source: "session",
  }));
  return [...chatItems, ...sessionItems].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function ChatSidebar({ open, onClose, currentChatId }: Props) {
  const [location, navigate] = useLocation();
  const [items, setItems] = useState<SidebarItem[]>([]);
  const [fp, setFp] = useState<string | null>(null);

  const reload = useCallback((fingerprint: string) => {
    setItems(buildSidebarItems(fingerprint));
  }, []);

  useEffect(() => {
    getFingerprint().then((fingerprint) => {
      setFp(fingerprint);
      reload(fingerprint);
    });
  }, [reload]);

  useEffect(() => {
    if (open && fp) reload(fp);
  }, [open, fp, reload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleNew = () => {
    const id = crypto.randomUUID();
    onClose();
    navigate(`/session/${id}`);
  };

  const handleSelect = (item: SidebarItem) => {
    onClose();
    navigate(item.source === "session" ? `/session/${item.id}` : `/chat/${item.id}`);
  };

  const handleDelete = (item: SidebarItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.source === "session") {
      deleteSession(item.id);
    } else {
      deleteChat(item.id);
    }
    if (fp) reload(fp);
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed top-0 left-0 z-40 h-full w-72 bg-gray-900 border-r border-gray-800 flex flex-col transition-transform duration-200 ease-in-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-white font-bold text-xs">
              S
            </div>
            <span className="text-sm font-semibold text-gray-100">
              summachat V2
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors p-1 rounded"
            aria-label="Close menu"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 2l12 12M14 2L2 14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="px-3 py-3 flex-shrink-0 space-y-2">
          <button
            type="button"
            onClick={handleNew}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 1v12M1 7h12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            New Chat
          </button>


        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {items.length === 0 ? (
            <div className="flex items-center justify-center h-24">
              <p className="text-xs text-gray-600">No chats yet</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {items.map((item) => {
                const isCurrent = item.id === currentChatId;
                return (
                  <button
                    key={`${item.source}-${item.id}`}
                    type="button"
                    onClick={() => handleSelect(item)}
                    className={cn(
                      "w-full text-left group flex items-start gap-2.5 px-3 py-2.5 rounded-lg transition-colors",
                      isCurrent
                        ? "bg-gray-800 text-gray-100"
                        : "text-gray-400 hover:bg-gray-800/60 hover:text-gray-200",
                    )}
                  >
                    <div className="flex gap-0.5 mt-0.5 flex-shrink-0">
                      {item.selectedModels.map((id) => (
                        <img
                          key={id}
                          src={MODEL_ICONS[id] ?? ""}
                          alt={id}
                          className="w-3.5 h-3.5 rounded-sm object-contain"
                        />
                      ))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs truncate leading-snug">
                        {item.title}
                      </p>
                      <p className="text-[10px] text-gray-600 mt-0.5">
                        {item.turnCount}{" "}
                        {item.turnCount === 1 ? "turn" : "turns"} ·{" "}
                        {formatDate(item.updatedAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(item, e)}
                      className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0 p-1 rounded mt-0.5"
                      aria-label="Delete"
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="none"
                      >
                        <path
                          d="M1 1l8 8M9 1L1 9"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {fp && (
          <div className="px-4 py-3 border-t border-gray-800 flex-shrink-0">
            <p className="text-[9px] text-gray-700 font-mono truncate">{fp}</p>
          </div>
        )}
      </aside>
    </>
  );
}
