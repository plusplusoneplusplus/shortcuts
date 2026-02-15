---
status: pending
---

# 009: Add Task Write API and CRUD UI Controls

## Summary

Add write endpoints (`POST`, `PATCH`, `DELETE`, archive) to `tasks-handler.ts` for creating, renaming, deleting, and archiving tasks/folders, then wire corresponding CRUD UI controls (buttons, dialogs, context menus, status dropdowns) into the task panel client module.

## Motivation

Commits 007 (read API) and 008 (task panel UI) established a read-only view of workspace tasks in the CoC dashboard. This commit completes the loop by enabling users to mutate tasks directly from the browser — creating tasks/folders, renaming, changing status, archiving, and deleting — without switching back to VS Code. Splitting writes into a separate commit keeps the review surface manageable and lets the read-only foundation stabilize independently.

## Changes

### Files to Create
(none — extend existing files)

### Files to Modify

- **`packages/coc/src/server/tasks-handler.ts`** — Add four write route-registration functions alongside the existing read routes:
  1. `POST /api/workspaces/:id/tasks` — Create a task file (body: `{name, folder?, docType?}`) or folder (body: `{name, type:'folder', parent?}`). Resolve paths relative to the workspace's configured tasks folder (default `.vscode/tasks`). For tasks, write a markdown file with YAML frontmatter containing `status: pending`. For folders, call `fs.promises.mkdir` with `{recursive: true}`. Return 201 with the created item's metadata.
  2. `PATCH /api/workspaces/:id/tasks` — Two mutation modes distinguished by body shape:
     - **Rename**: body `{path, newName}` — Use `fs.promises.rename` on the resolved absolute path; when renaming a document group, iterate all files matching `{baseName}.*.md` and rename each. Return 200 with new path.
     - **Status update**: body `{path, status}` — Validate status against `['pending','in-progress','done','future']`, then read the file, parse/replace the YAML frontmatter `status` field, and write back. Return 200 with updated status.
  3. `DELETE /api/workspaces/:id/tasks` — Body `{path}`. For files use `fs.promises.unlink`; for directories use `fs.promises.rm({recursive:true})`. Validate the resolved path is inside the tasks folder (prevent path-traversal). Return 204 on success.
  4. `POST /api/workspaces/:id/tasks/archive` — Body `{path, action:'archive'|'unarchive'}`. For `archive`: move the item from its current location into the `archive/` subfolder, preserving relative structure. For `unarchive`: move from `archive/` back to the tasks root, stripping the `archive/` prefix. Handle name collisions by appending a timestamp. Return 200 with the new path.

  **Implementation patterns to follow:**
  - Use `sendJSON`/`sendError` and `parseBody` from `api-handler.ts` (import them).
  - Use workspace lookup via `store.getWorkspaces()` + `.find(w => w.id === id)` to resolve `rootPath`, same as `GET /git-info` and `GET /pipelines` routes.
  - Route patterns use `RegExp` for `:id` segments (e.g. `/^\/api\/workspaces\/([^/]+)\/tasks$/`).
  - Register routes in a `registerTaskWriteRoutes(routes, store)` function called from `index.ts`.
  - All path operations must validate that the resolved absolute path starts with the workspace's tasks directory (security: prevent directory traversal).

- **`packages/coc/src/server/index.ts`** — Import and call `registerTaskWriteRoutes(routes, store)` during server setup, after existing route registration.

- **`packages/coc/src/server/spa/client/tasks.ts`** *(new client module — or extend if 008 already created it)* — Add CRUD UI controls to the task panel:
  1. **"New Task" / "New Folder" toolbar buttons** — Click opens a small dialog (overlay pattern from `repos.ts` `showAddRepoDialog`) with a text input for name and an optional doc-type dropdown for tasks. On submit, `POST /api/workspaces/:id/tasks`. After success, call `fetchTasksData()` to refresh the tree.
  2. **Context menu / action buttons per item** — Each task/folder row gets a `•••` button (pattern from `createRepoCard` in `repos.ts`). Clicking it shows a dropdown or inline actions: Rename, Delete, Archive (or Unarchive for archived items).
     - **Rename**: Opens an inline input or small dialog pre-filled with the current name. On submit, `PATCH /api/workspaces/:id/tasks` with `{path, newName}`.
     - **Delete**: Shows `confirm()` dialog (pattern from `confirmRemoveRepo` in `repos.ts`). On confirm, `DELETE /api/workspaces/:id/tasks` with `{path}`.
     - **Archive/Unarchive**: Calls `POST /api/workspaces/:id/tasks/archive` with `{path, action}`. No confirmation needed (reversible).
  3. **Status controls** — Each task row shows the current status as a clickable badge/dropdown. Clicking cycles through `pending → in-progress → done → future` or opens a small dropdown. On change, `PATCH /api/workspaces/:id/tasks` with `{path, status}`. Use status color coding consistent with the existing task panel.
  4. **Shared dialog component** — Extract a reusable `showInputDialog(title, placeholder, onSubmit)` helper to avoid duplicating the overlay/form/cancel pattern for New Task, New Folder, and Rename dialogs.

- **`packages/coc/src/server/spa/client/state.ts`** — Add task panel state if not already present from 008 (e.g. `taskPanelState: { selectedWorkspaceId, tasks, folders, expandedFolders }` or similar).

- **`packages/coc/src/server/spa/client/styles.css`** — Add styles for:
  - Task action buttons (`.task-action-btn`, `.task-menu-btn`)
  - Status badge colors (`.task-status-pending`, `.task-status-in-progress`, `.task-status-done`, `.task-status-future`)
  - Input dialog overlay (reuse `.enqueue-dialog` / `.add-repo-overlay` pattern or create `.task-dialog-overlay`)
  - Confirmation dialog styling

### Files to Delete
(none expected)

## Implementation Notes

1. **Path security is critical.** Every write endpoint must resolve the user-supplied `path` against `path.resolve(ws.rootPath, tasksFolder, body.path)` and then assert `resolvedPath.startsWith(tasksDir)` before any `fs` operation. Reject with 403 if the check fails. This mirrors the `browseDirectory` security pattern in `api-handler.ts`.

2. **YAML frontmatter parsing.** The extension's `updateTaskStatus()` in `src/shortcuts/tasks-viewer/task-manager.ts` uses regex-based frontmatter parsing (`/^---\n([\s\S]*?)\n---/`). The server handler should use the same approach — no dependency on `js-yaml` for the simple `status: <value>` replacement. Read file → regex match → replace or insert `status: <newValue>` → write file.

3. **Document group rename.** When renaming `path: "feature1/task1"` and the directory contains `task1.plan.md`, `task1.spec.md`, etc., the PATCH handler must glob for `task1.*.md` files and rename each to `newName.*.md`. Use `fs.promises.readdir` + filter rather than adding a glob dependency.

4. **Archive folder convention.** The tasks archive lives at `{tasksFolder}/archive/`. When archiving `feature1/backlog/task.md`, preserve structure: move to `archive/feature1/backlog/task.md`. Create intermediate directories with `mkdir({recursive:true})`. On name collision, append `-{Date.now()}` before the extension.

5. **Dialog patterns.** Reuse the overlay + form + cancel button pattern from `showAddRepoDialog` and `showEnqueueDialog`. Key elements: backdrop overlay (`onclick` on overlay closes dialog), form with `submit` handler, cancel button, and validation message area.

6. **Status cycling.** The simplest UX is a clickable badge that cycles on click: `pending → in-progress → done → future → pending`. For discoverability, add a tooltip showing the next status. An alternative is a small `<select>` dropdown — choose based on what looks better in the existing panel design.

7. **Optimistic UI.** After a successful write API call, immediately call the read API to refresh (`fetchTasksData()`). Don't attempt optimistic local mutations — the file system is the source of truth and the refresh is fast.

8. **WebSocket notification.** Optionally, after a write operation, broadcast a `task-changed` event via the existing WebSocket so other open browser tabs refresh. This is nice-to-have and can be deferred.

## Tests

- **`packages/coc/test/server/tasks-handler-write.test.ts`** — Vitest tests for write endpoints:
  - POST create task: returns 201, file exists on disk with correct frontmatter
  - POST create folder: returns 201, directory exists
  - POST with missing `name`: returns 400
  - POST into non-existent workspace: returns 404
  - PATCH rename task: returns 200, old path gone, new path exists
  - PATCH rename document group: all related files renamed
  - PATCH rename with name collision: returns 409
  - PATCH status update: returns 200, frontmatter updated in file
  - PATCH status with invalid value: returns 400
  - DELETE task file: returns 204, file removed
  - DELETE folder (recursive): returns 204, directory removed
  - DELETE with path traversal attempt (`../../etc/passwd`): returns 403
  - POST archive: file moved to archive subfolder, returns 200 with new path
  - POST unarchive: file moved back, returns 200
  - POST archive with name collision: timestamp suffix added
  - All write endpoints with non-existent workspace: returns 404

- **`packages/coc/test/server/tasks-ui-integration.test.ts`** — Client-side integration tests (if the SPA test pattern supports it):
  - New Task dialog: opens on button click, submits POST, refreshes tree
  - Rename dialog: pre-fills current name, submits PATCH
  - Delete: shows confirmation, submits DELETE on confirm, cancels on dismiss
  - Status badge: click cycles status, sends PATCH
  - Archive/Unarchive: sends correct action, refreshes tree

## Acceptance Criteria

- [ ] `POST /api/workspaces/:id/tasks` creates task markdown files with `status: pending` frontmatter and creates folders
- [ ] `PATCH /api/workspaces/:id/tasks` renames tasks/folders/document-groups and updates task status in frontmatter
- [ ] `DELETE /api/workspaces/:id/tasks` removes files and directories with path-traversal protection
- [ ] `POST /api/workspaces/:id/tasks/archive` archives and unarchives with structure preservation and collision handling
- [ ] All write endpoints return 404 for unknown workspace IDs
- [ ] All write endpoints reject path-traversal attempts with 403
- [ ] UI shows "New Task" and "New Folder" buttons that open input dialogs
- [ ] Each task/folder row has action controls for Rename, Delete, and Archive/Unarchive
- [ ] Task status is displayed as a clickable badge/dropdown that sends PATCH on change
- [ ] Destructive actions (Delete) show a confirmation dialog before proceeding
- [ ] All UI controls refresh the task tree after successful mutations
- [ ] Vitest tests for all write endpoints pass across platforms
- [ ] No regressions in existing read API (007) or task panel rendering (008)

## Dependencies

- Depends on: 007 (task read API — provides workspace lookup, tasks folder resolution, route registration pattern), 008 (task panel UI — provides the tree rendering that CRUD controls attach to)
