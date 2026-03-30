# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Common commands (run from workspace root):
- `npm install` or `bun install` - Install all dependencies
- `npm run build` - Build all packages
- `npm run typecheck` - Run TypeScript type checking across all packages

### API Server (artifacts/api-server):
- `npm run -w @workspace/api-server dev` - Start development server
- `npm run -w @workspace/api-server build` - Build server
- `npm run -w @workspace/api-server start` - Start built server
- `npm run -w @workspace/api-server typecheck` - Type check server code

### Chat UI (artifacts/chat-ui):
- `npm run -w @workspace/chat-ui dev` - Start development UI
- `npm run -w @workspace/chat-ui build` - Build UI for production
- `npm run -w @workspace/chat-ui serve` - Preview built UI
- `npm run -w @workspace/chat-ui typecheck` - Type check UI code

### Libraries:
Run commands with appropriate workspace flags, e.g.:
- `npm run -w @workspace/api-client-react typecheck`
- `npm run -w @workspace/db typecheck`

## Code Architecture

### Monorepo Structure:
- **artifacts/** - Deployable applications
  - `api-server/` - Express-based backend API
  - `chat-ui/` - React/Vite frontend application
  - `mockup-sandbox/` - Example React component library
- **lib/** - Shared libraries and packages
  - `api-spec/` - OpenAPI specification and generated clients
  - `api-client-react/` - React API client wrapper
  - `api-zod/` - Zod schema generation and validation
  - `db/` - Database layer using Drizzle ORM
  - `integrations-*` - AI service integrations (Anthropic, Gemini, OpenAI)
- **scripts/** - Utility scripts

### Key Technologies:
- **Backend**: Node.js, Express, TypeScript, Drizzle ORM
- **Frontend**: React, Vite, Tailwind CSS, Radix UI components
- **Type Safety**: End-to-end TypeScript with zod schemas
- **Build**: esbuild for server, Vite for client
- **Package Manager**: npm workspaces (bun also supported)

### Development Practices:
- Strict TypeScript configuration (noImplicitAny, strictNullChecks, etc.)
- Component library uses Radix UI primitives
- API contracts defined in OpenAPI spec with automatic client generation
- Environment-based configuration (development/production)
