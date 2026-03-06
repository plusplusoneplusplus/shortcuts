# Plan: Improve Chat Follow-up Queue UX

## Problem

When a user sends an initial chat message and then a follow-up, the queue tab shows **two separate task rows**:
1. The original `chat` task (in history/completed)
2. A new `chat-followup` task (under the "Other" filter bucket)

This is confusing because:
- The follow-up is logically part of the same conversation, not a new independent task
- Clicking `chat-followup` opens a generic `QueueTaskDetail` panel instead of the Chat tab
- `chat-followup` has no icon and no named filter — it falls into "Other" with a raw string label
- The queue tab implies two separate units of work when there is really one ongoing conversation

## Proposed Approach

**Re-activate the original `chat` task when a follow-up arrives**, instead of enqueuing a separate `chat-followup` task. The original task moves from history back to running, and when the follow-up completes, it returns to history with updated metadata.

This treats the queue task lifecycle as matching the conversation lifecycle.

---

## Key Design Decisions

- **Timestamps**: Keep original `createdAt`. Update `startedAt` to the follow-up's start time. Update `completedAt` when follow-up finishes.
- **Display name**: Update to reflect turn count, e.g., `"Chat (3 turns)"` or append the latest message preview.
- **Audit trail**: History entries are currently immutable. This plan requires relaxing that assumption for `chat` tasks only. Other task types are unaffected.
- **In-flight follow-ups**: If the original task is still running (edge case), no re-activation needed — just continue on the same task.

---

## Todos

### 1. ✅ `pipeline-core` — Add `reActivate` to `TaskQueueManager`
- Add method `reActivate(taskId: string): boolean` to `TaskQueueManager`
- Finds task in `history` array by id
- Removes it from `history`
- Resets: `status = 'running'`, clears `completedAt`/`result`/`error`, sets new `startedAt`
- Inserts into `running` Map
- Emits `taskUpdated` event
- Returns `false` if task not found or not in history

### 2. ✅ `pipeline-core` — Add `updateDisplayName` to `TaskQueueManager`
- Add method `updateTask(taskId, { displayName })` (or extend existing `updateTask` if it doesn't already support `displayName`)
- Used to update turn count in display name after each follow-up

### 3. ✅ `coc` — Update `CLITaskExecutor` to re-activate parent task
In `packages/coc/src/server/queue-executor-bridge.ts`, `chat-followup` handler:
- Before executing, call `queueManager.reActivate(parentTaskId)` to move original task back to running
- After `executeFollowUp()` completes, call `queueManager.markCompleted(parentTaskId, result)` to return it to history
- Update display name with new turn count

### 4. ✅ `coc` — Store `parentTaskId` in follow-up payload
In `packages/coc-server/src/task-types.ts`:
- Add `parentTaskId?: string` to `ChatFollowUpPayload`

In `packages/coc-server/src/api-handler.ts` (`POST /api/processes/:id/message`):
- Look up the queue to find the original `chat` task by `processId`
- Pass its `taskId` as `parentTaskId` in the enqueued follow-up payload

### 5. ✅ `coc` — Suppress `chat-followup` from queue tab display
In `packages/coc/src/server/spa/client/react/RepoQueueTab.tsx`:
- Filter out `type === 'chat-followup'` tasks from rendered lists (running, queued, history)
- These are now internal implementation details, not user-visible tasks

### 6. ✅ `coc` — Fix `selectTask` click routing (safety net)
In `RepoQueueTab.tsx` `selectTask()`:
- Also redirect `type === 'chat-followup'` to the Chat tab (same as `chat`)
- This handles any in-flight follow-ups that existed before migration / edge cases

---

## Files Affected

| File | Change |
|------|--------|
| `packages/pipeline-core/src/queue/task-queue-manager.ts` | Add `reActivate()` method |
| `packages/pipeline-core/src/queue/types.ts` | Ensure `displayName` is in `TaskUpdate` |
| `packages/coc-server/src/task-types.ts` | Add `parentTaskId` to `ChatFollowUpPayload` |
| `packages/coc-server/src/api-handler.ts` | Pass `parentTaskId` when enqueuing follow-up |
| `packages/coc/src/server/queue-executor-bridge.ts` | Re-activate parent task around follow-up execution |
| `packages/coc/src/server/spa/client/react/RepoQueueTab.tsx` | Filter out `chat-followup` rows; fix click routing |

---

## Out of Scope

- Changing how `conversationTurns` are stored on the process (no change needed)
- Changing SSE streaming (follows `processId`, unaffected)
- Affecting any task type other than `chat` / `chat-followup`
- Persistence of re-activated tasks across server restarts (not required)
