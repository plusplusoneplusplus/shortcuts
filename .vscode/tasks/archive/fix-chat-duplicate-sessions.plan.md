# Fix: Duplicate Chat Sessions After Follow-Up

## Problem

When a user sends a follow-up message in an existing chat session, the chat sidebar shows **duplicate entries** with the same content. Each follow-up message creates a new `type: 'chat'` queue task that ends up in the chat session list, appearing as a separate session even though it belongs to an existing conversation.

## Root Cause

**`packages/coc/src/server/queue-handler.ts`** — `GET /api/queue/history?type=chat`

When a follow-up is sent, `api-handler.ts` calls `bridge.enqueue()` with a new task:
- `type: 'chat'`
- `payload.processId: <existingProcessId>` — attaches to an existing process
- `payload.parentTaskId: <originalTaskId>` — marks it as a child of a parent task

The history endpoint filters tasks by `type === 'chat'` but does **not** exclude follow-up (child) tasks. Since follow-up tasks share the same `processId` as the original session, `enrichChatTasks` enriches them with the same conversation content, making them look identical to the original session.

After `sendFollowUp()` completes, `sessionsHook.refresh()` re-fetches history and the follow-up task appears as a new sidebar entry — a duplicate.

## Proposed Fix

### 1. Filter follow-ups from history list (`queue-handler.ts` ~line 775)

After the `typeFilter` block, add a guard for chat sessions:

```ts
// Exclude follow-up tasks — they are child tasks of an existing chat session
if (typeFilter === 'chat') {
    history = history.filter(t => !(t as any).payload?.parentTaskId);
}
```

### 2. Exclude follow-ups from the active-tasks collection (`queue-handler.ts` ~line 785)

```ts
for (const task of [...mgr.getRunning(), ...mgr.getQueued()]) {
    if (
        (task.type as string) === 'chat' &&
        !seenIds.has(task.id) &&
        !(task.payload as any)?.parentTaskId  // ← exclude follow-ups
    ) {
        seenIds.add(task.id);
        history.push(serializeTask(task));
    }
}
```

## Why `parentTaskId` Is the Right Signal

| Task | `payload.parentTaskId` | `payload.processId` |
|------|------------------------|---------------------|
| Original new chat | ❌ not set | ❌ not set in payload |
| Follow-up message | ✅ set to parent task ID | ✅ set to existing process |

`parentTaskId` is set in the payload exclusively by the follow-up enqueue path (`api-handler.ts` line 1533). It's the cleanest, most explicit indicator that a task is a follow-up rather than a new conversation.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/queue-handler.ts` | Filter `parentTaskId` tasks from chat history (2 places) |

## Testing

- Start a new chat, send one message, receive reply
- Send a follow-up message
- Verify the sidebar still shows **one** session entry (not two)
- Verify the conversation content inside the session is correct (both turns present)
- Verify that starting a brand-new chat still creates a new session entry
