# Plan: Jump to Bottom of Conversation on Queue Task Click

## Problem

When a user clicks a running or completed task in `RepoQueueTab`'s queue list, the
`QueueTaskDetail` component renders in the right panel with the conversation history.
However, the conversation does **not** automatically scroll to the bottom — the user
sees the top of a potentially long conversation instead of the latest messages.

## Current Behavior

`QueueTaskDetail.tsx` has a conditional auto-scroll that only fires when new turns
arrive **and** the user is already within 100 px of the bottom:

```ts
// packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx
useEffect(() => {
    const el = document.getElementById('queue-task-conversation');
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom < 100) {          // ← guarded: only if near bottom
        el.scrollTop = el.scrollHeight;
    }
}, [turns]);
```

There is **no** scroll-to-bottom triggered by a change in `selectedTaskId`
(i.e., when the user picks a different task from the sidebar).

## Desired Behavior

Clicking any running or completed task in the queue list should immediately scroll
the conversation panel to the **bottom** (most-recent messages), regardless of
prior scroll position.

## Scope

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx` | Add `useEffect` to scroll `#queue-task-conversation` to bottom when `selectedTaskId` changes and loading completes |

No changes required in `RepoQueueTab.tsx`, `ProcessesSidebar.tsx`, or context files.

## Implementation

### `QueueTaskDetail.tsx`

Add a new `useEffect` after the existing auto-scroll effect (around line 263):

```ts
// Scroll to bottom when a new task is selected
useEffect(() => {
    if (!selectedTaskId || loading) return;
    const el = document.getElementById('queue-task-conversation');
    if (el) el.scrollTop = el.scrollHeight;
}, [selectedTaskId, loading]);
```

**Why `[selectedTaskId, loading]`?**
- `selectedTaskId` — fires when the user clicks a different task.
- `loading` — when `loading` transitions from `true` → `false`, the turns are
  rendered in the DOM; waiting for this avoids scrolling before content is present.

This is intentionally unconditional (no "near bottom" guard) because the user
explicitly selected a task — jumping to the latest message is always the right
default.

## Edge Cases

| Scenario | Outcome |
|----------|---------|
| User clicks the **same** task already selected | `selectedTaskId` does not change, no scroll triggered (correct — respects current position) |
| User clicks a task that is still loading | Fires once loading finishes (`loading → false`) |
| User has manually scrolled up mid-conversation on a running task | Scroll is NOT reset while they're reading — only resets on next task selection |
| Task completes while detail panel is open | Existing turns-based scroll handles streaming updates as before |

## Acceptance Criteria

1. Clicking a **running** task card in the queue list scrolls the right panel to
   the bottom of the conversation.
2. Clicking a **completed** task card in the queue list scrolls the right panel to
   the bottom of the conversation.
3. Clicking the **same already-selected** task does not forcibly scroll the panel.
4. The existing near-bottom auto-scroll behavior during live streaming is
   unchanged.
5. No regressions in `QueueTaskDetail` tests.

## Files to Read Before Implementing

- `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx`
  (especially lines 60–130 for state, lines 250–290 for existing scroll effects)
- `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`
  (lines 130–165 for `selectTask` and lines 440–455 for right-panel render)
