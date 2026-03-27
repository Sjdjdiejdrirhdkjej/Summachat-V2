## 2026-03-26

- First attempt had scope creep (unrelated UI/manifest/debug artifacts). Corrected by reverting out-of-scope files and keeping only Task 1 server-side stream guardrail changes.
- Session-state files `.sisyphus/boulder.json` and `.sisyphus/plans/ai-provider-replit-chat.md` were mistakenly deleted and have now been restored.
- Search regression fixed: `/chat` webSearch + `search_*` SSE flow restored, and `/multi-chat` now uses shared `lib/web-search.ts` instead of route-local Exa duplication.
- Task 2 first pass briefly touched `artifacts/chat-ui/src/components/Markdown.tsx`; that scope creep was reverted and the retry is now limited to the Gemini route fix.
- Task 5 first pass briefly changed `artifacts/chat-ui/src/components/Markdown.tsx`; that scope creep was corrected so the retry stays limited to `artifacts/chat-ui/src/pages/multi-chat.tsx`.
- Task 5 acceptance also needed a minimal `artifacts/chat-ui/src/components/Markdown.tsx` typecheck unblocker: move prose styling to a wrapper because `ReactMarkdown` no longer accepts `className` in this repo's installed types.
