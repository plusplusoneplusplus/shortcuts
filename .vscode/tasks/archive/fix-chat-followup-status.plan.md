# Fix: Chat Follow-Up Message Doesn't Update Sidebar Status

## Problem

When a user sends a follow-up message in an already-completed chat, the sidebar chat list doesn't show the session as "in progress" (🔄). It stays showing ✅ completed.

From the screenshot: the user sent "no it should used to have a repo's specific tab for wiki, but somehow it's gone" as a follow-up, the assistant shows "Live" streaming indicator, but the sidebar still shows ✅.

## Root Cause Analysis

There are **two separate state systems** for chat status:

1. **Process store** (`FileProcessStore`) — tracks the AI process (`status: 'running'` / `'completed'`)
2. **Queue task** (`TaskQueueManager` history) — tracks the queue task (`status: 'completed'`)

When a follow-up message is sent:

- **Backend** (`api-handler.ts:804-806`): Updates the **process** status to `'running'` via `store.updateProcess(id, { status: 'running' })`. ✅
- **Frontend** (`RepoChatTab.tsx:473`): Optimistically updates the local React state to `'running'` via `sessionsHook.updateSessionStatus(chatTaskId, 'running')`. ✅
- **BUT**: The **queue task** in the `TaskQueueManager.history` array retains `status: 'completed'`. ❌

This means:
- The optimistic UI update works **momentarily**, but…
- Any WebSocket `queue-updated` event triggers `sessionsHook.refresh()` (line 258-262), which fetches `GET /api/queue/history?type=chat`
- That endpoint reads from queue history where the task is still `'completed'`
- The `enrichChatTasks()` function adds `chatMeta` (turnCount, firstMessage) but does **not** sync the process status back to the task
- So the refresh overwrites the optimistic `'running'` with the stale `'completed'`

The same issue occurs on page reload or when switching away and back.

## Fix Approach

### Option A: Server-side enrichment (Minimal, recommended)

In `enrichChatTasks()` (`queue-handler.ts:262`), after looking up the process, also sync the process status when it's `'running'`:

```typescript
if (process.status === 'running') {
    task.status = 'running';
}
```

**Pros**: Single-line fix, correct source of truth (process store knows the real status), no queue manager mutation needed.
**Cons**: Only affects the serialized response, not the in-memory queue task — but that's fine since the queue task is historical and the process store is authoritative for follow-ups.

### Option B: Update queue task status on follow-up (Alternative)

In `api-handler.ts` POST `/processes/:id/message` handler, also update the queue task status via the queue manager. This would require finding the task by processId and updating it.

**Pros**: Keeps queue task and process in sync.
**Cons**: More complex — need to find the task across all repos, queue history items are not easily updatable, and queue change events would fire unnecessarily.

### Option C: Frontend-only fix — skip refresh during streaming

Modify the WebSocket-triggered refresh effect (line 258) to also check if `sending` state is true (not just `eventSourceRef.current`).

**Pros**: No backend change.
**Cons**: Doesn't fix page reload or other tabs — only papers over the symptom.

## Recommended: Option A

## Todos

1. ~~**fix-enrich-chat-tasks**~~ ✅ — In `enrichChatTasks()` in `queue-handler.ts`, sync `process.status` to `task.status` when the process is `'running'`. This ensures `/api/queue/history?type=chat` returns accurate status during follow-ups.

2. ~~**add-test-enrich-status-sync**~~ ✅ — Add a test in `queue-handler.test.ts` that verifies: when a chat task in history has a processId pointing to a running process, the history endpoint returns `status: 'running'`. The challenge is setting up a history task with a processId — may need to pre-populate the queue state file or use `restoreHistory()` on the queue manager.

3. **verify-websocket-refresh** — Manually verify that WebSocket-triggered refreshes now correctly show the running status during follow-ups (the `repoQueueKey` effect at line 257 calls `sessionsHook.refresh()` which hits the enriched endpoint).

## Files to Modify

- `packages/coc/src/server/queue-handler.ts` — `enrichChatTasks()` function (~line 262)
- `packages/coc/test/server/queue-handler.test.ts` — new test case in "Chat metadata enrichment" describe block

## Notes

- The `startServer()` helper in tests creates a `FileProcessStore` internally. To test this, we need to either: (a) access the store to add a running process, or (b) pre-populate the data directory with process JSON files before server start.
- The queue persistence file format is version 3, with `{ version, savedAt, repoRootPath, repoId, isPaused, pending, history }`.
- `computeRepoId()` hashes `path.resolve(rootPath)` with SHA-256, taking first 16 hex chars.
