---
status: pending
---

# 010: Add Real-Time Task Synchronization via WebSocket

## Summary

Add file-system watching for each registered workspace's `.vscode/tasks/` directory so that task-file changes are detected server-side, debounced, and broadcast as a `tasks-changed` WebSocket event — enabling the SPA dashboard to auto-refresh its task panel without polling.

## Motivation

The CoC server already pushes process and queue state changes over WebSocket (`process-added`, `process-updated`, `queue-updated`, etc.), but `.vscode/tasks/` markdown files are only loaded on demand.  When a user edits, creates, or deletes a task file in their editor the dashboard has no way to know until a manual refresh.  This commit closes that gap with the same zero-external-deps philosophy used elsewhere (Node.js built-in `fs.watch` with recursive option, no chokidar).

## Changes

### Files to Create

- `packages/coc/src/server/task-watcher.ts` — New module that owns the per-workspace file watchers.
  - `TaskWatcher` class with:
    - `watchWorkspace(workspaceId: string, rootPath: string): void` — starts `fs.watch(path.join(rootPath, '.vscode/tasks'), { recursive: true })` on the workspace's tasks directory.  No-ops gracefully if the directory does not exist.
    - `unwatchWorkspace(workspaceId: string): void` — closes the `FSWatcher` for that workspace.
    - `closeAll(): void` — closes every active watcher (called on server shutdown).
    - Internal 300 ms debounce per workspace (restart a `setTimeout` on each raw event) to coalesce rapid-fire renames/writes into a single callback.
    - Constructor accepts a `onTasksChanged: (workspaceId: string) => void` callback so the module stays decoupled from WebSocket internals.
  - Handles cross-platform quirks: catch `EPERM`/`ENOENT` from `fs.watch` on Windows when directories are deleted, and clean up the watcher.

- `packages/coc/test/server/task-watcher.test.ts` — Unit tests for `TaskWatcher` (see Tests section).

### Files to Modify

- `packages/coc/src/server/websocket.ts`
  - Extend the `ServerMessage` union type with a new variant:
    ```ts
    | { type: 'tasks-changed'; workspaceId: string; timestamp: number }
    ```
  - No other logic changes needed — `broadcastProcessEvent` already handles workspace-scoped filtering via `getMessageWorkspaceId`.
  - Update `getMessageWorkspaceId` to extract `workspaceId` from `tasks-changed` messages (it currently only checks `process.workspaceId`).

- `packages/coc/src/server/index.ts`
  - Import `TaskWatcher` from `./task-watcher`.
  - After creating `wsServer`, instantiate `TaskWatcher` with a callback that calls `wsServer.broadcastProcessEvent({ type: 'tasks-changed', workspaceId, timestamp: Date.now() })`.
  - Hook into workspace registration: after `store.registerWorkspace(workspace)` succeeds (via the `onProcessChange` callback or by wrapping the store method), call `taskWatcher.watchWorkspace(workspace.id, workspace.rootPath)`.
    - **Preferred approach:** Wrap the store's `registerWorkspace` / `removeWorkspace` on the server side (in `createExecutionServer`) with a thin interceptor that also calls `taskWatcher.watchWorkspace` / `taskWatcher.unwatchWorkspace`.  This avoids modifying `api-handler.ts` and keeps the wiring in one place.
  - On startup, iterate `store.getWorkspaces()` results and call `taskWatcher.watchWorkspace` for each (handles server restart with persisted workspaces).
  - In the `close()` teardown sequence, call `taskWatcher.closeAll()` before closing the HTTP server.
  - Re-export `TaskWatcher` from the barrel.

- `packages/coc/src/server/spa/client/websocket.ts`
  - Add a handler branch for `msg.type === 'tasks-changed'`:
    ```ts
    } else if (msg.type === 'tasks-changed' && msg.workspaceId) {
        // Re-fetch the task list for this workspace and re-render
        refreshTaskPanel(msg.workspaceId);
    }
    ```
  - Import a `refreshTaskPanel` function (may need to be created or wired to an existing task-panel refresh).  If the tasks panel does not exist yet in the SPA, add a TODO comment referencing the commit that will add it (this event is forward-looking).

- `packages/coc/src/server/types.ts`
  - Add `TaskWatcher` to any relevant re-exports if it is part of the public server API surface.

### Files to Delete

(none)

## Implementation Notes

1. **`fs.watch` recursive option** — Supported natively on macOS (FSEvents) and Windows.  On Linux, recursive mode was added in Node 19+; if the server needs to support older Node on Linux, fall back to watching only the top-level `.vscode/tasks/` directory (one level).  Document the limitation in a code comment.

2. **Debounce strategy** — Use a per-workspace `setTimeout` map.  On every raw `fs.watch` event, clear the existing timer and set a new 300 ms timer.  When the timer fires, invoke the `onTasksChanged` callback once.  This avoids flooding WebSocket clients when a user saves multiple files rapidly or when git operations touch many files.

3. **Graceful missing-directory handling** — Workspaces may not have `.vscode/tasks/` yet.  `watchWorkspace` should try to watch and silently skip if the directory doesn't exist (log at debug level).  Consider re-attempting the watch on the next workspace update event.

4. **Error resilience** — `fs.watch` can emit `error` events (e.g., directory deleted while watched).  The `error` handler should close that watcher, remove it from the internal map, and log a warning.

5. **Workspace-scoped broadcast** — `broadcastProcessEvent` already filters by `client.workspaceId` subscription.  The `getMessageWorkspaceId` helper must be updated to return `workspaceId` from the new `tasks-changed` message variant so that filtering works correctly.

6. **Pattern consistency** — Follow the existing event-bridging pattern in `index.ts` (lines 171–251) where `store.onProcessChange` and `queueManager.on('change')` bridge to `wsServer.broadcastProcessEvent`.  The task watcher callback is a third bridge of the same shape.

7. **No scanning in this commit** — The `tasks-changed` event only signals *that* something changed, not *what* changed.  The client is responsible for re-fetching the task list via a REST endpoint.  Actual task scanning and a `/api/tasks` REST endpoint may be added in a subsequent commit.

## Tests

- **`task-watcher.test.ts`** — Unit tests using a temp directory:
  - `watchWorkspace` starts watching and fires callback when a `.md` file is created in `.vscode/tasks/`.
  - `watchWorkspace` fires callback when a file is modified.
  - `watchWorkspace` fires callback when a file is deleted.
  - Debounce: multiple rapid events produce only one callback invocation (verify with a 500 ms wait after the last event).
  - `unwatchWorkspace` stops firing callbacks for that workspace.
  - `closeAll` stops all watchers.
  - Watching a non-existent `.vscode/tasks/` directory does not throw and does not fire callbacks.
  - Watcher error handling: deleting the watched directory mid-watch cleans up without crashing.

- **`websocket.test.ts`** (existing, extend) — Add a case for the `tasks-changed` message type:
  - Verify `getMessageWorkspaceId` returns the correct workspace ID for a `tasks-changed` message.
  - Verify workspace-scoped filtering: a client subscribed to workspace A does not receive a `tasks-changed` event for workspace B.

- **`index.test.ts` / integration** (existing, extend) — Verify:
  - Registering a workspace triggers task watcher setup (mock `fs.watch`).
  - Removing a workspace stops the task watcher for that workspace.
  - Server shutdown calls `taskWatcher.closeAll()`.

## Acceptance Criteria

- [ ] Creating/modifying/deleting a `.md` file in a registered workspace's `.vscode/tasks/` directory causes a `tasks-changed` WebSocket message within ~500 ms
- [ ] The `tasks-changed` message includes the correct `workspaceId` and a `timestamp`
- [ ] Clients subscribed to a different workspace do NOT receive the event (workspace-scoped filtering)
- [ ] Unsubscribed clients (no workspace filter) DO receive the event
- [ ] Rapid file changes (e.g., 10 writes in 100 ms) are debounced into a single event
- [ ] Workspaces without a `.vscode/tasks/` directory are handled gracefully (no crash, no spurious events)
- [ ] Removing a workspace stops its file watcher
- [ ] Server shutdown cleans up all file watchers (no leaked handles)
- [ ] All new and modified tests pass on macOS, Linux, and Windows
- [ ] Zero new external dependencies (uses only Node.js built-in `fs.watch`)

## Dependencies

- Depends on: 008, 009
