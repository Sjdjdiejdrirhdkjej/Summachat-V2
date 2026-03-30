import { randomUUID } from "node:crypto";

export function getOrCreateAnonymousOwnerId(
  req: { cookies?: Record<string, string> },
): string {
  const cookies = req.cookies ?? {};
  const existing = cookies["imagegen_owner_id"];
  return existing ?? `imgown_${randomUUID()}`;
}
