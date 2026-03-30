import type { ModelId, ModelState, SearchResult } from "@/types/chat";

// Turn types for unified session (duplicated to avoid circular imports)
type TurnType = "text" | "compare" | "image";
type ComposerMode = "ask" | "compare" | "image";

interface BaseTurn {
  id: string;
  type: TurnType;
  prompt: string;
  status: "idle" | "streaming" | "generating" | "done" | "error";
}

interface TextTurn extends BaseTurn {
  type: "text";
  modelId: ModelId;
  modelState: ModelState;
  webSearch: boolean;
  searchStatus: "idle" | "searching" | "done" | "error";
  searchResults: SearchResult[];
  searchError?: string;
}

interface CompareTurn extends BaseTurn {
  type: "compare";
  selectedModels: ModelId[];
  models: Partial<Record<ModelId, ModelState>>;
  moderatorChoice?: ModelId;
  moderatorNote?: string;
  moderatorOutput?: string;
  moderatorStatus: "idle" | "streaming" | "done" | "error";
  moderatorError?: string;
  summary: string;
  summaryThinking?: string;
  summaryStatus: "idle" | "streaming" | "done" | "error";
  summaryError?: string;
  webSearch: boolean;
  searchStatus: "idle" | "searching" | "done" | "error";
  searchResults: SearchResult[];
  searchError?: string;
}

interface ImageTurn extends BaseTurn {
  type: "image";
  imageId?: string;
  originalPrompt: string;
  enhancedPrompt?: string;
  provider?: string;
  model?: string;
  mimeType?: string;
  error?: string;
  imageUrl?: string;
}

export type UnifiedTurn = TextTurn | CompareTurn | ImageTurn;

interface StoredSession {
  id: string;
  fingerprint: string;
  title: string;
  turns: UnifiedTurn[];
  composerMode: ComposerMode;
  selectedModel: ModelId;
  selectedModels: ModelId[];
  createdAt: number;
  updatedAt: number;
}

const SESSION_INDEX_KEY = "summachat_session_index";
const SESSION_PREFIX = "summachat_session_";

function getSessionKey(id: string) {
  return `${SESSION_PREFIX}${id}`;
}

export function getSessionIndex(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SESSION_INDEX_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function setSessionIndex(ids: string[]) {
  localStorage.setItem(SESSION_INDEX_KEY, JSON.stringify(ids));
}

export function getSession(id: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(getSessionKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession) {
  localStorage.setItem(getSessionKey(session.id), JSON.stringify(session));
  const index = getSessionIndex();
  if (!index.includes(session.id)) {
    setSessionIndex([session.id, ...index]);
  }
}

export function deleteSession(id: string) {
  localStorage.removeItem(getSessionKey(id));
  setSessionIndex(getSessionIndex().filter((x) => x !== id));
}

export function listSessions(fingerprint: string): StoredSession[] {
  return getSessionIndex()
    .map((id) => getSession(id))
    .filter((s): s is StoredSession => s !== null && s.fingerprint === fingerprint)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deriveSessionTitle(turns: UnifiedTurn[]): string {
  if (turns.length === 0) return "New Session";
  
  // Get the first user prompt
  const firstPrompt = turns[0]?.prompt ?? "";
  if (!firstPrompt) return "New Session";
  
  // Check if it's an image request
  if (turns[0]?.type === "image") {
    return firstPrompt.length > 40 ? "Image: " + firstPrompt.slice(0, 37) + "…" : "Image: " + firstPrompt;
  }
  
  return firstPrompt.length > 50 ? firstPrompt.slice(0, 47) + "…" : firstPrompt;
}

export function createStoredSession(
  id: string,
  fingerprint: string,
  turns: UnifiedTurn[],
  composerMode: ComposerMode,
  selectedModel: ModelId,
  selectedModels: ModelId[],
): StoredSession {
  const now = Date.now();
  return {
    id,
    fingerprint,
    title: deriveSessionTitle(turns),
    turns,
    composerMode,
    selectedModel,
    selectedModels,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateStoredSession(
  existing: StoredSession,
  updates: Partial<Pick<StoredSession, "turns" | "composerMode" | "selectedModel" | "selectedModels">>,
): StoredSession {
  const newTurns = updates.turns ?? existing.turns;
  return {
    ...existing,
    ...updates,
    title: deriveSessionTitle(newTurns),
    updatedAt: Date.now(),
  };
}

export type { StoredSession, ComposerMode, TurnType };