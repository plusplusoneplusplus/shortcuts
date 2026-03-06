# Cancel Pending Chat

## Problem

When a chat is queued (showing "Waiting to start…"), there is no way to cancel it. The user is stuck waiting for the chat to start. The screenshot shows multiple queued chats piling up with no cancel affordance.

## Approach

The backend already supports cancellation via `DELETE /api/queue/:id` → `cancelTask(id)`. The work is purely frontend — add a Cancel button in the "Waiting to start…" state and optionally a cancel action on queued sidebar cards.

## Changes

### 1. RepoChatTab — Cancel button in conversation header (queued state)

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

- Add a `handleCancelChat` callback that:
  1. Calls `DELETE /api/queue/${chatTaskId}` via `fetch`
  2. On success, calls `handleNewChat()` to reset state
  3. Calls `sessionsHook.refresh()` to update sidebar list
- Show a **Cancel** button in the header bar (line ~518) when `task?.status === 'queued'`:
  ```tsx
  {task?.status === 'queued' && (
      <Button size="sm" variant="secondary" onClick={() => void handleCancelChat()}>
          Cancel
      </Button>
  )}
  ```
- Also replace the plain "Waiting to start…" spinner (line ~546) with a version that includes the cancel button inline, providing two affordances for discovery.

### 2. ChatSessionSidebar — Cancel action on queued cards (optional enhancement)

**File:** `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx`

- Accept an optional `onCancelSession?: (taskId: string) => void` prop
- For sessions with `status === 'queued'`, render a small ✕ cancel button on the card
- Wire from RepoChatTab: `onCancelSession={handleCancelChat}` (with parameterized taskId)

### 3. Polling cleanup

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

- In the queued→running poll effect (line ~276), also handle `status === 'cancelled'` — if detected, reset to start screen instead of loading the session.

## Files to Modify

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Add `handleCancelChat`, Cancel button in header + inline, handle cancelled in poll |
| `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx` | Optional: add cancel action on queued session cards |

## Testing

- Add test for `handleCancelChat` calling `DELETE /api/queue/:id` and resetting state
- Add test for Cancel button visibility only when `task.status === 'queued'`
- Add test for sidebar cancel button on queued sessions
- Verify existing tests still pass

## Notes

- No backend changes needed — `DELETE /api/queue/:id` already exists and emits `queue-updated` WebSocket events, so the sidebar auto-refreshes
- The `cancelTask()` in `TaskQueueManager` handles both queued and running tasks
- The cancel should be immediate since queued tasks haven't started execution yet
