# Plan: Freeze Task Feature

## Problem

Users need the ability to "freeze" a queued task — the task stays in the queue at its position but the queue executor will skip over it when picking the next task to run. The task can later be "unfrozen" to become eligible for execution again.

This is distinct from cancelling (which removes the task) and pausing the whole queue (which stops all execution). Freeze is a per-task hold.

## Approach

Add a `frozen` boolean flag to `QueuedTask`. The executor's `peek()` logic is updated to skip frozen tasks and find the first non-frozen queued task. New API endpoints and UI context menu actions expose freeze/unfreeze.

No new `QueueStatus` value is needed — the task remains in `'queued'` status; `frozen` is an independent attribute.

---

## Todos

### 1. Data Model — `packages/pipeline-core/src/queue/types.ts`
- [x] Add `frozen?: boolean` field to the `QueuedTask` interface.
- [x] No migration needed; `undefined` is treated as `false`.

### 2. Queue Executor — `packages/pipeline-core/src/queue/queue-executor.ts`
- [x] Update `peek()` (currently returns `queue[0]`) to iterate and return the first task where `frozen` is falsy.
- [x] If all queued tasks are frozen, `peek()` returns `undefined` (executor idles).

### 3. Queue Manager — `packages/pipeline-core/src/queue/task-queue-manager.ts`
- [x] Add `freezeTask(id: string): boolean` — finds task in queue by id, sets `frozen = true`, emits a change event.
- [x] Add `unfreezeTask(id: string): boolean` — sets `frozen = false`, emits a change event.
- [x] Both methods return `false` (not found / task not in queued state).

### 4. API Routes — `packages/coc/src/server/queue-handler.ts`
- [x] Add `POST /api/queue/:id/freeze` → calls `freezeTask`, returns updated task or 404.
- [x] Add `POST /api/queue/:id/unfreeze` → calls `unfreezeTask`, returns updated task or 404.

### 5. Persistence — `packages/coc/src/server/queue-persistence.ts`
- [x] No changes required. `frozen` is a field on `QueuedTask` and is already serialized/restored as part of pending tasks. Frozen tasks restored on startup remain frozen.

### 6. Frontend UI — `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`
- [x] Add "Freeze" context menu item for queued (non-frozen) tasks: calls `POST /queue/:id/freeze`.
- [x] Add "Unfreeze" context menu item for frozen tasks: calls `POST /queue/:id/unfreeze`.
- [x] Visual indicator for frozen tasks: show a snowflake (❄) icon or muted/italic styling in the task row to distinguish frozen from normal queued tasks.

---

## Key Files

| File | Change |
|------|--------|
| `packages/pipeline-core/src/queue/types.ts` | Add `frozen?: boolean` to `QueuedTask` |
| `packages/pipeline-core/src/queue/queue-executor.ts` | `peek()` skips frozen tasks |
| `packages/pipeline-core/src/queue/task-queue-manager.ts` | `freezeTask()` / `unfreezeTask()` methods |
| `packages/coc/src/server/queue-handler.ts` | Two new route handlers |
| `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` | Freeze/Unfreeze menu items + visual indicator |

## Out of Scope

- Bulk freeze/unfreeze of all tasks.
- Frozen tasks do not affect queue ordering (they stay at their position).
- No separate "frozen" section in the UI — frozen tasks appear inline in the queue list with a visual marker.
