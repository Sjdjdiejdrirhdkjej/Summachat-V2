# AI Image Generator v1

## TL;DR

> **Summary**: Build a dedicated `/images` experience in Chat UI that sends a text prompt to the API server, enhances it with an LLM, routes the request to OpenAI or Gemini, persists the generated image for later reopening, and exposes text-only history plus protected image retrieval.
> **Deliverables**:
>
> - Dedicated Chat UI image page and navigation entrypoints
> - Contract-first image API (`POST /api/images/generations`, `GET /api/images`, `GET /api/images/{imageId}/content`)
> - Prompt-enhancement + deterministic provider-routing pipeline for OpenAI/Gemini
> - Durable image persistence with Postgres metadata + server-managed file storage behind an interface
> - Agent-executable QA covering success, invalid request, wrong-owner access, and reopen-after-refresh
>   **Effort**: Large
>   **Parallel**: YES - 2 waves
>   **Critical Path**: 1 → 2 → 3 → 6 → 8

## Context

### Original Request

Plan an AI image generator that uses an LLM to enhance the prompt and then chooses the best image model based on the request.

### Interview Summary

- V1 ships as a dedicated Chat UI page, not inside the existing multi-chat flow.
- V1 is synchronous.
- V1 is text-to-image only.
- V1 routes between the existing OpenAI and Gemini image-capable integrations.
- Generated images must persist so the same browser install can reopen full images later.
- Validation for v1 stays within existing repo gates: OpenAPI/codegen, typecheck, build, and agent QA.

### Metis Review (gaps addressed)

- Scope guardrails tightened to exclude auth, public sharing, galleries, async jobs, edits, and variations.
- Added explicit ownership model: anonymous device-scoped owner ID stored in localStorage and sent on every image request.
- Added explicit persistence split: Postgres metadata + server-managed file storage, not Postgres blobs.
- Added explicit reopen criteria, wrong-owner denial criteria, and storage-failure criteria.
- Added contract-first ordering so generated validators stay aligned with new API routes.

### Oracle Review (architecture decisions)

- Default v1 ownership is same-browser/device only; cross-device recovery is out of scope.
- Default v1 storage backend is server-managed local disk behind an `ImageStorage` interface, with production assumed to provide durable local/shared persistent storage.
- Full image bytes must be served through an API route; never expose direct filesystem paths.

## Work Objectives

### Core Objective

Deliver an end-to-end, repo-native AI image generator that produces one persisted PNG per request, records prompt lineage and routing decisions, and lets the originating browser reopen prior results from a protected history list.

### Deliverables

- `artifacts/chat-ui/src/pages/images.tsx` dedicated image page
- `artifacts/chat-ui/src/lib/image-owner.ts` owner ID helper
- New image API contract in `lib/api-spec/openapi.yaml` plus generated client/zod outputs
- `lib/db/src/schema/generated-images.ts` and schema exports
- `artifacts/api-server/src/lib/image-generation/*` modules for prompt enhancement, routing, normalization, ownership, and storage
- `artifacts/api-server/src/routes/images.ts` route registration for create/list/content

### Definition of Done (verifiable conditions with commands)

- `pnpm --filter @workspace/api-spec run codegen`
- `pnpm run typecheck`
- `pnpm run build`
- `PORT=3000 pnpm --filter @workspace/api-server run dev` serves the image endpoints at `http://127.0.0.1:3000/api`
- `PORT=5173 API_SERVER_URL=http://127.0.0.1:3000 pnpm --filter @workspace/chat-ui run dev` serves the UI at `http://127.0.0.1:5173/images`
- `curl -s -X POST http://127.0.0.1:3000/api/images/generations -H 'Content-Type: application/json' -H 'x-anonymous-owner-id: imgown_e2e_owner' --data '{"prompt":"minimalist poster with the words HELLO WORLD in bold white sans-serif"}'` returns `201` with JSON containing `image.id`, `image.provider`, `image.model`, and `image.contentUrl`
- A generated image can be reopened after page refresh from `http://127.0.0.1:5173/images` using the same browser install

### Must Have

- Contract-first image API with generated Zod/client artifacts updated before route/UI work
- One prompt input only in v1; fixed square PNG output (`1024x1024` target where provider supports explicit size)
- One image per request; no batch generation UI
- Anonymous owner ID stored in localStorage under a dedicated key and sent in `x-anonymous-owner-id`
- Persist these fields per image: original prompt, enhanced prompt, provider-revised prompt if available, routing reason, provider, model, mime type, byte size, checksum, storage key, created timestamp
- Text-only history list in UI; full image fetched on demand via JS `fetch`, then shown via object URL
- OpenAI chosen for text-heavy/poster/layout/product-style prompts and low-confidence fallback; Gemini chosen for general scene/concept/art prompts
- API-mediated ownership checks on list and content retrieval

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)

- No auth, user accounts, teams, public sharing, or cross-device recovery
- No SSE, websockets, background jobs, queues, polling, or webhooks
- No image editing, variations, uploads, masks, or multi-image generation
- No generic asset library, thumbnail pipeline, or public image URLs
- No image bytes stored in Postgres
- No direct `<img src="/api/images/...">` that depends on unauthenticated public access
- No provider choice exposed to end users in v1
- No automatic cleanup/TTL job in v1

## Verification Strategy

> ZERO HUMAN INTERVENTION — all verification is agent-executed.

- Test decision: **none** (existing repo has no test framework); use codegen + typecheck + build + agent QA
- QA policy: Every task below includes executable happy-path and failure/edge-path checks
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy

### Parallel Execution Waves

> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: contract, ownership schema, storage abstraction, routing pipeline, UI shell
Wave 2: generation route, history/content routes, UI integration

### Dependency Matrix (full, all tasks)

| Task                            | Depends On    | Blocks  |
| ------------------------------- | ------------- | ------- |
| 1. API contract                 | none          | 6, 7, 8 |
| 2. Owner + DB schema            | none          | 6, 7, 8 |
| 3. Storage adapter              | none          | 6, 7    |
| 4. Prompt enhancement + router  | none          | 6       |
| 5. UI shell + owner helper      | none          | 8       |
| 6. Generate route               | 1, 2, 3, 4    | 7, 8    |
| 7. History + content routes     | 1, 2, 3, 6    | 8       |
| 8. UI integration + reopen flow | 1, 2, 5, 6, 7 | F1-F4   |

### Agent Dispatch Summary (wave → task count → categories)

- Wave 1 → 5 tasks → `unspecified-high`, `unspecified-high`, `quick`, `deep`, `visual-engineering`
- Wave 2 → 3 tasks → `deep`, `unspecified-high`, `visual-engineering`
- Final Verification → 4 tasks → `oracle`, `unspecified-high`, `unspecified-high`, `deep`

## TODOs

> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Define the image API contract and regenerate schemas

  **What to do**:
  - Update `lib/api-spec/openapi.yaml` to add an `images` tag and exactly three endpoints:
    - `POST /images/generations`
    - `GET /images`
    - `GET /images/{imageId}/content`
  - Define request/response schemas for a fixed-shape v1:
    - `CreateImageGenerationRequest` with `prompt: string` (`minLength: 1`, `maxLength: 2000`)
    - `GeneratedImageRecord` with `id`, `prompt`, `enhancedPrompt`, `providerRevisedPrompt`, `provider`, `model`, `routingReason`, `mimeType`, `byteSize`, `status`, `createdAt`, `contentUrl`
    - `ListGeneratedImagesResponse` returning newest-first metadata records
    - `Problem` schema for 400/403/404/422/500 responses
  - Model owner identity as required header parameter `x-anonymous-owner-id` on all image endpoints.
  - Regenerate `@workspace/api-client-react` and `@workspace/api-zod` via Orval.

  **Must NOT do**:
  - Do not add edit, variation, upload, delete, or public download endpoints.
  - Do not model thumbnails or provider selection as user-controlled inputs.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: contract changes cascade into generated artifacts and server validation.
  - Skills: `[]` — No special skill needed.
  - Omitted: `[]` — No omission required.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 6, 7, 8 | Blocked By: none

  **References**:
  - Pattern: `lib/api-spec/openapi.yaml:1-203` — current contract layout and schema naming conventions
  - Pattern: `lib/api-spec/orval.config.ts:16-69` — generated client/zod outputs and base `/api` config
  - Route registration target: `artifacts/api-server/src/routes/index.ts:1-12` — new images router must mount here later

  **Acceptance Criteria**:
  - [ ] `pnpm --filter @workspace/api-spec run codegen` succeeds.
  - [ ] `pnpm run typecheck` succeeds after codegen.
  - [ ] Generated outputs include image operations/schemas in `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/`.

  **QA Scenarios**:

  ```
  Scenario: Codegen produces image operations
    Tool: Bash
    Steps: Run `pnpm --filter @workspace/api-spec run codegen` from repo root, then verify generated files contain `createImageGeneration`, `listGeneratedImages`, and `getGeneratedImageContent` exports.
    Expected: Codegen exits 0 and all three operation names exist in generated client output.
    Evidence: .sisyphus/evidence/task-1-image-contract.txt

  Scenario: Contract rejects empty prompt at schema level
    Tool: Bash
    Steps: After codegen, inspect generated Zod schema for `CreateImageGenerationRequest` and confirm `prompt` has a minimum length constraint.
    Expected: Empty prompt is invalid before route execution; generated schema contains the prompt length guard.
    Evidence: .sisyphus/evidence/task-1-image-contract-error.txt
  ```

  **Commit**: YES | Message: `feat(api-spec): define image generation endpoints` | Files: `lib/api-spec/openapi.yaml`, `lib/api-client-react/src/generated/**`, `lib/api-zod/src/generated/**`

- [ ] 2. Add anonymous owner semantics and generated image metadata schema

  **What to do**:
  - Create `lib/db/src/schema/generated-images.ts` with a single `generatedImages` table using a UUID primary key.
  - Add these columns exactly: `id`, `anonymousOwnerIdHash`, `originalPrompt`, `enhancedPrompt`, `providerRevisedPrompt` nullable, `provider`, `model`, `routingReason`, `mimeType`, `byteSize`, `sha256`, `storageBackend`, `storageKey`, `status`, `createdAt`.
  - Use `status` enum values `ready | blocked | failed` as text constrained by Zod/route logic; v1 writes `ready` or `blocked` only.
  - Export the table and inferred types from `lib/db/src/schema/index.ts`.
  - Create `artifacts/chat-ui/src/lib/image-owner.ts` with `getOrCreateAnonymousOwnerId()` storing a stable opaque ID in localStorage under `imagegen_owner_id`; format must be `imgown_${crypto.randomUUID()}`.
  - Hash the owner ID server-side before DB persistence; never store raw owner IDs in Postgres.

  **Must NOT do**:
  - Do not add `users`, `assets`, `galleries`, or `userId` columns.
  - Do not reuse the browser fingerprint as the canonical owner key.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: DB schema and client ownership semantics must stay tightly aligned.
  - Skills: `[]` — No special skill needed.
  - Omitted: `[]` — No omission required.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 6, 7, 8 | Blocked By: none

  **References**:
  - Pattern: `lib/db/src/schema/conversations.ts:1-17` — table + insert schema pattern
  - Pattern: `lib/db/src/schema/messages.ts:1-23` — foreign-key/export style
  - Export point: `lib/db/src/schema/index.ts:1-2` — update schema barrel exports here
  - Identity precedent: `artifacts/chat-ui/src/lib/fingerprint.ts:1-62` — localStorage-backed device identity pattern to mirror without reusing fingerprint
  - Persistence precedent: `artifacts/chat-ui/src/lib/chat-store.ts:3-64` — localStorage keying/listing pattern for same-browser scope

  **Acceptance Criteria**:
  - [ ] `pnpm run typecheck` succeeds with the new schema and owner helper.
  - [ ] `lib/db/src/schema/index.ts` exports the new table/types.
  - [ ] `artifacts/chat-ui/src/lib/image-owner.ts` returns a stable `imgown_...` value across reloads in the same browser.

  **QA Scenarios**:

  ```
  Scenario: Owner helper uses the required storage key and prefix
    Tool: Bash
    Steps: Inspect `artifacts/chat-ui/src/lib/image-owner.ts`.
    Expected: The helper stores under `imagegen_owner_id` and creates values prefixed with `imgown_`.
    Evidence: .sisyphus/evidence/task-2-owner-id.json

  Scenario: Schema stays anonymous-only
    Tool: Bash
    Steps: Inspect `lib/db/src/schema/generated-images.ts` and `lib/db/src/schema/index.ts`.
    Expected: The schema contains `anonymousOwnerIdHash` and does not introduce `userId`, `galleryId`, or image blob columns.
    Evidence: .sisyphus/evidence/task-2-owner-id-error.txt
  ```

  **Commit**: YES | Message: `feat(db): add generated image metadata schema` | Files: `lib/db/src/schema/generated-images.ts`, `lib/db/src/schema/index.ts`, `artifacts/chat-ui/src/lib/image-owner.ts`

- [ ] 3. Build the durable image storage adapter

  **What to do**:
  - Create `artifacts/api-server/src/lib/image-generation/storage.ts` with:
    - `ImageStorage` interface
    - `LocalImageStorage` implementation
    - `getImageStorage()` factory
  - Default the storage directory to `process.env.IMAGE_STORAGE_DIR ?? path.resolve(process.cwd(), ".data/generated-images")`.
  - Persist bytes using storage keys `${imageId}.png` only.
  - Expose methods exactly named `write`, `readStream`, `exists`, and `remove`.
  - Return normalized metadata from `write`: `storageBackend`, `storageKey`, `byteSize`, `sha256`, `mimeType`.
  - Create directories recursively if missing.
  - Convert missing-file reads into a controlled `not_found` result; do not leak raw filesystem errors to the route layer.
  - Treat durable local/shared persistent storage as a confirmed v1 deployment assumption; only replace this backend if deployment architecture changes later.

  **Must NOT do**:
  - Do not store files under `src/`, `dist/`, or any repo-tracked directory.
  - Do not expose absolute file paths to the UI or API responses.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: a small, self-contained storage abstraction with deterministic behavior.
  - Skills: `[]` — No special skill needed.
  - Omitted: `[]` — No omission required.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 6, 7 | Blocked By: none

  **References**:
  - Pattern: `artifacts/api-server/src/app.ts:31-50` — API server owns `/api` and must not rely on public static file exposure for protected images
  - Provider byte precedent: `lib/integrations-openai-ai-server/src/image/client.ts:22-36` — OpenAI adapter already yields image bytes
  - Provider byte precedent: `lib/integrations-gemini-ai/src/image/client.ts:23-47` — Gemini adapter currently yields base64 + mime and needs normalization later

  **Acceptance Criteria**:
  - [ ] `pnpm --filter @workspace/api-server run typecheck` succeeds.
  - [ ] A deterministic write/read round-trip preserves byte length and SHA-256 checksum.
  - [ ] Missing storage keys are mapped to a controlled not-found result.

  **QA Scenarios**:

  ```
  Scenario: Storage round-trip preserves file bytes
    Tool: Bash
    Steps: Run a `pnpm --filter @workspace/api-server exec tsx --eval` script that instantiates `LocalImageStorage`, writes a known PNG fixture buffer for image ID `11111111-1111-1111-1111-111111111111`, then reads it back and compares the SHA-256 digest.
    Expected: The script exits 0 and reports identical byte size and checksum.
    Evidence: .sisyphus/evidence/task-3-storage.txt

  Scenario: Missing file read is normalized
    Tool: Bash
    Steps: Run a `tsx --eval` script against `LocalImageStorage.readStream("missing.png")`.
    Expected: The script returns a controlled not-found result instead of an uncaught filesystem exception.
    Evidence: .sisyphus/evidence/task-3-storage-error.txt
  ```

  **Commit**: YES | Message: `feat(api-server): add local image storage adapter` | Files: `artifacts/api-server/src/lib/image-generation/storage.ts`

- [ ] 4. Implement prompt enhancement, routing, and provider normalization

  **What to do**:
  - Create `artifacts/api-server/src/lib/image-generation/prompt-enhancer.ts` that calls OpenAI `gpt-5.2` once per request and returns structured JSON with exactly: `enhancedPrompt`, `routingCategory`, and `routingReason`.
  - Allowed `routingCategory` values: `text-heavy`, `layout-product`, `scene-photoreal`, `scene-illustration`, `low-confidence`.
  - Create `artifacts/api-server/src/lib/image-generation/router.ts` with a deterministic mapper:
    - `text-heavy` → OpenAI `gpt-image-1`
    - `layout-product` → OpenAI `gpt-image-1`
    - `scene-photoreal` → Gemini `gemini-2.5-flash-image`
    - `scene-illustration` → Gemini `gemini-2.5-flash-image`
    - `low-confidence` → OpenAI `gpt-image-1`
  - Create `artifacts/api-server/src/lib/image-generation/providers.ts` that normalizes both provider adapters to one result shape: `bytes`, `mimeType`, `provider`, `model`, `providerRevisedPrompt`.
  - Extend the OpenAI image adapter to surface `revised_prompt` when present.
  - Convert Gemini base64 output to `Buffer` in the normalization layer.
  - Record provider-native safety/block metadata when available; if a provider blocks generation, normalize to `status: blocked` without writing bytes.

  **Must NOT do**:
  - Do not expose provider choice as a user-facing selector.
  - Do not make routing depend on runtime randomness.
  - Do not implement edits, masks, or multi-step conversational refinement.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: this is the core business logic and must reconcile provider shape differences cleanly.
  - Skills: `[]` — No special skill needed.
  - Omitted: `[]` — No omission required.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 6 | Blocked By: none

  **References**:
  - Pattern: `artifacts/api-server/src/routes/multi-chat.ts:46-64` — route-adjacent schema + typed request handling pattern
  - Pattern: `artifacts/api-server/src/routes/multi-chat.ts:480-580` — provider dispatch branching pattern to replace with a normalized image pipeline
  - Provider API: `lib/integrations-openai-ai-server/src/image/client.ts:22-36` — OpenAI image generation entrypoint
  - Provider API: `lib/integrations-gemini-ai/src/image/client.ts:23-47` — Gemini image generation entrypoint
  - External: `https://developers.openai.com/api/docs/guides/image-generation` — `revised_prompt` and image capability guidance
  - External: `https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/Shared.Types/VisionGenerativeModelParams` — Gemini/Imagen image safety and prompt enhancement controls

  **Acceptance Criteria**:
  - [ ] `pnpm --filter @workspace/api-server run typecheck` succeeds.
  - [ ] A deterministic router function maps sample routing categories to the correct provider/model.
  - [ ] Provider normalization always yields a `Buffer` plus `provider`, `model`, and nullable `providerRevisedPrompt`.

  **QA Scenarios**:

  ```
  Scenario: Router chooses OpenAI for text-heavy prompts and Gemini for scene prompts
    Tool: Bash
    Steps: Run a `pnpm --filter @workspace/api-server exec tsx --eval` script that calls the pure router with `text-heavy` and `scene-photoreal` categories.
    Expected: `text-heavy` maps to `openai/gpt-image-1`; `scene-photoreal` maps to `gemini/gemini-2.5-flash-image`.
    Evidence: .sisyphus/evidence/task-4-router.txt

  Scenario: Low-confidence requests fall back to OpenAI
    Tool: Bash
    Steps: Run the same script with `low-confidence`.
    Expected: The fallback provider/model is OpenAI `gpt-image-1`, not Gemini.
    Evidence: .sisyphus/evidence/task-4-router-error.txt
  ```

  **Commit**: YES | Message: `feat(api-server): add image prompt routing pipeline` | Files: `artifacts/api-server/src/lib/image-generation/**`, `lib/integrations-openai-ai-server/src/image/client.ts`

- [ ] 5. Add the dedicated image page shell, owner helper wiring, and navigation entrypoints

  **What to do**:
  - Add `artifacts/chat-ui/src/pages/images.tsx` and route it at `/images` in `artifacts/chat-ui/src/App.tsx`.
  - Reuse existing layout conventions from `multi-chat.tsx`, `home.tsx`, and `ChatSidebar.tsx`.
  - Add a visible navigation entry labeled exactly `Image Studio` on the home screen and in the sidebar.
  - Page shell must include these exact testable elements:
    - `textarea[data-testid="image-prompt-input"]`
    - `button[data-testid="generate-image-button"]`
    - `div[data-testid="image-history-list"]`
    - `div[data-testid="generated-image-panel"]`
    - `pre[data-testid="image-enhanced-prompt"]` (collapsed/hidden until a result exists)
    - `div[data-testid="image-error-banner"]`
  - Use `getOrCreateAnonymousOwnerId()` on first render and keep the owner ID entirely client-side.
  - Do not show thumbnails in the history list; show title, provider badge, and created date only.

  **Must NOT do**:
  - Do not reuse `/chat/:id` routes for image generation.
  - Do not show the raw owner ID in the UI.
  - Do not add provider toggles or advanced controls.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: this is a new route/page with explicit UI structure and reusable styling patterns.
  - Skills: `[]` — No special skill needed.
  - Omitted: `[]` — No omission required.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 8 | Blocked By: none

  **References**:
  - Pattern: `artifacts/chat-ui/src/App.tsx:1-36` — current routing shell
  - Pattern: `artifacts/chat-ui/src/pages/home.tsx:31-156` — page framing and CTA conventions
  - Pattern: `artifacts/chat-ui/src/components/ChatSidebar.tsx:27-194` — sidebar navigation/list conventions
  - Pattern: `artifacts/chat-ui/src/pages/multi-chat.tsx:193-252` — page-local state, local persistence hooks, and streaming-era layout conventions to adapt

  **Acceptance Criteria**:
  - [ ] `pnpm --filter @workspace/chat-ui run typecheck` succeeds.
  - [ ] `http://127.0.0.1:5173/images` renders the dedicated page shell with all required test IDs.
  - [ ] Home and sidebar both include an `Image Studio` navigation entry.

  **QA Scenarios**:

  ```
  Scenario: Image Studio route and shell render correctly
    Tool: Playwright
    Steps: Start the UI at `http://127.0.0.1:5173`, navigate to `/images`, and query the page for `image-prompt-input`, `generate-image-button`, `image-history-list`, and `generated-image-panel`.
    Expected: All required elements are present and visible; `image-error-banner` is absent on first load.
    Evidence: .sisyphus/evidence/task-5-image-page.png

  Scenario: Navigation entry is available from home and sidebar
    Tool: Playwright
    Steps: Open `/`, click the sidebar trigger, and look for the exact text `Image Studio`; then navigate using that entry.
    Expected: The app reaches `/images` without using the chat route.
    Evidence: .sisyphus/evidence/task-5-image-page-nav.png
  ```

  **Commit**: YES | Message: `feat(chat-ui): add image studio shell` | Files: `artifacts/chat-ui/src/pages/images.tsx`, `artifacts/chat-ui/src/App.tsx`, `artifacts/chat-ui/src/pages/home.tsx`, `artifacts/chat-ui/src/components/ChatSidebar.tsx`

- [ ] 6. Implement the synchronous generation route with prompt lineage, routing, persistence, and error mapping

  **What to do**:
  - Create `artifacts/api-server/src/routes/images.ts` with `POST /images/generations`.
  - Validate request bodies with generated Zod schemas from `@workspace/api-zod`; validate the `x-anonymous-owner-id` header explicitly before any provider call.
  - For each valid request, execute this exact flow:
    1. Validate prompt and owner header
    2. Enhance prompt + classify routing category
    3. Choose provider/model deterministically
    4. Generate one image
    5. If blocked, persist metadata row with `status = blocked` and return `422`
    6. If successful, persist bytes via `ImageStorage.write`
    7. Persist metadata row with `status = ready`
    8. Return `201` with the generated record and `contentUrl`
  - Use fixed v1 output assumptions:
    - OpenAI size: `1024x1024`
    - Gemini: provider default image size, normalized to PNG bytes if needed
  - On storage-write failure after provider success, remove any partially written file and return `500`.
  - Log `originalPrompt`, `enhancedPrompt`, `providerRevisedPrompt`, `routingReason`, provider/model, and request ID via existing server logging patterns.
  - Mount the new router in `artifacts/api-server/src/routes/index.ts`.

  **Must NOT do**:
  - Do not stream partial results.
  - Do not write a DB row claiming `ready` before storage succeeds.
  - Do not swallow provider or storage errors.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: this is the main orchestration path and the highest-risk backend task.
  - Skills: `[]` — No special skill needed.
  - Omitted: `[]` — No omission required.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 7, 8 | Blocked By: 1, 2, 3, 4

  **References**:
  - Pattern: `artifacts/api-server/src/routes/multi-chat.ts:408-451` — request validation and response lifecycle pattern
  - Pattern: `artifacts/api-server/src/routes/multi-chat.ts:480-617` — provider invocation/error-finalization pattern
  - Route mount: `artifacts/api-server/src/routes/index.ts:1-12` — register the images router here
  - Server mount: `artifacts/api-server/src/app.ts:31-50` — `/api` namespace and built UI hosting
  - Provider API: `lib/integrations-openai-ai-server/src/image/client.ts:22-36`
  - Provider API: `lib/integrations-gemini-ai/src/image/client.ts:23-47`

  **Acceptance Criteria**:
  - [ ] `pnpm --filter @workspace/api-server run typecheck` succeeds.
  - [ ] `POST /api/images/generations` with a valid owner header and prompt returns `201` and a JSON body containing `image.id`, `image.provider`, `image.model`, `image.enhancedPrompt`, and `image.contentUrl`.
  - [ ] Empty prompts return `400` before provider invocation.
  - [ ] Provider blocks return `422` with metadata persisted as `blocked` and no file written.

  **QA Scenarios**:

  ```
  Scenario: Successful generation returns persisted metadata and content URL
    Tool: Bash
    Steps: Start the API server on `http://127.0.0.1:3000`, run `curl -s -D .sisyphus/evidence/task-6-generate.headers -o .sisyphus/evidence/task-6-generate.json -X POST http://127.0.0.1:3000/api/images/generations -H 'Content-Type: application/json' -H 'x-anonymous-owner-id: imgown_e2e_owner' --data '{"prompt":"minimalist poster with the words HELLO WORLD in bold white sans-serif"}'`.
    Expected: Status `201`; response JSON contains a non-empty `image.id`, provider/model values, non-empty `enhancedPrompt`, and a relative `contentUrl`.
    Evidence: .sisyphus/evidence/task-6-generate.json

  Scenario: Invalid prompt is rejected before generation
    Tool: Bash
    Steps: Run the same request with `{"prompt":"generate a nude photo of a child"}`.
    Expected: Status `422`; the response reports a blocked generation, metadata is persisted with `status = blocked`, and no image file is written.
    Evidence: .sisyphus/evidence/task-6-generate-error.json
  ```

  **Commit**: YES | Message: `feat(api-server): add image generation route` | Files: `artifacts/api-server/src/routes/images.ts`, `artifacts/api-server/src/routes/index.ts`, `artifacts/api-server/src/lib/image-generation/**`

- [ ] 7. Implement image history and protected content retrieval routes

  **What to do**:
  - In `artifacts/api-server/src/routes/images.ts`, add:
    - `GET /images` returning newest-first metadata for the caller’s owner ID only
    - `GET /images/{imageId}/content` streaming PNG bytes for the owner’s image only
  - Require `x-anonymous-owner-id` on both routes.
  - Hash the incoming owner ID and compare against `anonymousOwnerIdHash`.
  - Return `404` for wrong-owner access and for missing records; do not reveal whether an image exists for another owner.
  - For blocked images, exclude them from the list route entirely.
  - Set `Content-Type: image/png` and `Cache-Control: private, max-age=0, must-revalidate` on the content route.
  - If metadata exists but the file is missing, return `410 Gone` and log a storage inconsistency event.

  **Must NOT do**:
  - Do not serve content through Express static middleware.
  - Do not return the raw `storageKey` to the client.
  - Do not return blocked items in the visible history list.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: route correctness and ownership denial semantics matter more than UI polish here.
  - Skills: `[]` — No special skill needed.
  - Omitted: `[]` — No omission required.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 8 | Blocked By: 1, 2, 3, 6

  **References**:
  - Pattern: `artifacts/api-server/src/app.ts:35-47` — keep protected file access out of static serving
  - Schema pattern: `lib/db/src/schema/conversations.ts:1-17` — table/type export pattern to follow for the generated images table
  - Schema pattern: `lib/db/src/schema/messages.ts:1-23` — relationship/export style to mirror where needed
  - Identity precedent: `artifacts/chat-ui/src/lib/chat-store.ts:54-64` — same-browser filtering concept to mirror on the server side

  **Acceptance Criteria**:
  - [ ] `GET /api/images` returns only records owned by the supplied owner header.
  - [ ] `GET /api/images/{imageId}/content` returns `200` + `image/png` for the correct owner.
  - [ ] Wrong-owner access returns `404`.
  - [ ] Missing file with present metadata returns `410`.

  **QA Scenarios**:

  ```
  Scenario: History list and content reopen work for the correct owner
    Tool: Bash
    Steps: Generate one image as `imgown_e2e_owner`, call `GET /api/images` with the same owner header, extract the returned `image.id`, then call `GET /api/images/{imageId}/content` with the same owner header and save the bytes to `.sisyphus/evidence/task-7-history.png`.
    Expected: The list contains the new item and the content request returns `200` with `Content-Type: image/png` and non-empty bytes.
    Evidence: .sisyphus/evidence/task-7-history.json

  Scenario: Wrong owner cannot reopen another image
    Tool: Bash
    Steps: Reuse the same `image.id` but call `GET /api/images/{imageId}/content` with `x-anonymous-owner-id: imgown_other_owner`.
    Expected: Status `404` with no image bytes returned.
    Evidence: .sisyphus/evidence/task-7-history-error.json
  ```

  **Commit**: YES | Message: `feat(api-server): add image history and content routes` | Files: `artifacts/api-server/src/routes/images.ts`

- [ ] 8. Integrate the UI generation flow, history list, reopen flow, and error states

  **What to do**:
  - Use `fetch` from `artifacts/chat-ui/src/pages/images.tsx` for all three image endpoints; do not introduce a new client abstraction for v1.
  - Always send `x-anonymous-owner-id` from `getOrCreateAnonymousOwnerId()`.
  - On successful generation:
    - render the full image in an `<img data-testid="generated-image">` using a JS-created object URL
    - show provider/model badge
    - reveal `image-enhanced-prompt`
    - prepend the new item to `image-history-list`
  - On page load and refresh, fetch `GET /api/images` and render the history list newest-first.
  - On history click, fetch `/api/images/{imageId}/content` with the owner header, recreate an object URL, and show that image in the preview panel.
  - Empty state copy must be exactly `No images yet`.
  - Loading button text must be exactly `Generating…`.
  - Validation error banner copy for empty prompt must be exactly `Enter a prompt to generate an image.`
  - Wrong-owner/missing-image history fetch failures must show `Unable to reopen that image.` in `image-error-banner`.

  **Must NOT do**:
  - Do not use `img src` URLs that bypass owner-checked fetches.
  - Do not store raw image bytes in localStorage.
  - Do not show blocked generations in the visible history list.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: this is the main user-facing flow and must align with existing design language.
  - Skills: `[]` — No special skill needed.
  - Omitted: `[]` — No omission required.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: F1-F4 | Blocked By: 1, 2, 5, 6, 7

  **References**:
  - Pattern: `artifacts/chat-ui/src/pages/multi-chat.tsx:202-252` — prompt state + persistence callback organization
  - Pattern: `artifacts/chat-ui/src/pages/home.tsx:87-152` — list/empty-state layout conventions
  - Pattern: `artifacts/chat-ui/src/components/ChatSidebar.tsx:127-190` — side list item presentation conventions
  - Routing shell: `artifacts/chat-ui/src/App.tsx:11-20` — dedicated page route placement
  - Dev proxy: `artifacts/chat-ui/vite.config.ts:50-59` — UI can call `/api` directly during dev when `API_SERVER_URL` points at the API server

  **Acceptance Criteria**:
  - [ ] `pnpm --filter @workspace/chat-ui run typecheck` succeeds.
  - [ ] A successful generation shows `generated-image`, provider/model badge, and enhanced prompt panel.
  - [ ] Refreshing `/images` preserves the history list and allows reopening a previously generated image.
  - [ ] Submitting an empty prompt shows the exact validation copy and does not call the API.

  **QA Scenarios**:

  ```
  Scenario: Generate an image, refresh, and reopen it from history
    Tool: Playwright
    Steps: Open `http://127.0.0.1:5173/images`, fill `image-prompt-input` with `minimalist poster with the words HELLO WORLD in bold white sans-serif`, click `generate-image-button`, wait for `generated-image`, refresh the page, click the first history item in `image-history-list`, and verify the preview repopulates.
    Expected: The image appears before refresh and reappears after refresh from persisted history; `image-enhanced-prompt` is visible after generation.
    Evidence: .sisyphus/evidence/task-8-ui-flow.png

  Scenario: Empty prompt is rejected in the UI before network submission
    Tool: Playwright
    Steps: Open `/images`, leave `image-prompt-input` empty, click `generate-image-button`.
    Expected: `image-error-banner` shows `Enter a prompt to generate an image.` and no loading state or image preview appears.
    Evidence: .sisyphus/evidence/task-8-ui-flow-error.png
  ```

  **Commit**: YES | Message: `feat(chat-ui): connect image generation flow` | Files: `artifacts/chat-ui/src/pages/images.tsx`, `artifacts/chat-ui/src/App.tsx`, `artifacts/chat-ui/src/components/ChatSidebar.tsx`, `artifacts/chat-ui/src/pages/home.tsx`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy

- 1 commit: API contract + generated artifacts
- 1 commit: DB schema + anonymous owner helper
- 1 commit: storage adapter
- 1 commit: prompt enhancement + routing + provider normalization
- 1 commit: image studio shell + navigation
- 1 commit: generation route
- 1 commit: history/content routes
- 1 commit: UI integration + reopen flow
- Keep every commit green: codegen, typecheck, and build must pass before each commit is created.

## Success Criteria

- A user can open `/images`, enter one prompt, and receive one generated image.
- The server records prompt lineage and routing decisions for every successful or blocked request.
- The same browser install can refresh `/images` and reopen prior images without regenerating them.
- A different anonymous owner cannot list or reopen another owner’s images.
- The implementation stays inside v1 scope and does not drift into auth, sharing, async jobs, or image editing.
