# Move Queue Task Button to Header

## Problem

The "+ Queue Task" button is currently located inside the Queue tab's left panel toolbar (next to the filter dropdown and pause/resume button). The user wants it moved to the **top-right header area**, alongside the "Generate Plan", "Edit", and "Remove" buttons. This improves discoverability and keeps the action prominent regardless of scroll position.

## Approach

Move the button from `RepoQueueTab.tsx` toolbar into the `RepoDetail.tsx` header, conditionally rendered only when the Queue sub-tab is active. The queue dispatch is already available in `RepoDetail.tsx` via `useQueue()`.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Add "+ Queue Task" button to header, shown only when `activeSubTab === 'queue'` |
| `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` | Remove the "+ Queue Task" button from the toolbar (lines 305-313). Keep the empty-state button (line 269-276) as a convenience fallback. |

## Detailed Steps

### 1. Add button to RepoDetail header

In `RepoDetail.tsx` around **line 100** (before the "Generate Plan" button), add:

```tsx
{activeSubTab === 'queue' && (
    <Button
        variant="ghost"
        size="sm"
        onClick={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id })}
        title="Queue a new task"
        data-testid="repo-queue-task-btn"
    >
        + Queue Task
    </Button>
)}
```

`queueDispatch` is already destructured on line 42 from `useQueue()`. No new imports needed.

### 2. Remove button from RepoQueueTab toolbar

In `RepoQueueTab.tsx`, remove lines 305-313 (the `<Button>` with `data-testid="repo-queue-task-btn"`) from the toolbar `<div>`. Keep the pause/resume button and the empty-state "+ Queue Task" button intact.

### 3. Update tests

Search for tests referencing `repo-queue-task-btn` in the toolbar context and update selectors if any assume it's inside the queue tab panel.

## Notes

- The `workspaceId` is available as `ws.id` in `RepoDetail.tsx`
- The empty-state "+ Queue Task" button in `RepoQueueTab.tsx` (line 269-276, testid `repo-queue-task-btn-empty`) should remain — it serves as an inline CTA when the queue is empty
- The pause/resume button stays in the queue tab toolbar since it's queue-specific operational state
