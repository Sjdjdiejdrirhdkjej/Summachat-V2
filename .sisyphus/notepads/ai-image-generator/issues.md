## 2026-03-27

- Root typecheck initially failed in `lib/api-zod/src/index.ts` due ambiguous star re-exports (`ChatQueryResponse`, `ListGeneratedImagesResponse`).
- Resolved by explicitly re-exporting those names from `./generated/api` to disambiguate module exports.
  2026-03-27
- Issue: repo typecheck failed after codegen with TS2308 duplicate exports in `lib/api-zod/src/index.ts` due to overlapping names between `generated/api` value exports and `generated/types` interface exports.
- Resolution: switched wildcard types export to type-only (`export type * from "./generated/types";`), then reran typecheck/build successfully.

## 2026-03-27

- `pnpm --filter @workspace/api-server exec tsx --eval ...` failed because `tsx` is not installed in the workspace package scripts/devDependencies.
- Used `pnpm dlx tsx --eval ...` as a one-off verification fallback for router mapping evidence.

## 2026-03-27

- Playwright browser verification is blocked in this runner because the ephemeral Chromium binary fails to launch with `libglib-2.0.so.0: cannot open shared object file`.
- As a fallback, the task still captured route/build validation with root `pnpm run typecheck`, root `pnpm run build`, and an HTTP 200 check against `http://127.0.0.1:5173/images`.
