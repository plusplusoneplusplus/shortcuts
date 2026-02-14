---
status: pending
---

# 004: Add Process REST API Endpoints

## Summary
Add the HTTP API handler that exposes CRUD operations for AI processes and workspace registration over REST. This is the primary interface through which VS Code extensions and CLI clients submit, query, update, and cancel AI processes on the standalone server.

## Motivation
The FileProcessStore (commit 002) provides persistence and the HTTP server (commit 003) provides routing infrastructure, but there are no application-level endpoints yet. This commit wires them together into a complete REST API so that external consumers (the VS Code extension, other CLI tools) can interact with the process store over HTTP.

## Changes

### Files to Create

- `packages/pipeline-cli/src/server/api-handler.ts` — API route handler module:

  **Request/Response helpers:**
  - `sendJSON(res, statusCode, data)` — write JSON response with correct Content-Type header
  - `sendError(res, statusCode, message)` — write JSON error envelope `{ error: message }`
  - `parseBody(req): Promise<any>` — read and JSON-parse the request body (reject on invalid JSON with 400)
  - `parseQueryParams(url): ProcessFilter` — extract `workspace`, `status`, `type`, `limit`, `offset`, `since` from URL query string into a typed filter object

  **`registerApiRoutes(router, store)` — main wiring function:**

  *Workspace endpoints:*
  - `POST /api/workspaces` — Register a workspace; body: `{ id, name, rootPath, color? }`. Returns 201 with the created workspace object. Returns 400 if `id`, `name`, or `rootPath` missing.
  - `GET /api/workspaces` — List all registered workspaces. Returns 200 with `{ workspaces: [...] }`.

  *Process endpoints:*
  - `GET /api/processes` — List processes with query-param filtering:
    - `?workspace=<id>` — filter by workspace ID
    - `?status=running,completed` — filter by status (comma-separated `AIProcessStatus` values)
    - `?type=code-review` — filter by `AIProcessType`
    - `?limit=50&offset=0` — pagination (defaults: limit=50, offset=0)
    - `?since=<ISO date>` — only processes with `startTime` after the given date
    - Returns 200 with `{ processes: [...], total, limit, offset }`.
  - `GET /api/processes/:id` — Single process detail (full result included). Returns 200 with `{ process }` or 404 `{ error: "Process not found" }`.
  - `POST /api/processes` — Create/register a new process. Body: serialized `AIProcess` fields + `workspaceId`. Calls `deserializeProcess` to hydrate dates, stores via `FileProcessStore.addProcess()`. Returns 201 with the stored process. Returns 400 if required fields (`id`, `promptPreview`, `status`, `startTime`) are missing.
  - `PATCH /api/processes/:id` — Partial update. Body may include `status`, `result`, `error`, `endTime`, `structuredResult`, `metadata`. Updates only provided fields via `FileProcessStore.updateProcess()`. Returns 200 with updated process or 404.
  - `DELETE /api/processes/:id` — Remove a single process. Returns 204 on success or 404.
  - `POST /api/processes/:id/cancel` — Cancel a running process. Sets `status: 'cancelled'` and `endTime: now`. Returns 200 with updated process, 404 if not found, 409 if process is already in a terminal state (`completed`, `failed`, `cancelled`).
  - `DELETE /api/processes?status=completed` — Bulk-clear processes by status. Returns 200 with `{ removed: <count> }`.

  *Stats endpoint:*
  - `GET /api/stats` — Aggregate statistics. Returns 200 with:
    ```json
    {
      "totalProcesses": 42,
      "byStatus": { "running": 3, "completed": 30, "failed": 5, "cancelled": 2, "queued": 2 },
      "byWorkspace": [
        { "workspaceId": "ws-1", "name": "frontend", "count": 25 },
        { "workspaceId": "ws-2", "name": "backend", "count": 17 }
      ]
    }
    ```

- `packages/pipeline-cli/test/server/api-handler.test.ts` — Comprehensive tests (see Tests section)

### Files to Modify

- `packages/pipeline-cli/src/server/router.ts` — Import `registerApiRoutes` and call it during server setup to wire all `/api/*` routes to the handler. The router already provides path-param extraction and JSON body parsing from commit 003.

## Implementation Notes

- **Process creation flow:** Extensions POST a full serialized process (with ISO date strings) plus a `workspaceId` field. The handler calls `deserializeProcess()` from `pipeline-core` to convert date strings back to `Date` objects before storing.
- **Status updates via PATCH:** Only the fields present in the request body are applied. This keeps the contract simple — a status change is `{ status: "completed", result: "...", endTime: "..." }`.
- **Cancel as semantic action:** `POST /api/processes/:id/cancel` is distinct from `PATCH` because cancellation has side effects (setting `endTime`, validating current state). The 409 response for already-terminal processes prevents invalid transitions.
- **Pagination defaults:** `limit=50`, `offset=0`. The response includes `total` (pre-pagination count) so clients can compute page counts.
- **`parseQueryParams` parses `status` as comma-separated:** e.g., `?status=running,completed` becomes `['running', 'completed']`. Invalid status values are silently ignored.
- **Bulk delete uses query params on DELETE:** `DELETE /api/processes?status=completed` clears all completed processes. If no `status` query param is provided, returns 400 to prevent accidental full wipe.
- **Workspace storage:** Delegates to `FileProcessStore.registerWorkspace()` / `getWorkspaces()` from commit 002 — workspaces are persisted to `{dataDir}/workspaces.json` and survive server restarts. No in-memory duplication.
- **`ProcessFilter` type:** Reuses the `ProcessFilter` interface from `pipeline-core` (commit 001). The `parseQueryParams` function maps URL query params to this shared type.

## Tests

`packages/pipeline-cli/test/server/api-handler.test.ts`:

- **CRUD lifecycle:** create process → get by ID → update via PATCH → list all → delete → verify 404 on re-fetch
- **Workspace registration:** POST workspace → GET workspaces → verify listed; POST with missing fields → 400
- **Workspace filtering:** create processes in two workspaces → `GET /api/processes?workspace=ws-1` returns only ws-1 processes
- **Pagination:** create 10 processes → `?limit=3&offset=0` returns first 3 with `total: 10` → `?limit=3&offset=3` returns next 3
- **Status filtering:** create processes with mixed statuses → `?status=running,failed` returns only matching
- **Type filtering:** create processes with different types → `?type=code-review` returns only code-review
- **Since filtering:** create processes with different start times → `?since=<ISO>` returns only those after the date
- **Cancel endpoint:** cancel running process → 200 with `cancelled` status; cancel already-completed → 409
- **Bulk delete:** create completed + running processes → `DELETE /api/processes?status=completed` removes only completed; `DELETE /api/processes` without status → 400
- **Error responses:** GET non-existent process → 404; POST process with missing required fields → 400; PATCH non-existent → 404
- **Stats endpoint:** create processes across workspaces and statuses → `GET /api/stats` returns correct counts
- **sendJSON / sendError helpers:** verify correct status codes and Content-Type headers
- **parseQueryParams:** verify parsing of all supported query parameters including edge cases (empty values, invalid dates)

## Acceptance Criteria

- [ ] All workspace endpoints return correct status codes and response shapes
- [ ] All process CRUD endpoints work with proper validation and error handling
- [ ] Query-param filtering works for workspace, status, type, since
- [ ] Pagination returns correct slices and total count
- [ ] Cancel returns 409 for terminal-state processes
- [ ] Bulk delete requires explicit status parameter
- [ ] Stats endpoint returns accurate per-status and per-workspace counts
- [ ] `deserializeProcess` from `pipeline-core` is used for date hydration on create
- [ ] All tests pass
- [ ] Existing pipeline-cli tests pass unchanged

## Dependencies

- Depends on: 002 (FileProcessStore), 003 (HTTP server with router)
