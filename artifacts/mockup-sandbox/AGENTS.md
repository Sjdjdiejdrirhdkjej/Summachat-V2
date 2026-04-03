# AGENTS.md — Mockup Sandbox

Package-level guidance for `@workspace/mockup-sandbox` (React + Vite).

## Overview

Vite-based component preview sandbox for workspace canvas. Dynamically discovers and renders mockup components from `./components/mockups/` directory. Standalone app with no workspace dependencies.

## Structure

```
src/
├── main.tsx        → Entry (minimal, no dark mode)
├── App.tsx         → Gallery landing + preview router
├── components/
│   ├── ui/         → 47 Radix/shadcn components (duplicated from chat-ui)
│   └── mockups/    → Previewable components (discovered dynamically)
└── lib/
    └── mockupPreviewPlugin.ts  → Vite plugin for component discovery
```

## Where to Look

| Task                 | Location                                                         |
| -------------------- | ---------------------------------------------------------------- |
| Add mockup component | `src/components/mockups/` — create `ComponentName.tsx`           |
| Preview route        | `/preview/ComponentName` — auto-generated from filename          |
| Gallery landing      | `src/App.tsx` — lists discovered mockups                         |
| UI components        | `src/components/ui/` — 47 Radix primitives (copy of chat-ui)     |
| Vite plugin          | `src/lib/mockupPreviewPlugin.ts` — file watching, glob discovery |

## Conventions

- **Mockup naming**: PascalCase filenames → `/preview/ComponentName` routes
- **UI components**: Shared with chat-ui but duplicated (consider extracting to `lib/ui/`)
- **No dark mode**: Unlike chat-ui, this sandbox doesn't set color scheme
- **No workspace deps**: Fully standalone, uses only npm packages

## Development

```bash
npm run dev      # Vite dev server
npm run build    # Production build
npm run preview  # Preview build
```

## Notes

- **Sidebar duplication**: The `sidebar.tsx` component (714 lines) is 97% identical to chat-ui's version — candidate for shared extraction
- **No tests**: Unlike chat-ui and api-server, no test configuration
- **No API calls**: Purely frontend, no backend integration
