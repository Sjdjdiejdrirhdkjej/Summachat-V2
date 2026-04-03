## OVERVIEW

Server-side OpenAI integration package that exposes shared client, batch, image, and audio helpers through subpath exports.

## WHERE TO LOOK

- `package.json` for the public entrypoints: `.`, `./batch`, `./image`, `./audio`.
- `tsconfig.json` for the package build contract: composite, declaration-only output rooted in `src/`.
- `src/index.ts` for the root barrel and the main public API surface.
- `src/client.ts` for base OpenAI client setup and required environment checks.
- `src/batch/utils.ts` for retry, concurrency, and SSE batch processing helpers.
- `src/image/client.ts` for image generation and edit helpers that return `Buffer` data.
- `src/audio/client.ts` for format detection, `ffmpeg` conversion, speech, and voice chat flows.
- Neighbor packages in `lib/integrations-anthropic-ai` and `lib/integrations-gemini-ai` when aligning cross-provider helper shape.

## CONVENTIONS

- Preserve the subpath export pattern. Each exported area has its own `index.ts` barrel, and consumers import from the matching package path.
- Keep this package server-only. Current helpers use Node APIs such as `fs`, `Buffer`, temp files, and child processes.
- Fail fast on missing `AI_INTEGRATIONS_OPENAI_*` variables during module init. Don't defer these checks into later request paths.
- Reuse the shared `openai` client pattern unless a helper truly needs a separate client instance.
- Return binary payloads as `Buffer` objects, matching the existing image and audio APIs.
- Keep batch logic generic. `batchProcess` and `batchProcessWithSSE` are meant for reusable provider calls, not route-specific behavior.
- When handling OpenAI responses with loose or evolving shapes, prefer safe narrowing patterns like `Reflect.get` over unsafe casts.
- Treat `ffmpeg` as a runtime dependency for audio conversion paths. If you touch `convertToWav`, keep temp file cleanup and error propagation intact.
- Keep exports declaration-friendly. This package emits types only, so public APIs should stay easy for TypeScript to describe from source.

## ANTI-PATTERNS

- Don't add browser-only code, fetch wrappers for the client, or UI-oriented helpers here.
- Don't bypass the package barrels by pointing consumers at deep internal files unless the export map is updated on purpose.
- Don't silently swallow OpenAI or `ffmpeg` failures. Surface clear errors so callers can decide how to recover.
- Don't hardcode app-specific prompts, routes, or business rules into shared integration helpers.
- Don't duplicate retry or rate-limit handling in new helpers when the batch utilities already cover the need.
- Don't weaken the env var names or prefix. This package follows the workspace `AI_INTEGRATIONS_*` naming scheme.
