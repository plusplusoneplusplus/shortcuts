---
status: pending
---

# 003: Add Vitest tests for Swagger spec and UI routes

## Summary
Adds a Vitest test file `packages/coc-server/test/swagger.test.ts` that verifies the two new Swagger routes (`GET /api/openapi.json` and `GET /api/docs`) registered in commit 002, including an edge case where `openapi.yaml` is missing. Tests use `vi.mock('fs')` to avoid any real filesystem reads and spin up a minimal in-process HTTP server via `createRequestHandler`.

## Motivation
Tests should live in a separate commit so reviewers can approve the feature code (commit 002) independently before scrutinising test coverage. Keeping the test commit atomic also makes it easy to bisect if a future change breaks the routes.

## Changes

### Files to Create
- `packages/coc-server/test/swagger.test.ts` — Vitest integration tests for `GET /api/openapi.json` and `GET /api/docs`, exercising happy paths and the ENOENT edge case

### Files to Modify
(none)

### Files to Delete
(none)

## Implementation Notes

### Test infrastructure already present
The package already has a well-established pattern (see `test/shared/router.test.ts`, `test/git-api.test.ts`):

1. **Test server helper** — spin up `http.createServer` on a random port with `server.listen(0, '127.0.0.1', callback)`, tear it down in `afterAll`.
2. **HTTP helper** — a small `request(url, opts)` wrapper around `http.request` that resolves to `{ status, headers, body }`.
3. **`vi.mock` at the top of the file** — hoisted by Vitest's transform; must be declared before any imports that transitively call the mocked module.

### Mocking `fs`
The `GET /api/openapi.json` route handler calls `fs.readFileSync(path.join(__dirname, 'openapi.yaml'), 'utf8')` (implemented in commit 002). Mock the entire `fs` module with `vi.mock('fs')` and use `vi.spyOn` / `mockReturnValueOnce` per test:

```ts
vi.mock('fs');
import * as fs from 'fs';

// happy path
vi.mocked(fs.readFileSync).mockReturnValueOnce('openapi: "3.0.0"\ninfo:\n  title: CoC\n  version: "1.0.0"\npaths: {}');

// ENOENT edge case
const err = Object.assign(new Error('no such file'), { code: 'ENOENT' });
vi.mocked(fs.readFileSync).mockImplementationOnce(() => { throw err; });
```

Because `vi.mock('fs')` replaces every export, you must restore real implementations for any code that uses `fs` internally (e.g. `http.createServer` internals do **not** use `fs`, so this is safe here). Use `beforeEach(() => vi.clearAllMocks())` to reset call history between tests.

### Route registration
The tests need to call `createRequestHandler` (exported from `src/router.ts`) with the swagger routes registered. Import `registerSwaggerRoutes` (or whatever export name commit 002 establishes in `src/router.ts` or a dedicated `src/swagger-handler.ts`) plus a `createMockProcessStore` (already available at `test/helpers/mock-process-store.ts`) to satisfy the `store` dependency.

If commit 002 registers the swagger routes directly inside `createRequestHandler` rather than as a separately-importable function, construct the handler with an empty `routes: []` array — the built-in swagger routes will still be present.

### `js-yaml` — do NOT mock
`js-yaml` is a pure-JS parser with no I/O. Only mock `fs.readFileSync`; let `js-yaml` parse the YAML string normally to confirm the round-trip to JSON is correct.

### No `supertest` needed
The repo does not use `supertest`. Follow the existing pattern: plain `http.request` wrapped in a `request()` helper (identical to the one in `test/shared/router.test.ts`).

### Content-Type for `/api/docs`
The handler in commit 002 sends `res.writeHead(200, { 'Content-Type': 'text/html' })`. The test should assert `res.headers['content-type']` starts with `'text/html'` (handles optional charset suffix).

## Tests

### `GET /api/openapi.json` — happy path
- Mock `fs.readFileSync` to return a minimal YAML string (`openapi: "3.0.0"\ninfo:\n  title: CoC\n  version: "1.0.0"\npaths: {}`)
- Assert: HTTP status 200
- Assert: `content-type` header contains `application/json`
- Assert: parsed body has `openapi` field equal to `"3.0.0"`
- Assert: parsed body has `info.title` equal to `"CoC"`

### `GET /api/docs` — happy path
- No `fs` mock needed (the docs handler does not read files)
- Assert: HTTP status 200
- Assert: `content-type` header starts with `text/html`
- Assert: body contains the string `swagger-ui` (Swagger UI element/class present in the HTML)
- Assert: body contains `/api/openapi.json` (the spec URL embedded in the HTML)
- Assert: body contains `unpkg.com/swagger-ui-dist` (CDN script/link present)

### `GET /api/openapi.json` — missing file (ENOENT)
- Mock `fs.readFileSync` to throw `Object.assign(new Error('no such file'), { code: 'ENOENT' })`
- Assert: HTTP status 404
- Assert: parsed JSON body has an `error` field (e.g. `{ error: 'openapi.yaml not found' }`)

## Acceptance Criteria
- [ ] All three test cases pass with `npm run test:run` executed inside `packages/coc-server/`
- [ ] No real `openapi.yaml` file is read during the test run (`fs.readFileSync` is mocked for the JSON route tests)
- [ ] No real network calls are made (CDN URLs are only asserted as strings in the HTML body)
- [ ] `vi.clearAllMocks()` is called in `beforeEach` so mock state does not bleed between tests
- [ ] Test server is properly closed in `afterAll` to avoid open-handle warnings

## Dependencies
- Depends on: 002 (swagger routes must be registered in `src/router.ts` or a dedicated handler)

## Assumed Prior State
- `packages/coc-server/src/router.ts` exports `createRequestHandler` — present before commit 001.
- `packages/coc-server/src/openapi.yaml` exists (created in commit 001) — not required at test runtime because `fs` is mocked, but the import path `__dirname + '/openapi.yaml'` must be the path the route handler uses.
- The swagger routes (`GET /api/openapi.json`, `GET /api/docs`) are registered and reachable through `createRequestHandler` (commit 002).
- `packages/coc-server/test/helpers/mock-process-store.ts` exports `createMockProcessStore` — present in the existing test suite.
- `js-yaml` is in `dependencies` in `packages/coc-server/package.json` (added in commit 002).
- Vitest `^1.0.0` is already a `devDependency`; no new test tooling is required.
