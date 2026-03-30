- Chose a simple local filesystem adapter with a fixed `.png` storage key to keep the API server independent from public static file serving.
- Returned storage metadata from `write()` in a normalized shape so callers do not need to inspect filesystem details.

## 2026-03-27

- Added `generated_images.anonymous_owner_id_hash` as the persisted owner field so Postgres stores only hashed owner identifiers (never raw anonymous owner IDs).
- Implemented client owner helper key as `imagegen_owner_id` with format `imgown_${crypto.randomUUID()}` to provide stable same-browser identity.
  2026-03-27
- Added exactly three image endpoints to OpenAPI: `POST /images/generations`, `GET /images`, and `GET /images/{imageId}/content` under a new `images` tag.
- Modeled owner identity as required header parameter `x-anonymous-owner-id` and referenced it on all image operations.
- Standardized image error responses on `Problem` for 400/403/404/422/500 to keep API error payloads uniform.
- Updated `lib/api-zod/src/index.ts` to `export type * from "./generated/types";` to prevent name collisions with `generated/api` while preserving type exports.

## 2026-03-27

- Kept routing pure and deterministic in `routeImageGeneration(category)` using a compile-time `Record` table keyed by the allowed categories.
- Extended OpenAI adapter `generateImageBuffer` to return `{ bytes, mimeType, revisedPrompt }` so prompt lineage can persist provider-side rewrites without extra API calls.
- Implemented provider blocking as a first-class normalized outcome (`status: blocked`) to prevent accidental downstream storage writes for blocked generations.

## 2026-03-27

- Added a dedicated `/images` route instead of reusing `/chat/:id` so the image workflow stays isolated from the multi-chat state model.
- Initialized `getOrCreateAnonymousOwnerId()` inside the new image page on mount, keeping anonymous ownership entirely client-side until later API integration uses the header.
- Kept the history shell text-only by design: title, provider badge, and created date structure exist without introducing thumbnail UI or provider controls.
