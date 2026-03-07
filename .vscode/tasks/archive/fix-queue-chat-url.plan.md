# Fix: Queue Tab Chat Link Uses Wrong Session ID in URL

## Problem

When clicking a chat item in the Queue tab, the browser navigates to a URL like:

```
http://100.77.219.91:4000/#repos/ws-5i8wyn/chat/queue_1772685487447-9py3w8e
```

But the chat router and `RepoChatTab` expect the session ID **without** the `queue_` prefix:

```
http://100.77.219.91:4000/#repos/ws-5i8wyn/chat/1772685487447-9py3w8e
```

The URL is never matched to an existing session, so the chat view shows nothing.

## Root Cause

**File:** `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`, line 160

```typescript
const sessionId = task.processId || task.id;
//                ^^^^^^^^^^^^^^^^ task.processId = "queue_<task.id>" — wrong for a URL
```

The code reaches for `task.processId` first, but `task.processId` is the **internal process store key** (`queue_<task.id>`), not the chat session identifier. The URL must carry the bare `task.id`.

`RepoChatTab` is explicitly designed to receive a bare task ID (`chatTaskId`) and reconstructs the process ID itself:
```typescript
// RepoChatTab.tsx line 116
const processId = task?.processId ?? (chatTaskId ? `queue_${chatTaskId}` : null);
```

The contract is: **the URL always carries `task.id` (bare); `RepoChatTab` handles process resolution internally.**

`task.id` is always set and always the bare ID — there is no need to involve `task.processId` in navigation at all.

## Acceptance Criteria

- [ ] Clicking a chat item in the Queue tab navigates to `#repos/<wsId>/chat/<id>` where `<id>` does **not** contain the `queue_` prefix.
- [ ] The Chat tab opens and correctly loads the conversation for both:
  - Tasks that already have a `processId` (completed/running chats).
  - Tasks that only have a queue `id` (queued chats not yet started).
- [ ] No regression: clicking a non-chat queue item (e.g., `run-pipeline`) still works normally.
- [ ] Deep-linking directly to `#repos/<wsId>/chat/<id>` (without `queue_` prefix) still resolves the chat session.

## Subtasks

1. **Fix `RepoQueueTab.tsx`** — always use `task.id` for navigation; remove `task.processId` from this expression entirely:
   ```typescript
   // Line 160 — before
   const sessionId = task.processId || task.id;

   // After — task.id is always the bare task ID; task.processId is an internal runtime key
   const sessionId = task.id;
   ```

2. **Verify `RepoChatTab.tsx`** — confirm existing logic reconstructs `queue_<id>` when resolving the process, so no change is needed there (lines 116, 296, 384 already handle this correctly).

3. **Manual test** — open the Queue tab, click a completed chat item, confirm the URL is correct and the conversation loads.

## Notes

- `task.id` for queue items is always `queue_<timestamp>-<suffix>` (set by the server's queue logic).
- `task.processId` is only populated after the task has been dequeued and a process record created — queued-but-not-started chats have only `task.id`.
- The `RepoChatTab` uses `chatTaskId` (the ID passed via the URL/store) as the bare ID and synthesises `queue_<chatTaskId>` when it needs to call the process API. This contract must be preserved.
- The same `queue_` stripping pattern may be needed elsewhere if other navigation paths (e.g., deep-link restore on page load) exhibit the same issue — investigate `Router.tsx` `parseChatDeepLink` if further problems are reported.
