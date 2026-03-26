import type { ModelId, Turn } from "@/types/chat";

const INDEX_KEY = "summachat_index";
const CHAT_PREFIX = "summachat_chat_";

export type StoredChat = {
  id: string;
  fingerprint: string;
  title: string;
  selectedModels: ModelId[];
  turns: Turn[];
  createdAt: number;
  updatedAt: number;
};

function getChatKey(id: string) {
  return `${CHAT_PREFIX}${id}`;
}

export function getIndex(): string[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function setIndex(ids: string[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
}

export function getChat(id: string): StoredChat | null {
  try {
    const raw = localStorage.getItem(getChatKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveChat(chat: StoredChat) {
  localStorage.setItem(getChatKey(chat.id), JSON.stringify(chat));
  const index = getIndex();
  if (!index.includes(chat.id)) {
    setIndex([chat.id, ...index]);
  }
}

export function deleteChat(id: string) {
  localStorage.removeItem(getChatKey(id));
  setIndex(getIndex().filter((x) => x !== id));
}

export function listChats(fingerprint: string): StoredChat[] {
  return getIndex()
    .map((id) => getChat(id))
    .filter((c): c is StoredChat => c !== null && c.fingerprint === fingerprint)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deriveChatTitle(turns: Turn[]): string {
  const first = turns[0]?.prompt ?? "";
  return first.length > 60 ? first.slice(0, 57) + "…" : first || "New Chat";
}
