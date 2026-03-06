# Fix: Completed task stays in "Completed" section when follow-up is queued

## Problem

When a user sends a follow-up message into an already-completed chat task via the Queue tab's "Continue this conversation" input, the parent task remains under **COMPLETED TASKS** in the sidebar even though a follow-up message is pending in the queue. The user expects the task to move to the **QUEUED TASKS** section.

### Root Cause

The lifecycle has a gap between enqueue and execution:

1. **Enqueue time** (`api-handler.ts:1583–1603`): The follow-up task is created with `parentTaskId` in its payload, but `enqueue()` in `TaskQueueManager` does **nothing** with the parent task — it stays in `history`.
2. **Execution time** (`queue-executor-bridge.ts:233–234`): `reActivate(parentTaskId)` fires only when the follow-up **starts executing**, moving the parent from `history → running`.

The gap means: while the follow-up sits in the queue waiting (could be indefinitely if queue is paused), the parent task incorrectly shows as "Completed".

### Visual

```
User queues follow-up → [follow-up in queue, parent still in history/completed]  ← BUG
Follow-up starts       → [parent moved to running]                                ← OK
Follow-up finishes     → [parent back to history/completed]                       ← OK
```

## Proposed Fix

Add a `requeueFromHistory()` method to `TaskQueueManager` that moves a task from `history → queue`, and call it when a follow-up is enqueued. Update `reActivate()` to also handle the case where the parent is already in the queue (not just history).

### Changes

#### 1. `packages/pipeline-core/src/queue/task-queue-manager.ts` ✅

**Add `requeueFromHistory(id: string): boolean` method** (new, ~15 lines):
- Find the task in `this.history` by id
- Splice it out of history
- Set `status = 'queued'`, clear `completedAt`/`result`/`error`, reset `startedAt`
- Insert into `this.queue` (via `insertByPriority`)
- Emit `'updated'` and `'taskUpdated'` events
- Return `true` on success, `false` if not found

**Add `returnToHistory(id: string): boolean` method** (new):
- Reverses `requeueFromHistory` — moves a queued task back to history as completed
- Used when a follow-up is cancelled

**Update `reActivate(id: string): boolean`** to also check `this.queue`: ✅
- After the existing history check, add a fallback: if not found in history, check `this.queue`
- If found in queue, splice it out, set `status = 'running'`, move to `this.running`
- This handles the case where `reActivate` is called while the parent is already queued (i.e., the follow-up starts executing while the parent is in the queued state)

#### 2. `packages/coc-server/src/api-handler.ts` (~lines 1583–1603) ✅

**After `bridge.enqueue()` succeeds**, call `requeueFromHistory()` on the parent task:
- After line 1603 (the `bridge.enqueue()` call), if `parentTask?.id` exists, call the queue manager's `requeueFromHistory(parentTask.id)`
- This needs access to the queue manager — check how the bridge exposes it (likely via `bridge.queueManager` or add a method to the bridge)

#### 3. `packages/coc/src/server/queue-executor-bridge.ts` (~line 233) ✅

**Expose a method to requeue parent tasks**, or add a `requeueParent(parentTaskId)` convenience method on the bridge that delegates to `queueManager.requeueFromHistory()`.

Alternatively, call `requeueFromHistory` directly in the bridge's `enqueue` wrapper if it has access to the parentTaskId from the payload.

#### 4. `packages/coc-server/src/spa/client/react/repos/RepoQueueTab.tsx` ✅

**No UI changes needed** — the three sections already render from the server's `queued[]`, `running[]`, and `history[]` arrays. Once the parent task is moved server-side from history to queue, the UI will automatically show it under "QUEUED TASKS" on the next poll/refresh.

However, verify that the parent task (which is NOT a follow-up) is not accidentally filtered out by the follow-up filter (`t.type === 'chat' && t.payload?.processId`). The parent task should not have `payload.processId` at the top level, so it should be fine — but confirm this.

#### 5. Cancel follow-up edge case ✅

- `queue-handler.ts`: DELETE /api/queue/:id now checks if the cancelled task was a chat follow-up and moves the parent back to history via `returnToHistory`
- `queue-executor-bridge.ts`: Cancel-before-start also calls `returnToHistory` on the parent

### Lifecycle After Fix

```
User queues follow-up → [follow-up in queue (hidden), parent moved to queue (visible)]  ← FIXED
Follow-up starts       → [parent moved from queue to running]                             ← OK
Follow-up finishes     → [parent back to history/completed]                               ← OK
```

### Testing

- Add unit test in `packages/pipeline-core/src/queue/task-queue-manager.test.ts`:
  - `requeueFromHistory` moves a completed task back to queue with correct status
  - `requeueFromHistory` returns false for non-existent id
  - `reActivate` works when task is in queue (not just history)
- Add integration test in queue-executor-bridge tests:
  - Enqueuing a chat follow-up moves the parent task from history to queued
  - When follow-up executes, parent moves from queued to running
  - When follow-up completes, parent returns to history

### Edge Cases

- **Multiple follow-ups queued**: If user queues 2 follow-ups for the same parent, the second `requeueFromHistory` call should be a no-op (parent is already in queue) — return false gracefully
- **Parent task not found**: If `parentTaskId` doesn't match anything in history (already requeued or running), the method returns false — no harm
- **Queue paused**: Works correctly — parent sits in queued section alongside the paused queue, which is the desired UX
- **Cancel follow-up**: If the follow-up is cancelled while in queue, the parent should return to completed — needs a handler in the cancellation path
