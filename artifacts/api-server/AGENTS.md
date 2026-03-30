# AGENTS.md — API Server

Package-level guidance for `@workspace/api-server` (Express 5).

## Overview

Express 5 API server at `/api`. Serves Chat UI static assets. Graceful shutdown.

## Structure

```
src/
├── index.ts        → Server bootstrap (PORT binding, SIGTERM/SIGINT handlers)
├── app.ts          → Express factory (middleware, routes, static serve, SPA fallback)
├── routes/         → API endpoints (/api/*)
│   ├── chat.ts         → single chat
│   ├── multi-chat.ts   → streaming multi-model chat
│   ├── images.ts       → image generation
│   ├── health.ts       → health check
│   └── models.ts       → model listing
└── lib/
    └── image-generation/  → Flux/SDXL integration
```

## Where to Look

| Task                | Location                                   |
| ------------------- | ------------------------------------------ |
| Add API route       | `src/routes/`, mount in `app.ts` at `/api` |
| Change CORS/cookies | `app.ts` middleware stack                  |
| Add middleware      | `app.ts` before routes                     |
| Streaming responses | `src/routes/multi-chat.ts`                 |
| Prompt engineering  | `src/routes/multi-chat.ts` lines 295-330   |

## Routes

| Path                   | File            | Notes                         |
| ---------------------- | --------------- | ----------------------------- |
| `POST /api/chat`       | `chat.ts`       | Single model chat             |
| `POST /api/multi-chat` | `multi-chat.ts` | Multi-model with tool routing |
| `POST /api/images`     | `images.ts`     | Flux Kontext / SDXL           |
| `GET /api/models`      | `models.ts`     | Available models              |
| `GET /api/health`      | `health.ts`     | Health check                  |

## Anti-Patterns (THIS PACKAGE)

**NEVER in prompt generation** (`multi-chat.ts` line 308):

- Vague words: "beautiful", "nice", "pretty", "cool", "good", "cute"
- Explanations, markdown, quotes, commentary in prompt output

**Prompt output format**:

- Write ONLY the improved prompt
- No meta-commentary

## Build

Custom esbuild bundle in `build.mjs`:

- 80+ externals (node_modules not bundled)
- Source maps via `SOURCEMAPS` env
- Outputs to `dist/index.js`

```bash
npm run build      # esbuild bundle
npm run dev        # build + start
npm run start      # production (requires pre-built dist/)
```

## Logging

Pino with redaction:

- Headers: `authorization`, `cookie`
- Response bodies with `password`, `secret`, `token`

Logger available via `req.log` (pino-http).

## Dependencies

Consumes:

- `@workspace/db` — Drizzle schema
- `@workspace/api-zod` — Zod validators (generated)
- `@workspace/integrations-*` — AI service clients

## Error Handling

```typescript
// Unknown error narrowing
catch (e) {
  const message = e instanceof Error ? e.message : "Unknown error";
}
```

Never use empty catch blocks — log or rethrow.
