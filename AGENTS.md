# AGENTS.md

Repository guidance for coding agents working in `/home/runner/workspace`.

## Scope and precedence

- This is the repo-level agent guide for this workspace.
- No repo-level `.cursorrules`, `.cursor/rules/*`, or `.github/copilot-instructions.md` files were found when this file was written.
- Follow direct user instructions first, then this file, then local file conventions.

## Repo snapshot

- **Package manager**: `npm` or `bun` (both supported interchangeably, enforced via preinstall script).
- **Runtime/tooling baseline**: Node.js 24, TypeScript 5.9.
- **Monorepo layout**: npm workspaces with 19 packages.
- **Root workspace globs**: `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts`.
- **TypeScript**: Project references with `customConditions: ["workspace"]`, strict baseline from `tsconfig.base.json`.
- **Prettier**: Installed, no repo-defined format script.
- **No ESLint**: No repo-level eslint config — follow adjacent file style.
- **Test framework**: Vitest v3.2.4 (node environment for both api-server and chat-ui).

## Testing

- **Framework**: Vitest v3.2.4 (sole test runner).
- **Test files**: `*.test.{ts,tsx}` pattern, co-located with source files.
- **Run package**: `npm run -w @workspace/<name> test` (api-server or chat-ui only).
- **No root test**: Root has no `npm run test` command — use workspace flags.
- **Setup files**: `./src/test-setup.ts` per package.
- **Libraries**: `@testing-library/react` for UI, `supertest` for API routes.
- **Environment**: Both api-server and chat-ui use `node` env (chat-ui uses jsdom via react-testing-library).

## TypeScript Strictness

Root `tsconfig.base.json` enforces strict baseline:

- `noImplicitAny`, `strictNullChecks`, `strictPropertyInitialization`: true
- `useUnknownInCatchVariables`, `noImplicitReturns`, `noImplicitOverride`: true
- **Deviations**: `strictFunctionTypes: false`, `noUnusedLocals: false`

## Directory map

- `artifacts/` — runnable apps.
  - `artifacts/api-server/` — Express 5 API server.
  - `artifacts/chat-ui/` — React + Vite app.
  - `artifacts/mockup-sandbox/` — Vite sandbox app.
- `lib/` — reusable internal packages.
  - `lib/api-spec/` — OpenAPI spec and Orval config.
  - `lib/api-zod/` — generated Zod validators.
  - `lib/api-client-react/` — generated React client.
  - `lib/db/` — Drizzle schema and database access.
- `lib/integrations/` — external AI service integrations. Note: `lib/integrations/` directory exists but integrations live as sibling packages with `-ai` suffix.
  - `lib/integrations-anthropic-ai/` — Anthropic AI integration.
  - `lib/integrations-gemini-ai/` — Google Gemini AI integration.
  - `lib/integrations-openai-ai-server/` — OpenAI AI integration (server-side).
  - `lib/integrations-openai-ai-react/` — OpenAI AI integration (React client).
- `scripts/` — standalone TS scripts run through one workspace package.

## Commands agents should actually use

### Core commands

- Install: `npm install` or `bun install`
- Repo-wide typecheck: `npm run typecheck`
- Repo-wide build: `npm run build`
- Single package: `npm run -w <workspace-name> <script>`

### Common package commands

- API server: `-w @workspace/api-server` (dev, build, start, typecheck)
- Chat UI: `-w @workspace/chat-ui` (dev, build, serve, typecheck)
- Mockup sandbox: `-w @workspace/mockup-sandbox` (dev, build, preview, typecheck)
- DB: `-w @workspace/db` (push, push-force)
- API codegen: `npm run -w @workspace/api-spec codegen`
- Scripts: `npm run -w @workspace/scripts <script>` (uses `tsx` to run TS directly)
- Integration packages: `npm run -w @workspace/integration-name <script>`

### When to run what

- Small package-local change: run that package's `typecheck` if available.
- Cross-package or shared-lib change: run `npm run typecheck` from repo root.
- Before handoff: prefer root typecheck for code changes, build for bundle-affecting changes.
- OpenAPI changes: run codegen, then typecheck.
- Drizzle schema changes: use `npm run -w @workspace/db push`.

## Code style and implementation rules

### Module and import style

- Use ESM imports/exports. Packages are configured as `"type": "module"`.
- Prefer `import` / `export`; do not introduce `require()`.
- Use workspace package imports across packages, for example `@workspace/db` or `@workspace/api-zod`.
- Use relative imports within a package.
- In Chat UI, prefer the `@/*` alias for app-local imports where the surrounding code uses it.
- Use type-only imports when appropriate, for example `import { type Express } from "express"`.

### Formatting

- Use 2-space indentation.
- Follow the surrounding file's semicolon style instead of normalizing unrelated lines.
- Server and shared library files commonly use semicolons.
- Many UI files omit semicolons.
- Keep diffs stylistically local; do not reformat a file unless the task requires it.

### Types

- Stay in TypeScript; do not bypass the type system.
- Respect the root strictness baseline: `noImplicitAny`, `strictNullChecks`, `useUnknownInCatchVariables`, `noImplicitReturns`, and `strictPropertyInitialization` are enabled.
- TypeScript uses `customConditions: ["workspace"]` for package resolution.
- Do not use `as any`, `@ts-ignore`, or `@ts-expect-error`.
- Prefer explicit types at public boundaries, exported helpers, and non-obvious state.
- Keep schema-driven typing where it already exists.
- In Drizzle schema files, preserve the pattern of exporting inferred types, for example `$inferSelect` and `z.infer`. Use `createInsertSchema` from `drizzle-zod` for insert validation.

### Validation and API boundaries

- Validate request and response shapes with Zod at API boundaries.
- Prefer `safeParse` or `parse` based on the current local pattern.
- Keep generated API schema/client packages generated; do not hand-edit generated output unless the task explicitly requires it.

### Naming

- React components: PascalCase.
- Hooks: `useX`.
- Route/page files commonly use kebab-case, for example `multi-chat.ts` or `not-found.tsx`.
- Utility and helper names should be descriptive rather than abbreviated.
- Constants that act as fixed registries or maps may use ALL_CAPS.

### Error handling

- Fail fast for required environment variables during startup/config initialization.
- When narrowing unknown errors, use `instanceof Error` before reading `.message`.
- Do not swallow errors with empty catch blocks.
- Prefer structured error types or clear error payloads over ad hoc string-only flows when the module already has a pattern for that.

## Architecture notes agents should preserve

- Keep the monorepo split clear: apps in `artifacts/`, reusable code in `lib/`, utility scripts in `scripts/`.
- Root TypeScript project references are part of the build graph and specifically configure lib packages for incremental compilation. Update references when adding new package dependencies that require them.
- The API flow is schema/codegen-driven:
  - OpenAPI spec lives in `lib/api-spec/`.
  - Orval generates clients into sibling packages.
  - Server routes consume generated validators and shared libs.
- Database code follows a schema-plus-inferred-types pattern using Drizzle ORM with PostgreSQL.
- Server logging uses pino with redaction of sensitive headers/cookies.
- API server build: custom `build.mjs` (esbuild with 80+ externals, not tsup/tsx).
- Root `package.json` has aggressive dependency overrides (esbuild, undici, yaml, tar) — don't change without reason.
- Environment variables for AI integrations use `AI_INTEGRATIONS_*` prefix (e.g., `AI_INTEGRATIONS_ANTHROPIC_API_KEY`).
- API server uses lazy route loading pattern in `src/routes/index.ts` for provider-dependent routes.
- Chat UI uses Wouter for routing, React Query for API calls, and localStorage for chat persistence.
- Cross-package dependency: api-server → db, api-zod, integrations-\*; chat-ui → api-client-react.

## Package dependency graph

```
lib/api-spec (source of truth)
       │
       ├──[codegen]──► lib/api-zod (validators)
       │                     │
       │                     └──► api-server (consumer)
       │
       └──[codegen]──► lib/api-client-react
                            │
                            └──► chat-ui (consumer)

lib/db ──────────────────► api-server (consumer)

lib/integrations-* ──────► api-server (consumer)
  ├── openai-ai-server
  ├── openai-ai-react ────► chat-ui (consumer)
  ├── anthropic-ai
  ├── gemini-ai
  └── vertex-ai-fallback
```

## Integration package conventions

All AI integration packages in `lib/integrations-*` follow shared patterns:

- **Environment variables**: `AI_INTEGRATIONS_{PROVIDER}_*` prefix (e.g., `AI_INTEGRATIONS_ANTHROPIC_API_KEY`)
- **Lazy client init**: Module-level singleton with `getClient()`, `tryGetClient()`, `isConfigured()` accessors
- **Subpath exports**: Server packages export `./batch`, `./image`, `./audio` as needed
- **Batch utilities**: `batchProcess`, `batchProcessWithSSE`, `isRateLimitError` — duplicated across 3 packages, consider extracting
- **Build**: Declaration-only output, composite TypeScript project references
- **Server-only**: All integration packages except `openai-ai-react` use Node APIs (fs, Buffer, child_process)

See `lib/integrations-openai-ai-server/AGENTS.md` for OpenAI-specific conventions.

## Build and CI notes

- **No CI/CD**: No GitHub Actions, no Makefile — all builds are manual via npm scripts
- **API server build**: Custom `build.mjs` (esbuild with 80+ externals, `SOURCEMAP=1` for linked source maps), not tsup/tsx
- **Drizzle migrations**: Uses schema push (`db push`), not traditional migration files
- **Vitest**: Workspace config in root, but test scripts only in package `package.json`
- **Vercel deployment**: `vercel.json` builds only chat-ui; api-server deploys separately
- **Post-merge hook**: `scripts/post-merge.sh` runs `npm ci` + `db push` after git merges
- **preinstall guard**: Root package.json enforces `npm` or `bun` only (blocks yarn/pnpm)

## Structural deviations from standard TypeScript monorepo

- **Ghost workspace glob**: `lib/integrations/*` is in workspaces but empty — actual packages are siblings (`lib/integrations-*-ai/`)
- **Mirror code outside workspace**: `lib/integrations/*_ai_integrations/` contains staging code NOT in the monorepo
- **Partial tsconfig references**: Root references only cover lib packages, not artifacts/scripts
- **Python mixed in**: `.pythonlibs/` in TypeScript monorepo (for tooling)
- **Tool directories with package.json**: `.opencode/`, `.config/kilo/` have their own npm packages
- **Double `-ai` suffix**: `integrations-openai-ai-server` and `integrations-openai-ai-react` (redundant naming)

## Anti-patterns (THIS PROJECT)

- **NEVER log secrets, auth headers, cookies, or raw credentials**
- **NEVER use empty catch blocks** — log or rethrow errors
- **NEVER use vague words in prompts**: "beautiful", "nice", "pretty", "cool", "good", "cute"
- **Do not bypass the type system** (`as any`, `@ts-ignore`, `@ts-expect-error`)
- **Do not edit generated files** (`generated/*.ts`, `api-zod/src/generated/`)
- **Do not switch package managers** without user approval
- **Do not use `require()`** — use ESM imports only
- **`dist/` in lib/db is read-only** — declaration-only output, never edit
- **Fail fast on missing env vars** — don't defer checks in integration packages
- **Do not add explanations, markdown, or commentary in prompt generation output** — write ONLY the improved prompt

## Working norms for agents

- Prefer minimal diffs that match existing local patterns.
- Read adjacent files before introducing a new pattern.
- If conventions differ by area, follow the area you are editing instead of forcing uniformity.
- Do not claim lint, format, or test coverage that does not exist.
- When summarizing validation, distinguish between package-local typecheck and root typecheck.

## Important constraints

- Do not switch to a different package manager without user approval.
- If adding dependencies, keep workspace usage consistent with surrounding manifests.
- Never log secrets, auth headers, cookies, or raw credentials.

If this repo later adds Cursor rules, Copilot instructions, linting, formatting, or tests, update this file to reflect the new source of truth.
