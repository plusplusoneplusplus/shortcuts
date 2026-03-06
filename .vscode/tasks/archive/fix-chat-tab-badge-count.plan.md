# Fix: Chat Tab Badge Count Disappears When Chat Is Running

## Problem

The Chat tab in the CoC SPA dashboard should show a green badge with the number of actively running chats (similar to how the Tasks tab shows "24"). Even when a chat is clearly active (showing "ASSISTANT Live" in the chat panel), the Chat tab badge is missing.

## Architecture Context

The badge count flows through this pipeline:

```
Server: QueueManager.getRunning() → mapRunning(task) → WebSocket broadcast {repoId, running: [...]}
Client: App.tsx onMessage → resolveWorkspaceIdForQueueMessage → REPO_QUEUE_UPDATED(ws.id, queue)
UI:     useRepoQueueStats(ws.id) → repoQueueMap[ws.id].running.filter(t => t.type === 'chat').length
Badge:  chatRunningCount > 0 → <span>{chatRunningCount}</span>
```

## Root Causes (Two Independent Issues)

### Issue 1: Stats-Only Seed Blocks Full Data Fetch

**This is the primary bug.** Two competing seed mechanisms create a race:

1. **`ReposView.tsx:85-108`** — On app load, fetches `/queue/repos` and dispatches `REPO_QUEUE_STATS_UPDATED` for each repo. This creates entries in `repoQueueMap[ws.id]` with **only stats** (empty `running`/`queued`/`history` arrays):
   ```ts
   // REPO_QUEUE_STATS_UPDATED reducer:
   { queued: existingRepo?.queued ?? [], running: existingRepo?.running ?? [], ... }
   // → queued: [], running: [], history: [] (all empty)
   ```

2. **`RepoDetail.tsx:56-60`** — When user opens a repo tab, attempts to seed with full task data from `/queue?repoId=ws.id`. But it checks:
   ```ts
   if (queueState.repoQueueMap[ws.id]) return; // ← already truthy from step 1!
   ```
   Since step 1 already created the entry (with empty arrays), this full fetch **never fires**.

**Result:** `repoQueueMap[ws.id]` has `running: []` until a WebSocket update successfully resolves to `ws.id`. If that resolution fails even once (see Issue 2), the badge stays at 0.

### Issue 2: WebSocket Workspace ID Resolution Can Fail

The server broadcasts `queue-updated` with `repoId = SHA256(rootPath).substring(0,16)` — a hash, not the workspace ID. `App.tsx:157` must resolve this to `ws.id` via `resolveWorkspaceIdForQueueMessage()`:

1. It extracts `workingDirectory` from task objects in the queue message
2. It matches against `appState.workspaces[].rootPath` via `normalizeComparablePath()`

**Failure modes:**
- **`appState.workspaces` is empty/stale in closure** — The `onMessage` callback depends on `appState.workspaces`, but if `useWebSocket` internally captures the initial callback ref without updating, the workspaces list could be stale (empty at app startup).
- **Path normalization mismatch** — Different path separators, casing, or trailing slashes between server `workingDirectory` and client `workspace.rootPath`.
- **No tasks in queue message** — When the broadcast includes `running: []`, `queued: []`, `history: []` (e.g., brief transition state), `getQueueWorkingDirectory()` returns null.

When resolution fails, data only goes to `repoQueueMap[hash]`, not `repoQueueMap[ws.id]`. The alias cache (`repoIdAliasRef`) helps on subsequent messages, but only if a previous resolution succeeded.

### Issue 3 (Secondary): Follow-Up Messages Bypass Queue

- First chat message: `POST /api/queue` → creates a queue task with `type: 'chat'` → appears in `running` → badge shows ✓
- Follow-up messages: `POST /api/processes/{pid}/message` → **bypasses queue entirely** → no queue task → badge shows 0

After the first AI response completes, the queue task moves to `history`. Any subsequent follow-up keeps the chat "Live" (via independent SSE tracking in `RepoChatTab.tsx`) but the queue has no running chat tasks. The badge disappears even though the chat is actively streaming a follow-up response.

## Proposed Fixes

### Fix 1: Don't let stats-only seed block full data fetch (Critical) ✅

In `RepoDetail.tsx`, change the seed guard to check for actual task data, not just entry existence:

```tsx
// Before:
if (queueState.repoQueueMap[ws.id]) return;

// After: Only skip if we already have task-level data (not just stats)
const existing = queueState.repoQueueMap[ws.id];
if (existing && (existing.running.length > 0 || existing.queued.length > 0 || existing.history.length > 0)) return;
```

Or better — always fetch on mount and merge:

```tsx
useEffect(() => {
    fetchApi('/queue?repoId=' + encodeURIComponent(ws.id))
        .then(data => {
            if (data) queueDispatch({ type: 'REPO_QUEUE_UPDATED', repoId: ws.id, queue: data });
        }).catch(() => {});
}, [ws.id]);
```

**Alternative:** Add a flag to distinguish stats-only entries from fully-seeded entries.

### Fix 2: Use a ref for workspaces in WebSocket handler (Important)

Already handled by existing code — `useWebSocket` hook syncs callback refs when deps change, and `onMessage` correctly lists `appState.workspaces` in its dependency array.

### Fix 3: Track streaming chats independently for badge (Enhancement) ✅

Implemented Option B: Track "actively streaming" chat count via `streamingChatWorkspaces` in QueueContext.

## Files to Modify

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Fix seed guard (Fix 1) |
| `packages/coc/src/server/spa/client/react/App.tsx` | Use ref for workspaces (Fix 2) |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Track streaming state for badge (Fix 3) |
| `packages/coc/src/server/spa/client/react/hooks/useRepoQueueStats.ts` | Potentially merge queue + streaming counts |

## Testing

- Verify badge appears when first chat message is streaming
- Verify badge appears when follow-up message is streaming
- Verify badge disappears when all chats complete
- Verify badge count is correct with multiple concurrent chats
- Verify no regression on Queue tab badges
- Test across page refreshes and reconnects
