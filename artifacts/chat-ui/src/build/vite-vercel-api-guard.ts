/**
 * Build-time guard: when building for production on Vercel, ensure the chat UI
 * knows where to reach the API server.
 *
 * - If `VITE_ALLOW_SAME_ORIGIN_API` is set, same-origin `/api` is assumed
 *   (API serverless function is co-deployed on the same Vercel project).
 * - Otherwise, `VITE_API_ORIGIN` must be set so the UI can reach a remote API.
 */
export function assertVercelProductionApiOrigin(
  mode: string,
  env: NodeJS.ProcessEnv,
): void {
  if (mode !== "production") return;

  const allowSameOrigin = env["VITE_ALLOW_SAME_ORIGIN_API"]?.trim();
  if (allowSameOrigin) return;

  const apiOrigin = env["VITE_API_ORIGIN"]?.trim();
  if (apiOrigin) return;

  if (env["VERCEL"]) {
    throw new Error(
      "Vercel production build requires VITE_API_ORIGIN or VITE_ALLOW_SAME_ORIGIN_API=1. " +
        "Set VITE_ALLOW_SAME_ORIGIN_API=1 if the API is co-deployed on the same project, " +
        "or set VITE_API_ORIGIN to the API server URL.",
    );
  }
}
