## OVERVIEW

Source of truth for OpenAPI spec and Orval codegen configuration. All API types and clients flow from `openapi.yaml`.

## WHERE TO LOOK

- `openapi.yaml` for API schema definitions (paths, request/response shapes)
- `orval.config.ts` for codegen settings (output paths, client type)
- `package.json` for `codegen` script

## CONVENTIONS

- Edit `openapi.yaml` to define/change API contract
- Run `npm run -w @workspace/api-spec codegen` after spec changes
- Codegen outputs to: `lib/api-zod/src/generated/` (validators), `lib/api-client-react/src/generated/` (React client)
- Never edit generated files directly — change the spec, regenerate

## CODEGEN FLOW

```
openapi.yaml → Orval → lib/api-zod/ (Zod validators)
                        lib/api-client-react/ (React Query hooks)
```

Run after changes: `npm run -w @workspace/api-spec codegen`
