---
status: done
---

# 004: REST API Routes for Child Processes

## Summary
Add a dedicated `GET /api/processes/:id/children` route that returns child processes for a pipeline run, and extend the existing `GET /api/processes` with `?parentProcessId=` query parameter support.

## Motivation
The SPA needs server endpoints to fetch child processes for the workflow detail view. The store already supports `parentProcessId` filtering (Commit 1), and child records are being persisted (Commit 3). This commit exposes that data via REST.

## Changes

### Files to Modify

#### `packages/coc-server/src/api-handler.ts`

**1. Extend `parseQueryParams` (line 97–152) to parse `parentProcessId`:**

The function at line 97 builds a `ProcessFilter` from URL query string params. Each param follows the same pattern: check `typeof query.X === 'string' && query.X`, then assign to `filter`. Add after the existing `type` block (line 116–118):

```ts
if (typeof query.parentProcessId === 'string' && query.parentProcessId) {
    filter.parentProcessId = query.parentProcessId;
}
```

This makes `GET /api/processes?parentProcessId=X` work automatically — the list handler at line 1148 already calls `parseQueryParams` (line 1162) and passes the filter to `store.getAllProcesses`.

**2. Add new route `GET /api/processes/:id/children`:**

Insert a new `routes.push(...)` block between the `/output` route (line 1274) and the `GET /api/processes/:id` single-detail route (line 1301). It **must** come before the generic `/:id` route because the router matches top-down and the RegExp `/^\/api\/processes\/([^/]+)$/` at line 1304 would swallow `/children`.

Follow the exact route registration pattern used throughout `registerApiRoutes` (line 190):
- `routes.push({ method, pattern, handler })` where `Route` type (from `types.ts` line 102) has `method?: string`, `pattern: string | RegExp`, `handler: (req, res, match?) => void | Promise<void>`
- Parameterized routes use RegExp with capture groups (e.g., line 1267: `/^\/api\/processes\/([^/]+)\/stream$/`)
- ID extracted via `decodeURIComponent(match![1])` (e.g., line 1269)
- Errors use `handleAPIError` + error factory functions (`notFound`, `badRequest`, etc.) from `./errors`
- Success responses use `sendJSON(res, statusCode, data)`

```ts
// GET /api/processes/:id/children — Child processes for a pipeline run
routes.push({
    method: 'GET',
    pattern: /^\/api\/processes\/([^/]+)\/children$/,
    handler: async (req, res, match) => {
        const parentId = decodeURIComponent(match![1]);

        // Build filter from query params (reuse parseQueryParams for status, exclude, etc.)
        const baseFilter = parseQueryParams(req.url || '/');
        const filter: ProcessFilter = {
            ...baseFilter,
            parentProcessId: parentId,
        };

        // Default: exclude conversation for lightweight payloads
        if (!filter.exclude) {
            filter.exclude = ['conversation'];
        }

        const children = await store.getAllProcesses(filter);
        const responseChildren = filter.exclude
            ? children.map(p => stripExcludedFields(p, filter.exclude))
            : children;

        sendJSON(res, 200, { children: responseChildren, total: children.length });
    },
});
```

Key design decisions:
- The `/children` route is a convenience wrapper — it just calls `getAllProcesses` with `parentProcessId` set to the URL param
- `conversationTurns` excluded by default (per `exclude: ['conversation']`) to avoid massive payloads; client opts in via `?exclude=` (empty string) or omits the default by passing `?include=conversationTurns` — actually, the simpler approach matching existing convention is: default to `['conversation']` exclude, let `?exclude=` override. Client that wants full data passes `?exclude=` with no value (parsed as empty → no exclusion)
- Supports `?status=running,failed` via `parseQueryParams` reuse
- Non-existent parent returns `{ children: [], total: 0 }` — not 404 (the parent may have been cleaned up while children remain)
- No authentication changes needed — same auth level as existing process routes

**3. No changes needed to `GET /api/processes` handler (line 1143–1184):**

The list handler already calls `parseQueryParams` at line 1162 and passes the filter through. Once `parseQueryParams` parses `parentProcessId` (change #1), `?parentProcessId=X` works on the list endpoint for free.

### Files NOT Modified
- `packages/pipeline-core/src/process-store.ts` — `ProcessFilter.parentProcessId` already exists (Commit 1)
- `packages/coc-server/src/sse-handler.ts` — SSE streaming unchanged
- `packages/coc-server/src/types.ts` — `Route` interface unchanged

## Implementation Notes

### Route Registration Pattern (from `api-handler.ts`)
All routes follow this exact structure inside `registerApiRoutes` (line 190):
```ts
routes.push({
    method: 'GET',                                        // HTTP method string
    pattern: /^\/api\/processes\/([^/]+)\/children$/,     // RegExp with capture groups
    handler: async (req, res, match) => {                 // async handler
        const id = decodeURIComponent(match![1]);         // extract path param
        // ... business logic ...
        sendJSON(res, 200, { ... });                      // respond with JSON
    },
});
```

### Existing Route Order (process section, lines 1143–1365)
1. `GET  /api/processes` — list (string pattern, line 1147)
2. `DELETE /api/processes` — bulk clear (string pattern, line 1189)
3. `POST /api/processes` — create (string pattern, line 1215)
4. `GET  /api/processes/:id/stream` — SSE (RegExp, line 1267)
5. `GET  /api/processes/:id/output` — persisted output (RegExp, line 1277)
6. **→ INSERT HERE: `GET /api/processes/:id/children`** (RegExp)
7. `GET  /api/processes/:id` — single detail (RegExp, line 1304)
8. `PATCH /api/processes/:id` — partial update (RegExp, line 1320)
9. `DELETE /api/processes/:id` — remove (RegExp, line 1354)
10. `POST /api/processes/:id/cancel` — cancel (RegExp, line 1370)

### Helper Functions Available
- `parseQueryParams(reqUrl)` (line 97) — parses `workspace`, `status`, `type`, `since`, `limit`, `offset`, `exclude` from query string
- `stripExcludedFields(process, exclude)` (line 159) — strips `conversationTurns`/`fullPrompt`/`result`/`structuredResult` when `exclude` contains `'conversation'`, or strips `toolCalls` from turns when `exclude` contains `'toolCalls'`
- `VALID_STATUSES` (line 83) — `Set` of `'queued' | 'running' | 'completed' | 'failed' | 'cancelled'`
- `sendJSON(res, statusCode, data)` (line 46) — JSON response helper
- `handleAPIError(res, error)` — error response helper from `./errors`
- `notFound(entity)`, `badRequest(msg)` — error factories from `./errors`

## Tests

Test file: `packages/coc-server/test/process-children-api.test.ts`

Follow the existing test pattern from `api-handler-images.test.ts`:
- Import `createRouter` from `../src/shared/router`, `registerApiRoutes` from `../src/api-handler`
- Use `createMockProcessStore` from `./helpers/mock-process-store`
- Start an `http.createServer(router)` on an ephemeral port
- Use a `request()` helper that returns `{ status, body, json() }`

### Test Cases
1. **`GET /api/processes/:id/children` returns only child processes** — seed store with parent + 2 children + 1 unrelated process → assert response contains exactly 2 children
2. **`GET /api/processes/:id/children?status=failed` filters correctly** — seed 1 running child + 1 failed child → assert only failed child returned
3. **`GET /api/processes/:id/children` for non-existent parent returns empty array** — assert `{ children: [], total: 0 }`, not 404
4. **`GET /api/processes?parentProcessId=X` works as alternative query** — seed parent + children → assert list endpoint returns matching children
5. **Response strips `conversationTurns` by default** — seed child with `conversationTurns` → assert response children lack `conversationTurns`
6. **`?exclude=` (empty) includes `conversationTurns`** — assert full payload returned when default exclusion is overridden

## Acceptance Criteria
- [ ] `GET /api/processes/:id/children` route returns child processes
- [ ] Status filtering works on children endpoint
- [ ] `GET /api/processes?parentProcessId=X` also works
- [ ] `conversationTurns` excluded by default for performance
- [ ] Follows existing route registration pattern exactly
- [ ] Tests pass on Linux, macOS, Windows

## Dependencies
- Depends on: 001, 003

## Assumed Prior State
- `ProcessFilter.parentProcessId` works (Commit 1)
- Child `AIProcess` records exist in store with `parentProcessId` (Commit 3)
