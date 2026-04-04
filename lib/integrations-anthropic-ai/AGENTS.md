## OVERVIEW

Anthropic AI integration package with lazy client init, batch utilities, and shared rate-limit handling.

## WHERE TO LOOK

- `src/index.ts` for public API (`getClient()`, `tryGetClient()`, `isConfigured()`)
- `src/client.ts` for client setup and env var checks
- `src/batch/utils.ts` for retry, concurrency, batch processing

## CONVENTIONS

- Environment variables: `AI_INTEGRATIONS_ANTHROPIC_API_KEY` (fail fast if missing)
- Lazy singleton: Access via `getClient()` or `tryGetClient()`
- Subpath export: `./batch` for batch utilities
- Match patterns with `lib/integrations-openai-ai-server` for cross-provider consistency

## ANTI-PATTERNS

- Don't defer env var checks — fail at module init
- Don't duplicate batch logic — share with other providers
- Don't add UI helpers — server-only package
