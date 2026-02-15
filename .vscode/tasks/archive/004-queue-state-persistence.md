---
status: pending
---

# 004: Add task queue persistence with restore on startup

## Summary

Add a `QueuePersistence` class that subscribes to `TaskQueueManager` change events, debounces writes, and serializes queue state (pending tasks + recent history) to `~/.coc/queue.json`. On server startup the persisted state is restored — pending tasks are re-enqueued and any previously-running tasks are marked as failed with a "Server restarted" error. Uses atomic writes (temp file + rename) consistent with the `FileProcessStore` pattern.

## Motivation

`TaskQueueManager` is entirely in-memory — all pending and history items are lost when the `coc serve` process restarts. Users who queue several tasks and then restart (or experience a crash) lose their work. Persisting queue state to disk solves this by:

- Re-enqueuing pending tasks automatically on startup.
- Preserving history so the dashboard still shows recent completed/failed tasks.
- Marking previously-running tasks as failed with a clear error, since their execution context is gone.

## Changes

### Files to Create

1. **`packages/coc/src/server/queue-persistence.ts`**

   `QueuePersistence` class with the following design:

   ```typescript
   export class QueuePersistence {
       constructor(queueManager: TaskQueueManager, dataDir: string);
       restore(): void;   // Synchronous — called before executor starts
       dispose(): void;    // Flush pending writes, remove listener
   }
   ```

   **Constructor:**
   - Stores references to `queueManager` and computes `filePath` as `path.join(dataDir, 'queue.json')`.
   - Subscribes to `queueManager.on('change', ...)`.
   - On each change event, calls a debounced save (300 ms debounce window).

   **Serialization format** (`queue.json`):
   ```json
   {
       "version": 1,
       "savedAt": "2025-07-08T12:00:00.000Z",
       "pending": [ /* full QueuedTask objects */ ],
       "history": [ /* last 100 QueuedTask objects */ ]
   }
   ```

   **`save()` (private, debounced):**
   - Reads current state from `queueManager.getQueued()` and `queueManager.getHistory()`.
   - Also includes `queueManager.getRunning()` — serialized into the `pending` array so they survive a crash (they will be treated as pending on next restore).
   - Limits history to 100 entries (last N from `getHistory()`).
   - Writes JSON to `<filePath>.tmp`, then renames to `<filePath>` (atomic write).
   - Uses `fs.writeFileSync` / `fs.renameSync` (synchronous to guarantee flush in dispose).

   **`restore()`:**
   - If `queue.json` does not exist, returns immediately (clean first start).
   - Reads and parses the file. On parse error, logs a warning and returns (no crash).
   - Checks `version === 1`; skips restore with a warning for unknown versions.
   - For each task in `pending`:
     - If `status` was `'running'`: change status to `'failed'`, set `error` to `"Server restarted — task was running when server stopped"`, set `completedAt` to `Date.now()`, and place into history via `queueManager.updateTask()` or direct re-insertion to history.
     - If `status` was `'queued'`: re-enqueue via `queueManager.enqueue()` using the original `CreateTaskInput` fields (`type`, `priority`, `payload`, `config`, `displayName`). Note: this generates a new task ID, which is acceptable since the old ID is meaningless after restart.
   - For each task in `history`: populate the queue manager's history. Since `TaskQueueManager` does not expose a public method to inject history directly, use a lightweight approach — either:
     - (a) Add a `restoreHistory(tasks: QueuedTask[])` method to `TaskQueueManager` (preferred, minimal addition), or
     - (b) Use the existing `enqueue` → `markStarted` → `markCompleted`/`markFailed` sequence to replay tasks into history.
   - Logs the number of restored pending tasks and history entries to stderr.

   **`dispose()`:**
   - If a debounced write is pending, flush it immediately (cancel timer, call save synchronously).
   - Remove the `change` event listener from `queueManager`.

   **Debounce implementation:**
   - Use a simple `setTimeout`/`clearTimeout` pattern (no external dependency).
   - 300 ms delay — rapid successive changes collapse into a single write.

### Files to Modify

1. **`packages/pipeline-core/src/queue/task-queue-manager.ts`**
   - Add a `restoreHistory(tasks: QueuedTask[]): void` method that prepends tasks to the internal `history` array (respecting `maxHistorySize`). This is the minimal addition needed for persistence restore.
   - Export from `packages/pipeline-core/src/queue/index.ts`.

2. **`packages/coc/src/server/index.ts`**
   - Import `QueuePersistence` from `./queue-persistence`.
   - After creating `queueManager` (line ~120) and before creating `queueExecutor` (line ~127):
     ```typescript
     const queuePersistence = new QueuePersistence(queueManager, dataDir);
     queuePersistence.restore();
     ```
   - In the `close` handler (line ~256), before `queueExecutor.dispose()`:
     ```typescript
     queuePersistence.dispose();
     ```

## Implementation Notes

- **Atomic writes:** Follow the `FileProcessStore` pattern — write to `queue.json.tmp` then rename. This prevents corruption if the process is killed mid-write. See `packages/pipeline-core/src/file-process-store.ts` lines 261–264 for the reference pattern.
- **Synchronous I/O in save:** Using `writeFileSync`/`renameSync` in the save path ensures that `dispose()` can guarantee a flush before the process exits. The debounce timer fires infrequently (at most once per 300 ms) so the sync I/O cost is negligible.
- **Running tasks on restore:** Tasks with `status: 'running'` in the persisted file represent tasks that were mid-execution when the server stopped. Since their AI session context is gone, the only safe action is to mark them as failed. The error message should clearly indicate this was due to a server restart, not an execution failure.
- **Re-enqueue uses `enqueue()`:** Rather than trying to restore exact task IDs (which could collide with newly generated IDs), re-enqueue creates fresh tasks. The original `createdAt` ordering is preserved by enqueuing in the order they appear in the persisted array.
- **QueuedTask serialization:** All `QueuedTask` fields are JSON-serializable (numbers, strings, plain objects). The `payload` field uses discriminated unions (`FollowPromptPayload`, etc.) that are all plain objects. The `result` field is typed as `unknown` but in practice contains JSON-serializable AI responses.
- **`dataDir` is already established:** The `createExecutionServer` function resolves `dataDir` to `~/.coc/` (line 113) and creates it with `mkdirSync` (line 117). `QueuePersistence` can assume the directory exists.
- **No changes to queue-handler.ts or queue-executor-bridge.ts** — persistence is transparent; existing REST API and executor behaviour are unchanged.

## Tests

Add `packages/coc/test/queue-persistence.test.ts`:

1. **Serialization round-trip** — Enqueue several tasks with different priorities, trigger a save (wait for debounce), read `queue.json`, verify it contains `version: 1`, `savedAt` ISO string, and all pending tasks with correct fields (`id`, `type`, `priority`, `payload`, `config`, `displayName`, `status`, `createdAt`).

2. **Restore pending tasks** — Write a `queue.json` with two queued tasks, create a new `QueuePersistence` instance, call `restore()`, verify `queueManager.getQueued()` returns two tasks with matching `type`, `priority`, `payload`, `config`, and `displayName`.

3. **Running tasks marked as failed on restore** — Write a `queue.json` with a task that has `status: 'running'`, call `restore()`, verify the task appears in `queueManager.getHistory()` with `status: 'failed'` and `error` containing `"Server restarted"`.

4. **History restoration** — Write a `queue.json` with 5 history entries (mix of completed/failed/cancelled), call `restore()`, verify `queueManager.getHistory()` contains all 5 entries with correct statuses.

5. **Debounce coalescing** — Enqueue 10 tasks in rapid succession (<100 ms total), wait 500 ms, verify `queue.json` was written exactly once (use `fs.stat` mtime or spy on write).

6. **Empty state / no file** — Create `QueuePersistence` without any pre-existing `queue.json`, call `restore()`, verify no error is thrown and `queueManager.getQueued()` is empty.

7. **Corrupt file handling** — Write invalid JSON to `queue.json`, call `restore()`, verify no error is thrown (graceful degradation) and queue is empty.

8. **Dispose flushes pending write** — Enqueue a task, immediately call `dispose()` (before debounce fires), verify `queue.json` exists and contains the task.

9. **Atomic write safety** — Verify that after a save, no `.tmp` file remains (rename completed successfully).

10. **restoreHistory on TaskQueueManager** — Unit test the new `restoreHistory()` method: inject 5 tasks, verify `getHistory()` returns them; inject more than `maxHistorySize`, verify truncation.

## Acceptance Criteria

- [ ] Pending tasks survive server restart (stop `coc serve`, start again, tasks still queued).
- [ ] Queue history is preserved across restarts (last 100 entries).
- [ ] Previously-running tasks appear as failed with error `"Server restarted — task was running when server stopped"`.
- [ ] Writes are debounced at 300 ms — rapid queue changes produce a single file write.
- [ ] Atomic writes (temp file + rename) prevent corruption on crash.
- [ ] Graceful handling when `queue.json` does not exist (clean first start).
- [ ] Graceful handling when `queue.json` contains invalid JSON (logged warning, no crash).
- [ ] `dispose()` flushes any pending debounced write before returning.
- [ ] All existing queue and server tests continue to pass.
- [ ] New test file with ≥10 test cases covering the scenarios listed above.

## Dependencies

Depends on **002** (FileProcessStore wired in, `dataDir` established at `~/.coc/`).
