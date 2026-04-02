import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { getFingerprint } from "@/lib/fingerprint";
import { listChats, deleteChat } from "@/lib/chat-store";
import { listSessions, deleteSession } from "@/lib/session-store";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatDate(ts: number) {
  const d = new Date(ts);
  const diffDays = Math.floor((Date.now() - d.getTime()) / MS_PER_DAY);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface Props {
  collapsed: boolean;
  onToggle: () => void;
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
  return [...chatItems, ...sessionItems].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

export function ChatSidebar({ collapsed, onToggle, currentChatId }: Props) {
  const [, navigate] = useLocation();
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

  // Reload when sidebar opens
  useEffect(() => {
    if (!collapsed && fp) reload(fp);
  }, [collapsed, fp, reload]);

  const handleNew = () => {
    const id = crypto.randomUUID();
    navigate(`/session/${id}`);
  };

  const handleSelect = (item: SidebarItem) => {
    navigate(
      item.source === "session" ? `/session/${item.id}` : `/chat/${item.id}`,
    );
  };

  const handleDelete = (item: SidebarItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.source === "session") {
      deleteSession(item.id);
    } else {
      deleteChat(item.id);
    }
    if (fp) reload(fp);
    if (item.id === currentChatId) {
      navigate("/");
    }
  };

  return (
    <aside
      className={cn(
        "h-full flex flex-col bg-[#1a1a1f] border-r border-white/[0.06] transition-all duration-200 ease-in-out flex-shrink-0 overflow-hidden",
        collapsed ? "w-0 border-r-0" : "w-[260px]",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 flex-shrink-0">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-white font-bold text-xs">
            S
          </div>
          <span className="text-sm font-medium text-gray-200">SummaChat V2</span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="w-7 h-7 rounded-md flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-white/[0.06] transition-colors"
          aria-label="Collapse sidebar"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M11 2L5 8l6 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* New chat button */}
      <div className="px-3 pb-2 flex-shrink-0">
        <button
          type="button"
          onClick={handleNew}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.08] text-gray-300 hover:bg-white/[0.06] hover:border-white/[0.12] transition-colors text-sm"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M7 1v12M1 7h12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          New chat
        </button>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {items.length === 0 ? (
          <div className="flex items-center justify-center h-20">
            <p className="text-xs text-gray-600">No conversations yet</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {items.map((item) => {
              const isCurrent = item.id === currentChatId;
              const href =
                item.source === "session"
                  ? `/session/${item.id}`
                  : `/chat/${item.id}`;
              return (
                <div
                  key={`${item.source}-${item.id}`}
                  className={cn(
                    "w-full text-left group relative rounded-lg transition-colors",
                    isCurrent
                      ? "bg-white/[0.08] text-gray-100"
                      : "text-gray-400 hover:bg-white/[0.04] hover:text-gray-200",
                  )}
                >
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      handleSelect(item);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 pr-8"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] truncate leading-snug">
                        {item.title}
                      </p>
                    </div>
                  </a>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(item, e)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-red-400 transition-all p-0.5 rounded"
                    aria-label="Delete"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 2l8 8M10 2L2 10"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
