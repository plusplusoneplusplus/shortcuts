# Show Chat Tasks in Queue Tab

## Problem

Chat tasks use the same exclusive queue slot as other tasks (follow-prompt, impl, etc.), but are **hidden from the Queue tab** via an `isNonChat` filter in `RepoQueueTab.tsx`. When a chat is "Waiting to start..." because other exclusive tasks are running, the user has no visibility into where the chat sits in the queue — it only appears in the Chat tab with a spinner.

## Approach

**Remove the `isNonChat` filter** so chat tasks appear in the Queue tab alongside all other tasks. Add a 💬 icon and "Chat" label so they're visually distinguishable. When a chat task is selected in the Queue tab, clicking it should navigate to the Chat tab and open that session.

## Changes

### 1. Remove `isNonChat` filter from `RepoQueueTab.tsx`
**File:** `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`

- Remove the `isNonChat` function (line 32)
- Remove all `.filter(isNonChat)` calls in the HTTP fetch path (lines 61-68) and the WebSocket update path (lines 118-120)
- Add `'chat': 'Chat'` to `TASK_TYPE_LABELS` so it appears as a filter option

### 2. Add chat icon to `QueueTaskItem`
**File:** `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`

- In `QueueTaskItem`, when `task.type === 'chat'`, use a 💬 icon instead of 🔄/⏳
- In the history section, use 💬 prefix for completed chat tasks so they're distinguishable

### 3. Add click-to-navigate for chat tasks
**File:** `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`

- When a chat task is clicked in the Queue list, navigate to the Chat tab and select that chat session (using the task's `processId` or `id`)
- Use the existing tab navigation mechanism (likely a callback prop or context-based tab switch)

### 4. Update tests
**File:** `packages/coc/src/server/spa/client/react/repos/__tests__/RepoQueueTab.test.tsx` (or similar)

- Update any tests that assert chat tasks are excluded from the Queue tab
- Add a test verifying chat tasks appear in the Queue tab with the 💬 icon

## Notes

- Chat tasks should still appear in the Chat tab as well — this is additive, not a move
- Completed chat tasks in Queue history don't need full conversation display; just the summary line is enough
- The detail panel for a chat task in the Queue tab could show a "View in Chat" button rather than duplicating the chat UI
