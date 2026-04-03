/**
 * Fail Vite production builds on Vercel when the chat UI would call same-origin
 * `/api/*` (static hosting has no API → NOT_FOUND). See `resolveApiUrl` in
 * `src/lib/api-base.ts`.
 *
 * Set `VITE_API_ORIGIN` in the Vercel project (Production + Preview). If `/api` is
 * routed on the same host (e.g. edge rewrite), set `VITE_ALLOW_SAME_ORIGIN_API=1`.
 */
export function assertVercelProductionApiOrigin(
  mode: string,
  env: NodeJS.ProcessEnv,
): void {
  if (mode !== "production") {
    return;
  }
  if (env["VERCEL"] !== "1") {
    return;
  }
  if (env["VITE_API_ORIGIN"]?.trim()) {
    return;
  }
  if (env["VITE_ALLOW_SAME_ORIGIN_API"] === "1") {
    return;
  }
  throw new Error(
    "Chat UI: On Vercel, set VITE_API_ORIGIN to your API origin (no trailing slash), " +
      "e.g. https://api.example.com, so /api requests do not hit the static host (NOT_FOUND). " +
      "If /api is proxied on the same host, set VITE_ALLOW_SAME_ORIGIN_API=1 for this build.",
  );
}
