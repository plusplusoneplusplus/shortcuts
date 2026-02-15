---
status: pending
---

# 007: Add Task Read REST API to CoC Server

## Summary

Add read-only REST endpoints to the CoC server that expose the Tasks Viewer folder hierarchy and file content for a given workspace, using the shared `TaskManager` from `pipeline-core` (introduced in commit 005).

## Motivation

The CoC dashboard SPA needs task data to render a Tasks panel alongside the existing AI Processes view. Exposing the task hierarchy and file content via REST keeps the dashboard stateless (no filesystem access from the browser) and follows the same handler-per-domain pattern already used for processes (`api-handler.ts`) and queue (`queue-handler.ts`). Splitting this into its own commit isolates the server-side plumbing from later UI work.

## Changes

### Files to Create

- **`packages/coc/src/server/tasks-handler.ts`** — New handler module that registers three `GET` routes on the shared `Route[]` table. Follows the exact same pattern as `queue-handler.ts`: exports a single `registerTaskRoutes(routes, store)` function that pushes `Route` objects. Uses `sendJSON` / `sendError` from `api-handler.ts` for responses.

  **Routes:**

  | Method | Path | Description |
  |--------|------|-------------|
  | `GET` | `/api/workspaces/:id/tasks` | Returns the full `TaskFolder` hierarchy JSON for the workspace. Resolves workspace via `store.getWorkspaces()`, constructs a `TaskManager` with `ws.rootPath`, calls `getTaskFolderHierarchy()`, and returns the tree. Optional `?folder=` query param overrides the default `.vscode/tasks` folder path (same pattern as the existing `/api/workspaces/:id/pipelines` endpoint). |
  | `GET` | `/api/workspaces/:id/tasks/content` | Returns raw markdown content for a single task file. Requires `?path=relative/path.md` query parameter (relative to the tasks folder). Reads the file via `fs.promises.readFile`. Must validate that the resolved path stays within the workspace root (path-traversal guard). Returns `{ content: string, path: string }`. |
  | `GET` | `/api/workspaces/:id/tasks/settings` | Returns default `TasksViewerSettings` JSON. Since there is no VS Code configuration in the standalone server, returns a hard-coded default settings object (enabled: true, folderPath: `.vscode/tasks`, showArchived: false, showFuture: false, sortBy: `name`, groupRelatedDocuments: true, plus default discovery settings). |

- **`packages/coc/test/server/tasks-handler.test.ts`** — Vitest test file for the new handler.

### Files to Modify

- **`packages/coc/src/server/index.ts`** — Import `registerTaskRoutes` and call it alongside `registerApiRoutes` / `registerQueueRoutes` in `createExecutionServer()` (around line 160-161). Pass `store` so the handler can look up workspaces. Add re-export in the barrel export section (around line 304-305).

- **`packages/coc/src/server/router.ts`** — No changes needed; routes are registered by pushing onto the shared `Route[]` array before `createRequestHandler` is called.

### Files to Delete

(none)

## Implementation Notes

### Pattern to follow

The `tasks-handler.ts` module should mirror `queue-handler.ts` structurally:

1. Import `sendJSON`, `sendError`, `parseBody` from `./api-handler` (only `sendJSON`/`sendError` needed for read-only).
2. Import `Route` from `./types`.
3. Import `ProcessStore` from `@plusplusoneplusplus/pipeline-core` (needed to look up workspaces).
4. Import `TaskManager` from `@plusplusoneplusplus/pipeline-core` (the shared extraction from commit 005).
5. Export a single function: `registerTaskRoutes(routes: Route[], store: ProcessStore): void`.
6. Inside, push three route objects with regex patterns matching `/api/workspaces/:id/tasks*`.

### Workspace resolution

Every endpoint needs to resolve workspace ID → `WorkspaceInfo`. Follow the same approach as the existing `/api/workspaces/:id/git-info` route in `api-handler.ts` (lines 217-234): call `store.getWorkspaces()`, find by ID, return 404 if not found. Consider extracting a small helper `resolveWorkspace(store, id)` within the handler file to DRY this up.

### TaskManager instantiation

Commit 005 extracts a pure-Node.js `TaskManager` into `pipeline-core` that accepts a workspace root path. For each request, instantiate `new TaskManager(ws.rootPath)` (or equivalent factory). TaskManagers are lightweight (just filesystem scanning), so per-request creation is acceptable — no caching needed for the initial version.

### Path-traversal security for `/tasks/content`

The `content` endpoint must guard against `../../etc/passwd` style attacks:
1. Resolve the `path` query param against the tasks folder: `path.resolve(tasksFolder, requestedPath)`.
2. Verify the resolved path starts with the tasks folder path using `resolvedPath.startsWith(tasksFolder)`.
3. Return 403 if the check fails.
4. Return 404 if the file does not exist or is not a regular file.

This mirrors the security pattern used in `browseDirectory()` in `api-handler.ts` (lines 276-280).

### Default settings object

For the `/tasks/settings` endpoint, return a hard-coded object matching the `TasksViewerSettings` interface:

```typescript
const DEFAULT_SETTINGS: TasksViewerSettings = {
    enabled: true,
    folderPath: '.vscode/tasks',
    showArchived: false,
    showFuture: false,
    sortBy: 'name',
    groupRelatedDocuments: true,
    discovery: {
        enabled: false,
        defaultScope: {
            includeSourceFiles: true,
            includeDocs: true,
            includeConfigFiles: false,
            includeGitHistory: false,
            maxCommits: 50,
        },
        showRelatedInTree: true,
        groupByCategory: true,
    },
};
```

### Route ordering

The three regex patterns must be registered in specific-to-general order to prevent `/tasks/content` and `/tasks/settings` from matching `/tasks`:

1. `/api/workspaces/:id/tasks/content` — `^\/api\/workspaces\/([^/]+)\/tasks\/content$`
2. `/api/workspaces/:id/tasks/settings` — `^\/api\/workspaces\/([^/]+)\/tasks\/settings$`
3. `/api/workspaces/:id/tasks` — `^\/api\/workspaces\/([^/]+)\/tasks$`

### Query parameter parsing

Use `url.parse(req.url, true).query` for extracting `folder` and `path` query params, matching the pattern in `api-handler.ts` (line 248-251).

## Tests

- **Workspace not found** — `GET /api/workspaces/nonexistent/tasks` returns 404 with `{ error: "Workspace not found" }`.
- **Tasks hierarchy (empty)** — Register workspace, `GET /api/workspaces/:id/tasks` returns a valid root `TaskFolder` with empty children when `.vscode/tasks` doesn't exist.
- **Tasks hierarchy (with files)** — Create temp directory with `.vscode/tasks/*.md` files, register workspace pointing to it, verify hierarchy response contains correct folders/documents.
- **Tasks hierarchy with custom folder** — `GET /api/workspaces/:id/tasks?folder=custom-tasks` uses custom folder path.
- **Content endpoint (success)** — Create a task file, request `/tasks/content?path=my-task.md`, verify returns `{ content, path }` with correct markdown content.
- **Content endpoint (missing path param)** — `GET /api/workspaces/:id/tasks/content` without `?path=` returns 400.
- **Content endpoint (file not found)** — `GET /api/workspaces/:id/tasks/content?path=nonexistent.md` returns 404.
- **Content endpoint (path traversal blocked)** — `GET /api/workspaces/:id/tasks/content?path=../../etc/passwd` returns 403.
- **Content endpoint (nested path)** — `GET /api/workspaces/:id/tasks/content?path=feature1/task1.plan.md` returns correct content.
- **Settings endpoint** — `GET /api/workspaces/:id/tasks/settings` returns valid `TasksViewerSettings` object with expected defaults.

## Acceptance Criteria

- [ ] `GET /api/workspaces/:id/tasks` returns `TaskFolder` hierarchy JSON for a registered workspace
- [ ] `GET /api/workspaces/:id/tasks/content?path=...` returns raw markdown content with path-traversal protection
- [ ] `GET /api/workspaces/:id/tasks/settings` returns default `TasksViewerSettings` JSON
- [ ] All three endpoints return 404 for unknown workspace IDs
- [ ] Content endpoint returns 400 for missing `path` query param
- [ ] Content endpoint returns 403 for path-traversal attempts
- [ ] Handler follows the same `registerXxxRoutes(routes, store)` pattern as `api-handler.ts` / `queue-handler.ts`
- [ ] Handler is wired into `createExecutionServer()` in `index.ts`
- [ ] All new tests pass (`npm run test:run` in `packages/coc/`)
- [ ] Existing tests remain passing (no regressions)

## Dependencies

- Depends on: 005 (shared TaskManager extraction into pipeline-core)
