# AGENTS.md — Chat UI

Package-level guidance for `@workspace/chat-ui` (React + Vite).

## Overview

React 18 SPA with Vite. Dark mode by default. Proxies `/api` to api-server.

## Structure

```
src/
├── main.tsx        → Entry (createRoot, prefers-color-scheme)
├── App.tsx         → Layout shell
├── components/
│   └── ui/         → 55 Radix/shadcn components
├── lib/            → Utilities
├── types/          → TypeScript types
└── routes/         → File-based routing (TanStack Router)
```

## Where to Look

| Task             | Location                                   |
| ---------------- | ------------------------------------------ |
| Add page         | `src/routes/` — TanStack Router file-based |
| Add UI component | `src/components/ui/` — 55 components       |
| Add hook         | `src/lib/hooks/` or use `@/lib/hooks`      |
| API calls        | `@workspace/api-client-react` (generated)  |
| Query logic      | React Query, auto-generated hooks          |

## Aliases

| Alias     | Path                    |
| --------- | ----------------------- |
| `@`       | `./src`                 |
| `@assets` | `../../attached_assets` |

Always use `@/` for src-relative imports where surrounding code does.

## Styling

- TailwindCSS
- Radix UI primitives (shadcn pattern)
- Dark mode: `prefers-color-scheme` detection in `main.tsx`

## Build

```bash
npm run dev     # Vite dev server (:5173)
npm run build   # Production build → dist/public
npm run serve   # Preview build
```

Output: `dist/public/` (api-server serves as static assets)

## API Integration

Generated client from `@workspace/api-client-react`:

- React Query hooks
- Base URL: `/api`
- Run codegen after spec changes: `npm run -w @workspace/api-spec codegen`

## TypeScript

Uses strict settings from root `tsconfig.base.json`:

- `noImplicitAny`: true
- `strictNullChecks`: true
- `useUnknownInCatchVariables`: true

No `as any`, `@ts-ignore`, `@ts-expect-error`.

## Conventions

- React components: PascalCase files (`Button.tsx`)
- Hooks: `use*.ts`
- Route files: kebab-case (`multi-chat.ts`, `not-found.tsx`)
- Format: no semicolons (UI files)
