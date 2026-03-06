# Reactivate Parent Tasks During Follow-Up Chat

## Problem

When a follow-up chat is in progress on a completed task, the Queue tab badge shows the correct count (e.g., "2"), but the queue list shows **0 active tasks** — only "COMPLETED TASKS (67)". The 2 running `chat-followup` tasks are hidden from the list by the `t.type !== 'chat-followup'` filter, and the parent tasks remain in the completed section.

### Root Cause

There are **two mismatches** in the current code:

1. **Badge vs List filter gap** (`useRepoQueueStats.ts` vs `RepoQueueTab.tsx`):
   - Badge counts `chat-followup` tasks as running (`isNonChat = t.type !== 'chat'` passes `chat-followup`)
   - List hides `chat-followup` tasks (`t.type !== 'chat-followup'`)
   - The parent `chat` tasks are excluded from the badge count (`isChat = t.type === 'chat'`)

2. **Parent task not visually re-activated**: While `queue-executor-bridge.ts` calls `queueManager.reActivate(parentTaskId)` to move the parent from `history[]` → `running[]`, the parent has `type: 'chat'` which is intentionally excluded from the non-chat badge count. The parent DOES appear in the running list (since the list only filters `chat-followup`, not `chat`), but the badge doesn't reflect it.

## Desired Behavior

- When a follow-up chat starts on a completed task, the **parent task** should visibly appear in the "Running Tasks" section of the queue
- The Queue tab badge should accurately reflect the number of visible running tasks
- When the follow-up chat completes, the parent task moves back to "Completed"
- The `chat-followup` tasks themselves remain hidden from the list (they are implementation details)

## Approach

### Subtask 1: Fix badge count to exclude `chat-followup`

**File:** `packages/coc/src/server/spa/client/react/hooks/useRepoQueueStats.ts`

Change `isNonChat` to also exclude `chat-followup`:
```ts
// Before:
const isNonChat = (t: { type?: string }) => t.type !== 'chat';

// After:
const isNonChat = (t: { type?: string }) => t.type !== 'chat' && t.type !== 'chat-followup';
```

This ensures the badge only counts tasks that are actually visible in the list.

### Subtask 2: Include re-activated parent `chat` tasks in the badge

The re-activated parent task has `type: 'chat'`, which is excluded from the non-chat badge. We need to count parent chat tasks that are in `running[]` (i.e., re-activated due to follow-up) in the badge.

**Option A — Simple**: Add re-activated chat tasks to the badge:
```ts
// Count chat tasks that are running (re-activated for follow-up)
const chatRunningReactivated = runningArr.filter(isChat).length;
return {
    running: runningArr.filter(isNonChat).length + chatRunningReactivated,
    ...
};
```

But this would count ALL chat running tasks, including normal first-time chats. That may be acceptable since if a chat is running, it should show in the badge.

**Option B — Preferred**: Stop excluding `chat` from the badge entirely. The badge should count ALL visible running tasks:
```ts
const isHidden = (t: { type?: string }) => t.type === 'chat-followup';
return {
    running: runningArr.filter(t => !isHidden(t)).length,
    queued: queuedArr.filter(t => !isHidden(t)).length,
    ...
};
```

### Subtask 3: Verify `reActivate()` is working end-to-end

Confirm the following chain works when a follow-up chat is sent:
1. `api-handler.ts` sets process `status: 'running'`
2. `queue-executor-bridge.ts` calls `queueManager.reActivate(parentTaskId)`
3. `task-queue-manager.ts` moves parent from `history[]` → `running[]`
4. WebSocket `queue-updated` event broadcasts the new state
5. Client `QueueContext` receives `REPO_QUEUE_UPDATED` with parent in `running[]`
6. `RepoQueueTab` renders parent in "Running Tasks" section

If any step fails, investigate and fix.

### Subtask 4: Update tests

- Update `useRepoQueueStats` tests to verify `chat-followup` is excluded from badge counts
- Update `RepoQueueTab` tests to verify parent chat tasks appear in "Running" when re-activated
- Verify existing tests still pass

## Key Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/hooks/useRepoQueueStats.ts` | Badge count logic |
| `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` | Queue list rendering |
| `packages/coc/src/server/spa/client/react/contexts/QueueContext.tsx` | Queue state management |
| `packages/coc/src/server/queue-executor-bridge.ts` | Follow-up chat → reActivate |
| `packages/pipeline-core/src/queue/task-queue-manager.ts` | reActivate() implementation |
| `packages/coc-server/src/api-handler.ts` | Follow-up chat API endpoint |

## Acceptance Criteria

- [x] When a follow-up chat is in progress, the parent task appears in the "Running Tasks" section of the Queue tab
- [x] The Queue tab badge count matches the number of visible running tasks in the list
- [x] `chat-followup` tasks remain hidden from the queue list (implementation detail)
- [x] When the follow-up chat completes, the parent task moves back to "Completed Tasks"
- [x] No regression in normal (non-follow-up) task queue behavior
- [x] Tests updated and passing

## Notes

- The `reActivate()` server-side mechanism already exists and should work. The main fix is likely in the frontend badge calculation.
- Be careful not to double-count: if both the `chat-followup` and the parent `chat` task are in `running[]`, only the parent should be counted/displayed.
- The `chat` type filter in `useRepoQueueStats` was originally added to separate chat badge counts. Verify this separation is still needed or if it can be simplified.
