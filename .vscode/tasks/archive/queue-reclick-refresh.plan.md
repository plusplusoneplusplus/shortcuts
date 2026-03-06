# Queue Tab: Re-click Focused Task to Refresh

## Problem

In the CoC SPA Queue tab (`RepoQueueTab.tsx`), clicking on a task that is **already selected** (i.e., the right panel is already showing its details) does nothing. The `selectTask` function dispatches `SELECT_QUEUE_TASK` with the same ID, which produces no state change, so the detail panel doesn't re-fetch or re-render.

The **Processes** sidebar (`ProcessesSidebar.tsx`) already handles this correctly by dispatching `REFRESH_SELECTED_QUEUE_TASK` when the hash hasn't changed (lines 127–132). The Queue tab needs the same treatment.

## Approach

Add a check in `RepoQueueTab.selectTask`: if the clicked task's `id` matches the current `selectedTaskId`, dispatch `REFRESH_SELECTED_QUEUE_TASK` (which increments `refreshVersion`) instead of `SELECT_QUEUE_TASK`. The existing `QueueTaskDetail` already responds to `refreshVersion` changes — it bypasses the conversation cache and re-fetches from `/processes/{id}` (lines 324–349).

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` | In `selectTask`, check `selectedTaskId === id` and dispatch `REFRESH_SELECTED_QUEUE_TASK` |

## Detail

### RepoQueueTab.tsx — `selectTask` (line 157–175)

**Before:**
```ts
const selectTask = useCallback((id: string, task?: any) => {
    if (task?.type === 'chat') { ... return; }
    if (task?.type === 'run-pipeline') { ... return; }
    queueDispatch({ type: 'SELECT_QUEUE_TASK', id });
    location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/queue/' + encodeURIComponent(id);
    if (isMobile) setMobileShowDetail(true);
}, [queueDispatch, appDispatch, workspaceId, isMobile]);
```

**After:**
```ts
const selectTask = useCallback((id: string, task?: any) => {
    if (task?.type === 'chat') { ... return; }
    if (task?.type === 'run-pipeline') { ... return; }
    if (selectedTaskId === id) {
        queueDispatch({ type: 'REFRESH_SELECTED_QUEUE_TASK' });
        return;
    }
    queueDispatch({ type: 'SELECT_QUEUE_TASK', id });
    location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/queue/' + encodeURIComponent(id);
    if (isMobile) setMobileShowDetail(true);
}, [queueDispatch, appDispatch, workspaceId, isMobile, selectedTaskId]);
```

### How the refresh propagates (already implemented)

1. `REFRESH_SELECTED_QUEUE_TASK` → `refreshVersion++` (QueueContext.tsx:188–189)
2. `QueueTaskDetail` useEffect depends on `queueState.refreshVersion` (line 349)
3. When `refreshVersion` changes, it detects `isRefresh = true` (line 324–325)
4. Bypasses conversation cache and calls `fetchApi('/processes/...')` (line 340)
5. Updates `processDetails` and conversation turns → right panel re-renders

## Todos

- [x] **queue-reclick-refresh**: Add `selectedTaskId === id` guard to `selectTask` in `RepoQueueTab.tsx`

## Testing

- Click a running/queued/completed task → right panel loads (existing behavior, unchanged)
- Click the same task again → right panel re-fetches from backend and re-renders with fresh data
- Click a different task → normal selection behavior (unchanged)
- Verify chat and pipeline task routing still works (early returns before the new guard)
