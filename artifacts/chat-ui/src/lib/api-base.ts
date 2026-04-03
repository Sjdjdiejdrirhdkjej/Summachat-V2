/**
 * Base URL for API calls. In dev, the Vite proxy serves `/api` on the same origin
 * (empty base). On static hosts (e.g. Vercel), set `VITE_API_ORIGIN` to your API
 * origin (no trailing slash), e.g. `https://your-api.example.com`.
 */
export function getApiBase(): string {
  const explicit = import.meta.env.VITE_API_ORIGIN?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  return import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
}

/** Resolve a path like `/api/chat` or an absolute API URL for fetch/EventSource/img. */
export function resolveApiUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  const base = getApiBase();
  if (pathOrUrl.startsWith("/")) {
    return `${base}${pathOrUrl}`;
  }
  return `${base}/${pathOrUrl}`;
}
