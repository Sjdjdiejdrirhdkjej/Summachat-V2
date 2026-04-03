# Draft: Fix AI Message Stuck on "Waiting"

## Issue Summary

User reports that when sending a message to AI, it gets stuck on "waiting" status and doesn't respond.

## Symptoms

- **Location**: Frontend UI (chat-ui) shows "waiting" status indefinitely
- **Providers affected**: All (OpenAI, Anthropic, Gemini)
- **Error visibility**: Not yet checked (user hasn't inspected console/logs)
- **Trigger**: Started after switching from Replit modelfarm to AgentRouter (agentrouter.org)
- **Frequency**: Always (100% of messages)

## Requirements (confirmed)

- Fix the message stuck on "waiting" issue
- Issue occurs across all AI providers
- Frontend chat UI is the visible symptom location

## Open Questions

- Check browser console for errors/network tab for request status
- Check server logs for errors when processing message
- Determine: Is the API request completing? Is the response arriving? Is the state not updating?

## Research Findings

### Message Flow Architecture

```
User Input (unified-workspace.tsx:2624 handleTextSubmit)
   ↓ fetch POST
API Server (/api/chat or /api/multi-chat)
   ↓ SSE streaming
runGuardedProviderStream (provider-stream-guard.ts:73)
   ↓ 45s first-chunk timeout, 120s overall timeout
AI Provider (OpenAI/Anthropic/Gemini)
   ↓ stream chunks
SSE Events: {type: "start|chunk|done|error"}
   ↓ reader.read() loop (unified-workspace.tsx:3058)
handleEvent() processes events
   ↓ React state update
UI renders response
```

### Identified Failure Points (6 potential causes)

1. **SSE reader loop blocking** - if stream never yields `done`, UI stays in `streaming` forever
2. **No `done` event received** - server crash/timeout/connection drop before sending `done`
3. **Post-stream settlement bug** - unified-workspace.tsx:3072 unconditionally forces `status: "done"` even on failed streams (hides errors)
4. **Provider timeouts not reaching UI** - timeout at 45s first-chunk or 120s overall may silently fail
5. **Connection closed before `done`** - `res.on("close")` fires, no final SSE events sent
6. **Text turn settlement gap** - compare mode has `settleTurnAfterStream`, text mode forces done unconditionally

### Root Cause: Model Name Aliases

**CRITICAL**: Codebase uses Replit-specific model aliases that AgentRouter does NOT recognize:

| Alias in Code            | AgentRouter Expects                  |
| ------------------------ | ------------------------------------ |
| `gpt-5.2`                | `gpt-4o`, `gpt-4-turbo`              |
| `claude-opus-4-6`        | `claude-opus-4`, `claude-sonnet-4`   |
| `gemini-3.1-pro-preview` | `gemini-2.0-flash`, `gemini-1.5-pro` |

**Locations**: 80+ hardcoded model names across:

- `artifacts/api-server/src/routes/chat.ts` (lines 142, 182, 220)
- `lib/integrations-openai-ai-server/src/audio/client.ts` (line 212)
- Deep-research orchestrator, multi-chat routes, etc.

**AgentRouter Configuration**:

- API Key: `AGENTROUTER_API_KEY` (set by user ✓)
- Base URL: `https://agentrouter.org/v1` (default)
- Proxy: `AGENTROUTER_PROXY_URL` (optional, for Vercel Edge)

### Resolution Strategy

1. Create model name mapping/translation layer
2. Add proper error handling for unknown models
3. Add client-side timeout fallbacks
4. Fix text turn settlement logic

### AgentRouter Supported Models (from mastra.ai)

| Alias in Code                      | AgentRouter Model ID     |
| ---------------------------------- | ------------------------ |
| `gpt-5.2` (invalid)                | `gpt-5` or `gpt-5.1`     |
| `claude-opus-4-6` (invalid)        | `claude-opus-4-20250514` |
| `gemini-3.1-pro-preview` (invalid) | `gemini-3-pro-preview`   |

**Other available**: `claude-sonnet-4-20250514`, `claude-haiku-4-5-20251001`, `deepseek-r1-0528`, `deepseek-v3.1`, `glm-4.5`, `glm-4.6`

### User's Desired Mapping

- "gpt 5.4" → AgentRouter closest: `gpt-5.1` (no 5.4 available)
- "claude opus 4.6" → AgentRouter: `claude-opus-4-20250514`
- "gemini 3.1 pro" → AgentRouter: `gemini-3-pro-preview`
