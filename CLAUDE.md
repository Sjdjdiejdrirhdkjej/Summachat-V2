# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Common (from workspace root):
- `npm install` or `bun install` — install dependencies
- `npm run build` — typecheck then build all workspaces
- `npm run typecheck` — typecheck libs (project refs) then all workspaces
- `npm test` or `npx vitest --run` — run all tests
- `npx vitest --run -t "test name"` — run a single test by name

### Per-package (use `-w @workspace/<name>`):
- API server: `-w @workspace/api-server` (dev, build, start, test, typecheck)
- Chat UI: `-w @workspace/chat-ui` (dev, build, serve, test, typecheck)
- DB: `-w @workspace/db` (push, push-force)
- API codegen: `-w @workspace/api-spec codegen`
- Scripts: `-w @workspace/scripts <script>` (runs TS via tsx)

### When to run what:
- Package-local change → that package's `typecheck`
- Cross-package or shared-lib change → root `npm run typecheck`
- OpenAPI spec change → run codegen, then typecheck
- Drizzle schema change → `npm run -w @workspace/db push`

## Architecture

### Monorepo layout:
- `artifacts/` — deployable apps (`api-server/`, `chat-ui/`, `mockup-sandbox/`)
- `lib/` — reusable packages (`api-spec/`, `api-zod/`, `api-client-react/`, `db/`, `integrations-*/`)
- `scripts/` — standalone TS utility scripts

### API codegen pipeline:
1. OpenAPI spec in `lib/api-spec/openapi.yaml`
2. Orval generates Zod validators → `lib/api-zod/`, React client → `lib/api-client-react/`
3. Server routes consume `@workspace/api-zod` validators
4. Chat UI consumes `@workspace/api-client-react` hooks

### Server (artifacts/api-server):
- Express 5, custom esbuild build (`build.mjs` — 80+ externals, ESM output to `dist/index.mjs`)
- Routes mounted at `/api` in `src/app.ts`; lazy loading for provider-heavy routes
- Depends on `@workspace/db`, `@workspace/api-zod`, `@workspace/integrations-*`
- Logging via pino with redaction of auth headers, cookies, and sensitive response fields

### Chat UI (artifacts/chat-ui):
- React 19 + Vite + Tailwind CSS 4 + Radix UI (shadcn pattern, 55 components in `src/components/ui/`)
- Wouter for routing, React Query for API calls, localStorage for chat persistence
- Vite proxies `/api` to the api-server in dev
- Import alias `@/` maps to `src/`
- Dark mode via `prefers-color-scheme` detection in `main.tsx`

### Database (lib/db):
- Drizzle ORM with PostgreSQL; schema files in `src/schema/`
- Pattern per table: define table → `createInsertSchema` → export `$inferSelect` and `z.infer` types
- `npm run -w @workspace/db push` for schema changes

### Testing:
- Vitest workspace in root `vitest.workspace.ts` (covers api-server and chat-ui)
- api-server: node environment, `src/**/*.test.ts`, setup in `src/test-setup.ts`
- chat-ui: jsdom environment, `src/**/*.test.{ts,tsx}`, setup in `src/test-setup.ts`
- Run all: `npx vitest --run` from root; single package: `npm run -w @workspace/<name> test`

## Code style

- ESM only (`"type": "module"`); no `require()`
- TypeScript strict: `noImplicitAny`, `strictNullChecks`, `useUnknownInCatchVariables`, `noImplicitReturns`
- No `as any`, `@ts-ignore`, `@ts-expect-error`
- 2-space indent; follow surrounding file's semicolon style (server uses semicolons, many UI files omit them)
- React components: PascalCase; hooks: `use*`; route files: kebab-case
- Use `type`-only imports where appropriate: `import { type Express } from "express"`
- Cross-package imports: `@workspace/<name>`; within a package: relative or `@/` (chat-ui)
- Narrow unknown errors with `instanceof Error` before reading `.message`; never swallow errors silently

## Key environment variables

- AI integrations use `AI_INTEGRATIONS_*` prefix (e.g. `AI_INTEGRATIONS_ANTHROPIC_API_KEY`)
- `REPL_ID` — conditionally loads Replit Vite plugins in chat-ui
