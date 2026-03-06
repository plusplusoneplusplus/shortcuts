# Chat List Not Updating After New Chat

## Problem

When a user creates a new chat in the CoC dashboard SPA, the chat list sidebar on the left does not update to show the newly created chat session. The new chat only appears after a manual page refresh or when the chat completes.

## Root Cause

**`GET /api/queue/history` only returns completed/failed/cancelled tasks.**

The flow:
1. User clicks "New Chat" → types a message → `handleStartChat()` fires (`RepoChatTab.tsx:249`)
2. `POST /api/queue` creates a new task with status `running` or `queued`
3. `sessionsHook.refresh()` is called at line 289
4. `useChatSessions.ts` fetches `GET /api/queue/history?type=chat&repoId=...`
5. **`queue-handler.ts:679`** calls `mgr.getHistory()` which only returns **completed/failed/cancelled** tasks
6. The newly created running/queued task is **not included** → the list doesn't show it

There is also a secondary WebSocket-driven refresh path (`RepoChatTab.tsx:175-181`) that watches `repoQueueMap[workspaceId]`, but this suffers from the same issue: even when the WS event triggers a refresh, the fetched history endpoint still excludes running tasks.

## Proposed Fix

**Server-side: Include running/queued chat tasks in the history endpoint when `type=chat`.**

In `packages/coc/src/server/queue-handler.ts`, the `GET /api/queue/history` handler (line 660-710), when `typeFilter === 'chat'`, merge running and queued tasks into the response alongside history. This ensures the chat list always shows all chat sessions regardless of status.

Alternatively (or additionally), **client-side optimistic update**: after `handleStartChat` succeeds, immediately prepend the new session into the sessions list without waiting for the API.

### Recommended approach: Both

1. **Server fix** (primary) — ensures consistency for all consumers of the endpoint
2. **Client optimistic update** (secondary) — instant UI feedback, no round-trip delay

## Affected Files

| File | Change |
|------|--------|
| `packages/coc/src/server/queue-handler.ts` | Merge running + queued tasks into history response when `type=chat` |
| `packages/coc/src/server/spa/client/react/chat/useChatSessions.ts` | (Optional) Expose `prependSession()` for optimistic updates |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | (Optional) Optimistically add new session after `handleStartChat` |

## Tasks

1. **Server: merge active tasks into chat history** — In `queue-handler.ts` GET `/api/queue/history`, when `typeFilter === 'chat'`, also call `mgr.getQueued()` and `mgr.getRunning()`, filter for `type === 'chat'`, serialize, and merge into the `history` array before returning. Sort combined list by `createdAt` descending.

2. **Client: optimistic session prepend** — After `handleStartChat` succeeds in `RepoChatTab.tsx`, construct a `ChatSessionItem` from the response and prepend it to the sessions list so the sidebar updates immediately.

3. **Tests** — Add/update tests for the history endpoint to verify running chat tasks are included. Add a test for the optimistic prepend behavior.
