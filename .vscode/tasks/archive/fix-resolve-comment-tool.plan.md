# Fix resolve_comment tool — server-side resolution with WS push

## Problem

When the AI calls `resolve_comment` during a fix/batch-resolve operation, the comment remains open in the UI. The tool handler executes correctly (records IDs in an in-memory Map), but the resolved state never reaches the persistent comment store. Currently resolution is entirely frontend-dependent (poll task → read commentIds → PATCH each comment), which is fragile.

## Root Causes

### Bug 1: Field name mismatch (sync fallback, single-comment resolve)

**Server** (`task-comments-handler.ts:720`) returns `{ commentId }` (singular).
**Frontend** (`useTaskComments.ts:350`) reads `data.commentIds` (plural) → always `[]`.

### Bug 2: `revisedContent` missing from async queue result

`executeResolveComments` (`queue-executor-bridge.ts:963`) discards the AI response text.
Frontend gets `revisedContent = undefined`, blanking the editor.

### Design Gap: Comment resolution is frontend-only

The server never directly marks comments as resolved. If frontend poll fails/times out/unmounts, comments stay open.

## Architecture Decision

**Server-driven resolution with WebSocket push.** The server handles the `resolve_comment` tool callback, marks comments as resolved in `TaskCommentsManager`, pushes `comment-resolved` / `document-updated` WebSocket events to subscribed clients, and the frontend reacts to those events to update its UI state.

### Existing infrastructure we reuse

- **`comment-resolved` WS event** — already defined in `coc-server/src/websocket.ts:125`
- **`broadcastFileEvent()`** — file-scoped WS push to subscribed clients
- **`ProcessWebSocketServer`** — available in `index.ts`, needs to be threaded through
- **`TaskCommentsManager`** — already exported, can be instantiated with `dataDir`

## Proposed Fix

### Todo 1: Fix sync field name + add server-side resolution to sync path

**File:** `packages/coc/src/server/task-comments-handler.ts`

In the sync fallback (line ~720):
1. Change response from `{ commentId }` to `{ commentIds: [...] }` to align with async shape
2. After AI completes, directly call `manager.updateComment(wsId, taskPath, id, { status: 'resolved' })` for each resolved comment
3. Broadcast `comment-resolved` WS event for each resolved comment

Requires: passing `wsServer` into `registerTaskCommentsRoutes`.

### Todo 2: Capture revisedContent + add server-side resolution to async path

**File:** `packages/coc/src/server/queue-executor-bridge.ts`

In `executeResolveComments`:
1. Capture the return value of `executeWithAI` and extract `response` text
2. After AI completes, use `TaskCommentsManager` to mark each resolved comment
3. Broadcast `comment-resolved` WS event via the store or a new callback
4. Return `{ revisedContent, commentIds }` as the task result

Requires: `dataDir` (already available on CLITaskExecutor), `wsId` in payload (new), WS broadcast capability.

### Todo 3: Add `wsId` to ResolveCommentsPayload + thread wsServer

**File:** `packages/coc-server/src/task-types.ts` — add `wsId` field to `ResolveCommentsPayload`
**File:** `packages/coc/src/server/task-comments-handler.ts` — pass `wsId` when enqueuing
**File:** `packages/coc/src/server/index.ts` — pass `wsServer` to `registerTaskCommentsRoutes`
**File:** `packages/coc/src/server/queue-executor-bridge.ts` — accept optional WS broadcast callback or wsServer ref

### Todo 4: Simplify frontend — react to WS events instead of polling

**File:** `packages/coc/src/server/spa/client/react/hooks/useTaskComments.ts`

In `fixWithAI` and `resolveWithAI`:
1. Remove the manual PATCH loop (`Promise.all(commentIds.map(id => resolveComment(id)))`)
2. The server now handles resolution — frontend just needs to poll for `revisedContent` and refresh
3. Add a WebSocket listener for `comment-resolved` events to trigger a comments refresh

The frontend should still subscribe-file and listen for WS `comment-resolved` events to update local state. This decouples the UI from the async task completion.

### Todo 5: Update tests

- Update `task-comments-handler.test.ts` — sync response uses `commentIds` array, server-side resolution occurs
- Update `queue-executor-bridge.test.ts` — `revisedContent` returned, comments resolved server-side
- Verify `task-comments-batch-resolve.test.ts` still passes
- Test WS event emission for `comment-resolved`

## Files to Change

| File | Change |
|------|--------|
| `packages/coc-server/src/task-types.ts` | Add `wsId` to `ResolveCommentsPayload` |
| `packages/coc/src/server/index.ts` | Pass `wsServer` to `registerTaskCommentsRoutes` |
| `packages/coc/src/server/task-comments-handler.ts` | Accept `wsServer`, fix sync field name, add server-side resolution + WS push |
| `packages/coc/src/server/queue-executor-bridge.ts` | Capture `revisedContent`, add server-side resolution + WS push in async path |
| `packages/coc/src/server/spa/client/react/hooks/useTaskComments.ts` | Subscribe to `comment-resolved` WS events, remove manual PATCH loop |
| Test files | Update assertions, add WS event tests |

## Data Flow (after fix)

```
User clicks "Fix with AI"
  → Frontend POSTs to /ask-ai with commandId: 'resolve'
  → Server enqueues resolve-comments task (202 + taskId)
  → Queue executor runs AI with resolve_comment tool
  → AI calls resolve_comment tool → handler records IDs
  → executeResolveComments:
      1. Gets resolved IDs from tool
      2. Calls TaskCommentsManager.updateComment() for each → persisted
      3. Broadcasts WS comment-resolved events
      4. Returns { revisedContent, commentIds }
  → Frontend receives WS comment-resolved → refreshes comments (instant)
  → Frontend polls task result → gets revisedContent → updates editor
```

## Notes

- Frontend still polls for `revisedContent` (needed to update the editor). But comment resolution is now instant via WS push.
- The `comment-resolved` WS event type already exists in the ServerMessage union — no changes needed in `websocket.ts`.
- The sync fallback path (when bridge is unavailable) resolves comments inline before responding, so no WS needed there.
