# AGENTS.md

Repository guidance for coding agents working in `/home/runner/workspace`.

## Scope and precedence

- This is the repo-level agent guide for this workspace.
- No repo-level `.cursorrules`, `.cursor/rules/*`, or `.github/copilot-instructions.md` files were found when this file was written.
- Follow direct user instructions first, then this file, then local file conventions.

## Repo snapshot

- Package manager: `npm` or `bun` (both supported interchangeably).
- Runtime/tooling baseline: Node.js 24, TypeScript 5.9.
- Monorepo layout: npm workspaces.
- Root workspace globs: `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts`.
- Root TypeScript uses project references.
- Prettier is installed, but there is no repo-defined format script.
- No repo-defined lint command was found.
- No repo-defined test command or test runner config was found.

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
- Scripts: `npm run -w @workspace/scripts <script>`
- Integration packages: `npm run -w @workspace/integration-name <script>`

### When to run what

- Small package-local change: run that package's `typecheck` if available.
- Cross-package or shared-lib change: run `npm run typecheck` from repo root.
- Before handoff: prefer root typecheck for code changes, build for bundle-affecting changes.
- OpenAPI changes: run codegen, then typecheck.
- Drizzle schema changes: use `npm run -w @workspace/db push`.

### Testing

- No test runner or test files are currently configured in this repository.
- No `test` scripts found in any package.json files.
- No Jest, Vitest, or other test framework configurations found.
- If adding tests, consider Vitest for consistency with Vite-based apps.

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
- Respect the root strictness baseline: `noImplicitAny`, `strictNullChecks`, and `useUnknownInCatchVariables` are enabled.
- Do not use `as any`, `@ts-ignore`, or `@ts-expect-error`.
- Prefer explicit types at public boundaries, exported helpers, and non-obvious state.
- Keep schema-driven typing where it already exists.
- In Drizzle schema files, preserve the pattern of exporting inferred types, for example `$inferSelect` and `z.infer`.

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
- Database code follows a schema-plus-inferred-types pattern.
- Server logging uses pino with redaction of sensitive headers/cookies.
- API server build: custom `build.mjs` (esbuild with 80+ externals, not tsup/tsx).
- Vite configs conditionally load Replit plugins when `REPL_ID` env var is set.
- Root `package.json` has aggressive dependency overrides (esbuild, undici, yaml, tar) — don't change without reason.

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
