const STORAGE_KEY = "imagegen_owner_id";

export interface ImageGenerationResult {
  id: string;
  originalPrompt: string;
  enhancedPrompt: string;
  providerRevisedPrompt: string;
  provider: string;
  model: string;
  routingReason: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  storageBackend: string;
  storageKey: string;
  status: string;
  createdAt: string;
}

export function getOrCreateAnonymousOwnerId(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    return stored;
  }

  const ownerId = `imgown_${crypto.randomUUID()}`;
  localStorage.setItem(STORAGE_KEY, ownerId);
  return ownerId;
}
