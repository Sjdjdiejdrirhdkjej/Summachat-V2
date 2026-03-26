# AGENTS.md

Repository guidance for coding agents working in `/home/runner/workspace`.

## Scope and precedence

- This is the repo-level agent guide for this workspace.
- No repo-level `.cursorrules`, `.cursor/rules/*`, or `.github/copilot-instructions.md` files were found when this file was written.
- Follow direct user instructions first, then this file, then local file conventions.

## Repo snapshot

- Package manager: `pnpm` only.
- Runtime/tooling baseline: Node.js 24, TypeScript 5.9.
- Monorepo layout: pnpm workspaces.
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
- `scripts/` — standalone TS scripts run through one workspace package.

## Commands agents should actually use

### Install

- `pnpm install`
- Do not use npm or yarn. Root `preinstall` rejects them.

### Root validation

- `pnpm run typecheck`
  - Preferred repo-wide validation before handoff.
  - Root typecheck matters because TS project references connect packages.
- `pnpm run build`
  - Runs root typecheck first, then package builds where present.

### Lint / format / test

- Lint: no repo-defined command.
- Format: no repo-defined command.
- Test: no repo-defined command.
- Single-test execution: unsupported in the current repo state because no test runner or test files were found.

Do not invent `pnpm test`, `pnpm lint`, or `pnpm format` in plans or summaries unless the repo gains those commands.

### Package-filtered command pattern

Use pnpm filtering for targeted work:

- `pnpm --filter <workspace-name> run <script>`

Examples from the current repo:

- API server dev: `pnpm --filter @workspace/api-server run dev`
- API server build: `pnpm --filter @workspace/api-server run build`
- API server start: `pnpm --filter @workspace/api-server run start`
- API server typecheck: `pnpm --filter @workspace/api-server run typecheck`
- Chat UI dev: `pnpm --filter @workspace/chat-ui run dev`
- Chat UI build: `pnpm --filter @workspace/chat-ui run build`
- Chat UI serve: `pnpm --filter @workspace/chat-ui run serve`
- Chat UI typecheck: `pnpm --filter @workspace/chat-ui run typecheck`
- Mockup sandbox dev: `pnpm --filter @workspace/mockup-sandbox run dev`
- Mockup sandbox build: `pnpm --filter @workspace/mockup-sandbox run build`
- Mockup sandbox preview: `pnpm --filter @workspace/mockup-sandbox run preview`
- Mockup sandbox typecheck: `pnpm --filter @workspace/mockup-sandbox run typecheck`
- DB schema push: `pnpm --filter @workspace/db run push`
- DB schema force push: `pnpm --filter @workspace/db run push-force`
- API codegen: `pnpm --filter @workspace/api-spec run codegen`
- Scripts package pattern: `pnpm --filter @workspace/scripts run <script>`

## When to run what

- Small package-local change: run that package’s `typecheck` if available.
- Cross-package or shared-lib change: run `pnpm run typecheck` from repo root.
- Before final handoff on code changes: prefer root `pnpm run typecheck`.
- Before final handoff on build-affecting changes: run `pnpm run build` if the change can affect bundling or package outputs.
- If you change OpenAPI files or generated client/schema surfaces: run `pnpm --filter @workspace/api-spec run codegen`, then typecheck.
- If you change Drizzle schema definitions and the task calls for syncing schema: use `pnpm --filter @workspace/db run push`.

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
- Follow the surrounding file’s semicolon style instead of normalizing unrelated lines.
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

### Exports

- Reusable libraries generally favor named exports.
- Default exports are acceptable for top-level app objects, routers, pages, and similar single-purpose entry files.
- Follow the surrounding file’s export style when editing an existing module.

### Error handling

- Fail fast for required environment variables during startup/config initialization.
- When narrowing unknown errors, use `instanceof Error` before reading `.message`.
- Do not swallow errors with empty catch blocks.
- Prefer structured error types or clear error payloads over ad hoc string-only flows when the module already has a pattern for that.

### Logging and secrets

- Server logging uses pino.
- Preserve redaction of sensitive headers/cookies when touching logging.
- Never log secrets, auth headers, cookies, or raw credentials.

## Architecture notes agents should preserve

- Keep the monorepo split clear: apps in `artifacts/`, reusable code in `lib/`, utility scripts in `scripts/`.
- Root TypeScript project references are part of the build graph; update references when adding new package dependencies that require them.
- The API flow is schema/codegen-driven:
  - OpenAPI spec lives in `lib/api-spec/`.
  - Orval generates clients into sibling packages.
  - Server routes consume generated validators and shared libs.
- Database code follows a schema-plus-inferred-types pattern.

## Dependency and supply-chain rules

- Do not switch package managers.
- Do not remove or disable `minimumReleaseAge` protections in `pnpm-workspace.yaml`.
- If adding dependencies, keep workspace/catalog usage consistent with surrounding manifests.

## Working norms for agents

- Prefer minimal diffs that match existing local patterns.
- Read adjacent files before introducing a new pattern.
- If conventions differ by area, follow the area you are editing instead of forcing uniformity.
- Do not claim lint, format, or test coverage that does not exist.
- If asked for a single test command, state that the repo currently has no supported single-test command.
- When summarizing validation, distinguish between package-local typecheck and root typecheck.

## Handy quick reference

- Repo-wide typecheck: `pnpm run typecheck`
- Repo-wide build: `pnpm run build`
- Run one package script: `pnpm --filter <workspace-name> run <script>`
- Regenerate API client/schema code: `pnpm --filter @workspace/api-spec run codegen`
- Push DB schema: `pnpm --filter @workspace/db run push`
- Run scripts workspace script: `pnpm --filter @workspace/scripts run <script>`

If this repo later adds Cursor rules, Copilot instructions, linting, formatting, or tests, update this file to reflect the new source of truth.
