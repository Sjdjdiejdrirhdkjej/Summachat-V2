- Local image storage lives under `.data/generated-images` by default, with the final storage key forced to `${imageId}.png`.
- `readStream()` should normalize missing files to a controlled `not_found` result instead of surfacing raw filesystem errors.
- A small tsx round-trip script can verify both byte length and SHA-256 checksum without touching repo-tracked paths.

## 2026-03-27

- `lib/db/src/schema/*` follows a consistent Drizzle pattern: `pgTable(...)`, optional `createInsertSchema(...)`, and exported inferred select/insert types.
- Chat UI local identity helpers use stable `localStorage` keys and simple get-or-create flows without coupling identity to browser fingerprint details.
  2026-03-27
- `lib/api-spec/openapi.yaml` follows a compact pattern: path operations reference reusable component schemas with minimal inline definitions.
- Defining a shared required header under `components.parameters` (`AnonymousOwnerIdHeader`) keeps image endpoint parameter usage consistent and avoids duplication.
- Orval split-mode output places React client artifacts in `lib/api-client-react/src/generated/{api.ts,api.schemas.ts}` and Zod artifacts in `lib/api-zod/src/generated/`.

## 2026-03-27

- Added `prompt-enhancer.ts` with a single OpenAI `gpt-5.2` call that enforces strict JSON output via Zod (`enhancedPrompt`, `routingCategory`, `routingReason`) and retries parsing from embedded JSON when providers wrap content.
- Added deterministic router table in `router.ts` with `RoutingCategory -> { provider, model }` mapping and no runtime randomness.
- Added provider normalization in `providers.ts` to unify output as a discriminated union:
  - `status: "ready"` with `bytes: Buffer`, `mimeType`, `provider`, `model`, `providerRevisedPrompt`
  - `status: "blocked"` with provider/model metadata and block reason (no bytes)
- Gemini normalization now converts base64 inline image data to `Buffer` and captures native block/safety context from `promptFeedback`, `finishReason`, and candidate safety ratings when present.

## 2026-03-27

- Chat UI shell pages in `artifacts/chat-ui` consistently use `bg-gray-950`, `border-gray-800`, rounded `xl/2xl` surfaces, and compact header actions rather than introducing new theme tokens per page.
- `ChatSidebar` is the shared navigation surface for both home and detail pages, so new top-level destinations fit best as button entries in the existing action stack above the chat list.
- The image owner helper can be wired client-side on mount without showing or persisting the raw owner ID in visible UI state.
