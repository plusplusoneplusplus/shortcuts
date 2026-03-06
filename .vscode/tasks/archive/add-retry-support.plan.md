# Add Retry Support for a Task

## Problem

When a task fails (e.g., due to server restart, transient AI error, or timeout), there is no way to retry it. The user must manually re-create the task. The screenshot shows a failed task ("add different color for different t") in the COMPLETED TASKS section with the message "Server restarted — task was running when server stopped" but no retry action is available.

## Current State

- **Data model already has retry fields**: `QueuedTask.retryCount`, `TaskExecutionConfig.retryOnFailure/retryAttempts/retryDelayMs` — but **none are wired up** in the executor.
- **A `withRetry()` utility exists** at `packages/pipeline-core/src/runtime/retry.ts` with configurable backoff strategies — unused by queue executor.
- **No retry API endpoint** exists (no `POST /api/queue/:id/retry`).
- **No retry button** in either the SPA dashboard or VS Code tree view for failed tasks.
- **`QueueExecutor.handleTaskFailure()`** checks `retryCount < maxRetries` and calls `queueManager.markRetry()` — but the automatic retry path is incomplete.

## Proposed Approach

Add **manual retry** (user-initiated re-enqueue of a failed task) across all surfaces, and **wire up automatic retry** using existing config fields.

---

## Tasks

### 1. Backend: Add retry endpoint to queue handler
**Files:** `packages/coc/src/server/queue-handler.ts`, `packages/coc-server/src/api-handler.ts`

- [x] Add `POST /api/queue/:id/retry` endpoint
- Lookup the failed/cancelled task by ID from history
- Create a new `QueuedTask` cloned from the original (same prompt, type, priority, config, working directory)
- Reset status to `queued`, clear error/result, reset `retryCount` to 0
- Enqueue via `TaskQueueManager.enqueue()`
- Return the new task ID in the response
- Reject retry for tasks that are still `running` or `queued`

### 2. Core: Add `retryTask()` method to TaskQueueManager
**Files:** `packages/pipeline-core/src/queue/task-queue-manager.ts`

- [x] Add `retryTask(taskId: string): string | undefined` method
- Find task in completed/failed history
- Clone task payload and config into a new `CreateTaskInput`
- Enqueue and return the new task
- Emit appropriate events so UIs refresh

### 3. Wire up automatic retry in QueueExecutor
**Files:** `packages/pipeline-core/src/queue/queue-executor.ts`

- [x] Already wired (existing `handleTaskFailure` checks `retryOnFailure` and `retryCount < retryAttempts`)
- If eligible, increment `retryCount`, reset status to `queued`, and re-insert into the priority queue after `retryDelayMs`
- Use the existing `withRetry()` utility or the simpler inline approach already partially implemented
- Log retry attempts

### 4. SPA Dashboard: Add retry button for failed/cancelled tasks
**Files:** `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`, `ProcessesSidebar.tsx`

- [x] Add retry button in history section and QueueTaskDetail
- Wire button to `POST /api/queue/:id/retry`
- On success, show brief toast/notification and refresh the queue list
- Also add retry button in `QueueTaskDetail.tsx` detail panel for failed tasks

### 5. VS Code Extension: Add retry command for failed processes
**Files:** `src/shortcuts/ai-service/ai-queue-commands.ts`, `ai-process-tree-provider.ts`, `package.json`

- [x] Register `shortcuts.queue.retryTask` command with context menu for failed processes
- Add context menu item for failed process items (`contextValue` matching `*_failed`)
- Command calls `AIQueueService.retryTask()` which re-enqueues the original prompt with same config
- Add `retryTask()` to `AIQueueService` that creates a new task from the failed process's metadata

### 6. Tests
**Files:** New test files in `packages/pipeline-core/src/queue/__tests__/`, `packages/coc/src/server/__tests__/`

- [x] Unit tests for `TaskQueueManager.retryTask()` (10 tests)
- [x] Integration tests for `POST /api/queue/:id/retry` endpoint (3 tests)
- Unit test for automatic retry in `QueueExecutor` — verifies retry count, delay, max attempts
- Integration test for `POST /api/queue/:id/retry` endpoint — verifies 200 for failed task, 400 for running task
- Test retry button presence/absence based on task status in SPA

## Notes

- Retry creates a **new task** (new ID) rather than mutating the old one — keeps history clean
- The original failed task remains in history with its error for debugging
- Automatic retry (via config) and manual retry (via button) are independent features
- Consider adding a `retriedFromId` field to link the new task back to the original for traceability
