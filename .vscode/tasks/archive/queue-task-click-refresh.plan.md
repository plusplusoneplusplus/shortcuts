# Queue Task Click Refresh

## Problem

Clicking a task card in the Queue tab that is **already selected** (completed or running) does not trigger any API call to fetch the latest status. The `openTaskInRoute` handler in `ProcessesSidebar.tsx` guards against navigating to the same hash:

```ts
if (location.hash !== nextHash) {
    location.hash = nextHash;
    return;
}
// hash already matches — only dispatches SELECT_QUEUE_TASK with same id
queueDispatch({ type: 'SELECT_QUEUE_TASK', id: task.id });
dispatch({ type: 'SELECT_PROCESS', id: null });
```

Because `selectedTaskId` doesn't change, none of the `useEffect` hooks in `QueueTaskDetail.tsx` that depend on it re-run, so no refresh happens.

## Proposed Approach

Add a `refreshVersion: number` counter to `QueueContextState`. Increment it whenever the user clicks an already-selected task. `QueueTaskDetail.tsx` listens to `refreshVersion` in its conversation-fetch effect and re-fetches when it changes.

This is minimal, targeted, and doesn't affect any other behaviour.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/context/QueueContext.tsx` | Add `refreshVersion: number` to state; add `REFRESH_SELECTED_QUEUE_TASK` action; handle it in reducer by incrementing `refreshVersion` |
| `packages/coc/src/server/spa/client/react/processes/ProcessesSidebar.tsx` | In `openTaskInRoute`, when hash already matches dispatch `REFRESH_SELECTED_QUEUE_TASK` instead of (or in addition to) `SELECT_QUEUE_TASK` |
| `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx` | Add `refreshVersion` to the dependency array of the conversation-fetch `useEffect` (line 344) and the pending-task full-fetch `useEffect` (line 312); skip cache when `refreshVersion` triggered the effect |

## Detailed Steps

### 1. `QueueContext.tsx`

- Add `refreshVersion: number` field to `QueueContextState` (initial value `0`).
- Add action: `{ type: 'REFRESH_SELECTED_QUEUE_TASK' }` to `QueueAction` union.
- Handle in reducer:
  ```ts
  case 'REFRESH_SELECTED_QUEUE_TASK':
      return { ...state, refreshVersion: state.refreshVersion + 1 };
  ```

### 2. `ProcessesSidebar.tsx`

In `openTaskInRoute`, replace the `SELECT_QUEUE_TASK`/`SELECT_PROCESS` dispatches in the same-hash branch with:
```ts
queueDispatch({ type: 'REFRESH_SELECTED_QUEUE_TASK' });
```
(The task is already selected; we only need to trigger a refresh, not re-select.)

### 3. `QueueTaskDetail.tsx`

- Read `refreshVersion` from `queueState`.
- In the conversation-fetch `useEffect` (currently ends with `}, [selectedTaskId, selectedProcessId, isPending, appDispatch]`):
  - Add `queueState.refreshVersion` to the dependency array.
  - When the effect fires due to a refresh (i.e., task was already selected), **bypass the cache** so the server is always queried. A simple way: compare previous `selectedTaskId` vs current to decide cache bypass, or pass a `forceRefresh` flag by tracking `lastRefreshVersion` in a ref.
- In the pending-task full-fetch `useEffect` (`}, [selectedTaskId, isPending]`), similarly add `queueState.refreshVersion` to re-fetch task metadata.

#### Cache bypass strategy
Track `lastFetchedRefreshVersionRef = useRef(0)`. At the start of the conversation-fetch effect:
```ts
const isRefresh = queueState.refreshVersion > 0 &&
    lastFetchedRefreshVersionRef.current !== queueState.refreshVersion;
lastFetchedRefreshVersionRef.current = queueState.refreshVersion;
```
If `isRefresh` is true, skip the cache check and always call the API.

## Out of Scope

- Auto-polling / periodic refresh (not requested)
- Visual feedback (spinner on click) — can be added later
- Refreshing the queue sidebar list itself (already handled by WebSocket events)
