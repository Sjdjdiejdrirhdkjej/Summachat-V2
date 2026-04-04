## OVERVIEW

React hooks for OpenAI client-side features (audio streaming). Only integration package designed for browser use.

## WHERE TO LOOK

- `src/index.ts` for public hooks
- `src/audio/useVoiceStream.ts` for voice streaming hook

## CONVENTIONS

- Browser-safe: No Node.js APIs (fs, Buffer, child_process)
- React hooks: `useVoiceStream` and related audio utilities
- Follow React hook conventions (cleanup, dependency arrays)

## CONSUMER

- `chat-ui` — Voice/audio features via this package

## ANTI-PATTERNS

- Don't add server-only code — must work in browser
- Don't bypass React patterns — hooks should follow React Query conventions
