# Fix: Follow-up Messages Re-execute Original Chat From Scratch

## Problem

When a user sends a follow-up message on an existing chat/task, the system re-sends the **original message** and starts a completely fresh conversation instead of continuing the existing session.

Example: Chat starts with `"how are you"` → user sends a follow-up → instead of continuing, a brand new chat with `"how are you"` appears.

## Root Cause

**`requeueFromHistory` re-enqueues the parent task for execution, not just display.**

The flow when a follow-up message arrives (`api-handler.ts:1585–1610`):

1. A new follow-up task is enqueued with `kind: 'chat'` + `processId` (correctly identified as follow-up)
2. **BUG:** `bridge.requeueParentTask(parentTask.id)` is called at line 1609
3. In `multi-repo-executor-bridge.ts:246`, this calls `manager.requeueFromHistory(parentTaskId)`
4. `requeueFromHistory` (`task-queue-manager.ts:480`) resets the **original parent task** (`status: 'queued'`, clears `startedAt/completedAt/result/error`) and inserts it back into the **execution queue** via `insertByPriority()`
5. The queue executor picks up BOTH the follow-up task AND the original parent task
6. The parent task re-executes from scratch with the original prompt → **regression**

### Why it exists

The intent of `requeueParentTask` was **cosmetic** — show the parent task under "QUEUED TASKS" in the UI while the follow-up waits. But `requeueFromHistory` makes the task **executable**, not just visible.

The follow-up execution path (`queue-executor-bridge.ts:231–238`) already correctly handles UI state by calling `this.queueManager.reActivate(parentTaskId)` when the follow-up starts running.

### Secondary issue: dead code in `executeByType`

In `queue-executor-bridge.ts:862–863`, the `isChatPayload()` check matches follow-up tasks (since `isChatFollowUp ⊂ isChatPayload`) **before** the `isChatFollowUp()` check at line 881 can fire. The follow-up block at 881 is dead code. This isn't the regression cause (follow-ups short-circuit at `execute()` line 231), but it's a logic hazard.

## Fix

### Option A (Preferred): Remove `requeueParentTask` from api-handler

The `reActivate()` call in `queue-executor-bridge.ts:238` already handles moving the parent from history → running when the follow-up executes. The `requeueParentTask` call in `api-handler.ts:1609` is redundant and harmful.

**Files to change:**
- `packages/coc-server/src/api-handler.ts` — Remove lines 1606–1610 (the `requeueParentTask` call)
- Optionally remove `requeueParentTask` from the `ExecutorBridge` interface (line 40) if no other callers exist

### Option B: Replace `requeueFromHistory` with display-only state

Change `multi-repo-executor-bridge.ts:248` to call a display-only method instead of `requeueFromHistory`. For example, use a new method that updates the task's visual status without inserting it into the execution queue.

### Cleanup (both options)

- `queue-executor-bridge.ts:862–863` — Reorder the `isChatFollowUp` check before `isChatPayload` in `executeByType`, or remove the dead code block at 881–890 since follow-ups never reach `executeByType`.

## Key Files

| File | Lines | Role |
|------|-------|------|
| `packages/coc-server/src/api-handler.ts` | 1585–1610 | Enqueues follow-up + calls requeueParentTask |
| `packages/coc/src/server/multi-repo-executor-bridge.ts` | 246–253 | Delegates to requeueFromHistory |
| `packages/pipeline-core/src/queue/task-queue-manager.ts` | 480–497 | requeueFromHistory re-enqueues for execution |
| `packages/coc/src/server/queue-executor-bridge.ts` | 200–260 | execute() — follow-up short-circuit + reActivate |
| `packages/coc/src/server/queue-executor-bridge.ts` | 849–891 | executeByType — dead code for follow-ups |
| `packages/coc-server/src/task-types.ts` | 164–170 | isChatPayload / isChatFollowUp predicates |

## Todos

1. ~~**Remove requeueParentTask call** — Delete lines 1606–1610 in `api-handler.ts`~~
2. ~~**Clean up interface** — Remove `requeueParentTask?` from `ExecutorBridge` interface if no callers remain~~
3. ~~**Clean up multi-repo bridge** — Remove `requeueParentTask` method from `multi-repo-executor-bridge.ts` if unused~~
4. ~~**Fix dead code in executeByType** — Move `isChatFollowUp` check before `isChatPayload` or remove the unreachable block~~
5. ~~**Add/update tests** — Ensure follow-up flow doesn't re-execute parent task~~
