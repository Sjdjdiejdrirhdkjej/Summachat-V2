## OVERVIEW

Auto-generated Zod validators from OpenAPI spec. Consumed by api-server for request/response validation.

## WHERE TO LOOK

- `src/generated/` for auto-generated validators (do not edit)
- `src/index.ts` for barrel exports

## CONVENTIONS

- **Generated code**: Never edit `generated/*.ts` — regenerated from OpenAPI spec
- Schema changes: Edit `lib/api-spec/openapi.yaml`, run `npm run -w @workspace/api-spec codegen`
- Use `safeParse` or `parse` based on calling code patterns

## CONSUMERS

- `api-server` — Validates request/response shapes at API boundaries

## NOTES

- No custom validators — all derived from OpenAPI spec
- Changes require codegen run to take effect
