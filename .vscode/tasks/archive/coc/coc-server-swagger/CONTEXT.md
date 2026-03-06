# Context: CoC Server Swagger UI

## User Story
The CoC web server has many complex REST endpoints but no API documentation. The user wants a Swagger UI endpoint added at `/api/docs` for debugging purposes — always enabled, no auth required, using CDN-hosted Swagger UI with no new npm dependencies.

## Goal
Add a static OpenAPI 3.0 spec (`openapi.yaml`) covering all ~55 endpoints and serve it alongside a CDN-based Swagger UI at `GET /api/docs`, with the raw spec accessible at `GET /api/openapi.json`.

## Commit Sequence
1. Add OpenAPI 3.0 spec for all CoC server endpoints
2. Serve OpenAPI spec and Swagger UI via new routes
3. Add Vitest tests for Swagger spec and UI routes

## Key Decisions
- Static `openapi.yaml` (not runtime-generated) — easier to review and maintain
- CDN Swagger UI (`unpkg.com/swagger-ui-dist@5`) — zero new npm dependencies
- Route at `/api/docs` (not `/api-docs`) — shared router only dispatches `routes[]` for `/api/*` paths; `/api-docs` would fall through to the SPA
- `postbuild` Node.js one-liner copies `src/openapi.yaml → dist/openapi.yaml` since `tsc` does not copy non-TS files
- Always enabled — no debug flag, no env var gate

## Conventions
- `js-yaml` (already a runtime dep) used to parse YAML → JSON at serve time
- `__dirname` in compiled `dist/router.js` resolves to `dist/`, so spec is read from `path.join(__dirname, 'openapi.yaml')`
- Swagger UI HTML is an inline template literal in `router.ts` — no separate HTML file
- Tests use `vi.mock('fs')` hoisted mocking and plain `http.createServer` on port 0 (matches existing test patterns)
- Error envelope: `{ error: string }` with appropriate HTTP status (matches all other handlers)
