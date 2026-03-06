---
status: pending
---

# 002: Add cancellation guard for follow-up execution

## Summary

Extend the cancellation early-return path in `CLITaskExecutor.execute()` (line 171) to handle `chat-followup` tasks correctly. When a follow-up task is cancelled before execution begins, the original process — which `api-handler.ts` already set to `'running'` at line 1446 — must be reverted to `'completed'` so it doesn't appear stuck in a running state in the UI.

## Motivation

The `api-handler.ts` follow-up endpoint (line 1444–1447) updates the parent process status to `'running'` *before* enqueueing the `chat-followup` task. If the task is subsequently cancelled while still in the queue, the existing cancellation guard (line 171–174) returns early with `{ success: false, error: 'Task cancelled', durationMs: 0 }` — but never reverts the original process back to `'completed'`. This leaves the process permanently stuck in `'running'` status from the user's perspective.

The `executeFollowUp()` method itself handles the error and success paths correctly:
- **Success path** (line 554–556): updates the process to `status: 'completed'`.
- **Error path** (line 585–591): updates the process to `status: 'failed'` and appends an error turn — this is intentionally kept as-is because AI errors should be surfaced to the user.

The **cancellation path** is the only case where neither `executeFollowUp()` success nor error handlers run, so we must handle the revert explicitly.

## Changes

### Files to Create
- (none)

### Files to Modify
- `packages/coc/src/server/queue-executor-bridge.ts` — Extend the cancellation early-return block (lines 170–174) to detect `chat-followup` payloads and revert the original process status.

**Current code (lines 170–174):**
```typescript
// Check if cancelled before starting
if (this.cancelledTasks.has(task.id)) {
    logger.debug(LogCategory.AI, `[QueueExecutor] Task ${task.id} was cancelled before starting`);
    return { success: false, error: new Error('Task cancelled'), durationMs: 0 };
}
```

**Proposed replacement:**
```typescript
// Check if cancelled before starting
if (this.cancelledTasks.has(task.id)) {
    logger.debug(LogCategory.AI, `[QueueExecutor] Task ${task.id} was cancelled before starting`);
    // For follow-ups, revert the original process from 'running' back to 'completed'
    // since api-handler.ts set it to 'running' before enqueueing
    if (isChatFollowUpPayload(task.payload)) {
        const payload = task.payload as unknown as ChatFollowUpPayload;
        task.processId = payload.processId;
        try {
            await this.store.updateProcess(payload.processId, { status: 'completed' });
        } catch {
            // Non-fatal: process may already be cleaned up
        }
        if (payload.imageTempDir) {
            cleanupTempDir(payload.imageTempDir);
        }
    }
    return { success: false, error: new Error('Task cancelled'), durationMs: 0 };
}
```

Key details:
1. **`task.processId = payload.processId`** — Mirrors what commit 001's short-circuit block does, ensuring the task tracks the correct process ID for any downstream cleanup the queue executor infrastructure performs.
2. **`store.updateProcess(…, { status: 'completed' })`** — Reverts the status that `api-handler.ts` line 1446 set to `'running'`. Uses `'completed'` (not `'failed'`) because cancellation is a user-initiated action, not an error.
3. **`cleanupTempDir`** — If the follow-up had image attachments, the temp directory (created by `api-handler.ts` via `saveImagesToTempFiles`) must be cleaned up since the normal `finally` block in the short-circuit path won't run.
4. **`try/catch` around `updateProcess`** — Non-fatal guard; the process may have been deleted or the store may be shutting down.

### Files to Delete
- (none)

## Implementation Notes

- The `ChatFollowUpPayload` type is already imported at line 20 (from `@plusplusoneplusplus/coc-server`), along with `isChatFollowUpPayload` (line 25) and `cleanupTempDir` (line 22). No new imports needed.
- The `execute()` method signature is `async`, so `await this.store.updateProcess(…)` is valid at line 171.
- This change is purely additive — the existing cancellation path for non-follow-up tasks is unchanged (the `if (isChatFollowUpPayload(…))` block is skipped, and the same `return` statement fires).
- We intentionally do **not** call `this.store.emitProcessComplete()` here because the process was not "completed" in the pipeline sense — it was reverted to its prior state. The SPA will see the status change via the normal store update mechanism.

## Tests
- (covered in commit 003)

## Acceptance Criteria
- [ ] When a `chat-followup` task is cancelled before execution, the original process status is reverted from `'running'` to `'completed'`
- [ ] When a `chat-followup` task with image attachments is cancelled, the temp directory is cleaned up
- [ ] Non-follow-up task cancellation behavior is unchanged (no regression)
- [ ] The `task.processId` is set to `payload.processId` so queue infrastructure can track the correct process

## Dependencies
- Depends on: 001

## Assumed Prior State
Commit 001 applied: `execute()` has an early-return path for `chat-followup` payloads that skips ghost process creation.
