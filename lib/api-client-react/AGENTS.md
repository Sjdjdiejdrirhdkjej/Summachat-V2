# AGENTS.md — API Client React

Package-level guidance for `@workspace/api-client-react` (generated React Query client).

## Overview

Auto-generated React Query client from OpenAPI spec. Provides type-safe hooks for API calls with auth token injection and base URL configuration. Consumed by chat-ui for all backend communication.

## Structure

```
src/
├── index.ts              → Barrel export (hooks + utilities)
├── custom-fetch.ts       → Auth token getter, base URL, error classes
└── generated/
    ├── api.ts            → Generated React Query hooks
    └── api.schemas.ts    → Type definitions
```

## Where to Look

| Task                         | Location                                             |
| ---------------------------- | ---------------------------------------------------- |
| Configure base URL           | `custom-fetch.ts` — `setBaseUrl()`                   |
| Configure auth               | `custom-fetch.ts` — `setAuthTokenGetter()`           |
| Add custom error handling    | `custom-fetch.ts` — `ApiError`, `ResponseParseError` |
| Generated hooks              | `generated/api.ts` — auto-generated, do not edit     |
| Regenerate after spec change | `npm run -w @workspace/api-spec codegen`             |

## Conventions

- **Generated code**: Never edit `generated/*.ts` — regenerated from OpenAPI spec
- **Auth pattern**: Call `setAuthTokenGetter()` once at app startup to inject auth tokens
- **Base URL**: Call `setBaseUrl()` if API runs on non-default host
- **Error handling**: Custom `ApiError` and `ResponseParseError` classes for typed error handling

## Codegen Workflow

1. Edit OpenAPI spec: `lib/api-spec/openapi.yaml`
2. Run: `npm run -w @workspace/api-spec codegen`
3. This package regenerates `generated/api.ts` and `generated/api.schemas.ts`

## Exports

```typescript
// Main API
export { useChatPost, useMultiChatPost, ... } from './generated/api';

// Utilities
export { setBaseUrl, setAuthTokenGetter } from './custom-fetch';
export { ApiError, ResponseParseError } from './custom-fetch';
```

## Consumer

- **chat-ui**: Imports all hooks and utilities for API communication
- **No other consumers**: This package is chat-ui-specific

## Notes

- **No auth by default**: Call `setAuthTokenGetter()` before making authenticated requests
- **Default base URL**: `/api` — set `API_SERVER_URL` env var or call `setBaseUrl()` for custom servers
- **React Query dependency**: Requires `@tanstack/react-query` in consumer
