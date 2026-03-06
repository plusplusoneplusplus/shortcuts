# Fix: Chat Follow-Up Should Reuse Existing Process Instead of Creating New One

## Problem

When a user sends a follow-up message on a **completed** chat in the queue tab, the system creates a **new ghost process** (`queue_<new-task-id>`) in addition to correctly updating the original process. This results in a duplicate entry appearing in the queue list.

### Root Cause

The `execute()` method in `queue-executor-bridge.ts` (line 164) **unconditionally** creates a new process entry for every queued task:

```
const processId = `queue_${task.id}`;   // NEW ID, ignoring original
await this.store.addProcess(process);    // ghost entry created here
```

Later, `executeByType()` correctly routes `chat-followup` payloads to `executeFollowUp(payload.processId, ...)` which updates the **original** process. But by then, the ghost process already exists in the store and is visible in the UI.

### Flow Diagram

```
UI sends POST /api/processes/:originalId/message
  → api-handler appends user turn to original process, sets status='running'
  → bridge.enqueue({ type: 'chat-followup', payload: { processId: originalId, ... } })
    → execute() creates NEW process `queue_<taskId>` ← BUG: ghost entry
    → executeByType() calls executeFollowUp(originalId, ...) ← correct target
    → completion handler updates `queue_<taskId>` ← wrong process
```

## Acceptance Criteria

1. Sending a follow-up on a completed chat **does NOT** create a new process entry in the store
2. The original process is bumped from "completed" back to "running" (already done by api-handler)
3. The original process shows the follow-up response when complete (already works via `executeFollowUp`)
4. The queue tab UI reflects the original item moving back to active, then completed — no duplicate
5. Cancellation of a follow-up task still works correctly
6. Output streaming (SSE) targets the original process ID, not a ghost ID
7. The `persistOutput` / `flushConversationTurn` calls in the `finally` block use the original process ID
8. Existing tests continue to pass; new tests cover the follow-up-reuse path

## Subtasks

### 1. Short-circuit `execute()` for `chat-followup` tasks

In `queue-executor-bridge.ts`, add an early return path at the top of `execute()` (before the generic process-creation block at line 176) that detects `isChatFollowUpPayload(task.payload)` and:

- Sets `task.processId = payload.processId` (link task to original process)
- Skips `store.addProcess()` entirely
- Delegates to `executeFollowUp(payload.processId, payload.content, payload.attachments)`
- Handles cleanup (`imageTempDir`, output buffers, timeline buffers, throttle state)
- Returns an appropriate `TaskExecutionResult`

**File:** `packages/coc/src/server/queue-executor-bridge.ts` lines ~170-230

### 2. Ensure completion handler uses original process ID

The generic completion handler (lines 232-310) currently updates `processId` (the ghost). Since the short-circuit skips this block, verify that `executeFollowUp()` itself properly:

- Marks the original process as `completed` when done
- Persists the final conversation turns
- Emits `processComplete` event on the original process
- Cleans up output buffers using the original process ID

**File:** `packages/coc/src/server/queue-executor-bridge.ts` `executeFollowUp()` method (~line 420)

### 3. Handle error/cancellation for follow-up tasks

Ensure that if a follow-up task is cancelled (via `cancelledTasks` set) or errors out:

- The original process status reverts to `completed` (not left as `running`)
- No ghost process is left behind
- Error is properly reported via SSE/WebSocket

### 4. Add/update tests

- Unit test: `execute()` with a `chat-followup` payload does NOT call `store.addProcess()`
- Unit test: `execute()` with a `chat-followup` payload calls `executeFollowUp()` with correct args
- Unit test: cancellation of a follow-up task reverts original process to completed
- Integration test: full follow-up flow results in single process entry

**Test files:** `packages/coc/src/server/__tests__/queue-executor-bridge.*.test.ts`

## Notes

- The `api-handler.ts` side is already correct — it updates the original process status to `running` and appends the user turn before enqueueing.
- The `executeFollowUp()` method itself is also correct — it targets `payload.processId` (the original). The bug is purely in the `execute()` wrapper creating a ghost entry.
- The `resumedFrom` logic (cold resume, lines 268-289) is a separate feature for **new** tasks resuming from old sessions — not related to this bug.
- Consider whether `generateTitleIfNeeded` should be called after a follow-up (probably not — the original already has a title).
