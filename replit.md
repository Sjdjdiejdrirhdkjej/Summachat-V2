# Workspace

## Overview

npm/bun workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: npm workspaces
- **Node.js version**: 24
- **Package manager**: npm or bun (both supported)
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Application: Multi-Model Chat

Users select 2+ AI models, submit a prompt, and all selected models are called simultaneously. Once all models respond, a Claude Opus 4.6 moderator picks the strongest candidate with a short note, and a Claude Opus 4.6 summarizer synthesises the final answer using both the raw model outputs and the moderator review.

### Models available
- **GPT 5.4 High** (`gpt-5.2`) — OpenAI via Replit AI Integrations
- **Claude Opus 4.6** (`claude-opus-4-6`) — Anthropic via Replit AI Integrations
- **Gemini 3.1 Pro** (`gemini-3.1-pro-preview`) — Google via Replit AI Integrations

### Key files
- `artifacts/api-server/src/routes/multi-chat.ts` — POST `/api/multi-chat`, fans out to all selected models in parallel, streams SSE events, then runs summarizer
- `artifacts/chat-ui/src/pages/multi-chat.tsx` — main chat UI: model selector, prompt input, per-model streaming panels, synthesis panel
- `artifacts/chat-ui/src/App.tsx` — routes `/` to multi-chat page

### SSE event protocol
Events emitted over the stream:
- `{ type: "model_start", model, label }` — model has started responding
- `{ type: "model_chunk", model, content }` — incremental text from a model
- `{ type: "model_done", model }` — model finished
- `{ type: "model_error", model, error }` — model failed
- `{ type: "moderator_start" }` — moderator has started
- `{ type: "moderator_chunk", content }` — incremental text from moderator
- `{ type: "moderator_done", choice, note }` — moderator finished with selected model and note
- `{ type: "moderator_error", error }` — moderator failed
- `{ type: "summary_start" }` — summarizer has started
- `{ type: "summary_thinking_chunk", content }` — incremental reasoning text emitted inside `<thinking>` tags
- `{ type: "summary_chunk", content }` — incremental text from summarizer
- `{ type: "summary_done" }` — summarizer finished
- `{ type: "done" }` — entire request complete

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   └── chat-ui/            # React + Vite frontend
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── db/                 # Drizzle ORM schema + DB connection
│   ├── integrations-openai-ai-server/   # OpenAI SDK client + utilities
│   ├── integrations-anthropic-ai/       # Anthropic SDK client + utilities
│   └── integrations-gemini-ai/          # Google Gemini SDK client + utilities
├── scripts/                # Utility scripts
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `npm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `npm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `npm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /api/healthz`, `HEAD /api/healthz`, `GET /api/readyz`, and `HEAD /api/readyz`; `src/routes/multi-chat.ts` exposes `POST /api/multi-chat`
- Depends on: `@workspace/db`, `@workspace/api-zod`, `@workspace/integrations-openai-ai-server`, `@workspace/integrations-anthropic-ai`, `@workspace/integrations-gemini-ai`

### Replit deployment

- **Build** (see `.replit` `[deployment]`): runs `npm run typecheck`, then `npm run -w @workspace/chat-ui build`, then `npm run -w @workspace/api-server build`. This matches the repo’s expectation that OpenAPI-generated clients and types are committed; the typecheck step catches drift before producing bundles.
- **Run**: `node --enable-source-maps artifacts/api-server/dist/index.mjs` (default `PORT` is 8080 in code when unset).
- **Health**: Replit’s deployment probe uses `GET /api/healthz` (JSON `{"status":"ok"}`).
- **Secrets**: configure third-party API keys (for example web search) in Replit **Secrets**, not in committed config files.

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`).

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec.

### `lib/integrations-openai-ai-server` (`@workspace/integrations-openai-ai-server`)

Pre-configured OpenAI SDK client using `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY`.

### `lib/integrations-anthropic-ai` (`@workspace/integrations-anthropic-ai`)

Pre-configured Anthropic SDK client using `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` and `AI_INTEGRATIONS_ANTHROPIC_API_KEY`.

### `lib/integrations-gemini-ai` (`@workspace/integrations-gemini-ai`)

Pre-configured Google Gemini SDK client using `AI_INTEGRATIONS_GEMINI_BASE_URL` and `AI_INTEGRATIONS_GEMINI_API_KEY`.

### `scripts` (`@workspace/scripts`)

Utility scripts package.
